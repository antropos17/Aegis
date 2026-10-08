'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
let passed = 0;
const runtimeSource = fs.readFileSync(path.join(__dirname, 'cloud-stdio-runtime.cjs'), 'utf8');
const taskSource = fs.readFileSync(path.join(__dirname, 'cloud-stdio-task.cjs'), 'utf8');
const fixedTask = 'C:\\ProgramData\\AegisCloudLab\\trusted\\cloud-stdio-task.cjs';
class Exit extends Error { constructor(code) { super('fixed-exit'); this.code = code; } }
function runtime() {
  const socket = new EventEmitter(); socket.destroy = () => {}; const frames = []; const tasks = []; const turns = [];
  socket.write = (bytes) => frames.push(bytes);
  const env = { AEGIS_CLOUD_GUEST_TASK: '1', AEGIS_RUNTIME_SESSION: 'a'.repeat(32), AEGIS_RUNTIME_REQUEST: 'b'.repeat(32), AEGIS_RUNTIME_PIPE: 'aegis-cloud-runtime-' + 'c'.repeat(32) };
  const context = { Buffer, process: { env, exit: (code) => { throw new Exit(code); } },
    setImmediate: (fn) => turns.push(fn), setTimeout: () => 1, clearTimeout: () => {},
    require: (name) => { if (name === 'node:net') return { connect: (endpoint) => { assert.equal(endpoint, '\\\\.\\pipe\\' + env.AEGIS_RUNTIME_PIPE); return socket; } };
      if (name === 'node:assert/strict') return assert; assert.equal(name, fixedTask); tasks.push(name); return {}; } };
  vm.runInNewContext(runtimeSource, context, { timeout: 1000 });
  return { socket, frames, tasks, ready() { socket.emit('data', Buffer.from('d'.repeat(32))); while (turns.length) turns.shift()(); } };
}
function refused(fn) { let code = null; try { fn(); } catch (error) { if (!(error instanceof Exit)) throw error; code = error.code; } assert.equal(code, 123); }
try {
  const positive = runtime(); assert.equal(positive.tasks.length, 0); positive.ready(); assert.equal(positive.tasks.length, 0);
  assert.equal(positive.frames.length, 1); const frame = positive.frames[0]; assert.equal(frame.readUInt32LE(0), frame.length - 4);
  const body = JSON.parse(frame.subarray(4)); assert.equal(body.requestId, 'b'.repeat(32)); assert.equal(body.sessionId, 'a'.repeat(32));
  positive.socket.emit('data', Buffer.from('R')); assert.deepEqual(positive.tasks, [fixedTask]); passed++;
  for (const bytes of [Buffer.alloc(0), Buffer.from('X'), Buffer.from('RR')]) { const model = runtime(); model.ready(); refused(() => model.socket.emit('data', bytes)); assert.equal(model.tasks.length, 0); passed++; }
  const early = runtime(); early.socket.emit('data', Buffer.from('R')); assert.equal(early.tasks.length, 0);
  refused(() => early.socket.emit('data', Buffer.from('a'.repeat(31)))); assert.equal(early.tasks.length, 0); passed++;
  const ended = runtime(); ended.ready(); refused(() => ended.socket.emit('end')); assert.equal(ended.tasks.length, 0); passed++;
  const repeated = runtime(); repeated.ready(); repeated.socket.emit('data', Buffer.from('R')); refused(() => repeated.socket.emit('data', Buffer.from('R'))); assert.equal(repeated.tasks.length, 1); passed++;
  function task(override = {}) {
    const env = { AEGIS_CLOUD_GUEST_TASK: '1', AEGIS_STDIO_PREFIX: 'aegis-guest-stdio-' + 'a'.repeat(32), AEGIS_STDIO_OWNER_PID: '123', AEGIS_STDIO_CASE: '1', ...override };
    const calls = []; const child = new EventEmitter(); const exits = []; let intervals = 0;
    const context = { process: { env, exit: (code) => { exits.push(code); throw new Exit(code); } },
      setInterval: () => { intervals++; return 1; }, require: (name) => { assert.equal(name, 'node:child_process'); return { spawn: (...args) => { calls.push(args); return child; } }; } };
    try { vm.runInNewContext(taskSource, context, { timeout: 1000 }); } catch (error) { if (!(error instanceof Exit)) throw error; }
    return { calls, child, exits, intervals };
  }
  const good = task(); assert.equal(good.calls.length, 1); assert.equal(good.calls[0][0], 'C:\\ProgramData\\AegisCloudLab\\trusted\\guest-stdio.exe');
  assert.equal(good.calls[0][1].length, 0); assert.equal(good.calls[0][2].cwd, 'C:\\AegisLab\\work'); assert.deepEqual(Array.from(good.calls[0][2].stdio), ['ignore', 'ignore', 'ignore']);
  assert.throws(() => good.child.emit('exit', 0, null), (error) => error instanceof Exit && error.code === 0); passed++;
  for (const override of [{ AEGIS_CLOUD_GUEST_TASK: '0' }, { AEGIS_STDIO_PREFIX: 'unsafe' }, { AEGIS_STDIO_OWNER_PID: '0' },
    { AEGIS_STDIO_OWNER_PID: '4294967296' }, { AEGIS_STDIO_CASE: '6' }, { AEGIS_STDIO_CASE: '1;cmd' }]) {
    const model = task(override); assert.equal(model.calls.length, 0); assert.deepEqual(model.exits, [125]); passed++;
  }
  const failed = task(); assert.throws(() => failed.child.emit('exit', 1, null), (error) => error instanceof Exit && error.code === 125); passed++;
  for (const kind of ['3', '4', '5']) { const model = task({ AEGIS_STDIO_CASE: kind }); model.child.emit('exit', 125, null); assert.equal(model.intervals, 1); assert.equal(model.exits.length, 0); passed++; }
  process.stdout.write(JSON.stringify({ scope: 'synthetic-actual-stdio-runtime-task-source', passed, expectedCases: 18, guestExecuted: false }) + '\n');
  assert.equal(passed, 18);
} catch { process.stderr.write('stdio-source-controls-refused\n'); process.exitCode = 1; }
