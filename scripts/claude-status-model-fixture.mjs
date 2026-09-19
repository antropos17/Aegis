/** TEST ONLY: finite local model plan status -> action -> status. */
import {
  captureToolResult,
  setPrivateCanaries,
  hasPrivateCanary,
  emitSyntheticToolReply,
} from './claude-action-mcp-fixture.mjs';
const states = new WeakMap();
const idFor = (index) => 'toolu_aegisstatus' + (index + 1);
const counts = [
  'messagesObserved',
  'actionAttempts',
  'selectionRejected',
  'ownerInvocations',
  'ownerSettled',
  'ownerFailures',
  'cancellationRequests',
];
const constants = {
  schemaVersion: 1,
  mode: 'action-route-status',
  scope: 'current-mcp-connection',
  authorization: 'none',
  control: 'direct-child-only',
  outsideRouteCoverage: 'unknown',
  descendantControl: 'unsupported',
  blockingVerification: 'not-performed',
  providerIdentity: 'unverified',
};
const invalid = () => {
  throw Error('status-fixture-invalid');
};
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

function statusReport(value, catalog) {
  if (
    !exact(value, [
      ...Object.keys(constants),
      ...counts,
      'selection',
      'selectedActionCount',
      'activity',
      'limits',
    ]) ||
    !Object.entries(constants).every(([key, expected]) => value[key] === expected) ||
    value.selection !== (catalog ? 'catalog' : 'single-action') ||
    !Number.isSafeInteger(value.selectedActionCount) ||
    value.selectedActionCount < 1 ||
    value.selectedActionCount > (catalog ? 8 : 1) ||
    !['idle', 'owner-pending', 'cancellation-requested'].includes(value.activity) ||
    !exact(value.limits, ['messages', 'actionAttempts']) ||
    value.limits.messages !== 128 ||
    value.limits.actionAttempts !== 16
  )
    invalid();
  const safe = {};
  for (const name of counts) {
    if (
      !Number.isSafeInteger(value[name]) ||
      value[name] < 0 ||
      value[name] > (name === 'messagesObserved' ? 128 : 16)
    )
      invalid();
    safe[name] = value[name];
  }
  if (
    safe.messagesObserved < 1 ||
    safe.selectionRejected + safe.ownerInvocations !== safe.actionAttempts ||
    safe.ownerSettled > safe.ownerInvocations ||
    safe.ownerFailures > safe.ownerSettled ||
    safe.cancellationRequests > safe.ownerInvocations ||
    safe.ownerInvocations - safe.ownerSettled !== (value.activity === 'idle' ? 0 : 1) ||
    (value.activity === 'cancellation-requested' && safe.cancellationRequests < 1)
  )
    invalid();
  return {
    ...constants,
    selection: value.selection,
    selectedActionCount: value.selectedActionCount,
    activity: value.activity,
    ...safe,
    limits: { messages: 128, actionAttempts: 16 },
  };
}

function reports(content, mode) {
  const found = [];
  let nodes = 0;
  const visit = (value, depth) => {
    if (++nodes > 2048 || depth > 12) invalid();
    if (typeof value === 'string') {
      if (Buffer.byteLength(value) > 65536) invalid();
      let parsed;
      try {
        parsed = JSON.parse(value);
      } catch {
        const first = value.indexOf('{'),
          last = value.lastIndexOf('}');
        if (first < 0 || last <= first) return;
        try {
          parsed = JSON.parse(value.slice(first, last + 1));
        } catch {
          return;
        }
      }
      visit(parsed, depth + 1);
    } else if (value && typeof value === 'object') {
      if (['action-route-status', 'action-exec'].includes(value.mode)) {
        if (value.mode !== mode) invalid();
        found.push(value);
      } else for (const child of Object.values(value)) visit(child, depth + 1);
    }
  };
  visit(content, 0);
  if (!found.length) invalid();
  return found;
}

function observe(block, tool, state) {
  if (typeof block.is_error !== 'undefined' && typeof block.is_error !== 'boolean') invalid();
  const values = reports(block.content, tool === 'status' ? 'action-route-status' : 'action-exec');
  let normalized;
  for (const value of values) {
    let report;
    if (tool === 'status') report = statusReport(value, state.catalog);
    else {
      const captured = {};
      captureToolResult(
        { messages: [{ content: [{ ...block, content: value }] }] },
        captured,
        block.tool_use_id,
      );
      report = captured.report;
      if (!report || JSON.stringify(report).includes('unexpected')) invalid();
    }
    const semantic = JSON.stringify(report);
    if (normalized !== undefined && normalized !== semantic) invalid();
    normalized = semantic;
  }
  if (tool === 'status' && block.is_error === true) invalid();
  return {
    tool,
    toolDiscovered: true,
    toolResultSeen: true,
    privacyPass: true,
    resultIsError: block.is_error === true,
    report: JSON.parse(normalized),
  };
}

