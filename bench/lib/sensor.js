/**
 * @file bench/lib/sensor.js
 * @module bench/lib/sensor
 * @description Runs the AEGIS sensor as a child process for the length of one
 *   arm-A bench run, and tells the run when it is safe to start and safe to stop.
 *
 *   The product is started the way a developer starts it — `electron .` against
 *   the repository — and left in its ordinary mode of operation. Two deliberate
 *   choices shape the rest:
 *
 *   **A run-scoped Electron profile, outside the repository.** `--user-data-dir`
 *   is a stock Electron switch and changes nothing about how the sensor observes
 *   or what it writes; it changes only where. That buys three things a bench
 *   needs: the audit file is written by this run alone, so its hash chain starts
 *   at GENESIS and a verdict on it is a verdict on our own records; the run does
 *   not depend on whatever `scanIntervalSec` the developer last saved, or append
 *   to their real audit trail; and the single-instance lock lives in the profile,
 *   so a bench run does not collide with an AEGIS the user already has open.
 *   The profile must NOT live inside the repository: `src/main/file-watcher.js`
 *   watches the project directory, so an audit write there would raise a file
 *   event, which is logged to the audit, which is a write. That is a loop.
 *
 *   **Readiness is the sensor's own report of a completed scan, twice.** AEGIS
 *   logs `DEBUG [scan] process {ms, agents}` after a full process-scan tick —
 *   snapshot, identity stamp, session reconcile, batch — and `logger.js` mirrors
 *   every line to stderr while the app is unpackaged. The first such line says
 *   the process sensor has completed a cycle; every later one is a tick the run
 *   can count. Nothing here sleeps for a guessed interval.
 *
 *   One completed scan is not enough to start acting, and the first version of
 *   this file learned that the expensive way. AEGIS spends its first minute on a
 *   startup schedule (`scan-loop.js` `staggeredStartup`/`startWarmup`) that
 *   scans at THREE TIMES the configured interval before switching to the real
 *   one. A run that begins at the first tick therefore acts into a ~37 s gap; a
 *   scenario whose subject lives 35 s — S1 lives exactly that long, chosen
 *   against the 10 s configured interval — is then never in front of a scan at
 *   all, and its process start and end are unobservable for a reason that
 *   belongs to the harness, not to the sensor. So readiness waits for the
 *   cadence to settle: two consecutive ticks closer together than
 *   {@link STEADY_GAP_MS}, which is the sensor saying it has left the startup
 *   regime. Still its own output, still no sleep on a guess. If it never
 *   settles, the run says so on the record and proceeds rather than refusing —
 *   a slow cadence is a fact about the sensor, and the tick accounting makes it
 *   readable.
 *
 *   The signal is a property of running from source: a packaged build sets
 *   `isDev` false and prints nothing, and this module would have to be given a
 *   different signal before it could bench one.
 *
 *   Stopping is a kill, and that is a limitation, not a preference. AEGIS has no
 *   external graceful-shutdown path — its window `close` handler calls
 *   `preventDefault()` and hides to tray, so a polite `taskkill` leaves the app
 *   running and only `/F` ends it, which skips `before-quit → audit.shutdown()`.
 *   The audit's own 5 s flush timer is what makes the last records durable, so
 *   the kill is preceded by a drain longer than one flush interval.
 *
 *   Nothing here imports from `src/`.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.11.0
 */
'use strict';

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const manifest = require('./manifest');

/** @type {string} The renderer bundle the main window loads. */
const RENDERER_ENTRY = path.join(manifest.ROOT, 'dist', 'renderer', 'index.html');

/**
 * One completed process-scan tick, as the product logs it
 * (`src/main/scan-loop.js`, via `logger.debug('scan', 'process', …)`).
 * @type {RegExp}
 */
const TICK_LINE =
  /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]\s+DEBUG\s+\[scan]\s+process\b/;

