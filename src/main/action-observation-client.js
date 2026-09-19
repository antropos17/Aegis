'use strict';

const net = require('node:net');
const { readActionFile, parseActionJson } = require('./action-policy');
const { validObservation, follows } = require('./action-observation-schema');
const LIMITS = Object.freeze({
  staleMs: 3500,
  frameBytes: 4096,
  totalBytes: 1048576,
  lifetimeMs: 900000,
});

/** Observe one explicitly selected read-only endpoint, with sticky loss and no reconnect.
 * Bearer possession authenticates the observer; it does not attest the publisher or MCP client.
 * @param {string} file Main-owned native file selection. @returns {object} Snapshot and disposal only. @since v0.15.1 */
function observeActionRoute(file) {
  let socket, staleTimer, lifetime;
  let closed = false,
    everObserved = false,
    totalBytes = 0;
  let lastReceipt = performance.now();
  let partial = Buffer.alloc(0);
  let snapshot = null,
    lastObservedAt = null;
  let state = 'connecting',
    reason = null;
  const close = (why = 'observer-stopped') => {
    if (closed) return;
    closed = true;
    state = why === 'observer-stopped' ? 'stopped' : everObserved ? 'coverage-lost' : 'unavailable';
    reason = why;
    clearTimeout(staleTimer);
    clearTimeout(lifetime);
    partial.fill(0);
    partial = Buffer.alloc(0);
    socket?.destroy();
  };
  const fresh = () => {
    if (!closed && performance.now() - lastReceipt >= LIMITS.staleMs) close('updates-expired');
  };
  const deadline = () => {
    clearTimeout(staleTimer);
    staleTimer = setTimeout(() => close('updates-expired'), LIMITS.staleMs);
  };
  deadline();
  lifetime = setTimeout(() => close('observation-expired'), LIMITS.lifetimeMs);
  (async () => {
    let bytes, descriptor;
    try {
      bytes = await readActionFile(file);
      descriptor = parseActionJson(bytes);
    } finally {
      bytes?.fill(0);
    }
    if (closed) return;
    if (
      !descriptor ||
      typeof descriptor !== 'object' ||
      Array.isArray(descriptor) ||
      Object.keys(descriptor).length !== 4 ||
      descriptor.schemaVersion !== 1 ||
      descriptor.purpose !== 'aegis-action-observation' ||
      !Number.isInteger(descriptor.port) ||
      descriptor.port < 1 ||
      descriptor.port > 65535 ||
      typeof descriptor.token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(descriptor.token)
    ) {
      close('invalid-endpoint');
      return;
    }
    socket = net.createConnection({
      host: '127.0.0.1',
      port: descriptor.port,
      allowHalfOpen: false,
    });
    socket.on('error', () => close('connection-closed'));
    socket.on('end', () => close('connection-closed'));
    socket.on('close', () => close('connection-closed'));
    socket.on('connect', () => {
      if (closed) return;
      const auth = Buffer.from(descriptor.token + '\n', 'ascii');
      descriptor.token = '';
      socket.write(auth, (error) => {
        auth.fill(0);
        if (error) close('connection-closed');
      });
    });
    socket.on('data', (chunk) => {
      fresh();
      if (closed) return;
      totalBytes += chunk.length;
      if (totalBytes > LIMITS.totalBytes) {
        close('invalid-update');
        return;
      }
      let offset = 0;
      while (!closed && offset < chunk.length) {
        const newline = chunk.indexOf(10, offset);
        const end = newline < 0 ? chunk.length : newline;
        if (partial.length + end - offset > LIMITS.frameBytes) {
          close('invalid-update');
          return;
        }
        partial = Buffer.concat([partial, chunk.subarray(offset, end)]);
        if (newline < 0) return;
        try {
          const next = parseActionJson(partial);
          if (!validObservation(next) || !follows(snapshot, next)) {
            close('invalid-update');
            return;
          }
          snapshot = next;
          state = next.state;
          everObserved ||= state === 'observed';
          lastObservedAt = new Date().toISOString();
          lastReceipt = performance.now();
          if (state === 'coverage-lost') {
            close('owner-closed');
            return;
          }
          deadline();
        } catch {
          close('invalid-update');
          return;
        }
        partial.fill(0);
        partial = Buffer.alloc(0);
        offset = newline + 1;
      }
    });
  })().catch(() => close('observation-unavailable'));
  return {
    snapshot: () => {
      fresh();
      return structuredClone({ state, reason, lastObservedAt, snapshot });
    },
    close,
  };
}
module.exports = { observeActionRoute, LIMITS };
