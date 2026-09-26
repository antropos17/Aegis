'use strict';
const { spawn } = require('node:child_process');
const { parseActionJson } = require('./action-policy');
const { spawnInWindowsJob } = require('./mcp-gateway-windows-job');
const LIMITS = Object.freeze({
  frameBytes: 16384,
  totalBytes: 1048576,
  stderrBytes: 32768,
  requestMs: 3000,
  cleanupMs: 1000,
  windowsCleanupMs: 2000,
});

/** Own one explicitly selected server process; unsolicited upstream traffic closes admission.
 * @param {object} launch Prepared, policy-authorized launch. @param {Function} onFailure Revoke route.
 * @returns {object} Bounded RPC and held-child cleanup. @since v0.15.1 */
function createGatewayPeer(launch, onFailure) {
  const child =
    process.platform === 'win32'
      ? spawnInWindowsJob(launch)
      : spawn(launch.executable, launch.args, {
          cwd: launch.cwd,
          env: launch.env,
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
  let closed = false,
    exited = false,
    settled = false,
    serial = 0,
    total = 0,
    stderr = 0;
  let partial = Buffer.alloc(0),
    pending,
    cleanupTimer;
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const settle = (confirmed) => {
    if (settled) return;
    settled = true;
    clearTimeout(cleanupTimer);
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    if (!confirmed) child.unref();
    resolveDone(confirmed);
  };
  const close = () => {
    if (closed) return;
    closed = true;
    partial.fill(0);
    partial = Buffer.alloc(0);
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(Error('upstream-closed'));
      pending = null;
    }
    if (!exited) {
      try {
        if (child.stop) child.stop();
        else child.kill('SIGKILL');
      } catch {
        /* Held exit event is required. */
      }
    }
    cleanupTimer = setTimeout(
      () => {
        if (child.stop) child.kill('SIGKILL');
        settle(false);
      },
      child.stop ? LIMITS.windowsCleanupMs : LIMITS.cleanupMs,
    );
  };
  const fail = () => {
    if (closed) return;
    close();
    onFailure();
  };
  const write = (message) => {
    if (closed) throw Error('upstream-closed');
    const bytes = JSON.stringify(message) + '\n';
    if (Buffer.byteLength(bytes) > LIMITS.frameBytes) {
      fail();
      throw Error('upstream-limit');
    }
    child.stdin.write(bytes, (error) => {
      if (error) fail();
    });
  };
  const receive = (line) => {
    let message;
    try {
      message = parseActionJson(line);
    } catch {
      fail();
      return;
    }
    if (
      !message ||
      typeof message !== 'object' ||
      Array.isArray(message) ||
      message.jsonrpc !== '2.0' ||
      !pending ||
      message.id !== pending.id ||
      Object.keys(message).length !== 3 ||
      !Object.hasOwn(message, 'result')
    ) {
      fail();
      return;
    }
    const work = pending;
    pending = null;
    clearTimeout(work.timer);
    work.resolve(message.result);
  };
  child.stdout.on('data', (chunk) => {
    if (closed) return;
    total += chunk.length;
    if (total > LIMITS.totalBytes) {
      fail();
      return;
    }
    let offset = 0;
    while (!closed && offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline;
      if (partial.length + end - offset > LIMITS.frameBytes) {
        fail();
        return;
      }
      partial = Buffer.concat([partial, chunk.subarray(offset, end)]);
      if (newline < 0) return;
      const line = partial;
      partial = Buffer.alloc(0);
      receive(line);
      line.fill(0);
      offset = newline + 1;
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.length;
    if (stderr > LIMITS.stderrBytes) fail();
  });
  for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', fail);
  child.stdout.on('end', fail);
  child.on('error', fail);
  child.once('exit', () => {
    exited = true;
    if (!closed) fail();
  });
  child.once('close', () => settle(exited && (!child.stop || child.cleanupConfirmed)));
  return {
    done,
    close,
    request(method, params) {
      if (closed || pending) return Promise.reject(Error('upstream-unavailable'));
      return new Promise((resolve, reject) => {
        const id = ++serial;
        pending = { id, resolve, reject, timer: setTimeout(fail, LIMITS.requestMs) };
        try {
          write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
        } catch {
          fail();
        }
      });
    },
    notify(method) {
      write({ jsonrpc: '2.0', method });
    },
  };
}
module.exports = { createGatewayPeer, LIMITS };