/**
 * How long to wait for the first completed scan. Generous: boot pays for a
 * `tasklist` spawn, the snapshot sidecar handshake and a CIM query, and the
 * first scan is deliberately staggered a few seconds behind the window.
 * @type {number}
 */
const READY_TIMEOUT_MS = 120000;

/**
 * The gap between two completed scans, below which the sensor is taken to have
 * left its startup schedule and reached its configured cadence.
 *
 * 20 s sits in the empty space between the two regimes rather than close to
 * either: on the run-scoped profile the settings are the product defaults, so
 * warmup scans land ~30–40 s apart and steady scans ~10 s apart. It is not a
 * duration anything waits for — it is the test applied to instants the sensor
 * itself reported.
 *
 * A deployment configured with a much longer scan interval would never satisfy
 * it. That is deliberate and non-fatal: {@link start} gives up after
 * {@link STEADY_TIMEOUT_MS}, records that the cadence never settled, and lets
 * the run proceed with the fact on its capture record — where a reader can see
 * it next to how many ticks actually fell inside the scenario.
 * @type {number}
 */
const STEADY_GAP_MS = 20000;

/**
 * How long to wait for the cadence to settle before giving up on it and acting
 * anyway. AEGIS switches off its startup schedule 60 s after the schedule
 * begins, which is itself ~12 s into the app's life, so ~90 s is the honest
 * expectation and this is twice it.
 * @type {number}
 */
const STEADY_TIMEOUT_MS = 180000;

/**
 * How long to wait for the post-run ticks. The scan cadence is not constant:
 * `staggeredStartup` runs the first minute of an app's life at three times the
 * configured interval, so three ticks can legitimately take two minutes.
 * @type {number}
 */
const TICK_TIMEOUT_MS = 240000;

/**
 * Ticks to let the sensor play out after the last step.
 *
 * Three, because one is not enough to see the end of a process. AEGIS reports a
 * process end only after `session-tracker.js`'s exit grace of 2 consecutive
 * reliable scans that missed it, so a run that stops one tick after the last
 * step captures the start of a process and never its end. 2 + 1 is the smallest
 * number that lets the product reach its own conclusion.
 * @type {number}
 */
const POST_RUN_TICKS = 3;

/**
 * Quiet period between the last tick and the kill, in milliseconds. Longer than
 * the audit logger's 5 s flush interval, so the records of that last tick are on
 * disk before the process that holds them is destroyed.
 * @type {number}
 */
const DRAIN_MS = 6000;

/** @type {number} Diagnostic output kept from the child, in lines. */
const LOG_TAIL_LINES = 40;

/** An error that fails the run, carrying a machine-readable stage. */
class SensorError extends Error {
  /**
   * @param {string} stage - One of `renderer-missing`, `spawn-failed`,
   *   `died-before-ready`, `ready-timeout`, `died-mid-run`.
   * @param {string} message - What a reader needs in order to act.
   */
  constructor(stage, message) {
    super(message);
    this.name = 'SensorError';
    this.stage = stage;
  }
}

/**
 * Where this run's Electron profile goes: the OS temp directory, never the
 * repository (see the file docblock — a profile under the watched project
 * directory feeds the audit its own writes).
 * @param {string} runId
 * @returns {string}
 */
function profileDirFor(runId) {
  return path.join(os.tmpdir(), `aegis-bench-${runId}`);
}

/**
 * Split a stream into lines and hand each one to a sink, carrying the partial
 * last line over to the next chunk.
 * @param {import('stream').Readable} stream
 * @param {function(string): void} onLine
 * @returns {void}
 */
function pumpLines(stream, onLine) {
  let carry = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    const parts = (carry + chunk).split('\n');
    carry = parts.pop();
    for (const line of parts) onLine(line.replace(/\r$/, ''));
  });
  stream.on('end', () => {
    if (carry.trim()) onLine(carry.replace(/\r$/, ''));
    carry = '';
  });
}

