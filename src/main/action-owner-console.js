'use strict';

const { randomBytes: secureRandom } = require('node:crypto');
const { EventEmitter } = require('node:events');

const MAX_FRAME = 24576;
const MAX_PREVIEW = 16384;
const STARTUP_MS = 3000;
const REVIEW_MS = 60000;
const CLEANUP_MS = 3000;

/** A scoped adapter for the authenticated native verifier's private framed stdio. */
async function createOwnerConsole({
  child,
  randomBytes = secureRandom,
  startupMs = STARTUP_MS,
  reviewMs = REVIEW_MS,
  cleanupMs = CLEANUP_MS,
  heartbeatMs = 2500,
  healthMs = 3000,
  now = () => performance.now(),
  profileEnvironment,
}) {
  const scopedProfileEnvironment = profileEnvironment
    ? Object.freeze(
        Object.fromEntries(
          ['APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'TEMP', 'TMP'].map((key) => [
            key,
            profileEnvironment[key],
          ]),
        ),
      )
    : undefined;
  const startupAt = now();
  const within = (started, limit) => {
    const elapsed = now() - started;
    return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < limit;
  };
  const events = new EventEmitter();
  const input = child.stdout;
  const output = child.stdin;
  let buffer = Buffer.alloc(0);
  let available = false;
  let closed = false;
  let reviewed = false;
  let pending;
  let closing;
  let exited = false;
  let exitCode;
  let exitSignal;
  let shutdownAcknowledged = false;
  let shutdownAt;
  let acknowledgedAt;
  let exitedAt;
  let lastHeartbeat;
  let heartbeatTimer;
  let lastHeartbeatAt = 0;
  let health;
  let approved = false;
  let guardAt;
  let resolveHello;
  let resolveClose;
  const hello = new Promise((resolve) => {
    resolveHello = resolve;
  });
  const exit = new Promise((resolve) => {
    resolveClose = resolve;
  });

  const fail = () => {
    if (closed) return;
    closed = true;
    available = false;
    clearTimeout(heartbeatTimer);
    resolveHello(false);
    if (pending) pending.finish(false);
    if (health) health.finish(false);
    events.emit('lost');
    try {
      child.kill();
    } catch {
      /* already closed */
    }
  };
  const send = (message) => {
    if (closed || typeof message !== 'string') return false;
    const body = Buffer.from(message, 'ascii');
    if (!body.length || body.length > MAX_FRAME) return false;
    const frame = Buffer.allocUnsafe(body.length + 4);
    frame.writeUInt32LE(body.length, 0);
    body.copy(frame, 4);
    try {
      output.write(frame, (error) => {
        if (error) fail();
      });
      return true;
    } catch {
      fail();
      return false;
    }
  };
  const onFrame = (message) => {
    if (message === 'H 1' && !available && !pending && !closing) {
      if (!within(startupAt, startupMs)) return fail();
      available = true;
      lastHeartbeatAt = now();
      heartbeatTimer = setTimeout(fail, heartbeatMs);
      resolveHello(true);
      return;
    }
    if (available && /^P [a-f0-9]{32}$/.test(message)) {
      const nonce = message.slice(2);
      if (nonce === lastHeartbeat || (!closing && !within(lastHeartbeatAt, heartbeatMs)))
        return fail();
      lastHeartbeat = nonce;
      lastHeartbeatAt = now();
      clearTimeout(heartbeatTimer);
      if (!closing) heartbeatTimer = setTimeout(fail, heartbeatMs);
      if (!send(`Q ${nonce}`)) fail();
      return;
    }
    if (message === 'L' || (pending && message === `V ${pending.challenge}`)) {
      fail();
      return;
    }
    if (closing && message === 'B') {
      if (!within(shutdownAt, cleanupMs)) return fail();
      shutdownAcknowledged = true;
      acknowledgedAt = now();
      closing();
      return;
    }
    if (health && message === `Y ${health.nonce}`) {
      if (
        !within(health.startedAt, healthMs) ||
        !within(lastHeartbeatAt, heartbeatMs) ||
        health.signal?.aborted
      )
        return fail();
      guardAt = now();
      health.finish(true);
      return;
    }
    if (!pending) return fail();
    const [type, challenge, extra] = message.split(' ');
    if (extra !== undefined || challenge !== pending.challenge) return fail();
    if (pending.cancelled) {
      if (type === 'K') {
        pending.finish(false);
        fail();
      } else if (type !== 'A' && type !== 'D' && type !== 'U') fail();
      return;
    }
    if (!within(pending.startedAt, reviewMs) || pending.signal?.aborted) return fail();
    if (type === 'A') {
      approved = true;
      pending.finish(true);
    } else if (type === 'D') pending.finish(false);
    else if (type === 'U') {
      pending.finish(false);
      fail();
    } else fail();
  };
  const onData = (chunk) => {
    if (closed) return;
    if (!Buffer.isBuffer(chunk)) return fail();
    if (buffer.length + chunk.length > MAX_FRAME + 4) return fail();
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (!length || length > MAX_FRAME) return fail();
      if (buffer.length < length + 4) return;
      const bytes = buffer.subarray(4, length + 4);
      if (bytes.some((byte) => byte < 32 || byte > 126)) return fail();
      const message = bytes.toString('ascii');
      buffer = buffer.subarray(length + 4);
      onFrame(message);
      if (closed) return;
    }
  };
  input.on('data', onData);
  const onStreamClosed = () => {
    if (!shutdownAcknowledged) fail();
  };
  input.on('error', fail);
  input.on('end', onStreamClosed);
  input.on('close', onStreamClosed);
  output.on('error', fail);
  output.on('close', onStreamClosed);
  output.on('finish', onStreamClosed);
  child.on('error', fail);
  child.once('exit', (code, signal) => {
    exitCode = code;
    exitSignal = signal;
    if (!shutdownAcknowledged) fail();
  });
  child.once('close', (code, signal) => {
    exited = true;
    exitedAt = now();
    exitCode = code;
    exitSignal = signal;
    resolveClose();
    if (!shutdownAcknowledged) fail();
  });
  const helloTimer = setTimeout(() => resolveHello(false), startupMs);
  const started = await hello;
  clearTimeout(helloTimer);
  if (!started || closed) {
    fail();
    let timeout;
    await Promise.race([
      exit,
      new Promise((resolve) => {
        timeout = setTimeout(resolve, cleanupMs);
      }),
    ]);
    clearTimeout(timeout);
    return null;
  }

  const watch = (abort) => {
    events.on('lost', abort);
    if (!available) abort();
    return () => events.removeListener('lost', abort);
  };
  const adapter = {
    profileEnvironment: scopedProfileEnvironment,
    isTerminalAvailable: () => {
      if (available && !closing && !within(lastHeartbeatAt, heartbeatMs)) fail();
      return available && !closed;
    },
    watchTerminalLifetime: watch,
    monitorTerminalInput: watch,
    isCommitGuardFresh: () => {
      if (available && !within(lastHeartbeatAt, heartbeatMs)) fail();
      return available && !closed && guardAt !== undefined && within(guardAt, 1500);
    },
    async confirmInTerminal(operation, { signal, kind } = {}) {
      if (kind !== 'delete-file' || !available || closed || pending || reviewed || signal?.aborted)
        return false;
      let challenge;
      let preview;
      try {
        challenge = randomBytes(16).toString('hex');
        if (!/^[a-f0-9]{32}$/.test(challenge)) return false;
        const rendered = JSON.stringify(operation, null, 2).replace(
          /[\u007f-\uffff]/g,
          (char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'),
        );
        preview =
          'AEGIS terminal confirmation - ONE file deletion\n' +
          'The exact file path is displayed below. Terminal history may retain it.\n' +
          'A terminal response does not authenticate a human.\n' +
          'Exact operation (JSON escapes are literal):\n' +
          rendered;
        if (Buffer.byteLength(preview) > MAX_PREVIEW || /[^\x20-\x7e\n]/.test(preview))
          return false;
      } catch {
        return false;
      }
      return new Promise((resolve) => {
        reviewed = true;
        let timer;
        const item = {
          challenge,
          startedAt: now(),
          signal,
          cancelled: false,
          finish(value) {
            if (pending !== item) return;
            clearTimeout(timer);
            signal?.removeEventListener('abort', cancel);
            pending = undefined;
            resolve(value === true);
          },
        };
        const cancel = () => {
          if (pending !== item || item.cancelled) return;
          item.cancelled = true;
          clearTimeout(timer);
          if (!send(`C ${challenge}`)) return item.finish(false);
          timer = setTimeout(() => {
            fail();
            item.finish(false);
          }, cleanupMs);
        };
        pending = item;
        signal?.addEventListener('abort', cancel, { once: true });
        timer = setTimeout(cancel, reviewMs);
        if (!send(`R ${challenge} ${Buffer.from(preview, 'ascii').toString('base64')}`))
          item.finish(false);
        if (signal?.aborted) cancel();
      });
    },
    async checkBeforeCommit({ signal } = {}) {
      if (
        !approved ||
        !available ||
        closed ||
        pending ||
        health ||
        signal?.aborted ||
        !within(lastHeartbeatAt, heartbeatMs)
      )
        return false;
      let nonce;
      try {
        nonce = randomBytes(16).toString('hex');
        if (!/^[a-f0-9]{32}$/.test(nonce)) return false;
      } catch {
        return false;
      }
      return new Promise((resolve) => {
        let timer;
        const item = {
          nonce,
          startedAt: now(),
          signal,
          finish(value) {
            if (health !== item) return;
            clearTimeout(timer);
            signal?.removeEventListener('abort', cancel);
            health = undefined;
            resolve(value === true);
          },
        };
        const cancel = () => {
          item.finish(false);
          fail();
        };
        health = item;
        signal?.addEventListener('abort', cancel, { once: true });
        timer = setTimeout(cancel, healthMs);
        if (!send(`G ${nonce}`)) item.finish(false);
        if (signal?.aborted) cancel();
      });
    },
    async close() {
      if (pending) {
        // A live review cannot be converted into a successful shutdown.
        fail();
      }
      let acknowledged = false;
      clearTimeout(heartbeatTimer);
      if (!closed) {
        shutdownAt = now();
        const done = new Promise((resolve) => {
          closing = () => {
            acknowledged = true;
            resolve();
          };
        });
        if (send('S')) {
          let timeout;
          await Promise.race([
            done,
            new Promise((resolve) => {
              timeout = setTimeout(resolve, cleanupMs);
            }),
          ]);
          clearTimeout(timeout);
        }
      }
      if (acknowledged && !exited) {
        let timeout;
        await Promise.race([
          exit,
          new Promise((resolve) => {
            timeout = setTimeout(resolve, cleanupMs);
          }),
        ]);
        clearTimeout(timeout);
      }
      if (!exited) {
        fail();
        let timeout;
        await Promise.race([
          exit,
          new Promise((resolve) => {
            timeout = setTimeout(resolve, cleanupMs);
          }),
        ]);
        clearTimeout(timeout);
      }
      return (
        acknowledged &&
        exited &&
        exitedAt >= acknowledgedAt &&
        exitedAt - acknowledgedAt < cleanupMs &&
        exitCode === 0 &&
        exitSignal === null
      );
    },
  };
  return adapter;
}

module.exports = { createOwnerConsole, MAX_FRAME, MAX_PREVIEW };
