/**
 * @file bench/trace/reader.js
 * @module bench/trace/reader
 * @description Reads a trace directory, or refuses it by name.
 *
 *   Every refusal here writes nothing and returns nothing: a trace half-read is an
 *   input nobody recorded, and a verdict derived from one would name a run that never
 *   existed. The reasons are the closed list in `./schema.js`, so a caller branches on
 *   `err.reason` rather than on message text.
 *
 *   ONE DELIBERATE DIFFERENCE FROM THE AUDIT READER. `bench/lib/observed.js`
 *   `readChain` tolerates an unparseable LAST line, because the product's audit file
 *   is appended to by a live process that a `taskkill /F` can interrupt mid-write. A
 *   trace is not appended to by anything: it is written once, offline, from a
 *   completed recording. A torn trailing line therefore means the file is damaged, not
 *   that a writer was killed, and it is refused like any other break.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.12.0
 */

'use strict';

const fs = require('fs');
const path = require('path');

const environment = require('./environment');
const schema = require('./schema');

/**
 * Read and parse one JSON file, refusing rather than throwing a bare syntax error.
 * @param {string} filePath - Absolute path.
 * @param {string} label - What the file is, for the message.
 * @returns {*} The parsed value.
 * @throws {import('./schema').TraceError} `file-unreadable` on either failure.
 */
function readJsonFile(filePath, label) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return schema.refuse(
      schema.REFUSAL.FILE_UNREADABLE,
      `${label} could not be read at ${filePath}: ${err.message}`,
    );
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    return schema.refuse(
      schema.REFUSAL.FILE_UNREADABLE,
      `${label} at ${filePath} does not parse: ${err.message}`,
    );
  }
}

/**
 * Verify the chain over already-split lines and return the parsed records.
 *
 * Three checks, in the order a reader can act on them: the line parses, its
 * `bench.seq` is its position, and its hash recomputes from the previous one. The
 * first record seeds from `TRACE_GENESIS`.
 * @param {string[]} lines - Non-empty lines, in file order.
 * @param {string} label - The file name, for messages.
 * @returns {Object[]} Parsed records, still carrying their `hash`.
 * @throws {import('./schema').TraceError} `chain-broken` at the first failure.
 */
function verifyChain(lines, label) {
  const records = [];
  let prevHash = schema.TRACE_GENESIS;
  for (let i = 0; i < lines.length; i++) {
    let record;
    try {
      record = JSON.parse(lines[i]);
    } catch (err) {
      schema.refuse(
        schema.REFUSAL.CHAIN_BROKEN,
        `${label} line ${i} does not parse (${err.message}) — a trace is written once and ` +
          'offline, so a line that does not parse is damage, not an interrupted append',
      );
    }
    const seq = record && record.bench ? record.bench.seq : undefined;
    if (seq !== i) {
      schema.refuse(
        schema.REFUSAL.CHAIN_BROKEN,
        `${label} line ${i} carries bench.seq ${JSON.stringify(seq)} — a chain whose sequence ` +
          'skips or repeats is missing records or holds them twice',
      );
    }
    const expected = schema.recordHash(prevHash, record);
    if (expected !== record.hash) {
      schema.refuse(
        schema.REFUSAL.CHAIN_BROKEN,
        `${label} seq ${i} does not recompute (stored ${JSON.stringify(record.hash)}, derived ` +
          `${expected}) — the file is not trustworthy, so no record is taken out of it`,
      );
    }
    prevHash = record.hash;
    records.push(record);
  }
  return records;
}

/**
 * Enforce the ordering rules in `schema.KIND_ORDER_RULES`.
 *
 * These are not style: each one names a kind pair the injection surface cannot
 * actually deliver in that order, so a trace that asks for it is asking for a replay
 * nobody can run. Refusing on read is what keeps the kind table from reading as a
 * promise the mechanism does not keep.
 * @param {Object[]} records - Chain-verified records, in file order.
 * @returns {void}
 * @throws {import('./schema').TraceError} `kind-order` at the first violation.
 */
function verifyKindOrder(records) {
  /** @type {Map<string, number>} */
  const firstSeen = new Map();
  for (const record of records) {
    const kind = record.bench.kind;
    for (const rule of schema.KIND_ORDER_RULES) {
      if (kind === rule.forbids && firstSeen.has(rule.after)) {
        schema.refuse(
          schema.REFUSAL.KIND_ORDER,
          `seq ${record.bench.seq} is a ${rule.forbids} and seq ${firstSeen.get(rule.after)} was ` +
            `an ${rule.after} — ${rule.why}`,
        );
      }
    }
    if (!firstSeen.has(kind)) firstSeen.set(kind, record.bench.seq);
  }
}

/**
 * Read one trace directory.
 *
 * Order of refusals is the order a reader can act on them: the files exist and parse,
 * the header is structurally sound, the header matches this machine and this tree, the
 * chain holds, each record fits its kind, and finally the kinds are in a replayable
 * order. A later check never runs on input an earlier one rejected.
 * @param {string} traceDir - Directory holding `trace.header.json` and `trace.ndjson`.
 * @param {Object} [opts]
 * @param {Object} [opts.env] - A pre-observed environment (see
 *   `environment.observeEnvironment`). Observed here when absent, at the header's own clock
 *   epoch so the UTC offset is read at the instant the trace is about to replay.
 * @returns {{header: Object, records: Object[]}}
 * @throws {import('./schema').TraceError} With a reason from `schema.REFUSAL`.
 */
function readTrace(traceDir, opts = {}) {
  const headerPath = path.join(traceDir, schema.HEADER_FILENAME);
  const tracePath = path.join(traceDir, schema.TRACE_FILENAME);

  const header = readJsonFile(headerPath, 'the trace header');
  const clockEpochMs =
    header && header.clock && Number.isSafeInteger(header.clock.epochMs)
      ? header.clock.epochMs
      : undefined;
  const env = opts.env || environment.observeEnvironment({ clockEpochMs });
  environment.validateHeader(header, env);

  let text;
  try {
    text = fs.readFileSync(tracePath, 'utf8');
  } catch (err) {
    return schema.refuse(
      schema.REFUSAL.FILE_UNREADABLE,
      `the trace records could not be read at ${tracePath}: ${err.message}`,
    );
  }
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return schema.refuse(
      schema.REFUSAL.EMPTY_TRACE,
      `${schema.TRACE_FILENAME} holds no records — an empty trace is indistinguishable from a ` +
        'recording that captured nothing, and neither is an input',
    );
  }

  const records = verifyChain(lines, schema.TRACE_FILENAME);
  for (const record of records) schema.validateRecord(record, record.bench.seq);
  verifyKindOrder(records);

  if (header.id !== records[0].bench.trace) {
    schema.refuse(
      schema.REFUSAL.HEADER_MALFORMED,
      `the header names trace ${JSON.stringify(header.id)} and its first record names ` +
        `${JSON.stringify(records[0].bench.trace)} — that directory was assembled out of two ` +
        'recordings',
    );
  }
  return { header, records };
}

module.exports = {
  readJsonFile,
  readTrace,
  verifyChain,
  verifyKindOrder,
};
