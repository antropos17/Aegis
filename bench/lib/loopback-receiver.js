// @ts-check
'use strict';
const http = require('node:http');
const { createHash } = require('node:crypto');

const LIMITS = Object.freeze({
  bodyBytes: 512,
  requests: 4,
  connections: 4,
  durationMs: 3000,
  cleanupMs: 150,
  outputBytes: 8192,
});
/** @typedef {{runId:string, nonce:string, durationMs?:number, signal?:AbortSignal}} Options */

/**
 * Open a receiver for exactly one same-run public inert canary on ephemeral IPv4 loopback.
 * The returned handle controls only this receiver; its done value contains no request data.
 * @param {Options} options Closed safe runId/nonce, bounded durationMs and optional cancellation.
 * @returns {Promise<{runId:string,nonce:string,signal:AbortSignal|undefined,port:number|null,remainingMs:()=>number,done:Promise<ReturnType<typeof receiptShape>>,finish:()=>Promise<ReturnType<typeof receiptShape>>}>} Owned handle.
 * @since 0.19.2
 */
async function openLoopbackReceiver(options) {
  const input = validate(options);
  const { runId, nonce, durationMs, signal } = input;
  const expected = Buffer.from(`AEGIS_PUBLIC_INERT_LOOPBACK_V1\n${runId}\n${nonce}\n`, 'ascii');
  const expectedSha256 = createHash('sha256').update(expected).digest('hex');
  const start = process.hrtime.bigint();
  const remainingMs = () => Math.max(0, durationMs - Number(process.hrtime.bigint() - start) / 1e6);
  const state = receiptShape(runId, nonce, expectedSha256, durationMs, expected.length);
  /** @type {Set<import('node:net').Socket>} */
  const sockets = new Set();
  /** @type {Map<import('node:stream').Duplex,{ended:boolean,incomplete:boolean,faulted:boolean}>} */
  const connections = new Map();
  let stopped = false,
    listenerClosed = false,
    cleanupStarted = false;
  /** @type {(value:ReturnType<typeof receiptShape>)=>void} */
  let resolveDone;
  const done = new Promise(
    /** @param {(value:ReturnType<typeof receiptShape>)=>void} resolve */ (resolve) => {
      resolveDone = resolve;
    },
  );
  /** @type {(value:number|null)=>void} */
  let resolveReady;
  const ready = new Promise(
    /** @param {(value:number|null)=>void} resolve */ (resolve) => {
      resolveReady = resolve;
    },
  );
  const listenController = new AbortController();
  /** @type {NodeJS.Timeout|undefined} */
  let deadline;
  /** @type {NodeJS.Timeout|undefined} */
  let cleanupDeadline;
  const server = http.createServer(
    {
      maxHeaderSize: 2048,
      highWaterMark: 1024,
      headersTimeout: durationMs,
      requestTimeout: durationMs,
      connectionsCheckingInterval: 20,
      keepAliveTimeout: 1,
      // Admit missing-Host requests ourselves instead of Node's automatic 400 path.
      requireHostHeader: false,
    },
    receive,
  );
  /** @param {import('node:stream').Duplex} socket @returns {boolean} */
  function admit(socket) {
    if (stopped || remainingMs() <= 0) {
      stop('timeout');
      socket.destroy();
      return false;
    }
    if (++state.requests > LIMITS.requests) {
      stop('request-limit');
      return false;
    }
    return true;
  }
  /** @param {import('node:stream').Duplex} socket */
  function incomplete(socket) {
    const connection = connections.get(socket);
    if (connection && !connection.incomplete) {
      connection.incomplete = true;
      state.incomplete++;
    }
  }
  /** @param {import('node:http').ServerResponse} res @param {number} status */
  function respond(res, status) {
    const socket = res.req.socket;
    res.writeHead(status, { Connection: 'close', 'Content-Length': '0' });
    // A local response close can discard a partial next header without parser.finish().
    // Queue the empty response until peer EOF. The prepended handler queues the
    // bytes before Node's default end handler ends the writable side and finishes parsing.
    if (socket.readableEnded) res.end();
    else socket.prependOnceListener('end', () => res.end());
  }
  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {boolean} [unsupportedExpectation] */
  function receive(req, res, unsupportedExpectation = false) {
    if (!admit(req.socket)) return;
    const item = { settled: false };
    let bytes = 0;
    const hash = createHash('sha256');
    req.on('error', () => {});
    res.on('error', () => {});
    const settle = () => {
      item.settled = true;
    };
    if (req.method !== 'POST' || req.url !== '/' || !req.headers.host) {
      state.wrong++;
      settle();
      req.destroy();
      return;
    }
    if (unsupportedExpectation) state.wrong++;
    req.on('data', (chunk) => {
      if (stopped || item.settled) return;
      bytes += chunk.length;
      if (bytes > LIMITS.bodyBytes) {
        state.oversize++;
        settle();
        req.destroy();
        return;
      }
      hash.update(chunk);
    });
    req.on('end', () => {
      if (stopped || item.settled) return;
      if (remainingMs() <= 0) {
        stop('timeout');
        return;
      }
      settle();
      if (!req.complete) {
        incomplete(req.socket);
        req.destroy();
        return;
      }
      state.completedBodies++;
      if (unsupportedExpectation) {
        respond(res, 417);
        return;
      }
      const actual = hash.digest('hex');
      state.observedHashes.push(actual);
      let status = 422;
      if (bytes === expected.length && actual === expectedSha256) {
        state.matchingPayloads++;
        if (state.matchingPayloads > 1) {
          state.duplicates++;
          status = 409;
        } else status = 204;
      } else state.wrong++;
      respond(res, status);
    });
    req.on('close', () => {
      if (!stopped && !item.settled) {
        incomplete(req.socket);
        settle();
      }
    });
  }
  server.maxHeadersCount = 16;
  server.on('checkContinue', (req, res) => {
    receive(req, res);
    if (!stopped && !req.destroyed) res.writeContinue();
  });
  server.on('checkExpectation', (req, res) => {
    receive(req, res, true);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    const connection = { ended: false, incomplete: false, faulted: false };
    connections.set(socket, connection);
    socket.on('error', () => {});
    // Node's previously installed end handler calls parser.finish() first.
    socket.once('end', () => {
      connection.ended = true;
    });
    socket.once('close', () => {
      if (!connection.ended) incomplete(socket);
      sockets.delete(socket);
      maybeDone();
    });
    if (stopped) {
      socket.destroy();
      return;
    }
    if (++state.connections > LIMITS.connections) {
      stop('connection-limit');
      return;
    }
    if (socket.remoteAddress !== '127.0.0.1') {
      state.wrong++;
      socket.destroy();
    }
  });
  server.on('clientError', (_error, socket) => {
    const connection = connections.get(socket);
    if (!stopped && connection && !connection.faulted) {
      connection.faulted = true;
      admit(socket);
      state.protocolErrors++;
    }
    socket.destroy();
  });
  for (const event of ['upgrade', 'connect'])
    server.on(event, (_req, socket) => {
      if (admit(socket)) state.wrong++;
      socket.destroy();
    });
  server.on('error', () => stop('listen-unavailable'));
  server.once('close', () => {
    listenerClosed = true;
    maybeDone();
  });
  server.once('listening', () => {
    if (stopped) {
      listenController.abort();
      return;
    }
    const address = server.address();
    if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
      stop('listen-unavailable');
      return;
    }
    resolveReady(address.port);
  });
  function maybeDone() {
    if (!cleanupStarted || !listenerClosed || sockets.size) return;
    publish();
  }
  let published = false;
  function publish() {
    if (published) return;
    published = true;
    clearTimeout(cleanupDeadline);
    state.cleanup = {
      listenerClosed,
      socketsClosed: sockets.size === 0,
      confirmed: listenerClosed && sockets.size === 0,
    };
    if (state.incomplete || state.protocolErrors) state.reason ??= 'receipt-unconfirmed';
    const healthy = state.reason === null && state.cleanup.confirmed;
    if (!state.cleanup.confirmed) state.reason ??= 'cleanup-unconfirmed';
    state.verifiedCount = healthy ? state.matchingPayloads : null;
    state.exact = healthy
      ? state.matchingPayloads === 1 &&
        !state.wrong &&
        !state.duplicates &&
        !state.oversize &&
        !state.incomplete &&
        !state.protocolErrors
      : null;
    if (healthy && !state.exact)
      state.reason = state.duplicates
        ? 'duplicate-receipt'
        : state.wrong || state.oversize || state.protocolErrors
          ? 'wrong-receipt'
          : 'receipt-count-mismatch';
    const copy = structuredClone(state);
    if (Buffer.byteLength(JSON.stringify(copy)) > LIMITS.outputBytes)
      throw Error('loopback-output-too-large');
    resolveDone(copy);
  }
  /** @param {string|null} reason */
  function stop(reason) {
    if (stopped) return;
    stopped = true;
    state.reason = reason;
    for (const [socket, connection] of connections) if (!connection.ended) incomplete(socket);
    clearTimeout(deadline);
    signal?.removeEventListener('abort', cancel);
    resolveReady(null);
    cleanupStarted = true;
    cleanupDeadline = setTimeout(publish, LIMITS.cleanupMs);
    try {
      server.close();
    } catch {
      state.reason ??= 'cleanup-api-failed';
    }
    try {
      listenController.abort();
    } catch {
      state.reason ??= 'cleanup-api-failed';
    }
    try {
      server.closeAllConnections();
    } catch {
      state.reason ??= 'cleanup-api-failed';
    }
    for (const socket of sockets) {
      try {
        socket.destroy();
      } catch {
        /* remains unconfirmed */
      }
    }
    server.unref();
    maybeDone();
  }
  const cancel = () => stop('cancelled');
  if (signal?.aborted) {
    listenerClosed = true;
    stop('cancelled');
  } else {
    signal?.addEventListener('abort', cancel, { once: true });
    deadline = setTimeout(() => stop('timeout'), durationMs);
    try {
      server.listen({
        host: '127.0.0.1',
        port: 0,
        exclusive: true,
        signal: listenController.signal,
      });
    } catch {
      listenerClosed = !server.listening;
      stop('listen-unavailable');
    }
  }
  const port = await ready;
  return Object.freeze({
    runId,
    nonce,
    signal,
    port,
    remainingMs,
    done,
    finish: () => {
      stop(remainingMs() <= 0 ? 'timeout' : null);
      return done;
    },
  });
}

