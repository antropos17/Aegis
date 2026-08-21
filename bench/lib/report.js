/**
 * @file bench/lib/report.js
 * @module bench/lib/report
 * @description The report-shaping steps that are the same whether a report comes
 *   from a live run or from a recorded one: the join bound derived from the scan
 *   interval that run used, the exact bytes a report is written as, the summary it
 *   is said out loud with, and the fingerprint of the source that produced all
 *   three.
 *
 *   It exists so that `bench/run.js` and `bench/replay.js` share one definition of
 *   each instead of two that can drift, and so that replay can have them **without
 *   loading the live-run graph**. Requiring `run.js` for these functions would pull
 *   the actor, the sensor, the catalogue writer and ajv into a process whose whole
 *   contract is that it reads four files out of one directory — inert at load time,
 *   but a replay whose module graph can reach the sensor is one nobody can prove
 *   did not.
 *
 *   Imports: `./join`, which reads and writes nothing, and `./paths` for the
 *   recording-time path rewrite applied at serialize time. `./paths` does not
 *   touch the filesystem, git, or the live-run graph.
 *
 *   **The one filesystem read.** While this module is being loaded, it hashes the
 *   two files whose bytes decide a report's bytes — `./join.js` and this file — and
 *   freezes the result as {@link RENDERER_FINGERPRINT}. Once, at load, and never
 *   again: a bench run may execute for minutes against a dirty working tree, and a
 *   hash taken later would describe a file the run had that long to change.
 *
 *   It is a read of the DISK, not of the loader, and the difference is worth stating
 *   rather than glossing: `./join.js` is already in the module cache by the time this
 *   read happens, and this file is being executed while it reads itself. So under a
 *   concurrent edit of the working tree these digests describe the file bytes at that
 *   moment, which can differ from the bytes Node compiled. Closing that gap would take
 *   loader introspection; short of it, a disk read taken at load is the closest
 *   observation available, and {@link RENDERER_SOURCE} says so in the record itself.
 *   Nothing else here touches the filesystem, the clock, the environment or `src/`.
 *
 *   **What the fingerprint covers, and what it does not.** Those two files own the
 *   whole path from two event arrays to the bytes on disk: `join.js` builds the
 *   report and `serializeReport` writes it, and `join.js` requires nothing at all,
 *   so the pair is the closure rather than a sample of it. It does not cover the
 *   Node version, the platform, or anything in `bench/replay.js` and `bench/run.js`
 *   outside the serializer they both call.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.11.0
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { neutralizeRecorded } = require('./paths');
const join = require('./join');

/**
 * How many scan intervals a sensor is given to report something before the join
 * stops calling it that expectation's observation.
 *
 * Three, and not fewer, because AEGIS reports a process end only after
 * `session-tracker.js`'s grace of two consecutive scans that missed the process:
 * the floor for `process/end` is already two intervals plus the scan that
 * concludes it. It is not generous — a `process/end` that lands past the bound
 * produces a miss that is a property of the window, which is why every miss in
 * the report names its nearest candidate and the distance to it.
 * @type {number}
 */
const MAX_LATENCY_INTERVALS = 3;

/** @type {number} Shape version of the `reportRenderer` block. Bump when a field changes meaning. */
const RENDERER_FINGERPRINT_SCHEMA_VERSION = 1;

/** @type {string} The digest the fingerprint is taken with. Recorded, never assumed by a reader. */
const RENDERER_HASH_ALGORITHM = 'sha256';

/**
 * The renderer source set: field name in the fingerprint → absolute path.
 *
 * Two files and no more, because two files are the whole closure. `join.js`
 * builds the report object and requires nothing; this module derives the window
 * and serializes the object. A third entry would either be a file that cannot
 * change a byte of the output, or evidence that the closure has grown and the
 * covered set has to grow with it.
 * @type {Readonly<Object<string, string>>}
 */
const RENDERER_FILES = Object.freeze({
  joinSha256: path.join(__dirname, 'join.js'),
  reportHelperSha256: path.join(__dirname, 'report.js'),
});

/** @type {Readonly<Object<string, string>>} Field name → repository-relative path, for messages. */
const RENDERER_FILE_LABELS = Object.freeze({
  joinSha256: 'bench/lib/join.js',
  reportHelperSha256: 'bench/lib/report.js',
});

/** @type {string} What the fingerprint is a statement about — carried in every manifest that has one. */
const RENDERER_COVERS =
  'bench/lib/join.js and bench/lib/report.js: the report object, the join window and the exact ' +
  'bytes the report is serialized as. join.js requires nothing, so these two files are the whole ' +
  'closure rather than a sample of it. NOT covered: the Node version, the platform, and every ' +
  'part of bench/run.js and bench/replay.js outside the serializer they both call';

