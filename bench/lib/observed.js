/**
 * @file bench/lib/observed.js
 * @module bench/lib/observed
 * @description What the AEGIS sensor actually recorded during one bench run,
 *   read back out of the product's own audit log.
 *
 *   The source is deliberately the hash-chained audit JSONL the product writes
 *   in its ordinary mode of operation — `userData/audit-logs/aegis-audit-<day>.json`
 *   — and not a bench-only channel inside the main process. A capture path that
 *   exists only when the bench is running measures the bench, not the product.
 *
 *   Nothing here imports from `src/`. The chain check below is an INDEPENDENT
 *   re-implementation of the record format, for the same reason the catalogue is
 *   never diffed against a live stream: a sensor is never its own oracle. If
 *   `src/main/audit-hashchain.js` and this file ever disagree, that disagreement
 *   is a finding, and it cannot be one if both sides run the same code.
 *
 *   Three refusals, because a measurement that explains a doubt away is
 *   decoration (memory-bank/ai-mistakes.md #25):
 *
 *   - **A broken chain fails the run.** Not "skip the record and carry on" — the
 *     records around a break are not trustworthy, and a quietly shortened
 *     observation set reads exactly like a sensor that saw less.
 *   - **A loss marker inside the window fails the run.** `buffer-overflow-drop`
 *     is the product stating on disk that it threw records away. Whatever it
 *     threw away was inside the window we are about to call complete.
 *   - **Zero observations is a failure, not an empty file.** An empty
 *     `observed.ndjson` is indistinguishable from "the sensor was running and saw
 *     nothing", which is a claim no run that produced no records may make.
 *
 *   The one thing that is NOT a refusal is an unparseable LAST line. The bench
 *   stops the sensor by killing it (AEGIS has no external graceful-shutdown
 *   path), which can land mid-append; a truncated trailing line leaves a valid
 *   prefix, exactly as `audit-hashchain.js` documents. It is dropped and the
 *   drop is RECORDED — the run may be missing one observation and says so.
 *
 *   Field names are the same minimal ECS subset the catalogue writes
 *   (`bench/lib/catalogue.js`), so `expected.ndjson` and `observed.ndjson` are
 *   comparable line for line. A field the audit record does not carry is
 *   **omitted**, never nulled — the B2.2 convention. The audit persists less
 *   than the actor observes, and the gaps are the point:
 *
 *   | audit record | ECS shape | what it does NOT carry |
 *   |---|---|---|
 *   | `agent-enter` | `process.start` | image name, executable path, OS birth time |
 *   | `agent-exit` | `process.end` | exit code, terminating signal |
 *   | `file-access`/`config-access` + `created` | `file.creation` | owner pid, size, hash |
 *   | `file-access`/`config-access` + `deleted` | `file.deletion` | owner pid |
 *
 *   pid is the only join key the audit gives a process event; path is the only
 *   one it gives a file event. Everything the sensor observed that has no home
 *   in that subset — network connections, anomaly alerts, `modified`/`accessed`
 *   file events — is NOT written (a fifth shape would stop being the same
 *   subset) and is tallied instead, so what was left out is visible.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.11.0
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const catalogue = require('./catalogue');

/** @type {string} Name of the observation set inside a run directory. */
const OBSERVED_FILENAME = 'observed.ndjson';

/** @type {string} Name of the capture record inside a run directory. */
const META_FILENAME = 'observed.meta.json';

/** @type {string} Subdirectory of an Electron profile holding the audit files. */
const AUDIT_DIRNAME = 'audit-logs';

/** @type {RegExp} A daily audit file. One file, one independent chain. */
const AUDIT_FILENAME = /^aegis-audit-\d{4}-\d{2}-\d{2}\.json$/;

/**
 * Seed of every daily chain, from the record format this module reads.
 * Re-declared rather than imported: see the file docblock.
 * @type {string}
 */
const GENESIS = 'AEGIS-AUDIT-GENESIS-v1';

/** @type {string} Record type the product writes when it evicted entries. */
const DROP_MARKER_TYPE = 'buffer-overflow-drop';

