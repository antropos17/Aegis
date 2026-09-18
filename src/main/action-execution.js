'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { debuglog } = require('node:util');
const LIMITS = Object.freeze({
  prepareMs: 1500,
  runtimeMs: 5000,
  outputBytes: 65536,
  cleanupMs: 1000,
});
let testDeps = null;

function report(decision, reason, execution = {}) {
  return {
    schemaVersion: 1,
    mode: 'action-exec',
    decision,
    reason,
    execution: {
      state: 'not-started',
      exitCode: null,
      termination: 'not-requested',
      stdoutBytes: 0,
      stderrBytes: 0,
      outputComplete: true,
      ...execution,
    },
    control: 'direct-child-only',
    descendantControl: 'unsupported',
  };
}

function ownLaunch(launch) {
  if (
    !launch ||
    typeof launch.executable !== 'string' ||
    !path.isAbsolute(launch.executable) ||
    launch.executable.includes('\0') ||
    typeof launch.cwd !== 'string' ||
    !path.isAbsolute(launch.cwd) ||
    launch.cwd.includes('\0') ||
    !Array.isArray(launch.args) ||
    !launch.args.every((arg) => typeof arg === 'string' && !arg.includes('\0')) ||
    !launch.env ||
    typeof launch.env !== 'object' ||
    Array.isArray(launch.env) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(launch.env)) ||
    !Object.entries(launch.env).every(
      ([key, value]) =>
        key && !/[=\0]/.test(key) && typeof value === 'string' && !value.includes('\0'),
    )
  )
    return null;
  return {
    executable: launch.executable,
    cwd: launch.cwd,
    args: [...launch.args],
    env: Object.assign(Object.create(null), launch.env),
  };
}

/**
 * Evaluate one selected request then directly launch only that allowed child.
 * No shell or inherited environment is used. Child output is counted, never
 * returned or persisted. Descendants and operating-system isolation are unsupported.
 * @param {string} policyPath Explicit selected policy file.
 * @param {string} requestPath Explicit selected request file.
 * @param {{signal?: AbortSignal}} [options] Optional cancellation for an owning adapter.
 * @returns {Promise<object>} Fixed decision and direct-child outcome metadata.
 * @since v0.15.1
 */
async function executeAction(policyPath, requestPath, { signal } = {}) {
  if (signal?.aborted) return report('deny', 'action-cancelled');
  if (
    !['win32', 'linux', 'darwin'].includes(process.platform) ||
    process.permission ||
    debuglog('child_process').enabled
  )
    return report('deny', 'runtime-unsupported');
  const deps = testDeps || {};
  const prepare = deps.prepare || ((p, r) => require('./execution-policy').prepareExecution(p, r));
  const launchChild = deps.spawn || spawn;
  const now = deps.now || (() => performance.now());
  const started = now();
  let prepareTimer;
  let prepared;
  let onPrepareAbort;
  try {
    prepared = await Promise.race([
      Promise.resolve().then(() => (signal?.aborted ? null : prepare(policyPath, requestPath))),
      new Promise((resolve) => {
        onPrepareAbort = () => resolve(null);
        signal?.addEventListener('abort', onPrepareAbort, { once: true });
        if (signal?.aborted) resolve(null);
      }),
      new Promise((resolve) => {
        prepareTimer = setTimeout(() => resolve(null), LIMITS.prepareMs);
      }),
    ]);
  } catch (_) {
    return report('deny', 'preparation-failed');
  } finally {
    clearTimeout(prepareTimer);
    signal?.removeEventListener('abort', onPrepareAbort);
  }
  if (signal?.aborted) return report('deny', 'action-cancelled');
  if (now() - started >= LIMITS.prepareMs || !prepared)
    return report('deny', 'preparation-unavailable');
  if (!['allow', 'ask', 'deny'].includes(prepared.decision))
    return report('deny', 'decision-invalid');
  if (prepared.decision !== 'allow')
    return report(prepared.decision, `policy-${prepared.decision}`);
  let launch;
  try {
    launch = ownLaunch(prepared.launch);
  } catch (_) {
    return report('deny', 'launch-invalid');
  }
  if (!launch) return report('deny', 'launch-invalid');
  if (signal?.aborted) return report('deny', 'action-cancelled');
  if (now() - started >= LIMITS.prepareMs) return report('deny', 'preparation-unavailable');

  return new Promise((resolve) => {
    let child;
    let runtimeTimer;
    let cleanupTimer;
    let settled = false;
    let interrupted = false;
    let exitObserved = false;
    let exitCode = null;
    let reason = 'child-exited';
    let outputTruncated = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let totalBytes = 0;
    const finish = (outputComplete, spawnFailed = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(runtimeTimer);
      clearTimeout(cleanupTimer);
      signal?.removeEventListener('abort', onAbort);
      child?.stdout?.destroy();
      child?.stderr?.destroy();
      if (interrupted && !exitObserved) child?.unref?.();
      resolve(
        report('allow', spawnFailed ? 'spawn-failed' : reason, {
          state: spawnFailed ? 'spawn-failed' : interrupted ? 'interrupted' : 'exited',
          exitCode,
          termination: interrupted ? (exitObserved ? 'confirmed' : 'unconfirmed') : 'not-requested',
          stdoutBytes,
          stderrBytes,
          outputComplete: outputComplete && !outputTruncated,
        }),
      );
    };
    const cleanup = () => {
      if (!cleanupTimer) cleanupTimer = setTimeout(() => finish(false), LIMITS.cleanupMs);
    };
    const interrupt = (why) => {
      if (settled || interrupted) return;
      interrupted = true;
      reason = why;
      clearTimeout(runtimeTimer);
      cleanup();
      try {
        child.kill('SIGKILL');
      } catch (_) {
        /* Confirmation requires an exit event. */
      }
    };
    const onAbort = () => interrupt('action-cancelled');
    const count = (kind, chunk) => {
      if (settled || interrupted) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
      const retained = Math.min(bytes, LIMITS.outputBytes - totalBytes);
      if (kind === 'stdout') stdoutBytes += retained;
      else stderrBytes += retained;
      totalBytes += retained;
      if (bytes > retained) {
        outputTruncated = true;
        interrupt('output-limit');
      }
    };
    try {
      child = launchChild(launch.executable, launch.args, {
        cwd: launch.cwd,
        env: launch.env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      runtimeTimer = setTimeout(() => interrupt('runtime-timeout'), LIMITS.runtimeMs);
      child.on('error', () => {
        if (settled) return;
        if (typeof child.pid === 'number') interrupt('child-error');
        else finish(false, true);
      });
      child.once('exit', (code) => {
        if (settled) return;
        exitObserved = true;
        exitCode = Number.isInteger(code) ? code : null;
        clearTimeout(runtimeTimer);
        cleanup();
      });
      child.once('close', () => finish(true));
      child.stdout.on('data', (chunk) => count('stdout', chunk));
      child.stderr.on('data', (chunk) => count('stderr', chunk));
      child.stdout.on('error', () => interrupt('output-unavailable'));
      child.stderr.on('error', () => interrupt('output-unavailable'));
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    } catch (_) {
      if (child) interrupt('launch-failed');
      else finish(false, true);
    }
  });
}

/** @param {object} deps Trusted test prepare/spawn/clock. @returns {void} @since v0.15.1 */
function _setDepsForTest(deps) {
  testDeps = deps;
}
/** @returns {void} @since v0.15.1 */
function _resetForTest() {
  testDeps = null;
}
module.exports = { executeAction, LIMITS, _setDepsForTest, _resetForTest };