/** @type {string} When and from where the hashes were taken, and what that does and does not establish. */
const RENDERER_SOURCE =
  'sha256 over the bytes of those two files, read from disk once while bench/lib/report.js was ' +
  'being loaded into the process, and never again — a hash taken later would describe a file the ' +
  'run had minutes to change. It is a disk observation and not a loader one: join.js is already ' +
  'in the module cache when this read happens, and report.js reads its own file while executing. ' +
  'Under a concurrent modification of the working tree these digests therefore describe the file ' +
  'bytes at that moment, which can differ from the bytes Node compiled. Without loader ' +
  'introspection that is the closest observation available';

/** @type {RegExp} A lower-case sha256 digest, as `crypto` renders it. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * The three ways a recorded fingerprint can stand to the one replaying it. They
 * are names rather than English so a caller never parses a sentence.
 * @type {Readonly<Object<string, string>>}
 */
const RENDERER_PROVENANCE = Object.freeze({
  MATCH: 'renderer-match',
  SKEW: 'renderer-skew',
  LEGACY: 'legacy-unversioned',
});

/**
 * Hash one renderer source file.
 * @param {string} file - Absolute path.
 * @returns {{value: string|null, unavailable?: string}} Absent, never guessed:
 *   a file this process could not read produces no digest and says so.
 */
function hashFile(file) {
  try {
    return {
      value: crypto.createHash(RENDERER_HASH_ALGORITHM).update(fs.readFileSync(file)).digest('hex'),
    };
  } catch (err) {
    return {
      value: null,
      unavailable: `${file} could not be read: ${(err && err.message) || err}`,
    };
  }
}

/**
 * Take the fingerprint of the renderer this process is about to run.
 *
 * Called exactly once, below, during this module's own initialization. Not
 * exported as a live probe: the whole point of the value is that it describes
 * the loaded code, and a second call minutes later would describe the disk.
 * @returns {Object} The `reportRenderer` block, ready to serialize.
 */
function fingerprintLoadedRenderer() {
  /** @type {Object} */
  const block = {
    schemaVersion: RENDERER_FINGERPRINT_SCHEMA_VERSION,
    algorithm: RENDERER_HASH_ALGORITHM,
  };
  const unreadable = [];
  for (const [field, file] of Object.entries(RENDERER_FILES)) {
    const hashed = hashFile(file);
    block[field] = hashed.value;
    if (hashed.unavailable) unreadable.push(hashed.unavailable);
  }
  block.covers = RENDERER_COVERS;
  block.source = RENDERER_SOURCE;
  if (unreadable.length > 0) block.unavailable = unreadable.join('; ');
  return block;
}

/**
 * The fingerprint of the renderer running in this process, frozen at load.
 *
 * `bench/run.js` hands it to `manifest.collect()` so the run records which source
 * bytes produced its report; `bench/replay.js` holds a recording's copy up
 * against it. A run that predates the block carries none, and that is read as
 * `legacy-unversioned` rather than filled in.
 * @type {Readonly<Object>}
 */
const RENDERER_FINGERPRINT = Object.freeze(fingerprintLoadedRenderer());

/**
 * How a recorded fingerprint stands to the renderer in this process.
 *
 * The verdict is about renderer IDENTITY and nothing else. Whether a rebuild
 * reproduces a recorded report's bytes is a separate observation, made against
 * the recorded file itself, and the two are reported side by side rather than
 * one being read off the other: identical bytes under skew are still identical
 * bytes, and a divergence under a match is still a divergence.
 * @param {Object|null|undefined} recorded - `manifest.reportRenderer`, verbatim.
 * @param {Readonly<Object>} [current] - Defaults to {@link RENDERER_FINGERPRINT}.
 * @returns {{provenance: string, recorded: Object|null, current: Object,
 *   differences: Array<{field: string, file: string, recorded: *, current: *}>,
 *   reason: string|null}} `reason` is set only where the block exists but cannot
 *   be read as a version-1 sha256 fingerprint.
 */
