/**
 * @file bench/score.js
 * @module bench/score
 * @description Score one completed run (sub-block B2.5): confirm its catalogue
 *   against the oracle column, then score the sensor against the part of the
 *   catalogue that confirmation turned into ground truth, and write
 *   `matched.ndjson` and `metrics.json` beside the files it was derived from.
 *
 *   It needs no sensor, no scenario, no oracle channel and no built renderer. Its
 *   whole input is a run directory, and it is a pure function of the bytes in it:
 *   the same directory scored twice produces byte-identical output, because
 *   nothing about the moment of scoring reaches the files. `bench/lib/metrics.js`
 *   does the arithmetic and touches no filesystem API at all; this file owns every
 *   byte that lands on disk.
 *
 *   **Nothing here imports from `src/`.** Scoring is the measurement column, and a
 *   measurement that shared code with the thing it measures could not produce a
 *   disagreement anyone should believe.
 *
 *   ## What it refuses, and what it writes anyway
 *
 *   A directory nobody can fully read produces NO output — a partial score over
 *   it would name a run nobody recorded. That is a missing, unreadable or
 *   unparseable file, an NDJSON line that does not parse, a `manifest.json`,
 *   `observed.meta.json` and `oracle-loss.json` that disagree about which run they
 *   describe, an oracle accounting that counts normalized records with no file
 *   holding them, and an arm with no oracle column in its definition at all.
 *
 *   An oracle that ran and collected nothing is the opposite case and IS written:
 *   the file then records that no row of the catalogue is ground truth and that no
 *   sensor figure may be read as coverage — which is a result, not an absence of
 *   one — and the run exits 1. That is the same rule `oracle-loss.json` is written
 *   under: what can be counted is counted, and what could not be established is an
 *   explicit absence rather than a zero.
 *
 *   ## A recorded score is evidence
 *
 *   A directory that already holds a `metrics.json` is compared against, never
 *   overwritten: the rebuild is reported as identical or as differing, with the
 *   first differing byte, and nothing is written. `--out <dir>` puts a fresh score
 *   somewhere else, which is how the committed fixtures are scored without being
 *   touched. A verification that overwrites its own target is not one.
 *
 *   Exit codes follow `bench/run.js`: **2** the invocation was wrong and nothing
 *   ran · **1** the directory was refused, the oracle established no ground truth,
 *   the join window was absent, or a rebuild differed from a recorded score ·
 *   **0** the run was scored.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.14.0
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const join = require('./lib/join');
const metrics = require('./lib/metrics');
const sysmon = require('./lib/oracles/sysmon');
const { maxLatencyFrom } = require('./lib/report');
// The four run-file names, and the byte comparison, in the one spelling
// `bench/replay.js` already owns. A second declaration of either is a pair that
// drifts (memory-bank/ai-mistakes.md #24). Requiring that module is inert: its
// own entrypoint is behind `require.main === module`.
const {
  CATALOGUE_FILENAME,
  MANIFEST_FILENAME,
  META_FILENAME,
  OBSERVED_FILENAME,
  firstDifference,
} = require('./replay');

/** @type {string} The arm that runs a sensor, and therefore the only one with a sensor column. */
const SENSOR_ARM = 'A';

/**
 * The arms a score can be taken over: the two whose definition includes an
 * oracle. Arm C is the sensor alone with no oracle at all — there is nothing to
 * confirm the catalogue against, so a score over it would be the sensor marking
 * its own homework, and it is refused by name rather than written as zeroes.
 * @type {ReadonlyArray<string>}
 */
const SCORABLE_ARMS = Object.freeze(['A', 'B']);

/**
 * What each file this reads is, for a refusal message that tells a reader what
 * they are missing rather than only which path was absent.
 * @type {Readonly<Object<string, string>>}
 */
