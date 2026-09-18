'use strict';

const { prepareExecution } = require('./execution-policy');
const { isExecutionRuntimeSupported } = require('./execution-runtime');
const { isTerminalAvailable } = require('./action-confirmation-terminal');
const ROUTES = Object.freeze(['direct', 'terminal', 'mcp-stdio', 'mcp-review']);
const LIMITS = Object.freeze({ checkMs: 1500 });
let testDeps = null;

function baseReport(route, runtime, terminal) {
  return {
    schemaVersion: 1,
    mode: 'action-route-check',
    route,
    configuration: 'not-checked',
    policyDecision: 'unknown',
    reason: 'check-unavailable',
    runtime,
    terminal,
    terminalScope: 'checking-process-only',
    askBehavior: ['terminal', 'mcp-review'].includes(route)
      ? 'terminal-confirmation'
      : 'not-started',
    control: 'direct-child-only',
    descendantControl: 'unsupported',
    outsideRouteCoverage: 'unknown',
    connection: 'not-checked',
    blockingVerification: 'not-performed',
    executionPerformed: false,
    authorization: 'none',
    configurationObservation: 'single-pass-not-retained',
    gaps: [
      'other-agent-tools',
      'outside-route-filesystem-and-network',
      'descendants',
      'executable-content-binding',
      'continuous-configuration-watch',
      'provider-installation-and-version',
    ],
  };
}

/**
 * Inspect one selected route's current configuration without execution or approval.
 * The result is a transient observation, never a capability or future launch guarantee.
 * @param {string} route One of ROUTES.
 * @param {string} policyPath Explicit selected schema 2 policy.
 * @param {string} requestPath Explicit selected schema 1 action request.
 * @param {{signal?: AbortSignal}} [options] Trusted owner cancellation.
 * @returns {Promise<object>} Fixed metadata only; no private launch descriptor.
 * @since v0.15.1
 */
async function checkActionRoute(route, policyPath, requestPath, { signal } = {}) {
  if (!ROUTES.includes(route)) throw new Error('route-unsupported');
  const deps = testDeps || {};
  const needsTerminal = ['terminal', 'mcp-review'].includes(route);
  const report = baseReport(route, 'not-checked', needsTerminal ? 'not-checked' : 'not-required');
  if (signal?.aborted) return { ...report, reason: 'check-cancelled' };
  try {
    report.runtime = (deps.runtime || isExecutionRuntimeSupported)() ? 'supported' : 'unsupported';
    if (needsTerminal)
      report.terminal = (deps.terminal || isTerminalAvailable)() ? 'available' : 'unavailable';
  } catch {
    return report;
  }
  if (report.runtime !== 'supported') return { ...report, reason: 'runtime-unsupported' };
  const now = deps.now || (() => performance.now());
  const started = now();
  let timer;
  let abort;
  let outcome;
  try {
    outcome = await Promise.race([
      Promise.resolve().then(async () => {
        if (signal?.aborted) return { kind: 'cancelled' };
        try {
          return {
            kind: 'prepared',
            value: await (deps.prepare || prepareExecution)(policyPath, requestPath),
          };
        } catch {
          return { kind: 'unavailable' };
        }
      }),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'timeout' }), LIMITS.checkMs);
        abort = () => resolve({ kind: 'cancelled' });
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
  if (signal?.aborted || outcome.kind === 'cancelled')
    return { ...report, reason: 'check-cancelled' };
  if (outcome.kind === 'timeout' || now() - started >= LIMITS.checkMs)
    return { ...report, configuration: 'unavailable', reason: 'check-timeout' };
  const prepared = outcome.value;
  if (outcome.kind !== 'prepared' || !prepared) return { ...report, configuration: 'unavailable' };
  // Never spread or stringify the evaluator's private result, including launch.
  if (
    ['allow', 'ask', 'deny'].includes(prepared.decision) &&
    prepared.reason === `policy-${prepared.decision}`
  )
    return {
      ...report,
      configuration: 'valid',
      policyDecision: prepared.decision,
      reason: prepared.reason,
    };
  if (
    prepared.decision === 'deny' &&
    ['request-invalid', 'policy-invalid'].includes(prepared.reason)
  )
    return { ...report, configuration: 'invalid', reason: prepared.reason };
  return {
    ...report,
    configuration: 'unavailable',
    reason: prepared.reason === 'input-unavailable' ? 'input-unavailable' : 'check-unavailable',
  };
}

/**
 * Check selected files and current-process prerequisites before Electron starts.
 * Exit zero means the check completed with valid inputs, including a policy deny.
 * @param {string[]} args Flag, route, policy and request.
 * @param {(value:string) => void} write Redacted output sink.
 * @returns {Promise<number>} 0 completed, 2 unavailable/invalid configuration, 1 invalid CLI arguments.
 * @since v0.15.1
 */
async function handleActionRouteCheckCLI(args, write) {
  if (
    args.length !== 4 ||
    args[0] !== '--action-route-check-json' ||
    !ROUTES.includes(args[1]) ||
    args.slice(2).some((arg) => typeof arg !== 'string' || !arg || arg.startsWith('--'))
  ) {
    write(JSON.stringify({ error: 'expected-action-route-check-arguments' }));
    return 1;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.on('SIGINT', abort);
  process.on('SIGTERM', abort);
  let result;
  try {
    result = await checkActionRoute(args[1], args[2], args[3], { signal: controller.signal });
  } catch {
    result = baseReport(
      args[1],
      'not-checked',
      ['terminal', 'mcp-review'].includes(args[1]) ? 'not-checked' : 'not-required',
    );
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
  write(JSON.stringify(result));
  return result.configuration === 'valid' &&
    result.runtime === 'supported' &&
    ['available', 'not-required'].includes(result.terminal)
    ? 0
    : 2;
}

/** @param {object} deps Trusted preparation/runtime/terminal/clock seams. @returns {void} @since v0.15.1 */
function _setDepsForTest(deps) {
  testDeps = deps;
}
/** @returns {void} @since v0.15.1 */
function _resetForTest() {
  testDeps = null;
}
module.exports = {
  checkActionRoute,
  handleActionRouteCheckCLI,
  ROUTES,
  LIMITS,
  _setDepsForTest,
  _resetForTest,
};
