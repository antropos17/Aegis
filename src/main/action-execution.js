'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { isExecutionRuntimeSupported } = require('./execution-runtime');
const { isExecutionApprovalActive, consumeExecutionApproval } = require('./execution-approval');
const LIMITS = Object.freeze({
  prepareMs: 1500,
  runtimeMs: 5000,
  outputBytes: 65536,
  cleanupMs: 1000,
  protectedCleanupMs: 2000,
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

function protectedReport(decision, reason, execution = {}, descendantControl = 'not-started') {
  return {
    ...report(decision, reason, execution),
    control: 'windows-job',
    descendantControl,
  };
}

function runProtectedAction(launch, signal, authorization, spawnProtected) {
  let child;
  try {
    child = spawnProtected(launch);
  } catch {
    return Promise.resolve({
      ...protectedReport('deny', 'protected-launch-unavailable', { state: 'not-started' }),
      ...(authorization || {}),
    });
  }
  return new Promise((resolve) => {
    let settled = false;
    let interrupted = false;
    let interruptionReason = '';
    let cleanupTimer;
    const runtimeTimer = setTimeout(() => interrupt('runtime-timeout'), LIMITS.runtimeMs);
    const finish = (decision, reason, state, confirmed, outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(runtimeTimer);
      clearTimeout(cleanupTimer);
      signal?.removeEventListener('abort', onAbort);
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (!confirmed) child.unref?.();
      resolve({
        ...protectedReport(
          decision,
          reason,
          {
            state,
            exitCode: state === 'exited' ? outcome.exitCode : null,
            termination: !confirmed
              ? 'unconfirmed'
              : interrupted || state === 'interrupted'
                ? 'confirmed'
                : 'not-requested',
            stdoutBytes: outcome?.stdoutBytes || 0,
            stderrBytes: outcome?.stderrBytes || 0,
            outputComplete: state === 'exited' && outcome.outputComplete,
          },
          confirmed ? 'confirmed' : 'unconfirmed',
        ),
        ...(authorization || {}),
      });
    };
    const interrupt = (why) => {
      if (settled || interrupted) return;
      interrupted = true;
      interruptionReason = why;
      clearTimeout(runtimeTimer);
      try {
        child.stop();
      } catch {
        /* The close/status protocol confirms whether cleanup completed. */
      }
      cleanupTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* A missing cleanup receipt remains unconfirmed. */
        }
        finish('unknown', 'cleanup-unconfirmed', 'unknown', false);
      }, LIMITS.protectedCleanupMs);
    };
    const onAbort = () => interrupt('action-cancelled');
    child.on('error', () => interrupt('protected-launch-unavailable'));
    child.once('close', () => {
      const outcome = child.actionOutcome;
      if (!child.cleanupConfirmed || !outcome)
        return finish('unknown', 'cleanup-unconfirmed', 'unknown', false, outcome);
      if (interrupted) return finish('allow', interruptionReason, 'interrupted', true, outcome);
      if (outcome.outputLimit) return finish('allow', 'output-limit', 'interrupted', true, outcome);
      if (outcome.exited) return finish('allow', 'child-exited', 'exited', true, outcome);
      return finish('unknown', 'protected-interrupted', 'interrupted', true, outcome);
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
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
 * Evaluate one selected request then launch only that allowed child. The trusted
 * Windows Job opt-in holds ordinary Job-member descendants until verified cleanup. No shell or
 * inherited environment is used. Child output is counted, never returned.
 * @param {string} policyPath Explicit selected policy file.
 * @param {string} requestPath Explicit selected request file.
 * @param {{signal?: AbortSignal, binding?: object, approval?: object, protectedDescendants?: boolean}} [options] Owned cancellation, revision, one-use approval and Windows Job opt-in.
 * @returns {Promise<object>} Fixed decision and direct-child outcome metadata.
 * @since v0.15.1
 */
async function executeAction(policyPath, requestPath, options = {}) {
  const { signal, binding, approval } = options;
  const protectedJob = options.protectedDescendants === true;
  const localReport = protectedJob ? protectedReport : report;
  const pinned = Object.hasOwn(options, 'binding');
  const approved = Object.hasOwn(options, 'approval');
  if (
    Object.hasOwn(options, 'protectedDescendants') &&
    typeof options.protectedDescendants !== 'boolean'
  )
    return protectedReport('deny', 'protected-option-invalid');
  if (protectedJob && process.platform !== 'win32')
    return protectedReport('deny', 'protected-runtime-unsupported');
  if (signal?.aborted) return localReport('deny', 'action-cancelled');
  if (
    approved &&
    (!pinned ||
      !isExecutionApprovalActive(approval, binding) ||
      !require('./execution-binding').isExecutionBindingActive(binding, policyPath, requestPath))
  )
    return localReport('deny', 'approval-unavailable');
  if (!isExecutionRuntimeSupported()) return localReport('deny', 'runtime-unsupported');
  const deps = testDeps || {};
  const prepare =
    deps.prepare ||
    ((p, r) =>
      require('./execution-policy').prepareExecution(p, r, {
        ...(pinned ? { binding } : {}),
        ...(approved ? { review: true } : {}),
      }));
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
    return localReport('deny', 'preparation-failed');
  } finally {
    clearTimeout(prepareTimer);
    signal?.removeEventListener('abort', onPrepareAbort);
  }
  if (signal?.aborted) return localReport('deny', 'action-cancelled');
  if (now() - started >= LIMITS.prepareMs || !prepared)
    return localReport('deny', 'preparation-unavailable');
  if (!['allow', 'ask', 'deny'].includes(prepared.decision))
    return localReport('deny', 'decision-invalid');
  if (prepared.decision !== 'allow' && !(approved && prepared.decision === 'ask'))
    return localReport(
      prepared.decision,
      ['configuration-changed', 'configuration-unavailable', 'review-required'].includes(
        prepared.reason,
      )
        ? prepared.reason
        : `policy-${prepared.decision}`,
    );
  let launch;
  try {
    launch = ownLaunch(prepared.launch);
  } catch (_) {
    return localReport('deny', 'launch-invalid');
  }
  if (!launch) return localReport('deny', 'launch-invalid');
  if (
    pinned &&
    !require('./execution-binding').isExecutionBindingActive(binding, policyPath, requestPath)
  )
    return localReport('deny', 'configuration-changed');
  if (signal?.aborted) return localReport('deny', 'action-cancelled');
  if (now() - started >= LIMITS.prepareMs) return localReport('deny', 'preparation-unavailable');
  if (approved && !consumeExecutionApproval(approval, binding))
    return localReport('deny', 'approval-unavailable');

  if (protectedJob)
    return runProtectedAction(
      launch,
      signal,
      approved ? { authorization: 'operator-confirmed', policyDecision: prepared.decision } : null,
      deps.spawnProtected || require('./mcp-gateway-windows-job').spawnActionInWindowsJob,
    );

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
      resolve({
        ...report('allow', spawnFailed ? 'spawn-failed' : reason, {
          state: spawnFailed ? 'spawn-failed' : interrupted ? 'interrupted' : 'exited',
          exitCode,
          termination: interrupted ? (exitObserved ? 'confirmed' : 'unconfirmed') : 'not-requested',
          stdoutBytes,
          stderrBytes,
          outputComplete: outputComplete && !outputTruncated,
        }),
        ...(approved
          ? { authorization: 'operator-confirmed', policyDecision: prepared.decision }
          : {}),
      });
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