const SCORED_FILES = Object.freeze({
  [MANIFEST_FILENAME]: "the run's identity — runId, scenario and arm",
  [CATALOGUE_FILENAME]: 'the expected-event catalogue, one ECS document per line',
  [sysmon.LOSS_FILENAME]: "the oracle's own collection and loss accounting",
  [sysmon.ORACLE_FILENAME]: 'the oracle column, one ECS document per line',
  [OBSERVED_FILENAME]: 'what the sensor recorded, in the same ECS subset',
  [META_FILENAME]: 'how the sensor was run, and the scan interval the join window is derived from',
});

/** @type {ReadonlyArray<string>} The fields all three of a run's records carry, and must agree on. */
const IDENTITY_FIELDS = Object.freeze(['runId', 'scenario', 'arm']);

/** A refusal by this entrypoint. Never a finding about the sensor or the oracle. */
class ScoreError extends Error {
  /**
   * @param {string} stage - One of `usage`, `file-missing`, `file-unreadable`,
   *   `file-malformed`, `identity-mismatch`, `arm-unscorable`, `record-missing`,
   *   `write-failed`.
   * @param {string} message - What a reader needs in order to act.
   */
  constructor(stage, message) {
    super(message);
    this.name = 'ScoreError';
    this.stage = stage;
  }
}

/** @type {string} What a bad flag, an unusable --out and a missing directory all print. */
const USAGE = `Usage: node bench/score.js <run dir> [--out <dir>]

Scores one completed run: the catalogue confirmed against the oracle column, and
then the sensor scored against the confirmed part of it. Writes ${metrics.MATCHED_FILENAME}
(one line per catalogue row, both verdicts) and ${metrics.METRICS_FILENAME} (the counts over
them) into the run directory, or into --out.

A run directory that already holds ${metrics.METRICS_FILENAME} is COMPARED against and never
overwritten; use --out to score a committed fixture without touching it.

Exit codes: 0 scored · 1 the directory was refused, the oracle established no
ground truth, the join window was absent, or a rebuild differed · 2 the
invocation was wrong and nothing ran.`;

/**
 * @param {string[]} argv - `process.argv.slice(2)`
 * @returns {{dir: string, out: string|null}}
 * @throws {ScoreError} With stage `usage`, when nothing should run.
 */
function parseArgs(argv) {
  /** @type {string|null} */
  let dir = null;
  /** @type {string|null} */
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') {
      out = argv[i + 1];
      if (!out || out.startsWith('--')) {
        throw new ScoreError('usage', '--out needs a directory to write into');
      }
      i += 1;
      continue;
    }
    if (arg.startsWith('--')) throw new ScoreError('usage', `unknown flag ${arg}`);
    if (dir !== null) throw new ScoreError('usage', `unexpected second run directory ${arg}`);
    dir = arg;
  }
  if (dir === null) throw new ScoreError('usage', 'no run directory was given');
  return { dir: path.resolve(dir), out: out === null ? null : path.resolve(out) };
}

/**
 * Read one of the run's files as bytes, so the digest and the parse are taken
 * over the same read.
 * @param {string} dir - The run directory.
 * @param {string} name - One of {@link SCORED_FILES}.
 * @returns {string}
 * @throws {ScoreError} When it is absent or unreadable.
 */
function readRunFile(dir, name) {
  const file = path.join(dir, name);
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new ScoreError(
        'file-missing',
        `${file} is missing — it is ${SCORED_FILES[name]}, and a score derived from a directory ` +
          'missing it would be a score about a run nobody recorded',
      );
    }
    throw new ScoreError('file-unreadable', `${file} cannot be read: ${err.message}`);
  }
}

/**
 * Parse one of the run's JSON files.
 * @param {string} dir - The run directory.
 * @param {string} name - One of {@link SCORED_FILES}.
 * @returns {{value: Object, text: string}}
 * @throws {ScoreError} When it is absent or does not parse.
 */
