'use strict';

const net = require('node:net');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { publishActionEndpoint } = require('./action-mcp-endpoint');
const terminal = require('./action-confirmation-terminal');
const LIMITS = Object.freeze({
  lifetimeMs: 900000,
  authMs: 3000,
  connections: 8,
  pending: 4,
  authBufferBytes: 16449,
});
let testDeps = null;

/**
 * Start one operator-terminal broker for one bearer-authenticated MCP connection.
 * No action data or token is printed; the endpoint is a caller-selected new file.
 * @param {string[]} args Single-action flag/pair/endpoint, or catalog flag/manifest/endpoint.
 * @param {{signal?: AbortSignal, observe?: Function}} [options] Trusted cancellation and read-only observation.
 * @returns {Promise<number>} 0 for completed session, 2 for unavailable/closed review.
 * @since v0.15.1
 */
async function handleActionMcpReview(args, options = {}) {
  const signal = options.signal;
  if (signal?.aborted) return 2;
  const deps = testDeps || {};
  const catalog = args[0] === '--action-mcp-catalog-review';
  if (
    args.length !== (catalog ? 3 : 4) ||
    (!catalog && args[0] !== '--action-mcp-review') ||
    args.slice(1).some((a) => typeof a !== 'string' || !a || a.startsWith('--'))
  )
    return 2;
  const selection = catalog
    ? { catalogPath: args[1] }
    : { policyPath: args[1], requestPath: args[2] };
  const endpointPath = args[catalog ? 2 : 3];
  if (!(deps.available || terminal.isTerminalAvailable)()) return 2;
  const controller = new AbortController();
  const host = deps.process || process;
  const output = deps.output || process.stdout;
  const pending = new Set();
  const secret = randomBytes(32);
  let attempts = 0;
  let accepted = false;
  let closed = false;
  let code = 2;
  let active;
  let work;
  let lifetime;
  let removeEndpoint;
  let startup = true;
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const server = (deps.createServer || net.createServer)();
  const stop = () => {
    if (closed) return;
    closed = true;
    controller.abort();
    clearTimeout(lifetime);
    for (const peer of pending) peer.destroy();
    pending.clear();
    active?.destroy();
    server.close(() => {});
    if (!startup) resolveDone();
  };
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  output.on?.('error', stop);
  output.on?.('close', stop);
  const stopWatching = (deps.watchTerminal || terminal.watchTerminalLifetime)(stop);
  host.on('SIGINT', stop);
  host.on('SIGTERM', stop);
  // Monitor EOF while waiting for a client; release this reader before prompting.
  let stopIdleInput = (deps.monitorInput || terminal.monitorTerminalInput)(stop);
  const peerConnected = (peer) => {
    if (closed || accepted || ++attempts > LIMITS.connections || pending.size >= LIMITS.pending) {
      peer.on('error', () => {});
      peer.destroy();
      if (attempts > LIMITS.connections) stop();
      return;
    }
    pending.add(peer);
    const started = performance.now();
    let buffer = Buffer.alloc(0);
    let timer;
    const clear = () => {
      clearTimeout(timer);
      pending.delete(peer);
      peer.removeListener('data', onData);
      buffer.fill(0);
      buffer = Buffer.alloc(0);
    };
    const reject = () => {
      clear();
      peer.destroy();
    };
    const onData = (chunk) => {
      if (
        closed ||
        accepted ||
        performance.now() - started >= LIMITS.authMs ||
        buffer.length + chunk.length > LIMITS.authBufferBytes
      )
        return reject();
      const prior = buffer;
      buffer = Buffer.concat([prior, chunk]);
      prior.fill(0);
      const end = buffer.indexOf(10);
      if (end < 0) {
        if (buffer.length > 64) reject();
        return;
      }
      if (end !== 64 || !/^[a-f0-9]{64}$/.test(buffer.subarray(0, end).toString('latin1')))
        return reject();
      const received = Buffer.from(buffer.subarray(0, end).toString('latin1'), 'hex');
      const matches = timingSafeEqual(secret, received);
      received.fill(0);
      if (!matches) return reject();
      // Claim the only connection before any asynchronous work can race it.
      accepted = true;
      peer.pause();
      const remaining = Buffer.from(buffer.subarray(end + 1));
      clear();
      for (const other of pending) other.destroy();
      pending.clear();
      server.close(() => {});
      active = peer;
      if (remaining.length) peer.unshift(remaining);
      work = Promise.resolve()
        .then(() => {
          if (closed) return 2;
          const serving = (deps.serve || require('./action-mcp-stdio').serveActionMcp)({
            ...(options.observe ? { observe: options.observe } : {}),
            input: peer,
            output: peer,
            ...selection,
            execute: async (...parameters) => {
              stopIdleInput();
              stopIdleInput = () => {};
              try {
                return await (
                  deps.execute || require('./action-confirmation').confirmSelectedAction
                )(...parameters);
              } finally {
                if (!closed)
                  stopIdleInput = (deps.monitorInput || terminal.monitorTerminalInput)(stop);
              }
            },
            signal: controller.signal,
          });
          peer.resume();
          return serving;
        })
        .then((result) => {
          code = result;
        })
        .catch(() => {
          code = 2;
        })
        .finally(stop);
      // The transport attaches its own bounded data reader in the next microtask.
    };
    peer.on('error', () => {
      if (active === peer) stop();
      else reject();
    });
    peer.once('close', () => {
      clear();
      if (active === peer) stop();
    });
    peer.once('end', () => {
      if (active !== peer) reject();
    });
    peer.on('data', onData);
    timer = setTimeout(reject, LIMITS.authMs);
  };
  server.on('connection', peerConnected);
  server.on('error', stop);
  lifetime = setTimeout(stop, LIMITS.lifetimeMs);
  try {
    if (closed) return 2;
    await new Promise((resolve, reject) => {
      const failed = () => reject(new Error('broker-unavailable'));
      server.once('error', failed);
      controller.signal.addEventListener('abort', failed, { once: true });
      server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
        server.removeListener('error', failed);
        controller.signal.removeEventListener('abort', failed);
        resolve();
      });
    });
    if (closed) return 2;
    removeEndpoint = await publishActionEndpoint(endpointPath, {
      schemaVersion: 1,
      port: server.address().port,
      token: secret.toString('hex'),
    });
    if (closed) return 2;
    // A fixed readiness marker deliberately contains neither endpoint nor token.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ready-unavailable')), 1000);
      output.write('{"mode":"action-mcp-review","ready":true}\n', (error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      });
    });
    startup = false;
    if (closed) resolveDone();
    await done;
    await work;
    return code;
  } catch {
    return 2;
  } finally {
    startup = false;
    stop();
    await work;
    signal?.removeEventListener('abort', stop);
    stopIdleInput();
    stopWatching();
    host.removeListener('SIGINT', stop);
    host.removeListener('SIGTERM', stop);
    output.removeListener?.('close', stop);
    // A Writable can emit error after invoking its failed write callback.
    setImmediate(() => output.removeListener?.('error', stop)).unref?.();
    secret.fill(0);
    if (removeEndpoint) await removeEndpoint();
  }
}

/** @param {object} deps Trusted terminal/transport/server seams. @returns {void} @since v0.15.1 */
function _setDepsForTest(deps) {
  testDeps = deps;
}
/** @returns {void} @since v0.15.1 */
function _resetForTest() {
  testDeps = null;
}
module.exports = { handleActionMcpReview, LIMITS, _setDepsForTest, _resetForTest };
