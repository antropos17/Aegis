'use strict';

const net = require('node:net');
const { readActionFile, parseActionJson } = require('./action-policy');
const LIMITS = Object.freeze({
  connectMs: 3000,
  drainMs: 1000,
  lifetimeMs: 900000,
  bytes: 1048576,
  queuedBytes: 65536,
});
let testDeps = null;

/**
 * Relay one agent's stdio to an explicitly selected loopback operator broker.
 * The selected bearer is sent once before stdin; no payload or diagnostic is logged.
 * @param {string[]} args CLI flag and local descriptor filename.
 * @returns {Promise<number>} 0 for clean EOF, 2 for invalid setup, transport or bounds.
 * @since v0.15.1
 */
function handleActionMcpConnect(args) {
  const deps = testDeps || {};
  const input = deps.input || process.stdin;
  const output = deps.output || process.stdout;
  const host = deps.process || process;
  return new Promise((resolve) => {
    let socket;
    let ready = false;
    let closed = false;
    let settled = false;
    let code = 0;
    let connectTimer;
    let lifetime;
    let finalDrain;
    const outgoing = { total: 0, queued: 0, blocked: false, timer: null };
    const incoming = { total: 0, queued: 0, blocked: false, timer: null };
    const noop = () => {};
    const settle = () => {
      if (settled || !closed) return;
      if ((incoming.queued || incoming.blocked || incoming.writing) && !output.destroyed) {
        if (!finalDrain)
          finalDrain = setTimeout(() => {
            code = 2;
            incoming.queued = 0;
            incoming.blocked = false;
            incoming.writing = false;
            settle();
          }, LIMITS.drainMs);
        return;
      }
      settled = true;
      for (const timer of [connectTimer, lifetime, finalDrain, outgoing.timer, incoming.timer])
        clearTimeout(timer);
      input.removeListener('data', onInput);
      input.removeListener('end', onInputEnd);
      input.removeListener('close', onInputClose);
      input.removeListener('error', fail);
      output.removeListener('error', outputError);
      output.removeListener('close', outputError);
      output.removeListener('drain', outputDrain);
      host.removeListener('SIGINT', fail);
      host.removeListener('SIGTERM', fail);
      input.on('error', noop);
      output.on('error', noop);
      setImmediate(() => {
        input.removeListener('error', noop);
        output.removeListener('error', noop);
      }).unref?.();
      resolve(code);
    };
    const close = (status = 2) => {
      if (settled) return;
      if (status) code = 2;
      if (!closed) {
        closed = true;
        clearTimeout(connectTimer);
        clearTimeout(lifetime);
        clearTimeout(outgoing.timer);
        input.pause();
        socket?.destroy();
      }
      settle();
    };
    function fail() {
      close(2);
    }
    function outputError() {
      incoming.queued = 0;
      incoming.blocked = false;
      incoming.writing = false;
      close(2);
    }
    function onInputEnd() {
      close(0);
    }
    function onInputClose() {
      close(input.readableEnded ? 0 : 2);
    }
    const resume = (source, state) => {
      if (state.queued || state.blocked || state.writing) return;
      clearTimeout(state.timer);
      state.timer = null;
      if (!closed && ready) source.resume();
    };
    function outputDrain() {
      incoming.blocked = false;
      if (socket) resume(socket, incoming);
      settle();
    }
    function socketDrain() {
      outgoing.blocked = false;
      resume(input, outgoing);
    }
    const relay = (chunk, destination, source, state) => {
      if (closed || !ready) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      state.total += bytes.length;
      if (state.total > LIMITS.bytes || state.queued + bytes.length > LIMITS.queuedBytes) {
        close(2);
        return;
      }
      source.pause();
      state.queued += bytes.length;
      if (!state.timer)
        state.timer = setTimeout(() => {
          if (state === incoming) {
            incoming.queued = 0;
            incoming.blocked = false;
            incoming.writing = false;
          }
          close(2);
        }, LIMITS.drainMs);
      let returned = false;
      state.writing = true;
      try {
        const writable = destination.write(bytes, (error) => {
          if (settled) return;
          state.queued = Math.max(0, state.queued - bytes.length);
          if (error) {
            if (state === incoming) outputError();
            else close(2);
            return;
          }
          if (returned) {
            resume(source, state);
            settle();
          }
        });
        state.blocked = !writable;
        state.writing = false;
        returned = true;
        resume(source, state);
        settle();
      } catch {
        state.writing = false;
        if (state === incoming) outputError();
        else close(2);
      }
    };
    function onInput(chunk) {
      relay(chunk, socket, input, outgoing);
    }
    input.pause();
    input.on('error', fail);
    input.on('end', onInputEnd);
    input.on('close', onInputClose);
    output.on('error', outputError);
    output.on('close', outputError);
    output.on('drain', outputDrain);
    host.on('SIGINT', fail);
    host.on('SIGTERM', fail);
    lifetime = setTimeout(fail, LIMITS.lifetimeMs);
    connectTimer = setTimeout(fail, LIMITS.connectMs);
    if (
      args.length !== 2 ||
      args[0] !== '--action-mcp-connect' ||
      typeof args[1] !== 'string' ||
      !args[1] ||
      args[1].startsWith('--') ||
      input.destroyed ||
      output.destroyed ||
      input.readableEnded
    ) {
      close(2);
      return;
    }
    (async () => {
      let bytes;
      let descriptor;
      try {
        bytes = await (deps.read || readActionFile)(args[1]);
        descriptor = parseActionJson(bytes);
      } finally {
        bytes?.fill(0);
      }
      if (closed) return;
      if (
        !descriptor ||
        typeof descriptor !== 'object' ||
        Array.isArray(descriptor) ||
        Object.keys(descriptor).length !== 3 ||
        !['schemaVersion', 'port', 'token'].every((key) => Object.hasOwn(descriptor, key)) ||
        descriptor.schemaVersion !== 1 ||
        !Number.isInteger(descriptor.port) ||
        descriptor.port < 1 ||
        descriptor.port > 65535 ||
        typeof descriptor.token !== 'string' ||
        !/^[a-f0-9]{64}$/.test(descriptor.token)
      ) {
        close(2);
        return;
      }
      socket = (deps.connect || net.createConnection)({
        host: '127.0.0.1',
        port: descriptor.port,
        allowHalfOpen: false,
      });
      socket.pause();
      socket.on('error', fail);
      socket.on('drain', socketDrain);
      socket.on('end', () => close(0));
      socket.on('close', () => {
        if (!closed) close(2);
      });
      socket.on('data', (chunk) => relay(chunk, output, socket, incoming));
      socket.on('connect', () => {
        if (closed) return;
        const auth = Buffer.from(descriptor.token + '\n', 'ascii');
        descriptor.token = '';
        try {
          socket.write(auth, (error) => {
            auth.fill(0);
            if (closed) return;
            if (error) {
              close(2);
              return;
            }
            clearTimeout(connectTimer);
            ready = true;
            socket.resume();
            input.on('data', onInput);
            input.resume();
          });
        } catch {
          auth.fill(0);
          close(2);
        }
      });
    })().catch(fail);
  });
}

/** @param {object} deps Trusted streams, local connect/read and process seams. @returns {void} @since v0.15.1 */
function _setDepsForTest(deps) {
  testDeps = deps;
}
/** @returns {void} @since v0.15.1 */
function _resetForTest() {
  testDeps = null;
}
module.exports = { handleActionMcpConnect, LIMITS, _setDepsForTest, _resetForTest };