function readJson(dir, name) {
  const text = readRunFile(dir, name);
  try {
    return { value: JSON.parse(text), text };
  } catch (err) {
    throw new ScoreError(
      'file-malformed',
      `${path.join(dir, name)} is not valid JSON (${err.message}) — it is ${SCORED_FILES[name]}`,
    );
  }
}

/**
 * Parse one of the run's NDJSON files: one ECS document per line.
 *
 * A line that does not parse fails the score by its number. Not "skip it and
 * carry on" — a dropped catalogue line is an expectation that silently stops
 * being ground truth, a dropped oracle line is a confirmation nobody credits, and
 * a dropped observed line is a sensor charged with less than it recorded.
 * @param {string} dir - The run directory.
 * @param {string} name - One of {@link SCORED_FILES}.
 * @returns {{events: Object[], text: string}}
 * @throws {ScoreError} When it is absent, or a line does not parse.
 */
function readNdjson(dir, name) {
  const text = readRunFile(dir, name);
  const lines = text.split('\n');
  const events = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    try {
      events.push(JSON.parse(lines[i]));
    } catch (err) {
      throw new ScoreError(
        'file-malformed',
        `${path.join(dir, name)} line ${i + 1} does not parse (${err.message}) — this file is ` +
          'one ECS document per line, and a line nobody can read is an event this score would ' +
          'otherwise drop without saying so',
      );
    }
  }
  return { events, text };
}

/**
 * The provenance of one file this score was built from.
 *
 * Content digests and not modification times: a digest is a fact about the bytes
 * and survives a copy, and nothing about the moment of scoring may reach the
 * output or the same directory would score differently twice.
 * @param {string} name
 * @param {string} text - The exact bytes that were read.
 * @returns {Object}
 */
function inputRecord(name, text) {
  return {
    name,
    bytes: Buffer.byteLength(text, 'utf8'),
    sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
  };
}

/**
 * The identity all of a run's records agree on.
 *
 * Written from the same variables by the same run, so a disagreement means the
 * directory was assembled out of two runs — and a score across it would confirm
 * one run's catalogue against another run's oracle.
 * @param {Array<{name: string, record: Object}>} records - Each parsed record and
 *   the file it came from.
 * @returns {{runId: string, scenario: string, arm: string}}
 * @throws {ScoreError} When a field is missing anywhere, or two records disagree.
 */
function readIdentity(records) {
  /** @type {Object<string, string>} */
  const identity = {};
  for (const field of IDENTITY_FIELDS) {
    for (const { name, record } of records) {
      const value = record ? record[field] : undefined;
      if (typeof value !== 'string' || value === '') {
        throw new ScoreError(
          'identity-mismatch',
          `${name} carries no "${field}" — the three records a run writes each carry all of ` +
            `${IDENTITY_FIELDS.join(', ')}, and a score cannot name a run one of them does not`,
        );
      }
      if (identity[field] === undefined) {
        identity[field] = value;
        continue;
      }
      if (identity[field] !== value) {
        throw new ScoreError(
          'identity-mismatch',
          `the run's records disagree about "${field}": ${JSON.stringify(identity[field])} and ` +
            `${JSON.stringify(value)} in ${name}. That directory was assembled out of two runs, ` +
            'and a score across it would confirm one run against another',
        );
      }
    }
  }
  return /** @type {{runId: string, scenario: string, arm: string}} */ (identity);
}

/**
 * The join window this run was measured under, exactly as the capture recorded
 * it, through the same three-intervals rule a live run and a replay both use.
 * @param {Object} meta - Parsed `observed.meta.json`.
 * @returns {{maxLatency: Object, ticksWhileProcessAlive: number|null}}
 * @throws {ScoreError} When the capture record carries neither field.
 */