/**
 * Start AEGIS on a run-scoped profile and wait for its first completed scan.
 * @param {Object} opts
 * @param {string} opts.runId - Used to name the profile directory.
 * @param {function(string): void} [opts.log] - Progress sink.
 * @param {number} [opts.readyTimeoutMs] - Override, for tests.
 * @param {number} [opts.steadyTimeoutMs] - Override, for tests.
 * @param {number} [opts.steadyGapMs] - Override, for tests.
 * @returns {Promise<Object>} The handle every other function here takes.
 * @throws {SensorError} When the renderer is not built, the spawn fails, the app
 *   exits before it reports a scan, or the wait times out.
 */
async function start(opts) {
  const log = opts.log ?? (() => {});
  if (!fs.existsSync(RENDERER_ENTRY)) {
    throw new SensorError(
      'renderer-missing',
      `${RENDERER_ENTRY} does not exist, so the main window has nothing to load and the deferred ` +
        'subsystems that own the sensors never start. Run `npm run build:renderer` first',
    );
  }

  const profileDir = profileDirFor(opts.runId);
  fs.mkdirSync(profileDir, { recursive: true });

  // Electron's own launcher trick: an IDE terminal exports ELECTRON_RUN_AS_NODE=1,
  // and Electron checks the variable's EXISTENCE — setting it empty still starts
  // plain Node with no app, no window and no sensors. See scripts/launch.js.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const handle = {
    /** @type {import('child_process').ChildProcess|null} */
    child: null,
    pid: null,
    profileDir,
    startedAt: new Date().toISOString(),
    readyAt: null,
    steadyAt: null,
    steadyCadence: false,
    stoppedAt: null,
    /** @type {string[]} ISO instant of every completed process-scan tick. */
    ticks: [],
    /** @type {string[]} Tail of the child's output, for a failure message. */
    tail: [],
    /** @type {{code: number|null, signal: string|null}|null} */
    exit: null,
    /** @type {Array<function(): void>} Woken on a new tick or on exit. */
    _waiters: [],
  };

  const wake = () => {
    const waiters = handle._waiters.splice(0);
    for (const w of waiters) w();
  };

  const onLine = (line) => {
    handle.tail.push(line);
    if (handle.tail.length > LOG_TAIL_LINES) handle.tail.shift();
    const tick = TICK_LINE.exec(line);
    if (tick) {
      handle.ticks.push(tick[1]);
      wake();
    }
  };

  const child = spawn(require('electron'), ['.', `--user-data-dir=${profileDir}`], {
    cwd: manifest.ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  handle.child = child;
  pumpLines(child.stdout, onLine);
  pumpLines(child.stderr, onLine);
  child.on('exit', (code, signal) => {
    handle.exit = { code, signal };
    wake();
  });

  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', (err) =>
      reject(new SensorError('spawn-failed', `could not start the sensor: ${err.message}`)),
    );
  });
  handle.pid = child.pid;
  log(`sensor  started pid ${child.pid}, profile ${profileDir}`);

  const readyTimeout = opts.readyTimeoutMs ?? READY_TIMEOUT_MS;
  await waitFor(handle, () => handle.ticks.length >= 1, readyTimeout, {
    onExit: (exit) =>
      new SensorError(
        'died-before-ready',
        `the sensor exited (code ${exit.code}, signal ${exit.signal}) before it reported a ` +
          `completed process scan.\n${formatTail(handle)}`,
      ),
    onTimeout: () =>
      new SensorError(
        'ready-timeout',
        `the sensor did not report a completed process scan within ${readyTimeout} ms. A bench ` +
          'never proceeds on a guessed interval, so the run stops here rather than acting into a ' +
          `sensor that may not be watching.\n${formatTail(handle)}`,
      ),
  });
  handle.readyAt = handle.ticks[0];
  log(`sensor  alive — first completed process scan at ${handle.readyAt}`);

  const steadyTimeout = opts.steadyTimeoutMs ?? STEADY_TIMEOUT_MS;
  const gap = opts.steadyGapMs ?? STEADY_GAP_MS;
  log(`sensor  waiting for its scan cadence to settle (two ticks under ${gap} ms apart)`);
  await waitFor(handle, () => settledAt(handle.ticks, gap) !== null, steadyTimeout, {
    onExit: (exit) =>
      new SensorError(
        'died-before-ready',
        `the sensor exited (code ${exit.code}, signal ${exit.signal}) while the run was waiting ` +
          `for its scan cadence to settle.\n${formatTail(handle)}`,
      ),
    onTimeout: null,
  });
  handle.steadyAt = settledAt(handle.ticks, gap);
  handle.steadyCadence = handle.steadyAt !== null;
  if (handle.steadyCadence) {
    log(`sensor  ready — cadence settled at ${handle.steadyAt}`);
  } else {
    log(
      `sensor  cadence never settled within ${steadyTimeout} ms — the run proceeds and records ` +
        'that it acted while the sensor was still on its startup schedule',
    );
  }
  return handle;
}

