'use strict';

const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');
const { createAgentEventReceiver, LIMITS: EVENT_LIMITS } = require('./agent-event-receiver');
const LIMITS = Object.freeze({
  bytes: 8 * 1024 * 1024,
  requests: 10000,
  connections: 10000,
  concurrent: 4,
  perSecond: 20,
  requestMs: 2000,
  durationMs: 900000,
});
/**
 * Validate the required 32-byte hex bearer without echoing it.
 * @param {unknown} token Candidate credential.
 * @returns {boolean} Whether its representation is accepted.
 * @since v0.15.1
 */
const validToken = (token) => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);

/**
 * Start an explicitly requested, finite loopback collector. Bearer possession
 * does not verify an agent, OS process or the truth/completeness of its reports.
 * @param {{port: number, token: string, durationMs: number}} options Local configuration.
 * @returns {Promise<object>} Listening port, close operation and final report promise.
 * @since v0.15.1
 */
async function startHandoffCollector({ port, token, durationMs }) {
  if (
    !validToken(token) ||
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535 ||
    !Number.isInteger(durationMs) ||
    durationMs < 50 ||
    durationMs > LIMITS.durationMs
  )
    throw new Error('live-configuration-invalid');
  const expected = Buffer.from(`Bearer ${token}`);
  const receiver = createAgentEventReceiver();
  const source = receiver.register('claude-code-loopback');
  const sockets = new Set();
  const deliveries = new Set();
  const events = [];
  const usage = { bytes: 0, requests: 0, connections: 0, rejected: 0, duplicates: 0 };
  let sequence = 0;
  let closed = false;
  let timer;
  let resolveDone;
  let bucket = 0;
  let bucketCount = 0;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const server = http.createServer(
    {
      maxHeaderSize: 4096,
      requestTimeout: 2000,
      headersTimeout: 2000,
      connectionsCheckingInterval: 250,
    },
    handle,
  );
  server.maxHeadersCount = 16;
  server.maxRequestsPerSocket = 1;
  server.keepAliveTimeout = 1;

  const lose = () => {
    usage.rejected++;
    receiver.markLoss(source);
  };
  const finish = (reason) => {
    if (closed) return done;
    closed = true;
    clearTimeout(timer);
    if (reason !== 'deadline' && reason !== 'stopped') receiver.markLoss(source);
    // In-flight input was not acknowledged and must remain visible as lost.
    if (sockets.size) receiver.markLoss(source);
    for (const socket of sockets) socket.destroy();
    deliveries.clear();
    expected.fill(0);
    server.close(() =>
      resolveDone({
        schemaVersion: 1,
        mode: 'handoff-live',
        reason,
        adapterVersion: 1,
        producerVersion: 'unknown',
        activityCoverage: 'unknown',
        control: 'not-supported',
        receiver: receiver.close(source),
        usage: { ...usage },
        limits: LIMITS,
        events,
      }),
    );
    return done;
  };
  function handle(req, res) {
    usage.requests++;
    res.setHeader('Connection', 'close');
    const reject = (status) => {
      lose();
      res.writeHead(status);
      res.end();
    };
    if (closed) return reject(503);
    if (usage.requests > LIMITS.requests) return void finish('request-limit');
    const second = Math.floor(performance.now() / 1000);
    if (second !== bucket) {
      bucket = second;
      bucketCount = 0;
    }
    if (++bucketCount > LIMITS.perSecond) return reject(429);
    const auth = req.headers.authorization;
    const supplied = Buffer.from(typeof auth === 'string' ? auth : '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      return reject(401);
    const id = req.headers['x-aegis-delivery'];
    if (
      req.method !== 'POST' ||
      req.url !== '/v1/lifecycle' ||
      req.headers.origin ||
      req.headers.host !== `127.0.0.1:${server.address().port}` ||
      req.headers['x-aegis-version'] !== '1' ||
      req.headers['content-type'] !== 'application/json' ||
      req.headers['content-encoding'] ||
      typeof id !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)
    )
      return reject(400);
    if (deliveries.has(id)) {
      usage.duplicates++;
      return reject(409);
    }
    // Reserve before reading: retries cannot replace invalid or interrupted data.
    deliveries.add(id);
    const chunks = [];
    let bytes = 0;
    let ended = false;
    const timeout = setTimeout(() => {
      lose();
      req.destroy();
    }, LIMITS.requestMs);
    req.on('close', () => {
      clearTimeout(timeout);
      chunks.length = 0;
      if (!ended && !closed) lose();
    });
    req.on('error', () => {});
    req.on('data', (chunk) => {
      if (closed) return;
      bytes += chunk.length;
      usage.bytes += chunk.length;
      if (usage.bytes > LIMITS.bytes) return void finish('byte-limit');
      if (bytes > EVENT_LIMITS.lineBytes) {
        ended = true;
        lose();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      ended = true;
      clearTimeout(timeout);
      if (closed || req.destroyed) return;
      const result = receiver.receive(source, ++sequence, Buffer.concat(chunks, bytes));
      chunks.length = 0;
      if (result.status !== 'accepted') {
        reject(422);
        if (result.stop) finish('receiver-limit');
        return;
      }
      events.push(result.event);
      res.writeHead(204);
      res.end();
    });
  }
  server.on('connection', (socket) => {
    usage.connections++;
    if (closed || usage.connections > LIMITS.connections) {
      socket.destroy();
      finish('connection-limit');
      return;
    }
    if (sockets.size >= LIMITS.concurrent) {
      lose();
      socket.destroy();
      return;
    }
    sockets.add(socket);
    const deadline = setTimeout(() => {
      lose();
      socket.destroy();
    }, LIMITS.requestMs);
    socket.on('close', () => {
      clearTimeout(deadline);
      sockets.delete(socket);
    });
    socket.on('error', () => {});
  });
  server.on('clientError', (_error, socket) => {
    lose();
    socket.destroy();
  });
  server.on('checkContinue', (_req, res) => {
    lose();
    res.writeHead(417);
    res.end();
  });
  server.on('upgrade', (_req, socket) => {
    lose();
    socket.destroy();
  });
  server.on('dropRequest', (_req, socket) => {
    lose();
    socket.destroy();
  });
  server.on('checkExpectation', (_req, res) => {
    lose();
    res.writeHead(417);
    res.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', () => {
      expected.fill(0);
      receiver.close(source);
      reject(new Error('live-listen-unavailable'));
    });
    server.listen(port, '127.0.0.1', resolve);
  });
  server.removeAllListeners('error');
  server.on('error', () => finish('server-error'));
  timer = setTimeout(() => finish('deadline'), durationMs);
  return { port: server.address().port, done, close: () => finish('stopped') };
}

module.exports = { startHandoffCollector, validToken, LIMITS };