/** Configure only the fixed status/action/status plan; keep canaries outside receipts.
 * @param {object} scenario Public observation sink. @param {{catalog:boolean}} options Route type.
 * @param {string[]} canaries Private markers. @param {Function} [onStep] Completion callback.
 * @returns {void} @since v0.15.1 */
export function configureStatusScenario(scenario, options, canaries, onStep) {
  if (
    !exact(options, ['catalog']) ||
    typeof options.catalog !== 'boolean' ||
    (onStep !== undefined && typeof onStep !== 'function')
  )
    invalid();
  setPrivateCanaries(scenario, canaries);
  states.set(scenario, {
    catalog: options.catalog,
    onStep,
    calls: 0,
    requested: 0,
    completed: 0,
    stopped: false,
    seen: new Map(),
    names: [
      'mcp__aegis__aegis_route_status',
      options.catalog ? 'mcp__aegis__aegis_action_second' : 'mcp__aegis__aegis_execute_selected',
      'mcp__aegis__aegis_route_status',
    ],
  });
  Object.assign(scenario, {
    steps: [],
    requestedSteps: 0,
    completedSteps: 0,
    toolDiscovered: false,
    privacyLeakDetected: false,
    protocolError: false,
  });
}

/** Require correlated real results and stable redacted history before advancing.
 * @param {object} res Synthetic API response. @param {object} input Provider request.
 * @param {object} scenario Public observation sink. @returns {void} @since v0.15.1 */
export function replyWithStatusTools(res, input, scenario) {
  const state = states.get(scenario);
  let reply = { type: 'text', text: 'OK' };
  let stream = false;
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
    stream = input.stream === true;
    if (!state) invalid();
    state.calls++;
    const messages = input.messages ?? [];
    if (!Array.isArray(messages) || messages.length > 128) invalid();
    const blocks = [];
    let frames = 0;
    for (const message of messages) {
      if (typeof message?.content === 'string') continue;
      if (!Array.isArray(message?.content)) invalid();
      for (const block of message.content) {
        if (++frames > 128) invalid();
        if (block?.type !== 'tool_result') continue;
        const raw = JSON.stringify(block);
        if (Buffer.byteLength(raw) > 65536) invalid();
        scenario.privacyLeakDetected ||= hasPrivateCanary(raw, scenario);
        blocks.push(block);
      }
    }
    if (
      state.stopped ||
      state.calls > 4 ||
      scenario.requests !== state.calls ||
      scenario.privacyLeakDetected
    )
      invalid();
    if (!Array.isArray(input.tools) || input.tools.length > 128) invalid();
    const discovered = state.names.every((name) => input.tools.some((tool) => tool?.name === name));
    scenario.toolDiscovered ||= discovered;
    if (!discovered || (!state.requested && blocks.length)) invalid();
    const observed = new Map();
    for (const block of blocks) {
      const index = [0, 1, 2].find((i) => idFor(i) === block.tool_use_id);
      if (index === undefined || index >= state.requested || observed.has(index)) invalid();
      const step = observe(block, index === 1 ? 'action' : 'status', state);
      const semantic = JSON.stringify(step);
      if (index < state.completed && state.seen.get(index) !== semantic) invalid();
      observed.set(index, step);
    }
    if (state.requested > state.completed) {
      const index = state.completed,
        step = observed.get(index);
      if (!step) invalid();
      scenario.steps[index] = step;
      state.seen.set(index, JSON.stringify(step));
      scenario.completedSteps = ++state.completed;
      state.onStep?.(step, index);
    }
    if (state.requested < 3) {
      const index = state.requested++;
      scenario.steps.push({
        tool: index === 1 ? 'action' : 'status',
        toolDiscovered: true,
        toolResultSeen: false,
        privacyPass: false,
      });
      scenario.requestedSteps = state.requested;
      reply = { type: 'tool_use', id: idFor(index), name: state.names[index], input: {} };
    }
  } catch {
    scenario.protocolError = true;
    if (state) state.stopped = true;
  }
  if (scenario.privacyLeakDetected)
    for (const step of scenario.steps || []) step.privacyPass = false;
  emitSyntheticToolReply(res, { stream }, reply);
}