function readWindow(meta) {
  const sensor = meta && meta.sensor;
  if (!sensor || sensor.scanInterval === undefined || sensor.scanInterval === null) {
    throw new ScoreError(
      'record-missing',
      `${META_FILENAME} carries no sensor.scanInterval. The join window is derived from the run ` +
        'or it is absent — there is no third source, because the third source would be a literal ' +
        '— so a run recorded before that field existed is refused rather than scored against a ' +
        'window nobody derived',
    );
  }
  if (sensor.ticksWhileProcessAlive === undefined) {
    throw new ScoreError(
      'record-missing',
      `${META_FILENAME} carries no sensor.ticksWhileProcessAlive. An absent tick count would ` +
        'quietly become "there was no process lifetime to speak about" instead of the count the ' +
        'run measured',
    );
  }
  return {
    maxLatency: maxLatencyFrom(sensor.scanInterval),
    ticksWhileProcessAlive: sensor.ticksWhileProcessAlive,
  };
}

/**
 * Read everything a score is taken over, and refuse the directory rather than
 * score a part of it.
 * @param {string} dir - The run directory.
 * @returns {Object} Everything `bench/lib/metrics.js` needs, plus the provenance.
 * @throws {ScoreError} On any of the refusals in this file's docblock.
 */
function loadRun(dir) {
  const inputs = [];
  const manifest = readJson(dir, MANIFEST_FILENAME);
  inputs.push(inputRecord(MANIFEST_FILENAME, manifest.text));

  const arm = manifest.value.arm;
  if (!SCORABLE_ARMS.includes(arm)) {
    throw new ScoreError(
      'arm-unscorable',
      `arm ${JSON.stringify(arm)} has no oracle column in its definition, so there is nothing to ` +
        `confirm this catalogue against. Only ${SCORABLE_ARMS.join(' and ')} are scored — a ` +
        'sensor scored against a catalogue nobody confirmed is the sensor marking its own work',
    );
  }

  const catalogue = readNdjson(dir, CATALOGUE_FILENAME);
  inputs.push(inputRecord(CATALOGUE_FILENAME, catalogue.text));

  const loss = readJson(dir, sysmon.LOSS_FILENAME);
  inputs.push(inputRecord(sysmon.LOSS_FILENAME, loss.text));

  // Absent by design when the oracle collected nothing: an empty file would read
  // as "the oracle ran and saw nothing", which is a different claim (B2.3). The
  // accounting is what says which of the two happened, so it decides whether the
  // absence is honest or a directory missing a file it should hold.
  const records = loss.value.records || {};
  const normalized = typeof records.normalized === 'number' ? records.normalized : 0;
  let oracle = [];
  if (fs.existsSync(path.join(dir, sysmon.ORACLE_FILENAME))) {
    const read = readNdjson(dir, sysmon.ORACLE_FILENAME);
    oracle = read.events;
    inputs.push(inputRecord(sysmon.ORACLE_FILENAME, read.text));
  } else {
    if (normalized > 0) {
      throw new ScoreError(
        'file-missing',
        `${sysmon.LOSS_FILENAME} counts ${normalized} normalized oracle record(s) and ` +
          `${path.join(dir, sysmon.ORACLE_FILENAME)} does not exist. The accounting and the ` +
          'column disagree about what was collected, and a score would take the smaller of two ' +
          'answers without saying which',
      );
    }
    inputs.push({
      name: sysmon.ORACLE_FILENAME,
      present: false,
      reason:
        'the oracle collected no record, so none was written — an empty file would be ' +
        `indistinguishable from "the oracle ran and saw nothing". Why is in ${sysmon.LOSS_FILENAME}`,
    });
  }

  /** @type {Object|null} */
  let observed = null;
  let maxLatency = { value: null, source: null, unavailable: null };
  /** @type {number|null} */
  let ticksWhileProcessAlive = null;
  /** @type {Array<{name: string, record: Object}>} */
  const identityRecords = [
    { name: MANIFEST_FILENAME, record: manifest.value },
    { name: sysmon.LOSS_FILENAME, record: loss.value },
  ];

  if (arm === SENSOR_ARM) {
    const meta = readJson(dir, META_FILENAME);
    inputs.push(inputRecord(META_FILENAME, meta.text));
    identityRecords.push({ name: META_FILENAME, record: meta.value });
    const read = readNdjson(dir, OBSERVED_FILENAME);
    inputs.push(inputRecord(OBSERVED_FILENAME, read.text));
    observed = read.events;
    const window = readWindow(meta.value);
    maxLatency = window.maxLatency;
    ticksWhileProcessAlive = window.ticksWhileProcessAlive;
  }

  const identity = readIdentity(identityRecords);
  return {
    ...identity,
    expected: catalogue.events,
    oracle,
    loss: loss.value,
    observed,
    maxLatency,
    ticksWhileProcessAlive,
    inputs,
  };
}