/**
 * The instant a run of scan ticks first showed a settled cadence.
 * @param {string[]} ticks - Completed-scan instants, in order.
 * @param {number} gapMs - Below this, two consecutive ticks count as settled.
 * @returns {string|null} The later of the first close pair, or null.
 */
function settledAt(ticks, gapMs) {
  for (let i = 1; i < ticks.length; i++) {
    const gap = Date.parse(ticks[i]) - Date.parse(ticks[i - 1]);
    if (Number.isFinite(gap) && gap < gapMs) return ticks[i];
  }
  return null;
}

/**
 * Wait until a condition holds, the child exits, or the clock runs out.
 * @param {Object} handle
 * @param {function(): boolean} done
 * @param {number} timeoutMs
 * @param {Object} on
 * @param {function(Object): Error} on.onExit - Builds the error for a dead child.
 * @param {(function(): Error)|null} on.onTimeout - Builds the error for a
 *   timeout, or `null` to resolve quietly instead of throwing.
 * @returns {Promise<void>}
 */
function waitFor(handle, done, timeoutMs, on) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (done()) return resolve();
      if (handle.exit) return reject(on.onExit(handle.exit));
      const left = deadline - Date.now();
      if (left <= 0) {
        if (on.onTimeout) return reject(on.onTimeout());
        return resolve();
      }
      const timer = setTimeout(() => {
        handle._waiters = handle._waiters.filter((w) => w !== waiter);
        check();
      }, left);
      const waiter = () => {
        clearTimeout(timer);
        check();
      };
      handle._waiters.push(waiter);
    };
    check();
  });
}

/**
 * Let the sensor play out `count` more completed scan ticks.
 *
 * A timeout here is NOT a refusal: the run says how many ticks it actually got
 * and lets the capture record carry the shortfall. A dead child is, because
 * everything after it would be observed by nothing.
 * @param {Object} handle - From {@link start}.
 * @param {number} count
 * @param {Object} [opts]
 * @param {function(string): void} [opts.log]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<number>} Ticks actually seen, which may be fewer than asked.
 * @throws {SensorError} When the sensor died while we were waiting.
 */
async function waitForTicks(handle, count, opts = {}) {
  const log = opts.log ?? (() => {});
  const target = handle.ticks.length + count;
  const timeoutMs = opts.timeoutMs ?? TICK_TIMEOUT_MS;
  log(`sensor  waiting for ${count} more completed scan tick(s)`);
  await waitFor(handle, () => handle.ticks.length >= target, timeoutMs, {
    onExit: (exit) =>
      new SensorError(
        'died-mid-run',
        `the sensor exited (code ${exit.code}, signal ${exit.signal}) while the run was waiting ` +
          `for it to finish scanning.\n${formatTail(handle)}`,
      ),
    onTimeout: null,
  });
  return count - Math.max(0, target - handle.ticks.length);
}