/**
 * Slack added to both ends of the run window, in milliseconds.
 *
 * Deliberately small. The bench and the sensor run on one machine off one
 * clock, and every audit timestamp is taken inside the product's `log()` call —
 * i.e. AFTER the thing it describes — so a record caused by a step cannot
 * precede that step and nothing can be stamped after the sensor was killed.
 * Both ends are therefore inert by construction, which makes this a tolerance
 * for clock granularity and for the sub-millisecond ordering of two writes, not
 * a way to widen the window until the wanted records fall inside it. A generous
 * value would only pull the sensor's own start-up burst into the observation
 * set, where it would score as a run of file creations the scenario never made.
 * @type {number}
 */
const EPSILON_MS = 250;

/**
 * The closed set of audit types that map into the catalogue's ECS subset.
 *
 * `agent-enter`/`agent-exit` are session events: AEGIS reports a process start
 * when a scan first sees the process and a process end after the session
 * tracker's grace of missed scans, not from a process-creation notification. The
 * distance between the two instants is what arm A measures, so both map onto the
 * process shapes and neither is renamed to hide the difference.
 * @type {Readonly<Object<string, string>>}
 */
const PROCESS_TYPES = Object.freeze({
  'agent-enter': 'process.start',
  'agent-exit': 'process.end',
});

/**
 * Audit types whose records describe a file, keyed by the `action` the product
 * wrote. `modified` and `accessed` are absent on purpose: the catalogue has no
 * shape for them, and inventing one here would mean `expected.ndjson` and
 * `observed.ndjson` no longer speak the same subset.
 * @type {ReadonlySet<string>}
 */
const FILE_TYPES = Object.freeze(new Set(['file-access', 'config-access']));

/** @type {Readonly<Object<string, string>>} File actions that have a shape. */
const FILE_ACTIONS = Object.freeze({
  created: 'file.creation',
  deleted: 'file.deletion',
});

/**
 * An error the run must fail on. Carries a machine-readable `stage` so the
 * capture record can name what refused without parsing English.
 */
class ObservedError extends Error {
  /**
   * @param {string} stage - One of `audit-missing`, `chain-broken`,
   *   `records-lost`, `no-observations`.
   * @param {string} message - What a reader needs in order to act.
   */
  constructor(stage, message) {
    super(message);
    this.name = 'ObservedError';
    this.stage = stage;
  }
}

/**
 * Deterministic, key-order-independent serialization — the preimage half of the
 * record hash. Object keys sort recursively, so the result depends only on
 * content.
 * @param {*} value - Any JSON-serializable value.
 * @returns {string}
 */
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

/**
 * A record's chain hash: `sha256(prevHash + canonical(record without seq/hash))`.
 *
 * The JSON round-trip matches what was hashed at write time: `JSON.stringify`
 * drops undefined-valued keys, so a record carrying one would otherwise hash
 * differently here than it did on disk and produce a false break.
 * @param {string} prevHash - Previous record's hash, or {@link GENESIS}.
 * @param {Object} record - The record WITHOUT its `seq` and `hash` fields.
 * @returns {string} Hex-encoded SHA-256.
 */
function computeHash(prevHash, record) {
  return crypto
    .createHash('sha256')
    .update(prevHash + canonical(JSON.parse(JSON.stringify(record))))
    .digest('hex');
}

/**
 * The daily audit files an Electron profile holds, oldest first.
 * @param {string} profileDir - Electron `userData` directory.
 * @returns {string[]} Absolute paths. Empty when the directory is absent.
 */
function listAuditFiles(profileDir) {
  const dir = path.join(profileDir, AUDIT_DIRNAME);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (_) {
    return [];
  }
  return names
    .filter((n) => AUDIT_FILENAME.test(n))
    .sort()
    .map((n) => path.join(dir, n));
}

