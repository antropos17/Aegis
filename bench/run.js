/**
 * @file bench/run.js
 * @description Bench V1 run entrypoint. Creates one run directory and writes
 *   its environment manifest.
 *
 *   Sub-block B2.1 stops here on purpose: the scenario format (B2.2), the
 *   oracle adapters (B2.3, B2.6) and the SUT capture (B2.4) are separate
 *   blocks. What this file establishes is the run directory — the thing every
 *   later artefact is written into, and the reason a bench number can be traced
 *   back to a machine.
 *
 *   Usage:
 *     npm run bench:run
 *     npm run bench:run -- --scenario S1-agent-lifecycle --arm A
 *
 *   The `--` is not optional: without it npm keeps the flags for itself.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.11.0
 */
'use strict';

const fs = require('fs');
const path = require('path');

const manifest = require('./lib/manifest');

/** @type {string} Where run directories are created. Gitignored. */
const RUNS_DIR = path.join(manifest.ROOT, 'bench', 'runs');

/**
 * Scenario label used when none was named. Deliberately not `smoke` or
 * `default`: no scenario machinery exists until B2.2, and a name that sounds
 * like a scenario would document something that was never built.
 * @type {string}
 */
const NO_SCENARIO = 'no-scenario';

/** @type {RegExp} A label safe to use as one path segment. */
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const USAGE = `bench/run.js — create a Bench V1 run directory and write its manifest

Usage:  node bench/run.js [--scenario <id>] [--arm A|B|C]

  --scenario <id>  Scenario label for the run directory. Default: ${NO_SCENARIO}
                   (no scenario machinery exists before sub-block B2.2).
  --arm <A|B|C>    A = sensor + Sysmon · B = Sysmon + Procmon, no sensor
                   · C = sensor alone. Default: A.
  --help           Show this message.`;

/**
 * Parse `--key value` pairs. Unknown flags are an error rather than a silent
 * no-op: a typo in a bench invocation must not produce a run directory whose
 * name says something the run did not do.
 * @param {string[]} argv - Arguments after the script path.
 * @returns {{scenario: string, arm: string, help: boolean}}
 * @throws {Error} On an unknown flag, a missing value, or an invalid value.
 */
function parseArgs(argv) {
  const parsed = { scenario: NO_SCENARIO, arm: 'A', help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg !== '--scenario' && arg !== '--arm') {
      throw new Error(`unknown argument "${arg}"`);
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    if (arg === '--scenario') {
      if (!SAFE_LABEL.test(value)) {
        throw new Error(`--scenario "${value}" is not a safe directory-name segment`);
      }
      parsed.scenario = value;
    } else {
      if (!manifest.ARMS.includes(value)) {
        throw new Error(`--arm "${value}" is not one of ${manifest.ARMS.join(', ')}`);
      }
      parsed.arm = value;
    }
  }
  return parsed;
}

/**
 * Build the run id: UTC instant, scenario, arm.
 *
 * The timestamp keeps ISO-8601 ordering (run directories sort chronologically
 * as plain text) with `:` replaced, since it is illegal in a Windows path, and
 * the milliseconds dropped so two runs a second apart stay readable. Two runs
 * inside the same second collide — {@link createRunDir} refuses rather than
 * writing into an existing directory.
 * @param {Date} now
 * @param {string} scenario
 * @param {string} arm
 * @returns {string}
 */
function buildRunId(now, scenario, arm) {
  const stamp = now
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-');
  return `${stamp}-${scenario}-${arm}`;
}

/**
 * Create the run directory. Refuses an existing one — a bench run never writes
 * into a directory it did not create, or a re-run would silently blend two
 * machines' artefacts into one record.
 * @param {string} runId
 * @returns {string} Absolute path to the new directory.
 * @throws {Error} When the directory already exists.
 */
function createRunDir(runId) {
  const dir = path.join(RUNS_DIR, runId);
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.mkdirSync(dir); // no recursive — an existing directory must throw EEXIST
  return dir;
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
    console.error(`bench: ${err.message}\n`);
    console.error(USAGE);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const now = new Date();
  const runId = buildRunId(now, args.scenario, args.arm);
  const dir = createRunDir(runId);
  const record = manifest.collect({
    runId,
    scenario: args.scenario,
    arm: args.arm,
    startedAt: now.toISOString(),
  });
  const manifestPath = path.join(dir, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  const absent = [];
  for (const [group, fields] of Object.entries({ host: record.host, sensor: record.sensor })) {
    for (const [name, entry] of Object.entries(fields)) {
      if (entry && entry.unavailable) absent.push(`${group}.${name}: ${entry.unavailable}`);
    }
  }
  if (record.processCountAtStart.unavailable) {
    absent.push(`processCountAtStart: ${record.processCountAtStart.unavailable}`);
  }

  console.log(`run     ${runId}`);
  console.log(`arm     ${args.arm} — ${manifest.ARM_DESCRIPTIONS[args.arm]}`);
  console.log(`dir     ${dir}`);
  console.log(`written ${manifestPath}`);
  if (absent.length > 0) {
    console.log(`\n${absent.length} fact(s) recorded as ABSENT, not guessed:`);
    for (const line of absent) console.log(`  - ${line}`);
  }
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { NO_SCENARIO, RUNS_DIR, buildRunId, createRunDir, main, parseArgs };