/**
 * End the child process tree, after giving the audit logger time to flush.
 *
 * The drain is the whole point: AEGIS buffers audit records and writes them on a
 * 5 s timer, and this kill is hard enough to skip `before-quit`, so without the
 * wait the last seconds of observation would be lost with no trace on disk. The
 * tree is killed rather than the process, or the snapshot sidecar and the
 * renderer outlive their parent.
 * @param {Object} handle - From {@link start}.
 * @param {Object} [opts]
 * @param {function(string): void} [opts.log]
 * @param {number} [opts.drainMs] - Override, for tests.
 * @returns {Promise<Object>} The same handle, with `stoppedAt` set.
 */
async function stop(handle, opts = {}) {
  const log = opts.log ?? (() => {});
  const drainMs = opts.drainMs ?? DRAIN_MS;
  if (!handle.exit) {
    log(`sensor  draining ${drainMs} ms so the audit logger's flush timer runs`);
    await new Promise((resolve) => setTimeout(resolve, drainMs));
  }
  handle.stoppedAt = new Date().toISOString();
  if (handle.exit) {
    log(`sensor  already exited (code ${handle.exit.code}, signal ${handle.exit.signal})`);
    return handle;
  }
  await killTree(handle.pid);
  await waitFor(handle, () => handle.exit !== null, 15000, {
    onExit: () => new Error('unreachable — an exited child satisfies the condition'),
    onTimeout: null,
  });
  log(`sensor  stopped pid ${handle.pid} at ${handle.stoppedAt}`);
  return handle;
}

/**
 * Kill a process and its descendants.
 * @param {number} pid
 * @returns {Promise<void>} Resolves even when the kill fails — a process that is
 *   already gone is the outcome we wanted, and {@link stop} confirms it by
 *   waiting for `exit` rather than by trusting this.
 */
function killTree(pid) {
  if (process.platform !== 'win32') {
    // The bench is Windows-only (bench/README.md). This branch exists so the
    // module can be exercised elsewhere, not so a run can happen elsewhere.
    try {
      process.kill(pid, 'SIGTERM');
    } catch (_) {
      /* already gone */
    }
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve());
  });
}

/**
 * The child's last lines, for a failure message that says something.
 * @param {Object} handle
 * @returns {string}
 */
function formatTail(handle) {
  if (handle.tail.length === 0) return 'The sensor produced no output at all.';
  return `Last ${handle.tail.length} line(s) of its output:\n  ${handle.tail.join('\n  ')}`;
}

/**
 * How many completed scan ticks fell inside a closed interval.
 *
 * This is the discriminator between "the sensor missed the process" and "the
 * process was never in front of the sensor". A scenario whose subject lives for
 * 35 s while the sensor is still in its startup cadence can be scanned once, or
 * not at all, and a run that reports zero observations without reporting zero
 * ticks invites the reader to score a phase coincidence as a sensor failure.
 * @param {Object} handle - From {@link start}.
 * @param {string|null} fromIso - Start of the interval, or null when unknown.
 * @param {string|null} toIso - End of the interval, or null when unknown.
 * @returns {number|null} Null when either bound is unknown or unparseable.
 */
function ticksWithin(handle, fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return handle.ticks.filter((t) => {
    const at = Date.parse(t);
    return Number.isFinite(at) && at >= from && at <= to;
  }).length;
}

module.exports = {
  DRAIN_MS,
  LOG_TAIL_LINES,
  POST_RUN_TICKS,
  READY_TIMEOUT_MS,
  RENDERER_ENTRY,
  STEADY_GAP_MS,
  STEADY_TIMEOUT_MS,
  SensorError,
  TICK_LINE,
  TICK_TIMEOUT_MS,
  profileDirFor,
  pumpLines,
  settledAt,
  start,
  stop,
  ticksWithin,
  waitForTicks,
};