/**
 * Read one daily file and prove its chain.
 *
 * Every line is re-derived from the previous record's hash, from GENESIS. There
 * is no stored back-pointer to trust: linkage exists only if it recomputes.
 * @param {string} filePath - One `aegis-audit-<day>.json`.
 * @returns {{records: Object[], truncatedTail: string|null}} `truncatedTail` is
 *   the reason a trailing line was dropped, or `null` when none was.
 * @throws {ObservedError} On an interior line that does not parse, a seq that is
 *   not its line number, or a hash that does not recompute.
 */
function readChain(filePath) {
  const lines = fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  // A kill can land mid-append, and a half-written trailing line leaves a valid
  // prefix — the same asymmetry audit-hashchain.js documents for truncation. It
  // is dropped, and the fact that it existed is returned so the run records that
  // one observation may be missing. Only the LAST line gets this: a hole
  // anywhere else is a file nobody may read records out of.
  let truncatedTail = null;
  if (lines.length > 0) {
    try {
      JSON.parse(lines[lines.length - 1]);
    } catch (err) {
      truncatedTail =
        `the last line of ${path.basename(filePath)} does not parse (${err.message}) — it was ` +
        'dropped as a torn write, so this run may be missing the observation it held';
      lines.pop();
    }
  }

  const records = [];
  let prevHash = GENESIS;
  for (let i = 0; i < lines.length; i++) {
    let record;
    try {
      record = JSON.parse(lines[i]);
    } catch (err) {
      throw new ObservedError(
        'chain-broken',
        `${filePath} line ${i} does not parse (${err.message}) — an interior malformed line ` +
          'breaks the chain, and the records after it cannot be read as observations',
      );
    }
    if (record.seq !== i) {
      throw new ObservedError(
        'chain-broken',
        `${filePath} line ${i} carries seq ${JSON.stringify(record.seq)} — a chain whose ` +
          'sequence skips or repeats is missing records or holds them twice',
      );
    }
    const preimage = { ...record };
    delete preimage.seq;
    delete preimage.hash;
    const expected = computeHash(prevHash, preimage);
    if (expected !== record.hash) {
      throw new ObservedError(
        'chain-broken',
        `${filePath} seq ${i} does not recompute (stored ${record.hash}, derived ${expected}) — ` +
          'the file is not trustworthy, so no record is taken out of it',
      );
    }
    prevHash = record.hash;
    records.push({ ...record, auditFile: path.basename(filePath) });
  }
  return { records, truncatedTail };
}

/**
 * Split an observed path into its file name and directory WITHOUT touching the
 * filesystem — the file it names is usually gone by the time this runs.
 *
 * The separator is read off the string rather than taken from the running
 * platform: the bench only runs on Windows, but its tests do not, and
 * `path.basename` on POSIX would hand back a whole `X:\...\claude.exe` as the
 * name.
 * @param {string} value - The path exactly as the audit recorded it.
 * @returns {{name: string, directory: string}}
 */
function splitPath(value) {
  const flavour = /\\/.test(value) || /^[A-Za-z]:/.test(value) ? path.win32 : path.posix;
  return { name: flavour.basename(value), directory: flavour.dirname(value) };
}

/**
 * The `bench` block of an observed line: where the row came from, plus the three
 * sensor-specific observations ECS has no field for.
 *
 * `agent` is the display name from `src/shared/agent-database.json`, NOT the
 * image name — the audit does not persist the image name, so it must not be
 * written into `process.name` where a join would read it as one. `instanceId` is
 * carried verbatim and never parsed: it encodes the OS birth time as
 * `"<pid>:<ms>"`, and reconstructing an instant out of an identity string would
 * be a derivation dressed up as an observation.
 * @param {Object} record - The audit record.
 * @param {string} scenario - Scenario id.
 * @returns {Object}
 */
function benchBlock(record, scenario) {
  const block = {
    scenario,
    source: 'aegis-audit',
    auditFile: record.auditFile,
    auditSeq: record.seq,
    auditType: record.type,
  };
  if (typeof record.agent === 'string' && record.agent !== '') block.agent = record.agent;
  if (typeof record.instanceId === 'string' && record.instanceId !== '') {
    block.instanceId = record.instanceId;
  }
  if (record.attribution) block.attribution = record.attribution;
  return block;
}

