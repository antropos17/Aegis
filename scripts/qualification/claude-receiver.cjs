'use strict';

// Administrator-owned fixed API stub outside the task Job. No real provider is contacted.
const http = require('node:http');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const protocol = require('./claude-protocol.cjs');
if (process.platform !== 'win32' || process.env.AEGIS_CLOUD_GUEST_CLAUDE !== '1' || process.argv.length !== 2) process.exit(2);
const start = performance.now(), corpus = protocol.session(), sockets = new Set();
let failure = null, stopObserved = false, expired = false, finishing = false, closed = false;
let connectionCount = 0, connectionClosed = 0, clientEofCount = 0, forcedClosed = 0;
let completedResetCount = 0;
let requestCount = 0, inflight = false, completedResponses = 0;
const states = new WeakMap(), socketClosures = [];
// Observe raw framing before the HTTP parser. No body or credential bytes are retained.
function track(state, chunk) {
  state.wireBytes += chunk.length;
  if (state.wireBytes > 4 * (1048576 + 8192)) state.invalid = true;
  let offset = 0;
  while (!state.invalid && offset < chunk.length) {
    if (state.remaining > 0) {
      const count = Math.min(state.remaining, chunk.length - offset);
      state.remaining -= count; offset += count;
      if (state.remaining === 0) state.frames++;
      continue;
    }
    if (state.frames >= 4) { state.invalid = true; break; }
    // Header accumulation is capped; scan only the next bounded prefix.
    const count = Math.min(8193 - state.header.length, chunk.length - offset);
    const combined = Buffer.concat([state.header, chunk.subarray(offset, offset + count)]);
    const end = combined.indexOf('\r\n\r\n');
    if (end < 0) {
      state.header = combined; offset += count;
      if (combined.length > 8192) state.invalid = true;
      continue;
    }
    const consumed = end + 4 - state.header.length;
    if (end + 4 > 8192 || consumed < 0 || combined.subarray(0, end).some(byte => byte > 126 || (byte < 32 && byte !== 13 && byte !== 10))) {
      state.invalid = true; break;
    }
    const lines = combined.subarray(0, end).toString('ascii').split('\r\n');
    if (!/^POST \/v1\/messages(?:\?beta=true)? HTTP\/1\.1$/.test(lines.shift())) { state.invalid = true; break; }
    let length = null;
    for (const line of lines) {
      const match = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*([^\r\n]*)$/.exec(line);
      if (!match || /\r|\n/.test(match[2]) || match[1].toLowerCase() === 'transfer-encoding') { state.invalid = true; break; }
      if (match[1].toLowerCase() === 'content-length') {
        const value = match[2].trim();
        if (length !== null || !/^(0|[1-9][0-9]{0,6})$/.test(value) || Number(value) > 1048576) { state.invalid = true; break; }
        length = Number(value);
      }
    }
    if (length === null || state.invalid) { state.invalid = true; break; }
    offset += consumed; state.header = Buffer.alloc(0); state.remaining = length;
    if (length === 0) state.frames++;
  }
}
function allowReset(error, state) {
  return error?.code === 'ECONNRESET' && (!error.rawPacket || (Buffer.isBuffer(error.rawPacket) && error.rawPacket.length === 0)) &&
    state && !state.invalid && !state.eof && !state.closed &&
    state.header.length === 0 && state.remaining === 0 && state.requests > 0 &&
    state.frames === state.requests && state.ends === state.requests && state.responses === state.requests &&
    requestCount === 4 && completedResponses === 4 && !inflight && corpus.receipt().complete && !failure;
}
const nonce = crypto.randomBytes(16).toString('hex');
const known = new Set(['request-invalid', 'tool-registry-unavailable', 'tool-schema-unavailable', 'messages-invalid',
  'tool-sequence-invalid', 'tool-result-invalid']);