function classifyRenderer(recorded, current = RENDERER_FINGERPRINT) {
  const verdict = {
    provenance: RENDERER_PROVENANCE.LEGACY,
    recorded: null,
    current,
    differences: [],
    reason: null,
  };

  if (recorded === null || recorded === undefined || typeof recorded !== 'object') {
    return verdict;
  }
  verdict.recorded = recorded;

  if (recorded.schemaVersion !== RENDERER_FINGERPRINT_SCHEMA_VERSION) {
    verdict.provenance = RENDERER_PROVENANCE.SKEW;
    verdict.reason =
      `the recorded fingerprint is schema version ${JSON.stringify(recorded.schemaVersion)}, and ` +
      `this replay reads version ${RENDERER_FINGERPRINT_SCHEMA_VERSION} — a block it cannot read ` +
      'is not a block it may call a match';
    return verdict;
  }
  if (recorded.algorithm !== RENDERER_HASH_ALGORITHM) {
    verdict.provenance = RENDERER_PROVENANCE.SKEW;
    verdict.reason =
      `the recorded fingerprint was taken with ${JSON.stringify(recorded.algorithm)} and this one ` +
      `with ${RENDERER_HASH_ALGORITHM}; two digests of different algorithms cannot be compared`;
    return verdict;
  }

  for (const field of Object.keys(RENDERER_FILES)) {
    const was = recorded[field];
    const is = current[field];
    if (typeof was !== 'string' || !SHA256_HEX.test(was) || was !== is) {
      verdict.differences.push({
        field,
        file: RENDERER_FILE_LABELS[field],
        recorded: was === undefined ? null : was,
        current: is === undefined ? null : is,
      });
    }
  }

  verdict.provenance =
    verdict.differences.length === 0 ? RENDERER_PROVENANCE.MATCH : RENDERER_PROVENANCE.SKEW;
  return verdict;
}

/**
 * The bytes a report is written as, in the one form a run directory holds it in.
 *
 * One definition, called by the live run and by a replay alike. Two would be a
 * pair that can drift by a newline, and the difference would be reported as a
 * finding about the run rather than about the writer. This function is inside
 * the fingerprinted set for the same reason: it decides bytes.
 * @param {Object} report - From `join.buildReport()`.
 * @returns {string}
 */
function serializeReport(report) {
  return `${JSON.stringify(neutralizeRecorded(report), null, 2)}\n`;
}

/**
 * The join bound, from the interval — {@link MAX_LATENCY_INTERVALS} of them.
 * @param {{value: number|null, source: string, unavailable?: string}} scanInterval
 * @returns {{value: number|null, source: string, unavailable?: string}} Milliseconds.
 */
function maxLatencyFrom(scanInterval) {
  if (scanInterval.value === null) {
    return {
      value: null,
      source: scanInterval.source,
      unavailable:
        `the scan interval this run used could not be established — ${scanInterval.unavailable}. ` +
        'A join window is derived from the run or it is absent; it is never defaulted, because ' +
        'every recall figure in the report is a statement about that window',
    };
  }
  return {
    value: scanInterval.value * MAX_LATENCY_INTERVALS * 1000,
    source: `${scanInterval.value} s × ${MAX_LATENCY_INTERVALS} scan intervals — ${scanInterval.source}`,
  };
}

/**
 * Say the report out loud: one line per category, and the two facts that decide
 * whether its numbers may be read as coverage at all.
 * @param {Object} report - From `join.buildReport()`.
 * @returns {void}
 */
function reportJoin(report) {
  const bound = report.join.maxLatencyMs;
  console.log(
    `\njoin    [expected, expected + ${bound === null ? 'ABSENT' : `${bound} ms`}] — ` +
      report.join.maxLatencySource,
  );
  for (const category of join.CATEGORIES) {
    const block = report.categories[category];
    const latency =
      block.latencyMs.p50 === null ? 'no latency point' : `p50 ${block.latencyMs.p50} ms`;
    console.log(`report  ${category.padEnd(14)} ${block.recall.padEnd(34)} ${latency}`);
  }
  if (report.processObservable === false) {
    console.log(
      'report  processObservable false — no scan tick fell inside the process lifetime, so the ' +
        'process categories name a structural gap, not a coverage result',
    );
  }
  console.log(
    report.unmatchedObserved.length === 0
      ? 'report  every observed event cancelled an expectation'
      : `report  ${report.unmatchedObserved.length} observed event(s) cancelled no expectation — ` +
          'listed in the report, where they are signal rather than debris',
  );
  if (report.join.unavailable) console.error(`\nbench: ${report.join.unavailable}`);
}

module.exports = {
  MAX_LATENCY_INTERVALS,
  RENDERER_COVERS,
  RENDERER_FILES,
  RENDERER_FILE_LABELS,
  RENDERER_FINGERPRINT,
  RENDERER_FINGERPRINT_SCHEMA_VERSION,
  RENDERER_HASH_ALGORITHM,
  RENDERER_PROVENANCE,
  RENDERER_SOURCE,
  classifyRenderer,
  maxLatencyFrom,
  reportJoin,
  serializeReport,
};
