'use strict';

const catalog = require('./action-mcp-catalog');
const { prepareExecution } = require('./execution-policy');
const { isExecutionRuntimeSupported } = require('./execution-runtime');
const { isTerminalAvailable } = require('./action-confirmation-terminal');
const { baseReport } = require('./action-route-check');
const CATALOG_ROUTES = Object.freeze(['mcp-stdio', 'mcp-review']);
const LIMITS = Object.freeze({ checkMs: 1500 });
let testDeps = null;

function project(name, prepared) {
  const result = {
    name,
    configuration: 'unavailable',
    policyDecision: 'unknown',
    reason: 'check-unavailable',
  };
  if (
    prepared &&
    ['allow', 'ask', 'deny'].includes(prepared.decision) &&
    prepared.reason === `policy-${prepared.decision}`
  )
    return {
      name,
      configuration: 'valid',
      policyDecision: prepared.decision,
      reason: prepared.reason,
    };
  if (
    prepared?.decision === 'deny' &&
    ['request-invalid', 'policy-invalid'].includes(prepared.reason)
  )
    return { ...result, configuration: 'invalid', reason: prepared.reason };
  if (prepared?.reason === 'input-unavailable') result.reason = 'input-unavailable';
  return result;
}

/** Inspect all operator-selected catalog entries without retaining capabilities or executing.
 * One deadline covers manifest capture and sequential revision-bound evaluation.
 * @param {string} route One of CATALOG_ROUTES.
 * @param {string} catalogPath Explicit selected manifest.
 * @param {{signal?: AbortSignal}} [options] Trusted owner cancellation.
 * @returns {Promise<object>} Fixed metadata with public tool names only.
 * @since v0.15.1 */
async function checkActionCatalogRoute(route, catalogPath, { signal } = {}) {
  if (!CATALOG_ROUTES.includes(route)) throw new Error('route-unsupported');
  const needsTerminal = route === 'mcp-review';
  const report = {
    ...baseReport(route, 'not-checked', needsTerminal ? 'not-checked' : 'not-required'),
    mode: 'action-catalog-check',
    configurationObservation: 'bounded-revision-check-not-retained',
    actions: [],
  };
  if (signal?.aborted) return { ...report, reason: 'check-cancelled' };
  const deps = testDeps || {};
  try {
    report.runtime = (deps.runtime || isExecutionRuntimeSupported)() ? 'supported' : 'unsupported';
    if (needsTerminal)
      report.terminal = (deps.terminal || isTerminalAvailable)() ? 'available' : 'unavailable';
  } catch {
    return report;
  }
  if (report.runtime !== 'supported') return { ...report, reason: 'runtime-unsupported' };
  const capture = deps.capture || catalog.captureActionCatalog;
  const select = deps.select || catalog.selectActionCatalog;
  const list = deps.list || catalog.listActionCatalog;
  const revoke = deps.revoke || catalog.revokeActionCatalog;
  const prepare = deps.prepare || prepareExecution;
  const now = deps.now || (() => performance.now());
  const started = now();
  const controller = new AbortController();
  let cap;
  let finished = false;
  let timer;
  let abort;
  const elapsed = () => now() - started >= LIMITS.checkMs;
  const stopped = () => finished || controller.signal.aborted || signal?.aborted || elapsed();
  const dispose = () => {
    if (cap) {
      const owned = cap;
      cap = null;
      revoke(owned);
    }
  };
  try {
    const outcome = await Promise.race([
      (async () => {
        let captured;
        try {
          captured = await capture(catalogPath, { signal: controller.signal });
        } catch {
          return { reason: 'catalog-unavailable' };
        }
        if (stopped()) {
          revoke(captured);
          return { reason: 'check-unavailable' };
        }
        cap = captured;
        const tools = list(cap);
        const actions = [];
        for (const tool of tools) {
          if (stopped()) return { reason: 'check-unavailable' };
          let selected;
          try {
            selected = select(cap, tool.name);
          } catch {
            return { reason: 'configuration-changed' };
          }
          const prepared = await prepare(selected.policyPath, selected.requestPath, {
            binding: selected.binding,
          });
          if (stopped()) return { reason: 'check-unavailable' };
          actions.push(project(tool.name, prepared));
        }
        // Check every member again; one revoked binding invalidates all prior observations.
        try {
          for (const tool of tools) select(cap, tool.name);
        } catch {
          return { reason: 'configuration-changed' };
        }
        return { actions };
      })().catch(() => ({ reason: 'check-unavailable' })),
      new Promise((resolve) => {
        const stop = (reason) => {
          controller.abort();
          dispose();
          resolve({ reason });
        };
        abort = () => stop('check-cancelled');
        timer = setTimeout(() => stop('check-timeout'), LIMITS.checkMs);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      }),
    ]);
    if (signal?.aborted || outcome.reason === 'check-cancelled')
      return { ...report, reason: 'check-cancelled' };
    if (elapsed() || outcome.reason === 'check-timeout')
      return { ...report, configuration: 'unavailable', reason: 'check-timeout' };
    if (!outcome.actions)
      return { ...report, configuration: 'unavailable', reason: outcome.reason };
    const configuration = outcome.actions.some((action) => action.configuration === 'invalid')
      ? 'invalid'
      : outcome.actions.some((action) => action.configuration !== 'valid')
        ? 'unavailable'
        : 'valid';
    return {
      ...report,
      configuration,
      reason:
        configuration === 'valid'
          ? 'catalog-checked'
          : configuration === 'invalid'
            ? 'catalog-invalid'
            : 'catalog-unavailable',
      actions: outcome.actions,
    };
  } finally {
    finished = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.abort();
    dispose();
  }
}

/** @param {string[]} args Flag, route and manifest. @param {Function} write Fixed JSON sink.
 * @returns {Promise<number>} 0 completed valid check, 2 unavailable, 1 bad arguments.
 * @since v0.15.1 */
async function handleActionCatalogCheckCLI(args, write) {
  if (
    args.length !== 3 ||
    args[0] !== '--action-catalog-check-json' ||
    !CATALOG_ROUTES.includes(args[1]) ||
    typeof args[2] !== 'string' ||
    !args[2] ||
    args[2].startsWith('--')
  ) {
    write(JSON.stringify({ error: 'expected-action-catalog-check-arguments' }));
    return 1;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.on('SIGINT', abort);
  process.on('SIGTERM', abort);
  let result;
  try {
    result = await checkActionCatalogRoute(args[1], args[2], { signal: controller.signal });
  } catch {
    result = {
      ...baseReport(
        args[1],
        'not-checked',
        args[1] === 'mcp-review' ? 'not-checked' : 'not-required',
      ),
      mode: 'action-catalog-check',
      configurationObservation: 'bounded-revision-check-not-retained',
      actions: [],
    };
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

/** @param {object} deps Trusted catalog/evaluator/runtime/clock seams. @returns {void} @since v0.15.1 */
function _setDepsForTest(deps) {
  testDeps = deps;
}
/** @returns {void} @since v0.15.1 */
function _resetForTest() {
  testDeps = null;
}
module.exports = {
  checkActionCatalogRoute,
  handleActionCatalogCheckCLI,
  CATALOG_ROUTES,
  LIMITS,
  _setDepsForTest,
  _resetForTest,
};
