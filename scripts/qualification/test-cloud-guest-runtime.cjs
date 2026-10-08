'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const source = fs.readFileSync(__dirname + '/cloud-guest-runtime.cjs', 'utf8');
let controls = 0;
function make(envOverride = {}) {
  const socket = new EventEmitter(), turns = [], timers = [], writes = [], loads = [];
  let endpoint, exit;
  socket.destroy = () => {};
  socket.write = bytes => writes.push(Buffer.from(bytes));
  const fakeProcess = { env: { AEGIS_CLOUD_GUEST_TASK: '1', AEGIS_RUNTIME_SESSION: 'a'.repeat(32),
    AEGIS_RUNTIME_REQUEST: 'b'.repeat(32), AEGIS_RUNTIME_PIPE: 'aegis-cloud-runtime-' + 'c'.repeat(32), ...envOverride },
    exit(code) { exit = code; throw new Error('fixed-test-exit'); } };
  const context = { Buffer, process: fakeProcess, setImmediate: fn => turns.push(fn),
    setTimeout: fn => { timers.push(fn); return 1; }, clearTimeout: () => {},
    require(name) {
      if (name === 'node:net') return { connect(value) { endpoint = value; return socket; } };
      if (name.startsWith('node:')) return require(name);
      loads.push(name);
    } };
  function run() { vm.runInNewContext(source, context); }
  return { run, socket, turns, writes, loads, timers, get exit() { return exit; }, get endpoint() { return endpoint; } };
}
function test(name, body) { body(); controls++; console.log(name + ':passed'); }
function ready(state) {
  state.run(); state.socket.emit('data', Buffer.from('d'.repeat(32)));
  assert.equal(state.loads.length, 0); assert.equal(state.writes.length, 0);
  assert.equal(state.turns.length, 1); state.turns.shift()();
}
test('core-event-loop-before-ready-before-project', () => {
  const s = make(); ready(s);
  assert.equal(s.loads.length, 0); assert.equal(s.writes.length, 1);
  const frame = s.writes[0], payload = frame.subarray(4);
  assert.equal(frame.readUInt32LE(0), payload.length);
  assert.deepEqual(JSON.parse(payload), { protocol: 'aegis-supervisor-caller', version: 1,
    operation: 'inspect-owned', requestId: 'b'.repeat(32), sessionId: 'a'.repeat(32), generation: 'd'.repeat(32), sequence: 1 });
  assert.equal(s.endpoint, '\\\\.\\pipe\\aegis-cloud-runtime-' + 'c'.repeat(32));
  s.socket.emit('data', Buffer.from('R'));
  assert.deepEqual(s.loads, ['C:\\ProgramData\\AegisCloudLab\\trusted\\cloud-guest-task.cjs']);
});
test('split-challenge-does-not-release-project', () => {
  const s = make(); s.run(); s.socket.emit('data', Buffer.from('d'.repeat(16)));
  assert.equal(s.turns.length, 0); s.socket.emit('data', Buffer.from('d'.repeat(16)));
  s.turns.shift()(); assert.equal(s.writes.length, 1); assert.equal(s.loads.length, 0);
});
for (const [name, value] of [['early-ack', 'R'], ['oversized-challenge', 'd'.repeat(33)], ['malformed-challenge', 'z'.repeat(32)]]) {
  test(name, () => {
    const s = make(); s.run();
    if (name === 'early-ack') { s.socket.emit('data', Buffer.from(value)); assert.throws(() => s.timers[0](), /fixed-test-exit/); }
    else assert.throws(() => s.socket.emit('data', Buffer.from(value)), /fixed-test-exit/);
    assert.equal(s.loads.length, 0);
  });
}
for (const [name, value] of [['wrong-ack', 'X'], ['extra-ack-bytes', 'RR']]) {
  test(name, () => { const s = make(); ready(s);
    assert.throws(() => s.socket.emit('data', Buffer.from(value)), /fixed-test-exit/); assert.equal(s.loads.length, 0); });
}
test('disconnect-no-project', () => { const s = make(); ready(s);
  assert.throws(() => s.socket.emit('end'), /fixed-test-exit/); assert.equal(s.loads.length, 0); });
test('deadline-no-project', () => { const s = make(); ready(s);
  assert.throws(() => s.timers[0](), /fixed-test-exit/); assert.equal(s.exit, 122); assert.equal(s.loads.length, 0); });
test('arbitrary-endpoint-refused', () => { const s = make({ AEGIS_RUNTIME_PIPE: 'attacker' });
  assert.throws(s.run, /fixed-test-exit/); assert.equal(s.exit, 121); assert.equal(s.endpoint, undefined); });
console.log('pure-controls:' + controls);
