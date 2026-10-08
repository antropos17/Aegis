'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const net = require('node:net'), path = require('node:path'), { spawn } = require('node:child_process');
const protocol = require('./claude-protocol.cjs');

function body(index) {
  const messages = [{ role: 'user', content: 'Fixed fixture' }];
  for (let i = 0; i < index; i++) {
    messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: `toolu_aegisguest${i + 1}`, ...protocol.STEPS[i] }] });
    messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_aegisguest${i + 1}`,
      content: i === 0 ? protocol.BEFORE : i === 2 ? protocol.MARKER : 'Fixed edit completed' }] });
  }
  return JSON.stringify({ model: 'claude-sonnet-4-6', stream: false, tools: protocol.STEPS.map(step => ({ name: step.name,
    input_schema: { type: 'object', properties: Object.fromEntries(Object.keys(step.input).map(key => [key, {}])) } })), messages });
}
function frame(value, endpoint, headers = '') {
  return `POST /v1/messages HTTP/1.1\r\nHost: 127.0.0.1\r\nx-api-key: aegis-fixture-${endpoint.nonce}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(value)}\r\n${headers}\r\n${value}`;
}
async function run(mode) {
  const child = spawn(process.execPath, [path.join(__dirname, 'claude-receiver.cjs')], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP,
      AEGIS_CLOUD_GUEST_CLAUDE: '1', NODE_DISABLE_COMPILE_CACHE: '1' } });
  let out = '', err = '', socket;
  child.stdin.on('error', () => {});
  const deadline = setTimeout(() => { socket?.destroy(); child.kill(); }, 6000);
  const ended = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.stdout.on('data', chunk => { out += chunk; if (Buffer.byteLength(out) > 8704) child.kill(); });
    child.stderr.on('data', chunk => { err += chunk; if (Buffer.byteLength(err) > 1024) child.kill(); });
    child.on('close', code => resolve(code));
  });
  const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  try {
    const begin = Date.now();
    while (!out.includes('\n')) { assert.ok(Date.now() - begin < 2000, 'ready deadline'); await pause(5); }
    const endpoint = protocol.endpoint(JSON.parse(out.split('\n')[0]));
    socket = net.connect(endpoint.port, endpoint.address); socket.on('error', () => {});
    await new Promise(resolve => socket.once('connect', resolve));
    let pending = '';
    socket.on('data', chunk => { pending += chunk; assert.ok(Buffer.byteLength(pending) <= 16384); });
    async function request(index, suffix = '') {
      pending = ''; socket.write(frame(body(index), endpoint) + suffix);
      const started = Date.now();
      while (!pending.endsWith('\r\n0\r\n\r\n')) {
        assert.ok(Date.now() - started < 1500 && !socket.destroyed, 'response not complete'); await pause(5);
      }
    }
    const limit = mode === 'early-reset' ? 2 : ['truncated', 'forced'].includes(mode) ? 3 : 4;
    for (let i = 0; i < limit; i++) await request(i, mode === 'coalesced-partial' && i === 3 ? 'POST /v1/' : '');
    if (mode === 'lifetime-limit') {
      socket.resetAndDestroy(); await pause(20);
      for (let i = 0; i < 8; i++) {
        const other = net.connect(endpoint.port, endpoint.address); other.on('error', () => {});
        await new Promise(resolve => other.once('connect', resolve)); other.end();
        await new Promise(resolve => other.once('close', resolve));
      }
    } else if (mode === 'unused-eof' || mode === 'unused-reset') {
      const other = net.connect(endpoint.port, endpoint.address); other.on('error', () => {});
      await new Promise(resolve => other.once('connect', resolve));
      if (mode === 'unused-eof') other.end(); else other.resetAndDestroy();
      await new Promise(resolve => other.once('close', resolve)); socket.resetAndDestroy();
    } else if (mode === 'eof') socket.end();
    else if (mode === 'reset' || mode === 'early-reset' || mode === 'coalesced-partial') socket.resetAndDestroy();
    else if (mode === 'partial' || mode === 'fragmented-partial') {
      socket.write('POST /v1/'); await pause(25);
      if (mode === 'fragmented-partial') { socket.write('messages HTTP/1.1\r\nHost:'); await pause(25); }
      socket.resetAndDestroy();
    } else if (mode === 'fifth') { socket.write(frame(body(3), endpoint)); await pause(25); socket.destroy(); }
    else if (mode === 'parser') { socket.write('INVALID REQUEST\r\n\r\n'); await pause(25); socket.destroy(); }
    else if (mode === 'truncated' || mode === 'forced') {
      const fourth = frame(body(3), endpoint); socket.write(fourth.slice(0, -10)); await pause(25);
      if (mode === 'truncated') socket.resetAndDestroy();
    } else throw Error('test-mode');
    if (mode !== 'forced') await pause(30);
    child.stdin.end('STOP\n');
    const code = await ended;
    assert.equal(err, ''); const frames = out.trim().split('\n').map(JSON.parse); assert.equal(frames.length, 2);
    assert.equal(frames[1].closed, true);
    if (mode === 'lifetime-limit') {
      assert.equal(frames[1].connectionCount, 9); assert.ok(frames[1].connectionClosed <= 9);
      assert.equal(frames[1].failure, 'connection-close-unconfirmed');
    } else assert.equal(frames[1].connectionClosed, frames[1].connectionCount);
    return { code, receipt: frames[1] };
  } finally { clearTimeout(deadline); socket?.destroy(); if (child.exitCode === null) { child.kill(); await ended; } }
}
for (const mode of ['eof', 'reset', 'early-reset', 'partial', 'coalesced-partial', 'fragmented-partial', 'fifth', 'parser', 'truncated', 'forced', 'unused-eof', 'unused-reset', 'lifetime-limit']) {
  test(`actual HTTP socket closure: ${mode}`, { timeout: 8000 }, async () => {
    const { code, receipt } = await run(mode); const positive = mode === 'eof' || mode === 'reset';
    assert.equal(receipt.passed, positive); assert.equal(code, positive ? 0 : 1);
    assert.equal(receipt.completedResetCount, mode === 'reset' || mode === 'lifetime-limit' ? 1 : 0);
    if (positive) { assert.equal(receipt.requests, 4); assert.equal(receipt.completedResponses, 4); assert.equal(receipt.forcedClosed, 0); }
    if (mode === 'forced') assert.equal(receipt.forcedClosed, 1);
  });
}

// Replay the actual passive tracker using its source definition. Coercion,
// unsupported framing, and bytes after frame4 must poison reset eligibility.
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'claude-receiver.cjs'), 'utf8');
const start = source.indexOf('function track('), end = source.indexOf('function allowReset(', start);
assert.equal(source.split('function track(').length, 2); assert.equal(source.split('function allowReset(').length, 2);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({ Buffer }); vm.runInContext(source.slice(start, end), context);
test('raw framing preserves exact four bodies across header/body splits and coalesced frames', () => {
  const wire = Buffer.from([0, 1, 2, 3].map(index => frame(body(index), { nonce: 'a'.repeat(32) })).join(''));
  for (const size of [1, 7, 8192, wire.length]) {
    const state = { wireBytes: 0, header: Buffer.alloc(0), remaining: 0, frames: 0, invalid: false };
    for (let offset = 0; offset < wire.length; offset += size) context.track(state, wire.subarray(offset, offset + size));
    assert.equal(state.invalid, false); assert.equal(state.frames, 4);
    assert.equal(state.remaining, 0); assert.equal(state.header.length, 0);
  }
});
for (const mode of ['duplicate-cl', 'transfer-encoding', 'fold', 'noncanonical-length', 'missing-cl', 'oversized-header']) {
  test(`strict raw framing refuses ${mode}`, () => {
    const state = { wireBytes: 0, header: Buffer.alloc(0), remaining: 0, frames: 0, invalid: false };
    let wire = frame('{}', { nonce: 'a'.repeat(32) });
    if (mode === 'duplicate-cl') wire = wire.replace('\r\n\r\n', '\r\nContent-Length: 2\r\n\r\n');
    if (mode === 'transfer-encoding') wire = wire.replace('\r\n\r\n', '\r\nTransfer-Encoding: chunked\r\n\r\n');
    if (mode === 'fold') wire = wire.replace('Host:', ' Host:');
    if (mode === 'noncanonical-length') wire = wire.replace('Content-Length: 2', 'Content-Length: 02');
    if (mode === 'missing-cl') wire = wire.replace('Content-Length: 2\r\n', '');
    if (mode === 'oversized-header') wire = wire.replace('Host:', 'X-Long: ' + 'x'.repeat(8192) + '\r\nHost:');
    for (let offset = 0; offset < wire.length; offset += 7) context.track(state, Buffer.from(wire.slice(offset, offset + 7)));
    assert.equal(state.invalid, true);
  });
}
test('reset guard rejects unknown error, early/incomplete per-socket identity and raw parser data', () => {
  const stop = source.indexOf('const nonce =', end); assert.ok(stop > end);
  const guarded = vm.createContext({ Buffer });
  vm.runInContext('let requestCount=4,completedResponses=4,inflight=false,failure=null; const corpus={receipt:()=>({complete:true})};' + source.slice(end, stop), guarded);
  const clean = { invalid: false, eof: false, closed: false, header: Buffer.alloc(0), remaining: 0, requests: 4, frames: 4, ends: 4, responses: 4 };
  assert.equal(guarded.allowReset({ code: 'ECONNRESET' }, clean), true);
  for (const error of [{ code: 'UNKNOWN' }, { code: 'EPIPE' }, { code: 'HPE_INVALID_EOF_STATE' }, { code: 'ECONNRESET', rawPacket: Buffer.from('X') }])
    assert.equal(guarded.allowReset(error, clean), false);
  for (const [key, value] of [['requests', 0], ['responses', 3], ['frames', 5], ['ends', 3], ['remaining', 1], ['header', Buffer.from('P')], ['eof', true], ['closed', true]])
    assert.equal(guarded.allowReset({ code: 'ECONNRESET' }, { ...clean, [key]: value }), false);
  vm.runInContext('requestCount=3', guarded); assert.equal(guarded.allowReset({ code: 'ECONNRESET' }, clean), false);
});
