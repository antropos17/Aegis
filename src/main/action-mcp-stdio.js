'use strict';

const { TextDecoder } = require('node:util');
const LIMITS = Object.freeze({
  lineBytes: 16384,
  inputBytes: 1048576,
  frames: 128,
  pending: 4,
  outputBytes: 65536,
  lifetimeMs: 900000,
  drainMs: 1000,
});
let testDeps = null;

/**
 * Serve one finite newline-delimited MCP session on explicitly owned stdio.
 * Closing admission cancels the session and awaits its in-flight operations;
 * child cleanup must finish before the CLI exits. No diagnostic text is emitted.
 * @param {string[]} args Flag, selected policy path and selected request path.
 * @returns {Promise<number>} 0 for clean EOF, otherwise 2; stdout is protocol only.
 * @since v0.15.1
 */
function handleActionMcpStdio(args) {
  const input = testDeps?.input || process.stdin;
  const output = testDeps?.output || process.stdout;
  const createSession = testDeps?.createSession || require('./action-mcp').createActionMcp;
  return new Promise((resolve) => {
    const active = new Set();
    const writes = new Map();
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    let session;
    let partial = Buffer.alloc(0);
    let totalBytes = 0;
    let frames = 0;
    let queuedBytes = 0;
    let closed = false;
    let ended = false;
    let outputFailed = false;
    let settled = false;
    let exitCode = 0;
    let lifetime;
    let drainTimer;
    const finish = () => {
      if (!closed || active.size || settled) return;
      if (writes.size && !outputFailed) {
        if (!drainTimer)
          drainTimer = setTimeout(() => {
            exitCode = 2;
            outputFailed = true;
            output.destroy();
            finish();
          }, LIMITS.drainMs);
        return;
      }
      settled = true;
      clearTimeout(lifetime);
      clearTimeout(drainTimer);
      resolve(exitCode);
    };
    const close = (code = 2, brokenOutput = false) => {
      if (code) exitCode = 2;
      outputFailed ||= brokenOutput;
      if (!closed) {
        closed = true;
        clearTimeout(lifetime);
        partial = Buffer.alloc(0);
        input.removeListener('data', onData);
        input.removeListener('end', onEnd);
        // Keep error handlers through close so queued stream errors stay handled.
        if (!ended) input.destroy();
        try {
          session?.close();
        } catch (_) {
          exitCode = 2;
        }
      }
      finish();
    };
    const send = (response) => {
      if (response === null || response === undefined || closed || outputFailed || settled) return;
      let text;
      try {
        text = JSON.stringify(response) + '\n';
      } catch (_) {
        close(2, true);
        return;
      }
      const bytes = Buffer.byteLength(text);
      if (queuedBytes + bytes > LIMITS.outputBytes) {
        close(2, true);
        return;
      }
      const ticket = {};
      writes.set(ticket, bytes);
      queuedBytes += bytes;
      try {
        output.write(text, (error) => {
          queuedBytes -= writes.get(ticket) || 0;
          writes.delete(ticket);
          if (error) close(2, true);
          finish();
        });
      } catch (_) {
        writes.delete(ticket);
        queuedBytes -= bytes;
        close(2, true);
      }
    };
    const receive = (line) => {
      if (++frames > LIMITS.frames || active.size >= LIMITS.pending) {
        close();
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(decoder.decode(line));
      } catch (_) {
        close();
        return;
      }
      let work;
      try {
        work = session.receive(parsed);
      } catch (_) {
        close();
        return;
      }
      const pending = Promise.resolve(work)
        .then(send)
        .catch(() => close())
        .finally(() => {
          active.delete(pending);
          finish();
        });
      active.add(pending);
    };
    function onData(chunk) {
      if (closed) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > LIMITS.inputBytes) {
        close();
        return;
      }
      let offset = 0;
      while (!closed && offset < buffer.length) {
        const newline = buffer.indexOf(10, offset);
        const end = newline < 0 ? buffer.length : newline;
        const segment = buffer.subarray(offset, end);
        if (partial.length + segment.length > LIMITS.lineBytes) {
          close();
          return;
        }
        partial = Buffer.concat([partial, segment]);
        if (newline < 0) return;
        const line = partial;
        partial = Buffer.alloc(0);
        receive(line);
        offset = newline + 1;
      }
    }
    function onEnd() {
      ended = true;
      close(partial.length ? 2 : 0);
    }
    function onInputError() {
      close();
    }
    function onInputClose() {
      if (!ended) close();
      input.removeListener('error', onInputError);
      input.removeListener('close', onInputClose);
    }
    function onOutputError() {
      close(2, true);
    }
    function onOutputClose() {
      if (!settled) close(2, true);
      output.removeListener('error', onOutputError);
      output.removeListener('close', onOutputClose);
    }
    input.on('error', onInputError);
    input.on('close', onInputClose);
    output.on('error', onOutputError);
    output.on('close', onOutputClose);
    if (
      args.length !== 3 ||
      args[0] !== '--action-mcp-stdio' ||
      args.slice(1).some((arg) => typeof arg !== 'string' || !arg || arg.startsWith('--'))
    ) {
      close();
      return;
    }
    try {
      session = createSession({ policyPath: args[1], requestPath: args[2] });
    } catch (_) {
      close();
      return;
    }
    lifetime = setTimeout(() => close(), LIMITS.lifetimeMs);
    input.on('end', onEnd);
    input.on('data', onData);
  });
}

/** @param {object} deps Test streams and session factory. @returns {void} @since v0.15.1 */
function _setDepsForTest(deps) {
  testDeps = deps;
}
/** @returns {void} @since v0.15.1 */
function _resetForTest() {
  testDeps = null;
}
module.exports = { handleActionMcpStdio, LIMITS, _setDepsForTest, _resetForTest };