/**
 * `process.pid`, but only when the audit gave one the OS could have handed out.
 *
 * `null` is what a file event carries (chokidar knows no owner) and `0` is what
 * a synthetic, process-less agent carries. Neither is a pid, and per the B2.2
 * convention neither is written as one — the field is left out, and its absence
 * is the observation.
 * @param {Object} record
 * @returns {Object|null} `{pid}` or null when there is nothing to write.
 */
function processIdentity(record) {
  return Number.isSafeInteger(record.pid) && record.pid > 0 ? { pid: record.pid } : null;
}

/**
 * Map one audit record onto the catalogue's ECS subset.
 * @param {Object} record - A chain-verified audit record.
 * @param {string} scenario - Scenario id, for the bench block.
 * @returns {Object|null} An ECS document, or `null` when the record has no shape
 *   in the subset (the caller tallies those; it never drops them silently).
 */
function toEcs(record, scenario) {
  const shapeName = PROCESS_TYPES[record.type]
    ? PROCESS_TYPES[record.type]
    : FILE_TYPES.has(record.type)
      ? FILE_ACTIONS[record.action]
      : undefined;
  if (!shapeName) return null;
  const shape = catalogue.EVENT_SHAPES[shapeName];

  const fields = {};
  if (shape.category === 'file') {
    if (typeof record.path !== 'string' || record.path.trim() === '') return null;
    const { name, directory } = splitPath(record.path);
    fields.file = { path: record.path, name, directory };
    const identity = processIdentity(record);
    if (identity) fields.process = identity;
  } else {
    const identity = processIdentity(record);
    if (identity) fields.process = identity;
  }

  return {
    '@timestamp': record.timestamp,
    ecs: { version: catalogue.ECS_VERSION },
    event: {
      kind: 'event',
      category: [shape.category],
      type: [shape.type],
      action: shape.action,
    },
    ...fields,
    bench: benchBlock(record, scenario),
  };
}

/**
 * Reduce every record the sensor wrote to the ones that belong to this run, in
 * the shape the catalogue speaks.
 * @param {Object} opts
 * @param {Object[]} opts.records - Chain-verified records, all files, in order.
 * @param {string} opts.scenario - Scenario id.
 * @param {string} opts.windowStart - ISO instant of the run's first step.
 * @param {string} opts.windowEnd - ISO instant the sensor was stopped.
 * @param {number} [opts.epsilonMs] - Override, for tests.
 * @returns {{events: Object[], skipped: {outOfWindow: number, unparsableTimestamp: number,
 *   dropMarkersOutsideWindow: number, byShapelessType: Object<string, number>}}}
 * @throws {ObservedError} When a loss marker sits inside the window.
 */
function select(opts) {
  const epsilon = opts.epsilonMs != null ? opts.epsilonMs : EPSILON_MS;
  const from = Date.parse(opts.windowStart) - epsilon;
  const to = Date.parse(opts.windowEnd) + epsilon;
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new ObservedError(
      'no-observations',
      `the run window [${opts.windowStart}, ${opts.windowEnd}] is not two UTC instants, so no ` +
        'record can be said to fall inside it',
    );
  }

  const events = [];
  const skipped = {
    outOfWindow: 0,
    unparsableTimestamp: 0,
    dropMarkersOutsideWindow: 0,
    byShapelessType: {},
  };

  for (const record of opts.records) {
    const at = Date.parse(record.timestamp);
    if (!Number.isFinite(at)) {
      skipped.unparsableTimestamp += 1;
      continue;
    }
    const inWindow = at >= from && at <= to;
    if (record.type === DROP_MARKER_TYPE) {
      if (!inWindow) {
        skipped.dropMarkersOutsideWindow += 1;
        continue;
      }
      const dropped = (record.details && record.details.droppedCount) || 'an unstated number of';
      throw new ObservedError(
        'records-lost',
        `the sensor recorded a ${DROP_MARKER_TYPE} marker at ${record.timestamp}, inside this ` +
          `run's window: ${dropped} entries were evicted before they reached disk. What was ` +
          'lost was lost from the interval this run is about to call observed',
      );
    }
    if (!inWindow) {
      skipped.outOfWindow += 1;
      continue;
    }
    const event = toEcs(record, opts.scenario);
    if (!event) {
      const key = record.action ? `${record.type}/${record.action}` : record.type;
      skipped.byShapelessType[key] = (skipped.byShapelessType[key] || 0) + 1;
      continue;
    }
    events.push(event);
  }
  return { events, skipped };
}

