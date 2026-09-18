/** @param {string} value Local path. @returns {string} Bash-quoted path. @since v0.15.1 */
export const quote = (value) => `'${value.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`;
/** @param {object} scenario Synthetic scenario. @returns {object} Fixed tool input. @since v0.15.1 */
export const toolInput = (scenario) =>
  scenario.kind === 'agent'
    ? {
        description: 'Local synthetic hook check',
        prompt: 'Reply OK without tools.',
        subagent_type: 'general-purpose',
      }
    : {
        command: `printf checked > ${quote(scenario.sentinel)}`,
        description: 'Write isolated disposable sentinel',
      };

/** @param {object} res HTTP response. @param {object} input Parsed request.
 * @param {object} scenario Synthetic scenario. @returns {void} @since v0.15.1 */
export function sendReply(res, input, scenario) {
  const first = scenario.requests === 1;
  const block = first
    ? {
        type: 'tool_use',
        id: 'toolu_localtest0001',
        name: scenario.kind === 'agent' ? 'Agent' : 'Bash',
        input: toolInput(scenario),
      }
    : { type: 'text', text: 'OK' };
  const message = {
    id: 'msg_localtest',
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
    content_block: first ? { ...block, input: {} } : { type: 'text', text: '' },
  });
  emit('content_block_delta', {
    index: 0,
    delta: first
      ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) }
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
