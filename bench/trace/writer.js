/**
 * @file bench/trace/writer.js
 * @module bench/trace/writer
 * @description Turns observations into trace records, chains them, and produces the
 *   exact bytes a trace directory holds.
 *
 *   It writes nothing by itself except through {@link writeTrace}: every byte this
 *   module produces is available as a string first, so a caller can compare a trace
 *   against one already on disk instead of overwriting it. That is the same contract
 *   `bench/replay.js` keeps for a recorded report — a verification that overwrites
 *   its own target is not one.
 *
 *   PATHS ARE NEUTRALIZED HERE, at recording time, and the header says so. A trace
 *   may be committed, so the clone root and the OS account name must not ride in it
 *   (`bench/lib/paths.js`, the same transform `manifest.js` applies). The rewrite is
 *   applied to EVERY string in a record, not to a list of path-shaped fields: an
 *   agent's `cwd` and an event's path have to move together, or `cwd-containment`
 *   stops matching in replay and the trace quietly measures something else.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.12.0
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { neutralizeRecorded } = require('../lib/paths');
const environment = require('./environment');
const schema = require('./schema');

/**
 * Split a recorded path into its file name and directory WITHOUT touching the
 * filesystem — the file it names is usually gone by the time a trace is read.
 *
 * The separator is read off the string rather than off the running platform, for the
 * reason `bench/lib/observed.js` `splitPath` gives: the bench runs on Windows but its
 * tests do not, and `path.basename` on POSIX hands back a whole `X:\...\claude.exe`
 * as the name.
 * @param {string} value - The path exactly as it was observed.
 * @returns {{name: string, directory: string}}
 */
function splitPath(value) {
  const at = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'));
  if (at < 0) return { name: value, directory: '' };
  return { name: value.slice(at + 1), directory: value.slice(0, at) };
}

/**
 * The ECS fields a record of this kind carries beside its envelope.
 *
 * Only `fs.event` has a subject ECS can name — one file, one path. The tick kinds
 * carry a provider's whole answer, which is a set rather than a subject, so they get
 * no top-level ECS entity and their content stays in `bench.input`. Writing a first
 * element of that set into `file.path` would make a set look like an observation
 * about one file.
 * @param {string} kind - One of `schema.KIND_NAMES`.
 * @param {Object} input - The record's `bench.input`.
 * @returns {Object} Fields to spread beside the envelope; `{}` when there are none.
 */
function ecsFieldsFor(kind, input) {
  if (kind !== 'fs.event') return {};
  const { name, directory } = splitPath(input.path);
  return { file: { path: input.path, name, directory } };
}

/**
 * Build one unchained trace record.
 *
 * `seq` lives at `bench.seq`, never at the top level, and that is load-bearing: both
 * audit-chain verifiers in this repository gate on a TOP-LEVEL `seq` equal to the line
 * number before they hash anything, so a trace record makes them refuse at line 0
 * instead of returning a verdict about a file they were never meant to read.
 * @param {Object} opts
 * @param {string} opts.trace - Trace id; the same value the header carries.
 * @param {number} opts.seq - 0-based position, which must equal the line number.
 * @param {string} opts.kind - One of `schema.KIND_NAMES`.
 * @param {number} opts.epochMs - The instant this observation carries.
 * @param {Object} opts.input - What was observed, in the kind's declared shape.
 * @param {Object} [opts.ambient] - Ambient state at this record: `populationReliable`
 *   and `isOtherPanelExpanded`. Required for observation kinds, refused on the others.
 * @returns {Object} A record without its `hash`.
 * @throws {import('./schema').TraceError} When the record does not fit its kind.
 */