/**
 * Read a profile's audit trail and reduce it to this run's observations.
 * @param {Object} opts
 * @param {string} opts.profileDir - The Electron profile the sensor ran on.
 * @param {string} opts.scenario - Scenario id.
 * @param {string} opts.windowStart - ISO instant of the run's first step.
 * @param {string} opts.windowEnd - ISO instant the sensor was stopped.
 * @param {number} [opts.epsilonMs] - Override, for tests.
 * @returns {{events: Object[], files: string[], lines: number, truncatedTails: string[],
 *   skipped: Object}}
 * @throws {ObservedError} No audit file, a broken chain, a loss marker inside the
 *   window, or nothing observed at all.
 */
function capture(opts) {
  const files = listAuditFiles(opts.profileDir);
  if (files.length === 0) {
    throw new ObservedError(
      'audit-missing',
      `no audit file under ${path.join(opts.profileDir, AUDIT_DIRNAME)} — the sensor ran but ` +
        'persisted nothing, so there is no record of what it observed',
    );
  }

  const records = [];
  const truncatedTails = [];
  for (const file of files) {
    const chain = readChain(file);
    records.push(...chain.records);
    if (chain.truncatedTail) truncatedTails.push(chain.truncatedTail);
  }

  const { events, skipped } = select({
    records,
    scenario: opts.scenario,
    windowStart: opts.windowStart,
    windowEnd: opts.windowEnd,
    epsilonMs: opts.epsilonMs,
  });

  if (events.length === 0) {
    throw new ObservedError(
      'no-observations',
      `the audit holds ${records.length} verified record(s) but none of them falls in ` +
        `[${opts.windowStart}, ${opts.windowEnd}] with a shape this subset knows. An empty ` +
        'observed.ndjson would read as "the sensor saw nothing", which is a different claim',
    );
  }

  return { events, files, lines: records.length, truncatedTails, skipped };
}

/**
 * Write the observation set into a run directory.
 * @param {string} runDir - Absolute path of the run directory.
 * @param {Object[]} events - Never empty: {@link capture} refuses first.
 * @returns {string} Absolute path of the file written.
 */
function write(runDir, events) {
  const file = path.join(runDir, OBSERVED_FILENAME);
  fs.writeFileSync(file, catalogue.serialize(events), 'utf8');
  return file;
}

/**
 * Write the capture record: how the sensor was run, what window was read, and
 * everything that did NOT become a line of `observed.ndjson`.
 *
 * Always written in arm A, including — especially including — when the capture
 * refused. A run directory that holds no observations has to say why in a file,
 * or the next reader will assume the sensor was silent.
 * @param {string} runDir - Absolute path of the run directory.
 * @param {Object} record - Serializable capture record.
 * @returns {string} Absolute path of the file written.
 */
function writeMeta(runDir, record) {
  const file = path.join(runDir, META_FILENAME);
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return file;
}

module.exports = {
  AUDIT_DIRNAME,
  AUDIT_FILENAME,
  DROP_MARKER_TYPE,
  EPSILON_MS,
  FILE_ACTIONS,
  FILE_TYPES,
  GENESIS,
  META_FILENAME,
  OBSERVED_FILENAME,
  ObservedError,
  PROCESS_TYPES,
  canonical,
  capture,
  computeHash,
  listAuditFiles,
  readChain,
  select,
  splitPath,
  toEcs,
  write,
  writeMeta,
};
