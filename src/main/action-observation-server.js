'use strict';

const net = require('node:net');
const { randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { publishActionEndpoint } = require('./action-mcp-endpoint');
const { validObservation } = require('./action-observation-schema');
const LIMITS = Object.freeze({ heartbeatMs: 1000, authMs: 3000, attempts: 8, lifetimeMs: 900000 });

/** Start a separate observation-only endpoint in a caller-private directory.
 * No messages on this endpoint are forwarded to an execution owner.
 * @param {string} file New descriptor. @param {string} route Selected route.
 * @param {string} selection Fixed selection kind. @returns {Promise<object>} Observer hook and cleanup. @since v0.15.1 */
async function startActionObservation(file, route, selection) {
  const token = randomBytes(32);
  const connectionId = randomUUID();
  const peers = new Set();
  let getter = () => ({
    state: 'awaiting-client',
    client: null,
    selection,
    selectedActionCount: 0,
    actionAttempts: 0,
    selectionRejected: 0,
    ownerInvocations: 0,
    ownerSettled: 0,
    ownerFailures: 0,
    cancellationRequests: 0,
  });
  let active, timer, lifetime, remove;
  let attempts = 0,
    sequence = 0,
    closed = false;
  const server = net.createServer((peer) => {
    peer.on('error', () => peer.destroy());
    if (closed || active || ++attempts > LIMITS.attempts) {
      peer.destroy();
      if (attempts > LIMITS.attempts) stop();
      return;
    }
    peers.add(peer);
    let buffer = Buffer.alloc(0);
    const authTimer = setTimeout(() => peer.destroy(), LIMITS.authMs);
    peer.once('close', () => {
      clearTimeout(authTimer);
      buffer.fill(0);
      peers.delete(peer);
    });
    const authenticate = (chunk) => {
      if (buffer.length + chunk.length > 65) {
        peer.destroy();
        return;
      }
      const prior = buffer;
      buffer = Buffer.concat([buffer, chunk]);
      prior.fill(0);
      if (buffer.length !== 65) return;
      if (!/^[a-f0-9]{64}\n$/.test(buffer.toString('latin1'))) {
        peer.destroy();
        return;
      }
      const received = Buffer.from(buffer.subarray(0, 64).toString('latin1'), 'hex');
      const matches = timingSafeEqual(token, received);
      received.fill(0);
      if (!matches || active || closed) {
        peer.destroy();
        return;
      }
      active = peer;
      clearTimeout(authTimer);
      buffer.fill(0);
      peer.removeListener('data', authenticate);
      // Even authenticated observers cannot submit commands or other input.
      peer.on('data', () => peer.destroy());
      for (const other of peers) if (other !== peer) other.destroy();
      server.close();
      const send = () => {
        if (peer.destroyed || closed) return;
        try {
          const frame = {
            schemaVersion: 1,
            connectionId,
            sequence: ++sequence,
            route,
            ...getter(),
          };
          if (!validObservation(frame) || peer.writableLength > 4096) {
            peer.destroy();
            return;
          }
          peer.write(JSON.stringify(frame) + '\n');
        } catch {
          peer.destroy();
        }
      };
      send();
      timer = setInterval(send, LIMITS.heartbeatMs);
      peer.once('close', () => clearInterval(timer));
    };
    peer.on('data', authenticate);
  });
  const stop = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    clearTimeout(lifetime);
    for (const peer of peers) peer.destroy();
    server.close();
    token.fill(0);
  };
  server.on('error', stop);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    remove = await publishActionEndpoint(file, {
      schemaVersion: 1,
      purpose: 'aegis-action-observation',
      port: server.address().port,
      token: token.toString('hex'),
    });
    lifetime = setTimeout(stop, LIMITS.lifetimeMs);
    return {
      observe: (snapshot) => {
        if (typeof snapshot !== 'function') throw new Error('observation-unavailable');
        getter = snapshot;
      },
      close: async () => {
        stop();
        await remove();
      },
    };
  } catch {
    stop();
    if (remove) await remove();
    throw new Error('observation-unavailable');
  }
}

/** Run an explicitly opted-in MCP owner with a separate observation endpoint.
 * @param {string[]} args Existing route arguments followed by --observe and a new file.
 * @param {Function} run Existing owner. @param {string} route Route enum.
 * @returns {Promise<number>} Owner exit status, or 2 before owner start on invalid setup. @since v0.15.1 */
async function runObservedMcp(args, run, route) {
  const index = args.indexOf('--observe');
  const catalog = args[0].includes('-catalog-');
  const expected = (catalog ? 2 : 3) + (route === 'mcp-review' ? 1 : 0);
  if (
    index !== expected ||
    args.length !== expected + 2 ||
    !args[index + 1] ||
    args.slice(1, index).some((arg) => !arg || arg.startsWith('--')) ||
    args[index + 1].startsWith('--')
  )
    return 2;
  let observer;
  try {
    observer = await startActionObservation(
      args[index + 1],
      route,
      catalog ? 'catalog' : 'single-action',
    );
    return await run(args.slice(0, index), { observe: observer.observe });
  } catch {
    return 2;
  } finally {
    await observer?.close();
  }
}
module.exports = { startActionObservation, runObservedMcp, LIMITS };
