'use strict';
// Pure protocol controls only: no provider, child process, HTTP socket or project effect.
const assert = require('node:assert/strict');
const p = require('./claude-protocol.cjs');
let cases = 0;
function check(name, operation) { operation(); cases++; }
function registry() {
  return p.STEPS.map(step => ({ name: step.name, input_schema: { type: 'object', properties: Object.fromEntries(Object.keys(step.input).map(key => [key, { type: typeof step.input[key] }])) } }));
}
function transcript(count = 0) {
  const messages = [{ role: 'user', content: 'fixed disposable project' }];
  for (let i = 0; i < count; i++) {
    messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: `toolu_aegisguest${i + 1}`, ...structuredClone(p.STEPS[i]) }] });
    messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_aegisguest${i + 1}`, content: i === 0 ? p.BEFORE : i === 2 ? p.MARKER : 'fixed edit completed' }] });
  }
  return { model: 'claude-sonnet-4-6', tools: registry(), messages, stream: false };
}
const ready = { schemaVersion: 1, kind: 'claude-ready', address: '127.0.0.1', port: 1234, nonce: 'a'.repeat(32) };
check('closed endpoint', () => assert.deepEqual(p.endpoint(ready), ready));
for (const [name, mutate] of [
  ['nonloopback', value => value.address = '192.0.2.1'], ['port string', value => value.port = '1234'],
  ['zero port', value => value.port = 0], ['unknown key', value => value.extra = true], ['nonce shape', value => value.nonce = 'secret'],
  ['nonce array', value => value.nonce = ['a'.repeat(32)]],
]) check(name, () => { const value = structuredClone(ready); mutate(value); assert.throws(() => p.endpoint(value)); });
check('actual expected JSON/SSE wire encoding', () => {
  const corpus = p.session();
  for (let i = 0; i < 4; i++) {
    const input = transcript(i), result = corpus.advance(input), json = p.reply(input, result), sse = p.reply({ ...input, stream: true }, result);
    assert.equal(JSON.parse(json.text).stop_reason, i === 3 ? 'end_turn' : 'tool_use');
    assert(sse.text.includes('event: message_start')); assert(sse.text.includes('event: message_stop'));
    assert(sse.text.includes(i === 3 ? p.DONE : p.STEPS[i].name));
  }
  assert.deepEqual(corpus.receipt(), { requests: 4, toolResults: [true, true, true], complete: true });
  assert.throws(() => corpus.advance(transcript(3))); assert.equal(corpus.receipt().complete, false);
});
for (const [name, stage, mutate] of [
  ['missing PowerShell', 0, input => input.tools.pop()],
  ['unexpected Bash', 0, input => input.tools.push({ name: 'Bash' })],
  ['duplicate tool', 0, input => input.tools.push(input.tools[0])],
  ['unsupported command schema', 0, input => delete input.tools[2].input_schema.properties.command],
  ['wrong model', 0, input => input.model = 'other'],
  ['missing Read result', 1, input => input.messages.pop()],
  ['wrong result id', 1, input => input.messages.at(-1).content[0].tool_use_id = 'other'],
  ['error result', 1, input => input.messages.at(-1).content[0].is_error = true],
  ['string error false', 1, input => input.messages.at(-1).content[0].is_error = 'false'],
  ['Read content wrong', 1, input => input.messages.at(-1).content[0].content = 'permission denied'],
  ['extra tool use', 1, input => input.messages[1].content.push(input.messages[1].content[0])],
  ['changed command', 3, input => input.messages[5].content[0].input.command = 'arbitrary'],
  ['missing test marker', 3, input => input.messages.at(-1).content[0].content = 'test failed'],
  ['unknown image result', 3, input => input.messages.at(-1).content[0].content = [{ type: 'image' }]],
  ['result budget', 3, input => input.messages.at(-1).content[0].content = p.MARKER + 'x'.repeat(8192)],
  ['Astra all tools in user role', 3, input => {
    for (let i = 1; i < input.messages.length; i += 2) input.messages[i].role = 'user';
  }],
  ['result in assistant role', 1, input => input.messages.at(-1).role = 'assistant'],
  ['result before call', 1, input => [input.messages[1], input.messages[2]] = [input.messages[2], input.messages[1]]],
  ['all calls before results', 3, input => input.messages = [input.messages[0], input.messages[1], input.messages[3], input.messages[5], input.messages[2], input.messages[4], input.messages[6]]],
  ['history pair reordered', 3, input => input.messages = [input.messages[0], input.messages[3], input.messages[4], input.messages[1], input.messages[2], input.messages[5], input.messages[6]]],
  ['wrong-role combined call result', 1, input => input.messages = [input.messages[0], { role: 'user', content: [...input.messages[1].content, ...input.messages[2].content] }]],
]) check(name, () => {
  const corpus = p.session(); for (let i = 0; i < stage; i++) corpus.advance(transcript(i));
  const input = transcript(stage); mutate(input);
  assert.throws(() => corpus.advance(input)); assert.equal(corpus.receipt().complete, false);
  assert.throws(() => corpus.advance(transcript(stage))); // Failure stays sticky.
});
check('documented unavoidable EndConversation presence', () => {
  const input = transcript(); input.tools.push({ name: 'EndConversation' }); assert.equal(p.session().advance(input).block.name, 'Read');
});
check('text-block results', () => {
  const corpus = p.session(); corpus.advance(transcript()); const input = transcript(1);
  input.messages.at(-1).content[0].content = [{ type: 'text', text: p.BEFORE }]; assert.equal(corpus.advance(input).block.name, 'Edit');
});
check('valid ordered roles with incidental text', () => {
  const corpus = p.session();
  for (let i = 0; i < 4; i++) {
    const input = transcript(i);
    for (const message of input.messages) {
      if (Array.isArray(message.content)) message.content.unshift({ type: 'text', text: 'fixed incidental annotation' });
    }
    corpus.advance(input);
  }
  assert.equal(corpus.receipt().complete, true);
});
const good = { type: 'result', subtype: 'success', is_error: false, result: p.DONE };
check('closed client success', () => assert.equal(p.clientOutput(JSON.stringify(good)), true));
for (const [name, value] of [
  ['malformed client JSON', '{'], ['claimed error', JSON.stringify({ ...good, is_error: true })],
  ['missing success field', JSON.stringify({ type: 'result', result: p.DONE })],
  ['wrong completion', JSON.stringify({ ...good, result: 'OK' })], ['client budget', 'x'.repeat(65537)],
]) check(name, () => assert.equal(p.clientOutput(value), false));

// The pinned 2.1.292 client coalesces completed tools into ordered assistant/user batches.
// Actual request-shape evidence records Read/Edit together at request 3; values below
// are fixed fixture values rather than a claim to have retained raw provider messages.
function grouped(count, partitions = [count]) {
  const input = transcript(count), messages = [input.messages[0]];
  let at = 0;
  for (const size of partitions) {
    const calls = [], results = [];
    for (let i = 0; i < size; i++, at++) {
      calls.push(input.messages[2 * at + 1].content[0]);
      results.push(input.messages[2 * at + 2].content[0]);
    }
    messages.push({ role: 'assistant', content: calls }, { role: 'user', content: results });
  }
  assert.equal(at, count); input.messages = messages; return input;
}
check('actual pinned client coalesced Read Edit history', () => {
  const corpus = p.session(); corpus.advance(transcript()); corpus.advance(transcript(1));
  assert.equal(corpus.advance(grouped(2)).block.name, 'PowerShell');
  assert.equal(corpus.advance(grouped(3)).block.text, p.DONE);
  assert.equal(corpus.receipt().complete, true);
});
for (const partition of [[1, 2], [2, 1], [1, 1, 1]]) check('ordered mixed batches ' + partition, () => {
  const corpus = p.session(); for (let i = 0; i < 3; i++) corpus.advance(transcript(i));
  corpus.advance(grouped(3, partition)); assert.equal(corpus.receipt().complete, true);
});
for (const [name, mutate] of [
  ['grouped reordered calls', x => x.messages[1].content.reverse()],
  ['grouped reordered results', x => x.messages[2].content.reverse()],
  ['grouped duplicate call', x => x.messages[1].content[1] = x.messages[1].content[0]],
  ['grouped duplicate result', x => x.messages[2].content[1] = x.messages[2].content[0]],
  ['grouped missing prior call', x => x.messages[1].content.shift()],
  ['grouped missing prior result', x => x.messages[2].content.shift()],
  ['grouped foreign id', x => x.messages[2].content[0].tool_use_id = 'foreign'],
  ['grouped future id', x => x.messages[1].content[0].id = 'toolu_aegisguest4'],
  ['grouped call role swap', x => x.messages[1].role = 'user'],
  ['grouped result role swap', x => x.messages[2].role = 'assistant'],
  ['grouped result before calls', x => [x.messages[1], x.messages[2]] = [x.messages[2], x.messages[1]]],
  ['grouped changed exact input', x => x.messages[1].content[1].input.new_string = 'arbitrary'],
  ['grouped error result', x => x.messages[2].content[1].is_error = true],
  ['grouped extra block', x => x.messages[2].content.push({type:'image'})],
  ['grouped extra tool result', x => x.messages[2].content.push(x.messages[2].content[0])],
  ['grouped nonterminal latest result', x => x.messages.push({role:'user',content:[{type:'text',text:'extra'}]})],
]) check(name, () => {
  const corpus = p.session(); corpus.advance(transcript()); corpus.advance(transcript(1));
  const input = grouped(2); mutate(input);
  assert.throws(() => corpus.advance(input)); assert.equal(corpus.receipt().complete, false);
  assert.throws(() => corpus.advance(grouped(2)));
});

console.log(JSON.stringify({ schemaVersion: 1, cases, passed: true, mode: 'pure-fixed-protocol-controls', providerStarted: false, socketsOpened: false }));
