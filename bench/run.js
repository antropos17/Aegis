/**
 * @file bench/run.js
 * @description Bench V1 run entrypoint. Creates one run directory, writes its
 *   environment manifest, and — when a scenario was named — executes that
 *   scenario's steps and writes the expected-event catalogue they produced.
 *
 *   In **arm A** it also runs the AEGIS sensor across the scenario and writes
 *   what the sensor recorded to `observed.ndjson`, read back out of the
 *   product's own hash-chained audit log (`bench/lib/observed.js`), then joins
 *   the two files and writes `run-report.json` (`bench/lib/join.js`) — recall and
 *   latency per category, and the observations that cancelled nothing. Arms B and
 *   C start nothing and write no observation set — arm C is defined as the sensor
 *   alone with no oracle, and measuring its overhead is a later block.
 *
 *   The oracle adapters (B2.6) are still a separate block: the report scores the
 *   sensor against the catalogue and against nothing else, and the catalogue is
 *   still unconfirmed until an oracle confirms it.
 *
 *   The manifest also records **which report renderer this process is running** —
 *   `reportRenderer`, the sha256 of `bench/lib/join.js` and `bench/lib/report.js`
 *   frozen while they were loaded. `sensor.gitSha` cannot stand in for it: a run
 *   against a dirty tree names a commit whose bytes are not the ones rendering
 *   the report, and every arm-A run so far has been exactly that. A replay reads
 *   the block back and says whether the renderer it is running is the one that
 *   produced the recorded report, separately from whether it reproduced its bytes.
 *
 *   Order matters here, in three places.
 *
 *   A scenario is loaded and validated **before** the run directory exists, so a
 *   scenario that is wrong fails without leaving an empty run behind; a step
 *   that fails to execute happens after, and leaves the directory with the
 *   catalogue of everything that did happen first.
 *
 *   The sensor is started **before the first step and after the manifest**, and
 *   a sensor that will not start fails the run before anything is executed: an
 *   arm-A run whose sensor never ran is an arm-C run wearing the wrong name.
 *
 *   `expected.ndjson` is written **after the sensor is stopped**. AEGIS watches
 *   the project directory, so a file the harness creates inside the run
 *   directory while the sensor is live is observed and audited — the catalogue
 *   would show up as a file creation in the sensor's own answer, a false
 *   positive the harness manufactured for itself.
 *
 *   Exit codes: 0 the run completed · 1 a step failed to execute, the sensor
 *   could not be run or read, or the run report could not be derived · 2 the
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
const join = require('./lib/join');
const manifest = require('./lib/manifest');
const observed = require('./lib/observed');
// Destructured rather than taken as a namespace: `main` binds a local `report`
// for the object it just built, and a namespace of the same name would be
// shadowed exactly where these are called. They live in `lib/report.js` so that
// `bench/replay.js` can share them without loading this file's graph — above all
// `serializeReport`, which is the one definition of a report's bytes, and
// `RENDERER_FINGERPRINT`, which names the source those bytes came out of.
const {
  MAX_LATENCY_INTERVALS,
  RENDERER_FINGERPRINT,
  maxLatencyFrom,
  reportJoin,
  serializeReport,
} = require('./lib/report');
const sensor = require('./lib/sensor');

/** @type {string} Where run directories are created. Gitignored. */
const RUNS_DIR = path.join(manifest.ROOT, 'bench', 'runs');

/** @type {string} The settings file an Electron profile holds. */
const SETTINGS_FILENAME = 'settings.json';

/**
 * The one arm that runs the sensor. B is Sysmon and Procmon without it, and C
 * is the sensor alone with no oracle — an overhead measurement that scores
 * nothing and therefore captures nothing here.
 * @type {string}
 */
const SENSOR_ARM = 'A';

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
                   · C = sensor alone. Default: ${SENSOR_ARM}. The scenario
                   decides which arms it is meaningful in.
  --help           Show this message.

In arm ${SENSOR_ARM} with a scenario, AEGIS itself is run across the steps on a
run-scoped Electron profile, and what it recorded is written to observed.ndjson
next to the catalogue. It needs a built renderer: run \`npm run build:renderer\`
first, or the sensor refuses to start and the run stops before acting.

Exit codes: 0 completed · 1 a step failed to execute, or the sensor could not be
run or read · 2 bad invocation or bad scenario, nothing ran.`;

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
 * The instant the run began ACTING, which is where the observation window opens.
 *
 * Not the manifest's `startedAt`: between the two the sensor is started and
 * waited for, and everything it records in that interval — its own start-up
 * burst, the agents already running on the machine — is a fact about the
 * machine, not about this scenario. The window opens where the stimulus does.
 * @param {Array<{startedAt?: string}>} steps - `actor.execute()`'s step log.
 * @returns {string|null} Null when no step ever started.
 */