function poison(code) { if (!failure) failure = code; }
function emit(value) {
  const text = JSON.stringify(value) + '\n';
  if (Buffer.byteLength(text) > 8192) process.exit(3);
  process.stdout.write(text);
}
const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 2000, headersTimeout: 2000, connectionsCheckingInterval: 250 }, (req, res) => {
  requestCount++;
  const state = states.get(req.socket); state.requests++;
  if (finishing || inflight || requestCount > 4 || req.method !== 'POST' || !['/v1/messages', '/v1/messages?beta=true'].includes(req.url) ||
      req.headers['x-api-key'] !== `aegis-fixture-${nonce}` ||
      !req.headers['content-type']?.startsWith('application/json')) {
    poison('http-request-refused'); req.destroy(); return;
  }
  inflight = true;
  const chunks = []; let bytes = 0, ended = false;
  const timer = setTimeout(() => { poison('request-deadline'); req.destroy(); }, 2000);
  req.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > 1048576) { poison('request-limit'); req.destroy(); }
    else chunks.push(chunk);
  });
  req.on('error', () => { poison('request-error'); clearTimeout(timer); inflight = false; });
  req.on('aborted', () => poison('request-aborted'));
  req.on('end', () => {
    ended = true; state.ends++; clearTimeout(timer);
    try {
      const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      const response = protocol.reply(input, corpus.advance(input));
      res.once('finish', () => { completedResponses++; state.responses++; inflight = false; });
      res.once('close', () => { if (!res.writableFinished) poison('response-incomplete'); });
      res.writeHead(200, { 'Content-Type': response.type, 'Cache-Control': 'no-store' }); res.end(response.text);
    } catch (error) { poison(known.has(error.message) ? error.message : 'request-invalid'); inflight = false; res.writeHead(400); res.end(); }
  });
  req.on('close', () => { if (!ended) poison('request-incomplete'); });
});
server.maxConnections = 8;
server.keepAliveTimeout = 35000;
server.on('connection', socket => {
  connectionCount = Math.min(9, connectionCount + 1); sockets.add(socket);
  if (connectionCount > 8) {
    poison('connection-limit');
    socket.once('close', () => { connectionClosed = Math.min(9, connectionClosed + 1); sockets.delete(socket); });
    socket.on('error', () => poison('connection-error')); socket.destroy(); finish(); return;
  }
  const state = { wireBytes: 0, header: Buffer.alloc(0), remaining: 0, frames: 0, requests: 0, ends: 0,
    responses: 0, invalid: false, eof: false, closed: false, reset: false };
  states.set(socket, state);
  let acknowledgeClose;
  socketClosures.push(new Promise(resolve => { acknowledgeClose = resolve; }));
  socket.prependListener('data', chunk => { track(state, chunk); if (state.invalid) poison('http-framing-invalid'); });
  socket.once('end', () => { state.eof = true; clientEofCount++; });
  socket.once('close', () => {
    state.closed = true; connectionClosed++; sockets.delete(socket);
    const complete = !state.invalid && state.header.length === 0 && state.remaining === 0 && state.requests > 0 &&
      state.frames === state.requests && state.ends === state.requests && state.responses === state.requests;
    if (state.reset && !state.eof && complete) completedResetCount++;
    else if (!state.eof || !complete) poison('connection-close-unconfirmed');
    acknowledgeClose();
  });
  socket.on('error', error => { if (allowReset(error, state)) state.reset = true; else poison('connection-error'); });
});
server.on('connect', (_req, socket) => { poison('proxy-connect-refused'); socket.destroy(); });
server.on('clientError', (error, socket) => {
  if (allowReset(error, states.get(socket))) states.get(socket).reset = true;
  else poison('http-invalid');
  socket.destroy();
});
server.on('error', () => { poison('server-unavailable'); finish(); });
async function finish() {
  if (finishing) return;
  finishing = true; clearTimeout(expiry);
  process.stdin.pause();
  const settled = new Promise(resolve => { server.close(() => { closed = true; resolve(); }); });
  const drain = setTimeout(() => {
    for (const socket of sockets) { forcedClosed++; socket.destroy(); }
  }, 500);
  await settled; clearTimeout(drain);
  // The server close callback can precede individual socket close listeners.
  // Bound that observation separately; it cannot extend the 45s acceptance fence.
  let closureTimer;
  const observed = await Promise.race([Promise.all(socketClosures).then(() => true),
    new Promise(resolve => { closureTimer = setTimeout(() => resolve(false), 100); })]);
  clearTimeout(closureTimer); if (!observed) poison('socket-close-unconfirmed');
  const evidence = corpus.receipt();
  const passed = !failure && stopObserved && !expired && performance.now() - start < 45000 && closed &&
    requestCount === 4 && completedResponses === 4 && evidence.complete && connectionCount > 0 &&
    connectionClosed === connectionCount && clientEofCount + completedResetCount === connectionCount && forcedClosed === 0;
  emit({ schemaVersion: 1, kind: 'claude-receiver', passed, closed, stopObserved, expired, requests: requestCount,
    completedResponses, toolResults: evidence.toolResults, steps: ['read', 'edit', 'test', 'finish'],
    connectionCount, connectionClosed, clientEofCount, completedResetCount, forcedClosed, elapsedMilliseconds: Math.ceil(performance.now() - start),
    failure: failure || (passed ? null : 'receiver-controls-incomplete') });
  process.exitCode = passed ? 0 : 1;
}
const expiry = setTimeout(() => { expired = true; poison('receiver-expired'); finish(); }, 45000);
let control = Buffer.alloc(0);
process.stdin.on('data', bytes => {
  if (control.length + bytes.length > 5) { poison('control-invalid'); finish(); return; }
  control = Buffer.concat([control, bytes]);
  if (control.length > 5 || !Buffer.from('STOP\n').subarray(0, control.length).equals(control)) {
    poison('control-invalid'); finish(); return;
  }
  if (control.length === 5) {
    stopObserved = true;
    if (performance.now() - start >= 42500) poison('stop-too-late');
  }
});
process.stdin.on('end', () => {
  if (!stopObserved || control.length !== 5) poison('control-eof');
  if (performance.now() - start >= 43500) poison('stop-too-late');
  finish();
});
process.stdin.on('error', () => { poison('control-error'); finish(); });
server.listen(0, '127.0.0.1', () => {
  const ready = protocol.endpoint({ schemaVersion: 1, kind: 'claude-ready', address: '127.0.0.1', port: server.address().port, nonce });
  emit(ready);
});