/**
 * Put a fresh score where it belongs, or hold it up against the one already
 * there.
 *
 * A recorded score is the evidence a rebuild is checked against, so it is never
 * overwritten in place. `metrics.json`'s presence is the switch: it is the file
 * a reader cites, and `matched.ndjson` is compared beside it.
 * @param {Object} opts
 * @param {string} opts.dir - The run directory.
 * @param {string|null} opts.out - `--out`, when it was given.
 * @param {Object<string, string>} opts.bytes - Filename → the bytes to write.
 * @returns {{mode: string, differs: boolean, differences: Array<Object>}}
 * @throws {ScoreError} When the output could not be written.
 */
function emit(opts) {
  const target = opts.out === null ? opts.dir : opts.out;
  const recorded =
    opts.out === null && fs.existsSync(path.join(opts.dir, metrics.METRICS_FILENAME));

  if (recorded) {
    const differences = [];
    for (const [name, bytes] of Object.entries(opts.bytes)) {
      /** @type {string} */
      let existing;
      try {
        existing = fs.readFileSync(path.join(opts.dir, name), 'utf8');
      } catch (err) {
        if (err.code !== 'ENOENT') {
          throw new ScoreError('file-unreadable', `${path.join(opts.dir, name)}: ${err.message}`);
        }
        differences.push({ name, at: 0, reason: 'the recorded directory holds no such file' });
        continue;
      }
      const at = firstDifference(existing, bytes);
      if (at !== -1) differences.push({ name, at, reason: `first differing byte at offset ${at}` });
    }
    return { mode: 'compared', differs: differences.length > 0, differences };
  }

  try {
    if (opts.out !== null) fs.mkdirSync(target, { recursive: true });
    for (const [name, bytes] of Object.entries(opts.bytes)) {
      fs.writeFileSync(path.join(target, name), bytes, 'utf8');
    }
  } catch (err) {
    throw new ScoreError('write-failed', `${target} could not be written: ${err.message}`);
  }
  return { mode: 'written', differs: false, differences: [] };
}

/**
 * Say the score out loud: one line per category per column, and the facts that
 * decide whether any of it may be read as coverage.
 * @param {Object} score - From `metrics.buildMetrics()`.
 * @returns {void}
 */
function reportMetrics(score) {
  console.log(
    `\noracle  ${score.oracle.id ?? 'none'} — ${score.oracle.records} record(s), ` +
      `collected ${score.oracle.collected}`,
  );
  for (const category of join.CATEGORIES) {
    const cover = score.oracle.coverage[category];
    const truth = score.groundTruth[category];
    console.log(
      `truth   ${category.padEnd(14)} ${String(truth.confirmationRate).padEnd(34)} ` +
        `${cover.measurable ? 'measurable' : `UNMEASURABLE — ${cover.reasonCode}`}`,
    );
  }
  for (const category of join.CATEGORIES) {
    const block = score.sensor[category];
    console.log(
      `sensor  ${category.padEnd(14)} recall ${String(block.recall).padEnd(26)} ` +
        `precision ${String(block.precision).padEnd(12)} (lower bound)`,
    );
  }
  const unconfirmed = join.CATEGORIES.reduce(
    (rows, category) => rows.concat(score.groundTruth[category].unconfirmedRows),
    [],
  );
  console.log(
    unconfirmed.length === 0
      ? 'score   every catalogue row an oracle could confirm was confirmed'
      : `score   ${unconfirmed.length} catalogue row(s) are not ground truth — excluded from every ` +
          'recall and precision denominator, listed with their reasons, never counted as a miss',
  );
  console.log(
    'score   no aggregate figure is derived from any of this: the project publishes per-category ' +
      'evidence',
  );
}