/** @param {Options} options */
function validate(options) {
  /** @type {Record<string,unknown>} */
  const input = {};
  try {
    if (!options || ![Object.prototype, null].includes(Object.getPrototypeOf(options)))
      throw Error();
    for (const key of Reflect.ownKeys(options)) {
      const d = Object.getOwnPropertyDescriptor(options, key);
      if (
        typeof key !== 'string' ||
        !['runId', 'nonce', 'durationMs', 'signal'].includes(key) ||
        !d ||
        !Object.hasOwn(d, 'value')
      )
        throw Error();
      input[key] = d.value;
    }
    for (const key of ['runId', 'nonce'])
      if (typeof input[key] !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(input[key]))
        throw Error();
    const durationMs = input.durationMs === undefined ? 1000 : input.durationMs;
    if (
      typeof durationMs !== 'number' ||
      !Number.isSafeInteger(durationMs) ||
      durationMs < 50 ||
      durationMs > LIMITS.durationMs
    )
      throw Error();
    if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) throw Error();
    return {
      runId: /** @type {string} */ (input.runId),
      nonce: /** @type {string} */ (input.nonce),
      durationMs,
      signal: /** @type {AbortSignal|undefined} */ (input.signal),
    };
  } catch {
    throw Error('loopback-input-invalid');
  }
}

/** @param {string} runId @param {string} nonce @param {string} expectedSha256 @param {number} durationMs @param {number} expectedBytes */
function receiptShape(runId, nonce, expectedSha256, durationMs, expectedBytes) {
  return {
    version: 'loopback-receiver/1',
    runId,
    nonce,
    expectedCount: 1,
    expectedSha256,
    plannedDurationMs: durationMs,
    expectedBytes,
    connections: 0,
    requests: 0,
    completedBodies: 0,
    matchingPayloads: 0,
    duplicates: 0,
    wrong: 0,
    oversize: 0,
    incomplete: 0,
    protocolErrors: 0,
    observedHashes: /** @type {string[]} */ ([]),
    verifiedCount: /** @type {number|null} */ (null),
    exact: /** @type {boolean|null} */ (null),
    reason: /** @type {string|null} */ (null),
    cleanup: { listenerClosed: false, socketsClosed: false, confirmed: false },
  };
}

module.exports = { openLoopbackReceiver, LIMITS };
