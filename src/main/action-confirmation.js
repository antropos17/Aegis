'use strict';

const { debuglog } = require('node:util');
const {
  captureExecutionBinding,
  revokeExecutionBinding,
  isExecutionBindingActive,
} = require('./execution-binding');
const { prepareExecution } = require('./execution-policy');
const { executeAction } = require('./action-execution');
const terminal = require('./action-confirmation-terminal');
const LIMITS = Object.freeze({ prepareMs: 1500, reviewMs: 60000 });
let testDeps = null;
const refused = (reason) => ({
  schemaVersion: 1,
  mode: 'action-exec',
  decision: 'deny',
  reason,
  execution: {
    state: 'not-started',
    exitCode: null,
    termination: 'not-requested',
    stdoutBytes: 0,
    stderrBytes: 0,
    outputComplete: true,
  },
  control: 'direct-child-only',
  descendantControl: 'unsupported',
});

async function bounded(work, ms, signal) {
  let timer;
  let abort;
  try {
    return await Promise.race([
      Promise.resolve().then(() => (signal?.aborted ? undefined : work())),
      new Promise((resolve) => {
        abort = () => resolve(undefined);
        timer = setTimeout(abort, ms);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/**
 * Review exact pinned files locally and authorize at most one direct launch.
 * Callback/TTY data stays private; the returned report contains fixed metadata.
 * @param {string} policyPath Selected schema 2 policy.
 * @param {string} requestPath Selected schema 1 request.
 * @param {{signal?: AbortSignal, binding?: object}} [options] Cancellation and optional borrowed owner binding.
 * @returns {Promise<object>} Redacted execution outcome.
 * @since v0.15.1
 */
async function confirmSelectedAction(policyPath, requestPath, options = {}) {
  const { signal, binding: borrowedBinding } = options;
  const borrowed = Object.hasOwn(options, 'binding');
  if (signal?.aborted) return refused('action-cancelled');
  if (borrowed && !isExecutionBindingActive(borrowedBinding, policyPath, requestPath))
    return refused('configuration-changed');
  if (
    !['win32', 'linux', 'darwin'].includes(process.platform) ||
    process.permission ||
    debuglog('child_process').enabled
  )
    return refused('runtime-unsupported');
  const deps = testDeps || {};
  if (!(deps.available || terminal.isTerminalAvailable)()) return refused('terminal-required');
  const now = deps.now || (() => performance.now());
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const stopWatching = (deps.watchTerminal || terminal.watchTerminalLifetime)(abort);
  let binding;
  let approval;
  let stopReading = () => {};
  let delegated = false;
  try {
    binding = borrowed
      ? borrowedBinding
      : await captureExecutionBinding(policyPath, requestPath, { signal: controller.signal });
    const started = now();
    const prepared = await bounded(
      () => prepareExecution(policyPath, requestPath, { binding, review: true }),
      LIMITS.prepareMs,
      controller.signal,
    );
    if (!prepared || now() - started >= LIMITS.prepareMs || controller.signal.aborted)
      return refused('preparation-unavailable');
    if (!['allow', 'ask'].includes(prepared.decision) || !prepared.launch)
      return refused('policy-deny');
    const launch = prepared.launch;
    Object.freeze(launch.args);
    Object.freeze(launch.env);
    Object.freeze(launch);
    const reviewStarted = now();
    const confirmed = await bounded(
      () => (deps.confirm || terminal.confirmInTerminal)(launch, { signal: controller.signal }),
      LIMITS.reviewMs,
      controller.signal,
    );
    if (confirmed !== true || now() - reviewStarted >= LIMITS.reviewMs || controller.signal.aborted)
      return refused('confirmation-denied');
    stopReading = (deps.monitorInput || terminal.monitorTerminalInput)(abort);
    approval = require('./execution-approval').createExecutionApproval(binding);
    delegated = true;
    return await executeAction(policyPath, requestPath, {
      binding,
      approval,
      signal: controller.signal,
    });
  } catch {
    return delegated
      ? {
          schemaVersion: 1,
          mode: 'action-exec',
          decision: 'unknown',
          reason: 'execution-unavailable',
          execution: { state: 'unknown', exitCode: null, termination: 'unconfirmed' },
          control: 'direct-child-only',
          descendantControl: 'unsupported',
        }
      : refused('confirmation-unavailable');
  } finally {
    controller.abort();
    if (approval) require('./execution-approval').revokeExecutionApproval(approval);
    if (!borrowed) revokeExecutionBinding(binding);
    signal?.removeEventListener('abort', abort);
    stopReading();
    stopWatching();
  }
}

/** @param {object} deps Trusted terminal availability/review/clock seams. @returns {void} @since v0.15.1 */
function _setDepsForTest(deps) {
  testDeps = deps;
}
/** @returns {void} @since v0.15.1 */
function _resetForTest() {
  testDeps = null;
}
module.exports = { confirmSelectedAction, LIMITS, _setDepsForTest, _resetForTest };