/**
 * @param {string[]} argv - `process.argv.slice(2)`
 * @returns {number} Process exit code.
 */
function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (!(err instanceof ScoreError)) throw err;
    console.error(`bench: ${err.message}\n\n${USAGE}`);
    return 2;
  }

  let run;
  try {
    run = loadRun(args.dir);
  } catch (err) {
    if (!(err instanceof ScoreError)) throw err;
    console.error(`bench: ${err.message}`);
    console.error('bench: nothing was written — a partial score is a score about no run');
    return 1;
  }

  let built;
  try {
    built = metrics.buildMetrics({
      runId: run.runId,
      scenario: run.scenario,
      arm: run.arm,
      expected: run.expected,
      oracle: run.oracle,
      loss: run.loss,
      observed: run.observed,
      maxLatency: run.maxLatency,
      ticksWhileProcessAlive: run.ticksWhileProcessAlive,
      inputs: run.inputs,
    });
  } catch (err) {
    if (!(err instanceof metrics.MetricsError) && !(err instanceof join.JoinError)) throw err;
    console.error(`bench: ${err.message}`);
    console.error('bench: nothing was written');
    return 1;
  }

  const bytes = {
    [metrics.MATCHED_FILENAME]: metrics.serializeMatched(built.matched),
    [metrics.METRICS_FILENAME]: metrics.serializeMetrics(built.metrics),
  };

  let outcome;
  try {
    outcome = emit({ dir: args.dir, out: args.out, bytes });
  } catch (err) {
    if (!(err instanceof ScoreError)) throw err;
    console.error(`bench: ${err.message}`);
    return 1;
  }

  const where = args.out === null ? args.dir : args.out;
  if (outcome.mode === 'written') {
    for (const name of Object.keys(bytes)) console.log(`written ${path.join(where, name)}`);
  } else if (outcome.differs) {
    console.log(`compared ${args.dir} — the rebuild DIFFERS from the recorded score`);
    for (const difference of outcome.differences) {
      console.log(`compare ${difference.name}: ${difference.reason}`);
    }
    console.log(
      'compare nothing was written. A recorded score is the evidence a rebuild is checked ' +
        'against, and a verification that overwrites its own target is not one',
    );
  } else {
    console.log(`compared ${args.dir} — the rebuild reproduces the recorded score byte for byte`);
  }

  reportMetrics(built.metrics);

  if (outcome.differs) return 1;
  if (!built.metrics.oracle.collected || built.metrics.oracle.records === 0) {
    console.error(
      '\nbench: the oracle established no ground truth for this run, so no figure here is a ' +
        `coverage result. Why it collected nothing is in ${sysmon.LOSS_FILENAME}`,
    );
    return 1;
  }
  if (built.metrics.sensor.scored === false && run.arm === SENSOR_ARM) {
    console.error(`\nbench: ${built.metrics.sensor.unavailable}`);
    return 1;
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`bench: the score failed unexpectedly — ${(err && err.stack) || err}`);
    process.exitCode = 1;
  }
}

module.exports = {
  IDENTITY_FIELDS,
  SCORABLE_ARMS,
  SCORED_FILES,
  SENSOR_ARM,
  ScoreError,
  USAGE,
  emit,
  inputRecord,
  loadRun,
  main,
  parseArgs,
  readIdentity,
  readNdjson,
  readWindow,
  reportMetrics,
};