function firstStepStartedAt(steps) {
  const started = steps.find((s) => typeof s.startedAt === 'string');
  return started ? started.startedAt : null;
}

/**
 * The interval the scenario's own processes were alive, from the catalogue.
 *
 * Its purpose is to keep a phase coincidence from being read as a sensor
 * failure: a subject that lives 35 s while the sensor is still on its startup
 * cadence may be scanned once or not at all, and "the sensor saw no process"
 * and "no scan happened while a process existed" are different findings.
 * @param {Object[]} events - Catalogue events from `actor.execute()`.
 * @returns {{from: string|null, to: string|null}}
 */
function processAliveWindow(events) {
  const at = (type) =>
    events
      .filter((e) => e.event.category.includes('process') && e.event.type.includes(type))
      .map((e) => e['@timestamp'])
      .sort();
  const starts = at('start');
  const ends = at('end');
  if (starts.length === 0 || ends.length === 0) return { from: null, to: null };
  return { from: starts[0], to: ends[ends.length - 1] };
}

/**
 * The scan interval the sensor actually ran on, and where it was read.
 *
 * Not the manifest: `manifest.collect()` runs before the sensor exists, so the
 * profile it would have to read has not been created yet — the manifest cannot
 * carry this field honestly, and a value copied out of the product's defaults
 * would be `src/` contributing to its own measurement record.
 *
 * Two sources, in order, and each one is a thing that happened rather than a
 * constant:
 *
 * 1. `scanIntervalSec` in the run-scoped profile's `settings.json` — the
 *    configuration the sensor loaded. AEGIS writes that file when it first
 *    persists anything (seeing an agent is enough), so it normally exists by the
 *    time a run ends, but nothing guarantees it.
 * 2. The median gap between the scan ticks the sensor itself reported AFTER its
 *    cadence settled. Only then: before that it is on the startup schedule at
 *    three times the configured interval, and those gaps describe the wrong
 *    regime.
 *
 * Neither one produced a number → the interval is ABSENT, and it stays absent.
 * There is no third source, because the third source would be a literal.
 * @param {Object} handle - The sensor handle, after it has been stopped.
 * @returns {{value: number|null, source: string, unavailable?: string}} Seconds.
 */
function resolveScanInterval(handle) {
  const settingsPath = path.join(handle.profileDir, SETTINGS_FILENAME);
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (Number.isFinite(settings.scanIntervalSec) && settings.scanIntervalSec > 0) {
      return { value: settings.scanIntervalSec, source: `scanIntervalSec in ${settingsPath}` };
    }
  } catch (_) {
    // No settings file, or one that does not parse: the cadence is next.
  }

  if (handle.steadyCadence) {
    const steady = handle.ticks.filter((t) => Date.parse(t) >= Date.parse(handle.steadyAt));
    const gaps = [];
    for (let i = 1; i < steady.length; i++) {
      gaps.push(Date.parse(steady[i]) - Date.parse(steady[i - 1]));
    }
    gaps.sort((a, b) => a - b);
    const median = gaps.length > 0 ? gaps[Math.ceil(gaps.length / 2) - 1] : null;
    const seconds = median === null ? 0 : Math.round(median / 1000);
    if (seconds > 0) {
      return {
        value: seconds,
        source:
          `the median gap (${median} ms) between the ${steady.length} scan ticks the sensor ` +
          `reported after its cadence settled, rounded to whole seconds — ${settingsPath} ` +
          'carried no usable scanIntervalSec',
      };
    }
  }

  return {
    value: null,
    source: `scanIntervalSec in ${settingsPath}, then the sensor's own settled scan cadence`,
    unavailable:
      `${settingsPath} carried no usable scanIntervalSec and the sensor never reported a settled ` +
      'cadence to measure one from',
  };
}

/**
 * Build the capture record — how the sensor was run and what did NOT become an
 * observation. Written in arm A whether the capture succeeded or refused: a run
 * directory holding no observations has to say why, or the next reader assumes
 * the sensor was silent.
 * @param {Object} opts
 * @param {Object} opts.handle - The sensor handle.
 * @param {string} opts.runId
 * @param {string} opts.scenario
 * @param {string} opts.arm
 * @param {{start: string|null, end: string|null}} opts.window
 * @param {Object[]} opts.events - Catalogue events, for the alive window.
 * @param {number} opts.ticksAfterRun - Ticks the sensor played out after the
 *   last step, which may be fewer than asked for.
 * @returns {Object}
 */
