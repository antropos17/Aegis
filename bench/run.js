/**
 * @file bench/run.js
 * @description Bench V1 run entrypoint. Creates one run directory, writes its
 *   environment manifest, and — when a scenario was named — executes that
 *   scenario's steps and writes the expected-event catalogue they produced.
 *
 *   The oracle adapters (B2.3, B2.6) and the SUT capture (B2.4) are separate
 *   blocks: a run currently produces the record everything else will be scored
 *   against, and scores nothing itself.
 *
 *   Order matters here. A scenario is loaded and validated **before** the run
 *   directory exists, so a scenario that is wrong fails without leaving an
 *   empty run behind; a step that fails to execute happens after, and leaves
 *   the directory with the catalogue of everything that did happen first.
 *
 *   Exit codes: 0 the run completed · 1 a step failed to execute · 2 the
 *   invocation or the scenario was wrong, and nothing ran.
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

const actor = require('./lib/actor');
const catalogue = require('./lib/catalogue');
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

  --scenario <id>  A directory under bench/scenarios/. Its scenario.json is
                   validated and executed, and its expected-event catalogue is
                   written to expected.ndjson. Default: ${NO_SCENARIO} —
                   a run directory and a manifest, and nothing is executed.
  --arm <A|B|C>    A = sensor + Sysmon · B = Sysmon + Procmon, no sensor
                   · C = sensor alone. Default: A. The scenario decides which
                   arms it is meaningful in.
  --help           Show this message.

Exit codes: 0 completed · 1 a step failed to execute · 2 bad invocation or bad
scenario, nothing ran.`;

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
 * of the same scenario and arm inside one second therefore build the same id —
 * {@link createRunDir} refuses that, and {@link main} turns the refusal into
 * the same exit 2 every other bad input gets.
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
 * Load, validate and arm-check a scenario. Everything that can be known to be
 * wrong about a scenario is known here — before a run directory exists.
 * @param {string} id - Scenario directory name.
 * @param {string} arm - The arm asked for on the command line.
 * @returns {Object} The validated scenario.
 * @throws {Error} With a message naming the field, the kind or the arm.
 */
function prepareScenario(id, arm) {
  const { scenario } = actor.loadScenario(id);
  actor.validateScenario(scenario);
  actor.validateSteps(scenario);
  if (!scenario.arms.includes(arm)) {
    throw new Error(
      `scenario "${id}" declares itself meaningful in arm(s) ${scenario.arms.join(', ')}, not ${arm}`,
    );
  }
  return scenario;
}

/**
 * @param {string[]} argv - `process.argv.slice(2)`
 * @returns {Promise<number>} Process exit code.
 */
async function main(argv) {
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

  /** @type {Object|null} */
  let scenario = null;
  if (args.scenario !== NO_SCENARIO) {
    try {
      scenario = prepareScenario(args.scenario, args.arm);
    } catch (err) {
      console.error(`bench: ${err.message}`);
      return 2;
    }
  }

  const now = new Date();
  const runId = buildRunId(now, args.scenario, args.arm);
  let dir;
  try {
    dir = createRunDir(runId);
  } catch (err) {
    // The likely case is EEXIST: the same scenario and arm inside one second.
    // It fails legibly and with the same exit 2 as a bad flag — a bench loop
    // must not end in a Node stack trace, and it must never be tempting to
    // "fix" this by writing into a directory another run already owns.
    console.error(
      err.code === 'EEXIST'
        ? `bench: run directory ${runId} already exists — a run never writes into one it did not create`
        : `bench: could not create the run directory: ${err.message}`,
    );
    return 2;
  }
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

  let exitCode = 0;
  if (scenario) {
    console.log(`scenario ${scenario.id} — ${scenario.title}`);
    const outcome = await actor.execute(scenario, { runDir: dir, log: (m) => console.log(m) });
    const cataloguePath = catalogue.write(dir, outcome.events);
    console.log(`written ${cataloguePath} (${outcome.events.length} expected event(s))`);
    if (!outcome.ok) {
      const failed = outcome.steps.find((s) => s.status === 'failed');
      const skipped = outcome.steps.filter((s) => s.status === 'skipped').length;
      console.error(
        `\nbench: step "${failed.id}" (${failed.kind}) did not execute — ${failed.error}` +
          `\nbench: ${skipped} later step(s) were skipped; the catalogue holds only the ` +
          'events that actually happened',
      );
      exitCode = 1;
    }
  }

  if (absent.length > 0) {
    console.log(`\n${absent.length} fact(s) recorded as ABSENT, not guessed:`);
    for (const line of absent) console.log(`  - ${line}`);
  }
  return exitCode;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

module.exports = {
  NO_SCENARIO,
  RUNS_DIR,
  buildRunId,
  createRunDir,
  main,
  parseArgs,
  prepareScenario,
};
