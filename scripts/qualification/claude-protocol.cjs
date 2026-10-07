'use strict';

// Fixed disposable guest corpus; no project path or command comes from the wire.
const { isDeepStrictEqual } = require('node:util');
const TRUSTED = 'C:/ProgramData/AegisCloudLab/trusted';
const ROOT = 'C:/AegisLab/work/claude';
const SOURCE = `${ROOT}/sum.cjs`;
const BEFORE = 'module.exports = (a, b) => a - b;\n';
const AFTER = 'module.exports = (a, b) => a + b;\n';
const MARKER = 'AEGIS_CLAUDE_NODE_TEST_OK';
const DONE = 'AEGIS_CLAUDE_DONE';
const COMMAND = "& 'C:\\ProgramData\\AegisCloudLab\\trusted\\node.exe' --test 'C:\\ProgramData\\AegisCloudLab\\trusted\\claude-sum.test.cjs'";
const STEPS = Object.freeze([
  { name: 'Read', input: { file_path: SOURCE } },
  { name: 'Edit', input: { file_path: SOURCE, old_string: BEFORE.trimEnd(), new_string: AFTER.trimEnd(), replace_all: false } },
  { name: 'PowerShell', input: { command: COMMAND, description: 'Run the fixed disposable Node test', timeout: 10000 } },
].map(step => Object.freeze({ name: step.name, input: Object.freeze(step.input) })));

function refuse(code) { throw new Error(code); }
function endpoint(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'address,kind,nonce,port,schemaVersion' ||
      value.schemaVersion !== 1 || value.kind !== 'claude-ready' || value.address !== '127.0.0.1' ||
      !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 ||
      typeof value.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(value.nonce)) refuse('endpoint-invalid');
  return Object.freeze({ ...value });
}
function contentText(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value) || value.length > 8 || value.some(item => item?.type !== 'text' || typeof item.text !== 'string'))
    refuse('tool-result-invalid');
  return value.map(item => item.text).join('\n');
}
function registry(tools) {
  if (!Array.isArray(tools) || tools.length < 3 || tools.length > 4) refuse('tool-registry-unavailable');
  const names = tools.map(tool => tool?.name);
  if (new Set(names).size !== names.length || STEPS.some(step => !names.includes(step.name)) ||
      names.some(name => !['Read', 'Edit', 'PowerShell', 'EndConversation'].includes(name))) refuse('tool-registry-unavailable');
  for (const step of STEPS) {
    const schema = tools.find(tool => tool.name === step.name)?.input_schema;
    if (!schema || schema.type !== 'object' || !schema.properties ||
        Object.keys(step.input).some(key => !Object.hasOwn(schema.properties, key))) refuse('tool-schema-unavailable');
  }
}
function session() {
  let count = 0, failed = false;
  const observations = [];
  return {
    advance(input) {
      try {
        if (failed || count >= 4 || !input || input.model !== 'claude-sonnet-4-6' ||
            (input.stream !== undefined && typeof input.stream !== 'boolean')) refuse('request-invalid');
        registry(input.tools);
        if (!Array.isArray(input.messages) || input.messages.length > 16) refuse('messages-invalid');
        const calls = [], results = [], events = [];
        for (const message of input.messages) {
          if (!['user', 'assistant'].includes(message?.role)) refuse('messages-invalid');
          if (!Array.isArray(message.content)) {
            if (typeof message.content !== 'string' || message.role !== 'user') refuse('messages-invalid');
            continue;
          }
          for (const block of message.content) {
            if (block?.type === 'tool_use') {
              if (message.role !== 'assistant') refuse('tool-sequence-invalid');
              calls.push(block); events.push({ kind: 'call', block });
            } else if (block?.type === 'tool_result') {
              if (message.role !== 'user') refuse('tool-sequence-invalid');
              results.push(block); events.push({ kind: 'result', block });
            } else if (block?.type !== 'text' || typeof block.text !== 'string') refuse('messages-invalid');
          }
        }
        if (calls.length !== count || results.length !== count) refuse('tool-sequence-invalid');
        for (let i = 0; i < count; i++) {
          if (events[2 * i]?.kind !== 'call' || events[2 * i + 1]?.kind !== 'result' ||
              events[2 * i].block !== calls[i] || events[2 * i + 1].block !== results[i]) refuse('tool-sequence-invalid');
          if (calls[i].id !== `toolu_aegisguest${i + 1}` || calls[i].name !== STEPS[i].name ||
              !isDeepStrictEqual(calls[i].input, STEPS[i].input) ||
              results[i].tool_use_id !== calls[i].id ||
              (results[i].is_error !== undefined && results[i].is_error !== false)) refuse('tool-result-invalid');
          const text = contentText(results[i].content);
          if (Buffer.byteLength(text) > 8192 || !text ||
              (i === 0 && !text.includes(BEFORE.trimEnd())) ||
              (i === 2 && !text.includes(MARKER))) refuse('tool-result-invalid');
        }
        if (count > 0) {
          const last = input.messages.at(-1);
          if (last.role !== 'user' || !Array.isArray(last.content) ||
              last.content.filter(block => block.type === 'tool_result').length !== 1 ||
              last.content.find(block => block.type === 'tool_result').tool_use_id !== `toolu_aegisguest${count}`)
            refuse('tool-sequence-invalid');
          observations[count - 1] = true;
        }
        const block = count < 3 ? { type: 'tool_use', id: `toolu_aegisguest${count + 1}`, ...STEPS[count] } : { type: 'text', text: DONE };
        count++;
        return { block, stopReason: count === 4 ? 'end_turn' : 'tool_use' };
      } catch (error) { failed = true; throw error; }
    },
    receipt() { return { requests: count, toolResults: [...observations], complete: count === 4 && !failed && observations.length === 3 && observations.every(value => value === true) }; },
  };
}
function reply(input, result) {
  const message = { id: 'msg_aegisguest', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6',
    content: [result.block], stop_reason: result.stopReason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
  if (!input.stream) return { type: 'application/json', text: JSON.stringify(message) };
  const events = [];
  const emit = (type, data) => events.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  emit('message_start', { message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } });
  emit('content_block_start', { index: 0, content_block: result.block.type === 'tool_use' ? { ...result.block, input: {} } : { type: 'text', text: '' } });
  emit('content_block_delta', { index: 0, delta: result.block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(result.block.input) } : { type: 'text_delta', text: DONE } });
  emit('content_block_stop', { index: 0 });
  emit('message_delta', { delta: { stop_reason: result.stopReason, stop_sequence: null }, usage: { output_tokens: 1 } });
  emit('message_stop', {});
  return { type: 'text/event-stream', text: events.join('') };
}
function clientOutput(text) {
  if (Buffer.byteLength(text) > 65536) return false;
  try {
    const value = JSON.parse(text);
    return value?.type === 'result' && value.subtype === 'success' && value.is_error === false && value.result === DONE;
  } catch { return false; }
}
module.exports = { TRUSTED, ROOT, SOURCE, BEFORE, AFTER, MARKER, DONE, COMMAND, STEPS, endpoint, session, reply, clientOutput };