function buildCaptureRecord(opts) {
  const alive = processAliveWindow(opts.events);
  return {
    runId: opts.runId,
    scenario: opts.scenario,
    arm: opts.arm,
    sensor: {
      profileDir: opts.handle.profileDir,
      pid: opts.handle.pid,
      startedAt: opts.handle.startedAt,
      readyAt: opts.handle.readyAt,
      steadyAt: opts.handle.steadyAt,
      steadyCadence: opts.handle.steadyCadence,
      stoppedAt: opts.handle.stoppedAt,
      readySignal:
        'the app\'s own "DEBUG [scan] process" lines on stderr: one completed scan means the ' +
        `sensor is alive, and two under ${sensor.STEADY_GAP_MS} ms apart mean it has left the ` +
        'startup schedule that scans at three times the configured interval',
      stopMethod:
        `taskkill /T /F after a ${sensor.DRAIN_MS} ms drain. AEGIS has no external ` +
        'graceful-shutdown path (its window close handler hides to tray), so the kill skips ' +
        "before-quit and the drain is what makes the last records durable via the logger's " +
        'own 5 s flush timer',
      exit: opts.handle.exit,
      // Filled once the sensor has stopped: it is read off the profile the run
      // created, which does not exist when the manifest is collected.
      scanInterval: null,
      scanTicks: opts.handle.ticks,
      ticksRequestedAfterRun: sensor.POST_RUN_TICKS,
      ticksAfterRun: opts.ticksAfterRun,
      processAliveWindow: alive,
      ticksWhileProcessAlive: sensor.ticksWithin(opts.handle, alive.from, alive.to),
    },
    window: { start: opts.window.start, end: opts.window.end, epsilonMs: observed.EPSILON_MS },
    audit: null,
    observed: null,
    skipped: null,
    failure: null,
  };
}

/**
 * Run the sensor's half of an arm-A run: let it finish scanning, stop it, read
 * its audit trail, and write the observation set.
 *
 * Never throws for a reason the run should survive — a refusal comes back as
 * `failure` on the capture record and as a non-zero exit code, so the caller
 * still writes the catalogue of what actually happened.
 * @param {Object} opts
 * @param {Object} opts.handle - The sensor handle.
 * @param {string} opts.dir - Run directory.
 * @param {Object} opts.record - From {@link buildCaptureRecord}.
 * @param {boolean} opts.scenarioOk - Whether every step executed.
 * @param {function(string): void} opts.log
 * @returns {Promise<{record: Object, ok: boolean, events: Object[]}>} The
 *   observation set is handed back rather than read off disk again: the join runs
 *   on the arrays this run produced, and `bench/lib/join.js` performs no I/O.
 */
async function captureSensor(opts) {
  const { handle, record, log } = opts;
  let ticksAfterRun = 0;
  try {
    if (opts.scenarioOk) {
      // A failed scenario is not given the post-run ticks: there is nothing left
      // to play out, and making a broken run wait two minutes to say so helps
      // nobody. The shortfall is on the record either way.
      ticksAfterRun = await sensor.waitForTicks(handle, sensor.POST_RUN_TICKS, { log });
    } else {
      log('sensor  scenario did not complete — not waiting for post-run scan ticks');
    }
  } catch (err) {
    if (!(err instanceof sensor.SensorError)) throw err;
    record.failure = { stage: err.stage, reason: err.message };
  }
  record.sensor.ticksAfterRun = ticksAfterRun;

  await sensor.stop(handle, { log });
  record.sensor.stoppedAt = handle.stoppedAt;
  record.sensor.exit = handle.exit;
  record.sensor.scanTicks = handle.ticks;
  record.sensor.scanInterval = resolveScanInterval(handle);
  record.window.end = handle.stoppedAt;
  const alive = record.sensor.processAliveWindow;
  record.sensor.ticksWhileProcessAlive = sensor.ticksWithin(handle, alive.from, alive.to);

  if (record.failure) return { record, ok: false, events: [] };

  try {
    const captured = observed.capture({
      profileDir: handle.profileDir,
      scenario: record.scenario,
      windowStart: record.window.start,
      windowEnd: record.window.end,
    });
    record.audit = {
      files: captured.files,
      verifiedRecords: captured.lines,
      chain: 'verified from GENESIS, re-derived by bench/lib/observed.js',
      truncatedTails: captured.truncatedTails,
    };
    record.skipped = captured.skipped;
    const observedPath = observed.write(opts.dir, captured.events);
    record.observed = { path: observedPath, events: captured.events.length };
    log(`written ${observedPath} (${captured.events.length} observed event(s))`);
    for (const tail of captured.truncatedTails) log(`sensor  ${tail}`);
    return { record, ok: true, events: captured.events };
  } catch (err) {
    if (!(err instanceof observed.ObservedError)) throw err;
    record.failure = { stage: err.stage, reason: err.message };
    return { record, ok: false, events: [] };
  }
}

