/** TEST ONLY: bounded synthetic planner for the two explicitly configured catalog tools. */
import { createHash } from 'node:crypto';
import {
  captureToolResult,
  setPrivateCanaries,
  hasPrivateCanary,
  emitSyntheticToolReply,
} from './claude-action-mcp-fixture.mjs';
const scenarios = new WeakMap();
const names = {
  first: 'mcp__aegis__aegis_action_first',
  second: 'mcp__aegis__aegis_action_second',
};
const idFor = (index) => 'toolu_aegiscatalog' + (index + 1);
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const semantic = (block) => {
  const observed = {};
  captureToolResult({ messages: [{ content: [block] }] }, observed, block.tool_use_id);
  return fingerprint({ report: observed.report, resultIsError: observed.resultIsError });
};

/** Configure a bounded private tool plan; no configuration is serialized into receipts.
 * @param {object} scenario Redacted observation sink. @param {string[]} plan Fixed tool selectors.
 * @param {string[]} canaries Private leak markers. @param {Function} [onStep] Trusted observation callback.
 * @returns {void} @since v0.15.1 */
export function configureCatalogScenario(scenario, plan, canaries, onStep) {
  if (
    !Array.isArray(plan) ||
    !plan.length ||
    plan.length > 3 ||
    !Array.from(plan).every((tool) => tool === 'first' || tool === 'second') ||
    (onStep !== undefined && typeof onStep !== 'function')
  )
    throw Error('catalog-fixture-invalid');
  setPrivateCanaries(scenario, canaries);
  scenarios.set(scenario, {
    plan: [...plan],
    canaries: [...canaries],
    onStep,
    requested: 0,
    completed: 0,
    stopped: false,
    seen: new Map(),
    calls: 0,
  });
  scenario.steps = [];
  scenario.requestedSteps = 0;
  scenario.completedSteps = 0;
  scenario.toolDiscovered = false;
  scenario.privacyLeakDetected = false;
  scenario.protocolError = false;
}

/** Advance only after an actual correlated result, preserving privacy failures across history.
 * @param {object} res HTTP response. @param {object} input Model request.
 * @param {object} scenario Owned observation sink. @returns {void} @since v0.15.1 */
export function replyWithCatalogTools(res, input, scenario) {
  const state = scenarios.get(scenario);
  let block = { type: 'text', text: 'OK' };
  const fail = () => {
    scenario.protocolError = true;
    if (state) state.stopped = true;
  };
  const results = [];
  for (const message of Array.isArray(input.messages) ? input.messages : []) {
    for (const item of Array.isArray(message.content) ? message.content : []) {
      if (item?.type !== 'tool_result') continue;
      if (hasPrivateCanary(item, scenario)) scenario.privacyLeakDetected = true;
      results.push(item);
    }
  }
  if (!state) fail();
  else {
    state.calls++;
    const tools = Array.isArray(input.tools) ? input.tools : [];
    const discovered = state.plan.every((tool) =>
      tools.some((entry) => entry?.name === names[tool]),
    );
    scenario.toolDiscovered ||= discovered;
    if (scenario.privacyLeakDetected || state.calls > 4) fail();
    if (
      !state.stopped &&
      state.requested === 0 &&
      (state.calls !== 1 || scenario.requests !== 1 || !discovered || results.length)
    )
      fail();
    if (!state.stopped && state.requested > state.completed) {
      const index = state.completed;
      const id = idFor(index);
      const matching = results.filter((item) => item.tool_use_id === id);
      if (matching.length !== 1) fail();
      else {
        const step = scenario.steps[index];
        captureToolResult({ messages: [{ content: matching }] }, step, id);
        if (
          !step.report ||
          !step.privacyPass ||
          step.report.decision === 'unexpected' ||
          step.report.execution.state === 'unexpected'
        )
          fail();
        else {
          state.seen.set(id, semantic(matching[0]));
          state.completed++;
          scenario.completedSteps = state.completed;
          try {
            state.onStep?.(step, index);
          } catch {
            fail();
          }
        }
      }
    }
    // Claude rewrites old result wrappers. Compare redacted semantics while the
    // complete raw block still passes the independent canary scan above.
    for (const result of results) {
      const prior = state.seen.get(result.tool_use_id);
      if (!prior || prior !== semantic(result)) {
        scenario.protocolErrorReason = !prior ? 'unknown-result' : 'report-changed';
        fail();
      }
    }
    if (!state.stopped && state.requested < state.plan.length) {
      const index = state.requested;
      const tool = state.plan[index];
      if (!tools.some((entry) => entry?.name === names[tool])) fail();
      else {
        const step = { tool, toolDiscovered: true, toolResultSeen: false, privacyPass: false };
        setPrivateCanaries(step, state.canaries);
        scenario.steps.push(step);
        state.requested++;
        scenario.requestedSteps = state.requested;
        block = { type: 'tool_use', id: idFor(index), name: names[tool], input: {} };
      }
    }
  }
  if (scenario.privacyLeakDetected) {
    for (const step of scenario.steps || []) step.privacyPass = false;
  }
  emitSyntheticToolReply(res, input, block);
}
