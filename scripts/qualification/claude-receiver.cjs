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
let requestCount = 0, inflight = false, completedResponses = 0;
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
    ended = true; clearTimeout(timer);
    try {
      const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      const response = protocol.reply(input, corpus.advance(input));
      res.once('finish', () => { completedResponses++; inflight = false; });
      res.once('close', () => { if (!res.writableFinished) poison('response-incomplete'); });
      res.writeHead(200, { 'Content-Type': response.type, 'Cache-Control': 'no-store' }); res.end(response.text);
    } catch (error) { poison(known.has(error.message) ? error.message : 'request-invalid'); inflight = false; res.writeHead(400); res.end(); }
  });
  req.on('close', () => { if (!ended) poison('request-incomplete'); });
});
server.maxConnections = 8;
server.keepAliveTimeout = 35000;
server.on('connection', socket => {
  connectionCount++; sockets.add(socket);
  if (connectionCount > 8) { poison('connection-limit'); socket.destroy(); }
  socket.once('end', () => clientEofCount++);
  socket.once('close', () => { connectionClosed++; sockets.delete(socket); });
  socket.on('error', () => poison('connection-error'));
});
server.on('connect', (_req, socket) => { poison('proxy-connect-refused'); socket.destroy(); });
server.on('clientError', (_error, socket) => { poison('http-invalid'); socket.destroy(); });
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
  const evidence = corpus.receipt();
  const passed = !failure && stopObserved && !expired && performance.now() - start < 45000 && closed &&
    requestCount === 4 && completedResponses === 4 && evidence.complete && connectionCount > 0 &&
    connectionClosed === connectionCount && clientEofCount === connectionCount && forcedClosed === 0;
  emit({ schemaVersion: 1, kind: 'claude-receiver', passed, closed, stopObserved, expired, requests: requestCount,
    completedResponses, toolResults: evidence.toolResults, steps: ['read', 'edit', 'test', 'finish'],
    connectionCount, connectionClosed, clientEofCount, forcedClosed, elapsedMilliseconds: Math.ceil(performance.now() - start),
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