/**
 * Say out loud what the sensor half of the run produced — above all, what did
 * NOT become an observation. A tally that only lives in a file is a tally
 * nobody reads until they already distrust the number.
 * @param {Object} record - From {@link captureSensor}.
 * @returns {void}
 */
function reportCapture(record) {
  const s = record.sensor;
  console.log(
    `sensor  ${s.scanTicks.length} completed scan tick(s), ` +
      `${s.ticksAfterRun} of ${s.ticksRequestedAfterRun} asked for after the last step` +
      (s.ticksWhileProcessAlive === null
        ? ''
        : `, ${s.ticksWhileProcessAlive} while the scenario's process was alive`),
  );
  if (!s.steadyCadence) {
    console.log(
      'sensor  its scan cadence never settled, so the steps ran against the startup schedule — ' +
        'read every coverage figure from this run as a statement about that regime',
    );
  }
  if (s.ticksWhileProcessAlive === 0) {
    console.log(
      'sensor  no scan tick fell inside the process lifetime — anything missing about that ' +
        'process was never in front of the sensor, and is not a coverage result',
    );
  }
  if (record.failure) {
    console.error(`\nbench: ${record.failure.reason}`);
    console.error(
      `bench: no ${observed.OBSERVED_FILENAME} was written — an empty one would be ` +
        'indistinguishable from a sensor that ran and saw nothing',
    );
    return;
  }
  const skipped = record.skipped;
  const shapeless = Object.entries(skipped.byShapelessType);
  const lines = [];
  if (skipped.outOfWindow > 0) lines.push(`${skipped.outOfWindow} outside the run window`);
  if (skipped.unparsableTimestamp > 0) {
    lines.push(`${skipped.unparsableTimestamp} with a timestamp that is not an instant`);
  }
  if (skipped.dropMarkersOutsideWindow > 0) {
    lines.push(`${skipped.dropMarkersOutsideWindow} loss marker(s) outside the window`);
  }
  for (const [key, count] of shapeless) {
    lines.push(`${count} ${key} — real observations with no shape in this ECS subset`);
  }
  if (lines.length > 0) {
    console.log(
      `\n${record.audit.verifiedRecords} verified audit record(s); ` +
        `${lines.length} kind(s) did not become an observed line:`,
    );
    for (const line of lines) console.log(`  - ${line}`);
  }
}

/**
 * Join the catalogue to the observation set and write the run report.
 *
 * Written after the sensor has stopped, for the same reason `expected.ndjson` is:
 * the run directory sits inside the watched project directory, so a file created
 * while the sensor is live becomes a file creation in the sensor's own answer.
 * @param {Object} opts
 * @param {string} opts.dir - Run directory.
 * @param {string} opts.runId
 * @param {string} opts.scenario
 * @param {string} opts.arm
 * @param {Object[]} opts.expected - The catalogue events, in memory.
 * @param {Object} opts.capture - From {@link captureSensor}.
 * @returns {Object} The report that was written.
 */
