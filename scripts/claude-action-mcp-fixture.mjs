/** TEST ONLY: synthetic Anthropic responses for an explicitly configured local MCP tool. */
const TOOL_ID = 'toolu_aegislocal0001';
const TOOL_NAME = 'mcp__aegis__aegis_execute_selected';
const known = (value, choices) => (choices.includes(value) ? value : 'unexpected');
const privateCanaries = new WeakMap();
const REASONS = [
  'policy-allow',
  'policy-ask',
  'policy-deny',
  'child-exited',
  'spawn-failed',
  'action-cancelled',
  'approval-unavailable',
  'runtime-unsupported',
  'preparation-failed',
  'preparation-unavailable',
  'decision-invalid',
  'launch-invalid',
  'configuration-changed',
  'configuration-unavailable',
  'terminal-required',
  'confirmation-denied',
  'confirmation-unavailable',
  'execution-unavailable',
  'output-limit',
  'runtime-timeout',
  'child-error',
  'output-unavailable',
  'launch-failed',
];

/** Register bounded private markers outside the enumerable receipt sink.
 * @param {object} scenario Observation sink. @param {string[]} values Private markers.
 * @returns {void} @since v0.15.1 */
export function setPrivateCanaries(scenario, values) {
  if (
    !scenario ||
    typeof scenario !== 'object' ||
    Array.isArray(scenario) ||
    !Array.isArray(values) ||
    values.length > 8 ||
    !Array.from(values).every(
      (value) => typeof value === 'string' && value.length > 0 && value.length <= 1024,
    )
  )
    throw new Error('fixture-canaries-invalid');
  privateCanaries.set(scenario, [...values]);
}

/** Inspect complete provider output without returning private markers.
 * @param {unknown} value Provider text or parsed JSON. @param {object} scenario Observation sink.
 * @returns {boolean} Whether a private marker occurs. @since v0.15.1 */
export function hasPrivateCanary(value, scenario) {
  const text = typeof value === 'string' ? value : JSON.stringify(value) || '';
  if (/PRIVATE|aegis-mcp-owned/i.test(text)) return true;
  for (const canary of privateCanaries.get(scenario) || []) {
    let form = canary;
    // Provider wrappers can nest JSON text; match raw and escaped representations.
    for (let depth = 0; depth <= 10; depth++) {
      if (text.includes(form)) return true;
      const escaped = JSON.stringify(form).slice(1, -1);
      if (escaped === form) break;
      form = escaped;
    }
  }
  return false;
}

function reportFrom(value, depth = 0) {
  if (depth > 8 || value == null) return null;
  if (typeof value === 'string') {
    try {
      return reportFrom(JSON.parse(value), depth + 1);
    } catch {
      // Claude can wrap MCP text results with a provider-rendered heading.
      const first = value.indexOf('{');
      const last = value.lastIndexOf('}');
      if (first < 0 || last <= first) return null;
      try {
        return reportFrom(JSON.parse(value.slice(first, last + 1)), depth + 1);
      } catch {
        return null;
      }
    }
  }
  if (typeof value !== 'object') return null;
  if (value.schemaVersion === 1 && value.mode === 'action-exec') return value;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const result = reportFrom(child, depth + 1);
    if (result) return result;
  }
  return null;
}

/** @param {object} input Synthetic model request. @param {object} scenario Redacted observation sink.
 * @returns {void} @since v0.15.1 */
export function captureToolResult(input, scenario) {
  for (const message of Array.isArray(input.messages) ? input.messages : []) {
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block.type !== 'tool_result' || block.tool_use_id !== TOOL_ID) continue;
      scenario.toolResultSeen = true;
      scenario.resultIsError = block.is_error === true;
      scenario.resultContainsReportMarker = JSON.stringify(block.content).includes('action-exec');
      scenario.privacyLeakDetected =
        scenario.privacyLeakDetected === true || hasPrivateCanary(block, scenario);
      scenario.privacyPass = !scenario.privacyLeakDetected && !!scenario.report;
      const report = reportFrom(block.content);
      if (!report) continue;
      scenario.privacyPass = !scenario.privacyLeakDetected;
      scenario.report = {
        schemaVersion: report.schemaVersion,
        mode: report.mode,
        decision: known(report.decision, ['allow', 'ask', 'deny', 'unknown']),
        reason: known(report.reason, REASONS),
        ...(report.authorization === 'operator-confirmed'
          ? { authorization: 'operator-confirmed' }
          : {}),
        ...(['allow', 'ask', 'deny'].includes(report.policyDecision)
          ? { policyDecision: report.policyDecision }
          : {}),
        execution: {
          state: known(report.execution?.state, [
            'not-started',
            'exited',
            'spawn-failed',
            'interrupted',
            'unknown',
          ]),
          exitCode: Number.isSafeInteger(report.execution?.exitCode)
            ? report.execution.exitCode
            : null,
          outputComplete: report.execution?.outputComplete === true,
          termination: known(report.execution?.termination, [
            'not-requested',
            'confirmed',
            'unconfirmed',
          ]),
        },
        control: known(report.control, ['direct-child-only']),
        descendantControl: known(report.descendantControl, ['unsupported']),
      };
    }
  }
}

/** @param {object} res HTTP response. @param {object} input Parsed model request.
 * @param {object} scenario Synthetic action scenario. @returns {void} @since v0.15.1 */
export function replyWithSelectedTool(res, input, scenario) {
  captureToolResult(input, scenario);
  const selected = (Array.isArray(input.tools) ? input.tools : []).find(
    (tool) => tool.name === TOOL_NAME,
  );
  if (selected) scenario.toolDiscovered = true;
  const first = scenario.requests === 1 && selected;
  const block = first
    ? { type: 'tool_use', id: TOOL_ID, name: selected.name, input: {} }
    : { type: 'text', text: 'OK' };
  const message = {
    id: 'msg_aegislocal',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    content: [block],
    stop_reason: first ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  if (!input.stream) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(message));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const emit = (type, data) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  emit('message_start', {
    message: {
      ...message,
      content: [],
      stop_reason: null,
      usage: { input_tokens: 1, output_tokens: 0 },
    },
  });
  emit('content_block_start', {
    index: 0,
    content_block: first ? block : { type: 'text', text: '' },
  });
  emit('content_block_delta', {
    index: 0,
    delta: first
      ? { type: 'input_json_delta', partial_json: '{}' }
      : { type: 'text_delta', text: 'OK' },
  });
  emit('content_block_stop', { index: 0 });
  emit('message_delta', {
    delta: { stop_reason: message.stop_reason, stop_sequence: null },
    usage: { output_tokens: 1 },
  });
  emit('message_stop', {});
  res.end();
}