function buildRecord(opts) {
  const spec = schema.RECORD_KINDS[opts.kind];
  if (!spec) {
    schema.refuse(
      schema.REFUSAL.UNKNOWN_KIND,
      `bench.kind ${JSON.stringify(opts.kind)} is outside the closed list ` +
        `[${schema.KIND_NAMES.join(', ')}]`,
    );
  }
  if (!Number.isSafeInteger(opts.seq) || opts.seq < 0) {
    schema.refuse(schema.REFUSAL.RECORD_MALFORMED, 'seq must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(opts.epochMs) || opts.epochMs < 0) {
    schema.refuse(schema.REFUSAL.RECORD_MALFORMED, 'epochMs must be a non-negative safe integer');
  }
  // BEFORE anything is derived from it. The ECS envelope is a function OF the input,
  // so building first would let a malformed input crash the derivation instead of
  // being refused by the name this format declares for it.
  schema.validateInput(opts.kind, opts.input, '');

  const bench = {
    trace: opts.trace,
    seq: opts.seq,
    kind: opts.kind,
    input: opts.input,
  };
  // Ambient state rides the OBSERVATION kinds only. `populationReliable` decides
  // whether attribution may look for an owner at all, and it changes during a trace —
  // which is why it is a per-record fact and not a header one. Attaching it to a
  // `clock.advance` would claim the harness observed a population while moving its
  // own clock.
  if (spec.observation) {
    const ambient = opts.ambient;
    if (
      !ambient ||
      typeof ambient.populationReliable !== 'boolean' ||
      typeof ambient.isOtherPanelExpanded !== 'boolean'
    ) {
      schema.refuse(
        schema.REFUSAL.RECORD_MALFORMED,
        `${opts.kind}: bench.ambient must carry populationReliable and isOtherPanelExpanded ` +
          'as booleans — an observation whose scope was not recorded cannot be replayed',
      );
    }
    bench.ambient = {
      populationReliable: ambient.populationReliable,
      isOtherPanelExpanded: ambient.isOtherPanelExpanded,
    };
  } else if (opts.ambient) {
    schema.refuse(
      schema.REFUSAL.RECORD_MALFORMED,
      `${opts.kind} observed nothing, so it carries no ambient scope`,
    );
  }

  const record = neutralizeRecorded({
    '@timestamp': new Date(opts.epochMs).toISOString(),
    ecs: { version: schema.ECS_VERSION },
    event: schema.ecsEnvelopeFor(opts.kind, opts.input),
    ...ecsFieldsFor(opts.kind, opts.input),
    bench,
  });
  // Validated AFTER neutralization, against the bytes that will be written: a record
  // that only passes before the rewrite is a record the reader would refuse.
  return schema.validateRecord(record, opts.seq);
}

/**
 * Chain a list of unchained records, seeding from `TRACE_GENESIS`.
 * @param {Object[]} records - Records without `hash`, in file order.
 * @returns {Object[]} New objects carrying `hash`; the inputs are not mutated.
 * @throws {import('./schema').TraceError} When a record's `bench.seq` is not its index.
 */
function chainRecords(records) {
  let prevHash = schema.TRACE_GENESIS;
  return records.map((record, i) => {
    if (!record.bench || record.bench.seq !== i) {
      schema.refuse(
        schema.REFUSAL.CHAIN_BROKEN,
        `record at index ${i} carries bench.seq ${JSON.stringify(record.bench?.seq)} — the ` +
          'sequence is the line number, so a chain that skips or repeats one is missing ' +
          'records or holds them twice',
      );
    }
    const hash = schema.recordHash(prevHash, record);
    prevHash = hash;
    return { ...record, hash };
  });
}

/**
 * The exact bytes of `trace.ndjson`: one record per line, newline-terminated.
 * @param {Object[]} records - Chained records.
 * @returns {string}
 */
function serializeTrace(records) {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

/**
 * The exact bytes of `trace.header.json`.
 *
 * Pretty-printed with a trailing newline, the same shape `bench/lib/report.js`
 * `serializeReport` fixes for a run report, so a header diffs line by line and a
 * text tool does not report a missing final newline.
 * @param {Object} header - The header object.
 * @returns {string}
 */
function serializeHeader(header) {
  return `${JSON.stringify(neutralizeRecorded(header), null, 2)}\n`;
}

/**
 * Build a header around an observed environment.
 *
 * The environment is OBSERVED and copied in whole — the caller does not get to hand
 * in digests, because a header whose digests came from anywhere but the tree would
 * agree with that tree for no reason.
 * @param {Object} opts
 * @param {string} opts.id - Trace id; also the directory name.
 * @param {number} opts.clockEpochMs - The instant the trace's virtual clock starts at.
 * @param {Object} opts.scope - Every key of `environment.REQUIRED_SCOPE_KEYS`, each
 *   `{value, unavailable?}`.
 * @param {Object} [opts.provenance] - Where the trace came from: the run directory it
 *   was derived from, and anything a reader needs to find that evidence again.
 * @param {Object} [opts.settings] - The settings the sensors ran under.
 * @param {Object} [opts.env] - A pre-observed environment; observed here when absent.
 * @returns {Object} A header that {@link module:bench/trace/environment.validateHeader} accepts.
 */
function buildHeader(opts) {
  const env = opts.env || environment.observeEnvironment({ clockEpochMs: opts.clockEpochMs });
  return {
    traceSchemaVersion: schema.TRACE_SCHEMA_VERSION,
    id: opts.id,
    provenance: opts.provenance || null,
    platform: env.platform,
    pathSep: env.pathSep,
    nodeVersion: env.nodeVersion,
    tz: env.tz,
    clock: { epochMs: opts.clockEpochMs },
    digests: env.digests,
    settings: opts.settings || null,
    neutralization: {
      repoRoot: require('../lib/paths').RECORDED_REPO_ROOT,
      user: require('../lib/paths').RECORDED_USER,
      covers:
        'every string in the header and in every record, so an agent cwd and an event path ' +
        'are rewritten by one map and still name the same tree',
    },
    scope: opts.scope,
  };
}

/**
 * Write a trace directory: the header, the records, and nothing else.
 *
 * REFUSES to write into a directory that already holds a trace. A trace is a
 * recording, and a recording that can be written twice is not evidence — the same
 * rule `bench/run.js` applies to a run directory.
 * @param {string} traceDir - Directory to create.
 * @param {Object} header - A validated header.
 * @param {Object[]} records - Chained records.
 * @returns {{headerPath: string, tracePath: string}} What was written.
 * @throws {import('./schema').TraceError} When the directory already holds a trace.
 */
function writeTrace(traceDir, header, records) {
  const headerPath = path.join(traceDir, schema.HEADER_FILENAME);
  const tracePath = path.join(traceDir, schema.TRACE_FILENAME);
  for (const existing of [headerPath, tracePath]) {
    if (fs.existsSync(existing)) {
      schema.refuse(
        schema.REFUSAL.FILE_UNREADABLE,
        `${existing} already exists — a trace is a recording and is never written twice`,
      );
    }
  }
  fs.mkdirSync(traceDir, { recursive: true });
  fs.writeFileSync(headerPath, serializeHeader(header), 'utf8');
  fs.writeFileSync(tracePath, serializeTrace(records), 'utf8');
  return { headerPath, tracePath };
}

module.exports = {
  buildHeader,
  buildRecord,
  chainRecords,
  ecsFieldsFor,
  serializeHeader,
  serializeTrace,
  splitPath,
  writeTrace,
};