function writeReport(opts) {
  const report = join.buildReport({
    runId: opts.runId,
    scenario: opts.scenario,
    arm: opts.arm,
    expected: opts.expected,
    observed: opts.capture.events,
    maxLatency: maxLatencyFrom(opts.capture.record.sensor.scanInterval),
    ticksWhileProcessAlive: opts.capture.record.sensor.ticksWhileProcessAlive,
  });
  const file = path.join(opts.dir, join.REPORT_FILENAME);
  fs.writeFileSync(file, serializeReport(report), 'utf8');
  console.log(`written ${file}`);
  return report;
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
    // Frozen while `lib/report.js` was loading, a few milliseconds before this
    // line — the renderer this process is running, not the file as it will
    // stand when the report is written some minutes from now. Recorded in every
    // arm: it names the code, and the code is the same whether or not this arm
    // ends up rendering anything with it.
    reportRenderer: RENDERER_FINGERPRINT,
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

  const log = (m) => console.log(m);
  let exitCode = 0;
  if (scenario) {
    console.log(`scenario ${scenario.id} — ${scenario.title}`);

    /** @type {Object|null} The live sensor, from the moment it is started. */
    let handle = null;
    try {
      // The sensor comes up BEFORE the first step, and a sensor that will not
      // come up stops the run here: an arm-A run whose sensor never ran is an
      // arm-C run under the wrong name, and its empty answer would read as a
      // coverage miss.
      if (args.arm === SENSOR_ARM) {
        try {
          handle = await sensor.start({ runId, log });
        } catch (err) {
          if (!(err instanceof sensor.SensorError)) throw err;
          const metaPath = observed.writeMeta(dir, {
            runId,
            scenario: scenario.id,
            arm: args.arm,
            sensor: null,
            window: null,
            audit: null,
            observed: null,
            skipped: null,
            failure: { stage: err.stage, reason: err.message },
          });
          console.error(`\nbench: ${err.message}`);
          console.error(
            `bench: nothing was executed — the scenario never ran, so this run holds a manifest ` +
              `and the reason and no catalogue.\nbench: written ${metaPath}`,
          );
          return 1;
        }
      }

      const outcome = await actor.execute(scenario, { runDir: dir, log });

      /** @type {Object|null} */
      let capture = null;
      if (handle) {
        capture = await captureSensor({
          handle,
          dir,
          record: buildCaptureRecord({
            handle,
            runId,
            scenario: scenario.id,
            arm: args.arm,
            window: { start: firstStepStartedAt(outcome.steps), end: null },
            events: outcome.events,
            ticksAfterRun: 0,
          }),
          scenarioOk: outcome.ok,
          log,
        });
      }

      // Only now — the catalogue is a file inside the watched project directory,
      // and writing it while the sensor is live would put a file creation the
      // harness made for itself into the sensor's own answer.
      const cataloguePath = catalogue.write(dir, outcome.events);
      console.log(`written ${cataloguePath} (${outcome.events.length} expected event(s))`);

      if (capture) {
        const metaPath = observed.writeMeta(dir, capture.record);
        console.log(`written ${metaPath}`);
        reportCapture(capture.record);
        if (!capture.ok) exitCode = 1;
      }

      // Only with an observation set: a report joining the catalogue against
      // nothing would print four zero recalls, which is exactly what a sensor
      // that ran and saw nothing looks like. The reason is in observed.meta.json.
      if (capture && capture.ok) {
        const report = writeReport({
          dir,
          runId,
          scenario: scenario.id,
          arm: args.arm,
          expected: outcome.events,
          capture,
        });
        reportJoin(report);
        if (report.join.unavailable) exitCode = 1;
      } else if (capture) {
        console.error(
          `bench: no ${join.REPORT_FILENAME} was written — there is no observation set to join ` +
            'the catalogue against, and a report over an absent one would read as four zero recalls',
        );
      }

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
    } finally {
      // The net under every path above. `captureSensor` stops the sensor on each
      // route it completes, so reaching here with a live one means something
      // unforeseen threw — and a bench that dies must not leave the product it
      // started running: a survivor holds the single-instance lock on its
      // profile and keeps scanning and writing audit records for as long as the
      // machine is up. No drain: nothing is going to read that audit file, and a
      // failed run should end now.
      if (handle && !handle.exit) {
        console.error('bench: stopping the sensor after an unforeseen failure');
        await sensor.stop(handle, { log, drainMs: 0 });
      }
    }
  }

  if (absent.length > 0) {
    console.log(`\n${absent.length} fact(s) recorded as ABSENT, not guessed:`);
    for (const line of absent) console.log(`  - ${line}`);
  }
  return exitCode;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      // An unhandled rejection here would print a Node stack and exit 1 with no
      // statement of what the run was doing. By the time this runs, `main`'s own
      // finally has already stopped any sensor it started.
      console.error(`bench: the run failed unexpectedly — ${(err && err.stack) || err}`);
      process.exitCode = 1;
    },
  );
}

module.exports = {
  MAX_LATENCY_INTERVALS,
  NO_SCENARIO,
  RUNS_DIR,
  SENSOR_ARM,
  SETTINGS_FILENAME,
  buildRunId,
  createRunDir,
  firstStepStartedAt,
  main,
  maxLatencyFrom,
  parseArgs,
  prepareScenario,
  processAliveWindow,
  resolveScanInterval,
};
