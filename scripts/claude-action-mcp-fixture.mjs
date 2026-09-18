/** TEST ONLY: synthetic Anthropic responses for an explicitly configured local MCP tool. */
const TOOL_ID = 'toolu_aegislocal0001';
const TOOL_NAME = 'mcp__aegis__aegis_execute_selected';
const known = (value, choices) => (choices.includes(value) ? value : 'unexpected');

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
        scenario.privacyLeakDetected === true ||
        /PRIVATE|aegis-mcp-owned/i.test(JSON.stringify(block));
      scenario.privacyPass = !scenario.privacyLeakDetected && !!scenario.report;
      const report = reportFrom(block.content);
      if (!report) continue;
      scenario.privacyPass = !scenario.privacyLeakDetected;
      scenario.report = {
        schemaVersion: report.schemaVersion,
        mode: report.mode,
        decision: known(report.decision, ['allow', 'ask', 'deny', 'unknown']),
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
