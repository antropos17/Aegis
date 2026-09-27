'use strict';

const { isExecutionRuntimeSupported } = require('./execution-runtime');
const {
  captureExecutionBinding,
  revokeExecutionBinding,
  isExecutionBindingActive,
} = require('./execution-binding');
const { prepareExecution } = require('./execution-policy');
const { executeAction } = require('./action-execution');
const terminal = require('./action-confirmation-terminal');
const { actionReport } = require('./action-protected-execution');
const LIMITS = Object.freeze({ prepareMs: 1500, reviewMs: 60000 });
let testDeps = null;
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
 * Review exact pinned files locally and authorize at most one launch.
 * Callback/TTY data stays private; the returned report contains fixed metadata.
 * @param {string} policyPath Selected schema 2 policy.
 * @param {string} requestPath Selected schema 1 request.
 * @param {{signal?: AbortSignal, binding?: object, protectedDescendants?: boolean, appContainer?: boolean, inputFile?: string}} [options] Cancellation, optional borrowed owner binding and Windows Job selection.
 * @returns {Promise<object>} Redacted execution outcome.
 * @since v0.15.1
 */
async function confirmSelectedAction(policyPath, requestPath, options = {}) {
  const { signal, binding: borrowedBinding } = options;
  const borrowed = Object.hasOwn(options, 'binding');
  const appContainer = options.appContainer === true;
  const importInput = Object.hasOwn(options, 'inputFile');
  const inputFile = options.inputFile;
  const protectedDescendants = appContainer || options.protectedDescendants === true;
  const protection = { appContainer, protectedDescendants, importInput };
  const refuse = (reason) => actionReport('deny', reason, {}, protection);
  if (importInput && (!appContainer || typeof inputFile !== 'string'))
    return refuse('input-unavailable');
  if (
    ['protectedDescendants', 'appContainer'].some(
      (key) => Object.hasOwn(options, key) && typeof options[key] !== 'boolean',
    )
  )
    return actionReport(
      'deny',
      'protected-option-invalid',
      {},
      { ...protection, protectedDescendants: true },
    );
  if (signal?.aborted) return refuse('action-cancelled');
  if (borrowed && !isExecutionBindingActive(borrowedBinding, policyPath, requestPath))
    return refuse('configuration-changed');
  if (protectedDescendants && process.platform !== 'win32')
    return refuse('protected-runtime-unsupported');
  if (!isExecutionRuntimeSupported()) return refuse('runtime-unsupported');
  const deps = testDeps || {};
  if (!(deps.available || terminal.isTerminalAvailable)()) return refuse('terminal-required');
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
      return refuse('preparation-unavailable');
    if (!['allow', 'ask'].includes(prepared.decision) || !prepared.launch)
      return refuse('policy-deny');
    const launch = prepared.launch;
    Object.freeze(launch.args);
    Object.freeze(launch.env);
    Object.freeze(launch);
    const input = importInput
      ? require('./action-input-snapshot').captureInputSnapshot(inputFile)
      : null;
    const preview = input
      ? Object.freeze({
          ...launch,
          input: Object.freeze({
            path: input.path,
            size: input.size,
            operation: 'copy-to-input.bin',
          }),
        })
      : launch;
    const reviewStarted = now();
    const confirmed = await bounded(
      () =>
        (deps.confirm || terminal.confirmInTerminal)(preview, {
          signal: controller.signal,
          ...(appContainer
            ? { kind: importInput ? 'appcontainer-import' : 'appcontainer-launch' }
            : {}),
        }),
      LIMITS.reviewMs,
      controller.signal,
    );
    if (confirmed !== true || now() - reviewStarted >= LIMITS.reviewMs || controller.signal.aborted)
      return refuse('confirmation-denied');
    stopReading = (deps.monitorInput || terminal.monitorTerminalInput)(abort);
    approval = require('./execution-approval').createExecutionApproval(binding, input);
    delegated = true;
    return await executeAction(policyPath, requestPath, {
      binding,
      approval,
      signal: controller.signal,
      protectedDescendants,
      ...(appContainer ? { appContainer } : {}),
      ...(input ? { importInput: input } : {}),
    });
  } catch {
    return delegated
      ? actionReport(
          'unknown',
          'execution-unavailable',
          { state: 'unknown', termination: 'unconfirmed' },
          protection,
        )
      : refuse('confirmation-unavailable');
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
