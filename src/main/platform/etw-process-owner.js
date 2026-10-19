/** @file Dormant, fixture-only original-child lifetime supervision. */
'use strict';
const { performance } = require('node:perf_hooks');
const { createCollector } = require('./etw-process-protocol');
const fixture = require('./etw-process-owner-fixture');
const defaults = { mono: () => performance.now(), launchFixture: fixture.launchFixture };
let deps = defaults;
let activeLease = null,
  unsafeCleanup = false;

/** Prepare one disposable fixture lifetime. No capture executable is admitted.
 * @param {Object} options Bounded budget, cleanup grace and combined output limit.
 * @returns {Object} One-shot fixture runner and sanitized snapshot.
 * @since v0.19.2
 */
function createProcessOwner({ budgetMs = 2000, graceMs = 500, maxOutputBytes = 262144 } = {}) {
  for (const [n, max] of [
    [budgetMs, 30000],
    [graceMs, 5000],
    [maxOutputBytes, 1048576],
  ]) {
    if (!Number.isSafeInteger(n) || n <= 0 || n > max) throw new Error('owner-invalid-bound');
  }
  const { mono, launchFixture } = deps;
  const lease = {};
  // Created once, before launch. Data and terminal events check the same deadline.
  const deadline = mono() + budgetMs;
  let child = null,
    timer = null,
    graceDeadline = null,
    used = false,
    settled = false;
  let state = 'idle',
    failure = null,
    exited = false,
    stdoutClosed = false,
    stderrClosed = false;
  let cleanupUnknown = false,
    terminationAttempted = false,
    exitCode = null;
  let retainedBytes = 0,
    observedBytes = 0,
    stderrBytes = 0;
  const output = Buffer.alloc(maxOutputBytes);
  let evidence = null,
    resolveDone = null;
  const unknown = () => ({
    nativeStopStatus: null,
    finalCounter: null,
    loss: { nativeEventsLost: null, nativeBuffersLost: null },
    transportDrained: false,
    diagnosticComplete: false,
  });
  const snapshot = () => ({
    state,
    failure,
    exited,
    streamsClosed: stdoutClosed && stderrClosed,
    cleanupUnknown,
    terminationAttempted,
    retainedBytes,
    observedBytes,
    deadline,
    evidenceScope: 'synthetic-supervision',
    launchAllowed: false,
    ...(evidence ? { ...evidence, loss: { ...evidence.loss } } : unknown()),
  });
  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function settle() {
    if (settled) return;
    settled = true;
    clearTimer();
    output.fill(0);
    retainedBytes = 0;
    if (cleanupUnknown) unsafeCleanup = true;
    if (activeLease === lease && !cleanupUnknown) activeLease = null;
    resolveDone(snapshot());
  }
  function fail(code) {
    if (failure || settled) return;
    failure = code;
    evidence = null;
    output.fill(0);
    retainedBytes = 0;
    state = 'terminating';
    graceDeadline = Math.min(mono(), deadline) + graceMs;
    // An attempt is not exit evidence. Never reacquire by PID or retry kill.
    if (child && !exited && !terminationAttempted) {
      terminationAttempted = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* The cleanup evidence remains unknown. */
      }
    }
    arm();
  }
  function expire() {
    timer = null;
    if (settled) return;
    if (!failure && mono() >= deadline) fail('deadline');
    if (failure && mono() >= graceDeadline) {
      cleanupUnknown = true;
      state = 'cleanup-unknown';
      settle();
    } else arm();
  }
  function arm() {
    clearTimer();
    timer = setTimeout(expire, Math.max(1, (failure ? graceDeadline : deadline) - mono()));
  }
  function checkDeadline() {
    if (!failure && !settled && mono() >= deadline) fail('deadline');
    if (!settled && failure && mono() >= graceDeadline) {
      cleanupUnknown = true;
      state = 'cleanup-unknown';
      settle();
    }
  }
  function finishIfClosed(generation) {
    checkDeadline();
    if (settled || !exited || !stdoutClosed || !stderrClosed) return;
    if (!failure && exitCode !== 0) fail('child-exit');
    if (!failure && stderrBytes > 0) fail('stderr-output');
    if (!failure) {
      try {
        const frames = JSON.parse(output.subarray(0, retainedBytes).toString('utf8'));
        const collector = createCollector(generation);
        if (!Array.isArray(frames) || frames.length > 1027 || !frames.every(collector.accept))
          throw new Error('invalid-terminal');
        const result = collector.result();
        if (result.state !== 'closed') throw new Error('missing-terminal');
        if (!result.transportDrained) {
          fail('incomplete-terminal');
        } else {
          evidence = {
            nativeStopStatus: result.receipt.nativeStopStatus,
            finalCounter: result.receipt.admitted,
            loss: { ...result.receipt.loss },
            transportDrained: result.transportDrained,
            diagnosticComplete: result.diagnosticComplete,
          };
        }
      } catch {
        fail('invalid-terminal');
      }
    }
    // Parsing itself may consume the last available budget.
    checkDeadline();
    if (settled) return;
    state = 'closed';
    settle();
  }
  function onData(chunk, stderr) {
    checkDeadline();
    if (settled || failure) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    observedBytes = Math.min(Number.MAX_SAFE_INTEGER, observedBytes + bytes.length);
    if (observedBytes > maxOutputBytes) {
      fail('output-limit');
      return;
    }
    if (stderr) stderrBytes += bytes.length;
    else {
      bytes.copy(output, retainedBytes);
      retainedBytes += bytes.length;
    }
  }
  function runFixture(mode, generation) {
    if (used) throw new Error('owner-used');
    // Validate before acquiring a child; caller input cannot become a command.
    fixture.validateFixture(mode, generation);
    if (activeLease || unsafeCleanup) throw new Error('owner-cleanup-pending');
    used = true;
    activeLease = lease;
    state = 'running';
    const done = new Promise((resolve) => {
      resolveDone = resolve;
    });
    if (mono() >= deadline) {
      failure = 'deadline-before-launch';
      state = 'not-launched';
      settle();
      return done;
    }
    try {
      child = launchFixture(mode, generation);
    } catch {
      failure = 'launch-failed';
      state = 'not-launched';
      settle();
      return done;
    }
    child.on('error', () => fail('child-error'));
    child.stdout.on('error', () => fail('stream-error'));
    child.stderr.on('error', () => fail('stream-error'));
    child.stdout.on('data', (chunk) => onData(chunk, false));
    child.stderr.on('data', (chunk) => onData(chunk, true));
    child.stdout.on('close', () => {
      stdoutClosed = true;
      finishIfClosed(generation);
    });
    child.stderr.on('close', () => {
      stderrClosed = true;
      finishIfClosed(generation);
    });
    child.on('exit', (code) => {
      exited = true;
      exitCode = code;
      finishIfClosed(generation);
    });
    arm();
    return done;
  }
  return { runFixture, snapshot };
}

/** Override fixture/clock dependencies for isolated tests.
 * @param {Object} overrides Test dependencies.
 * @returns {void}
 * @since v0.19.2
 */
function _setDepsForTest(overrides) {
  deps = { ...defaults, ...overrides };
}
/** Restore fixture dependencies after tests.
 * @returns {void}
 * @since v0.19.2
 */
function _resetForTest() {
  deps = defaults;
  activeLease = null;
  unsafeCleanup = false;
}
module.exports = { createProcessOwner, _setDepsForTest, _resetForTest };
