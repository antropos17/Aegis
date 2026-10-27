'use strict';

const http = require('node:http');
const tty = require('node:tty');
const path = require('node:path');
const { randomBytes, randomInt, createHmac, timingSafeEqual } = require('node:crypto');
const { spawn } = require('node:child_process');

const LIMITS = Object.freeze({ keyMs: 45000, claimMs: 65000, replyBytes: 8192, cleanupMs: 4000 });
let testDeps = null;

// Read the actual descriptor rather than Electron's ended Windows process.stdin.
// Neither input bytes nor the normalized key are written to the terminal.
function readLaunchKey() {
  const terminal = testDeps?.tty || tty;
  const signals = testDeps?.signals || process;
  if (!terminal.isatty(0) || !terminal.isatty(1)) return Promise.resolve(null);
  let input;
  try {
    input = new terminal.ReadStream(0);
    input.setRawMode(true);
  } catch {
    input?.pause();
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let value = '',
      done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      input.removeListener('data', onData);
      input.removeListener('error', fail);
      input.removeListener('end', fail);
      signals.removeListener('SIGINT', fail);
      signals.removeListener('SIGTERM', fail);
      try {
        input.pause();
        input.unref?.();
      } catch {
        ok = false;
      }
      try {
        input.setRawMode(false);
      } catch {
        ok = false;
      }
      const ignoreLateError = () => {};
      input.on('error', ignoreLateError);
      setImmediate(() => input.removeListener('error', ignoreLateError)).unref?.();
      const normalized = value
        .replace(/\r?\n?$/, '')
        .replace(/[ -]/g, '')
        .toLowerCase();
      value = '';
      resolve(ok && /^[a-f0-9]{24}$/.test(normalized) ? normalized : null);
    };
    const fail = () => finish(false);
    const onData = (chunk) => {
      const text = chunk.toString('utf8');
      // Reject terminal interrupt and escape control sequences before parsing.
      // eslint-disable-next-line no-control-regex
      if (/[\x03\x1b]/.test(text) || /[^a-fA-F0-9 \-\r\n]/.test(text)) return fail();
      value += text;
      if (value.length > 64) return fail();
      if (/[\r\n]/.test(value)) {
        if (!/^[a-fA-F0-9 -]+\r?\n?$/.test(value)) return fail();
        finish(true);
      }
    };
    const timer = setTimeout(fail, LIMITS.keyMs);
    input.on('data', onData);
    input.once('error', fail);
    input.once('end', fail);
    signals.once('SIGINT', fail);
    signals.once('SIGTERM', fail);
    input.resume();
  });
}

function localPath(value, basename) {
  if (typeof value !== 'string' || value.length > 4096 || !/^[A-Za-z]:[\\/]/.test(value))
    return false;
  // Native path arguments must not contain control characters or device syntax.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f"<>|?*]/.test(value) || value.slice(2).includes(':')) return false;
  if (!path.win32.isAbsolute(value) || path.win32.normalize(value) !== value) return false;
  return !basename || path.win32.basename(value).toLowerCase() === basename;
}

// Only an endpoint that already knows the key may select the process to start.
function validSelection(value, session, code, nonce, key) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = ['token', 'executable', 'settings', 'cwd', 'proof'];
  if (
    Object.keys(value).length !== keys.length ||
    !keys.every((name) => Object.hasOwn(value, name))
  )
    return false;
  if (!/^[a-f0-9]{64}$/.test(value.token) || !/^[a-f0-9]{64}$/.test(value.proof)) return false;
  if (
    !localPath(value.executable, 'claude.exe') ||
    !localPath(value.settings, 'settings.json') ||
    !localPath(value.cwd)
  )
    return false;
  const expected = createHmac('sha256', key)
    .update(
      JSON.stringify([
        session,
        code,
        nonce,
        value.token,
        value.executable,
        value.settings,
        value.cwd,
      ]),
    )
    .digest();
  const supplied = Buffer.from(value.proof, 'hex');
  try {
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  } finally {
    expected.fill(0);
    supplied.fill(0);
  }
}

function claim(port, session, code, nonce) {
  return new Promise((resolve) => {
    let settled = false,
      bytes = 0;
    const chunks = [];
    let request;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request?.destroy();
      for (const chunk of chunks) chunk.fill(0);
      chunks.length = 0;
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), testDeps?.claimMs || LIMITS.claimMs);
    try {
      request = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: `/claim/${session}`,
          method: 'POST',
          agent: false,
          headers: { 'Content-Type': 'application/json', Connection: 'close' },
        },
        (response) => {
          if (response.statusCode !== 200) return finish(null);
          response.on('error', () => finish(null));
          response.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > LIMITS.replyBytes) return finish(null);
            chunks.push(Buffer.from(chunk));
          });
          response.on('end', () => {
            let raw;
            try {
              raw = Buffer.concat(chunks, bytes);
              const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
              finish(value);
            } catch {
              finish(null);
            } finally {
              raw?.fill(0);
            }
          });
        },
      );
      request.on('error', () => finish(null));
      request.end(JSON.stringify({ code, nonce }));
    } catch {
      finish(null);
    }
  });
}

function runChild(selected, port, session, write) {
  const signals = testDeps?.signals || process;
  const env = { ...process.env };
  delete env.AEGIS_CLAUDE_GUARD_CAPABILITY;
  delete env.AEGIS_CLAUDE_GUARD_PORT;
  delete env.AEGIS_CLAUDE_GUARD_SESSION;
  env.AEGIS_CLAUDE_GUARD_PORT = String(port);
  env.AEGIS_CLAUDE_GUARD_SESSION = session;
  env.AEGIS_CLAUDE_GUARD_CAPABILITY = selected.token;
  return new Promise((resolve) => {
    let child,
      done = false,
      timer,
      terminating = false;
    const finish = (code, unknown = false) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signals.removeListener('SIGINT', stop);
      signals.removeListener('SIGTERM', stop);
      delete env.AEGIS_CLAUDE_GUARD_CAPABILITY;
      if (unknown) {
        try {
          write('Claude child cleanup is unconfirmed; descendant cleanup is not verified.');
        } catch {
          // Preserve the fixed result even if terminal output closes.
        }
      }
      resolve(code);
    };
    const stop = () => {
      if (terminating || done) return;
      terminating = true;
      timer = setTimeout(() => finish(2, true), testDeps?.cleanupMs || LIMITS.cleanupMs);
      try {
        child?.kill();
      } catch {
        /* Timed settlement retains uncertainty. */
      }
    };
    try {
      child = (testDeps?.spawn || spawn)(selected.executable, ['--settings', selected.settings], {
        cwd: selected.cwd,
        env,
        stdio: 'inherit',
        shell: false,
        windowsHide: false,
      });
      child.once('error', () => finish(2));
      child.once('close', (code) => finish(!terminating && code === 0 ? 0 : 2));
      signals.once('SIGINT', stop);
      signals.once('SIGTERM', stop);
    } catch {
      finish(2);
    }
  });
}

function finishReport(port, session, token) {
  return new Promise((resolve) => {
    let done = false,
      request;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      request?.destroy();
      resolve();
    };
    const timer = setTimeout(finish, 250);
    try {
      request = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: `/finish/${session}`,
          method: 'POST',
          agent: false,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Connection: 'close',
          },
        },
        (response) => {
          response.resume();
          response.on('end', finish);
          response.on('error', finish);
        },
      );
      request.on('error', finish);
      request.end('{}');
    } catch {
      finish();
    }
  });
}

/** Launch one explicitly approved Claude route from a real terminal.
 * @param {string[]} args Fixed CLI flag, local port and session reference.
 * @param {(message:string)=>void} write Fixed terminal message sink.
 * @returns {Promise<number>} Process outcome or unavailable/uncertain refusal. @since v0.21.0 */
async function handleClaudeGuardSession(args, write) {
  try {
    return await runSession(args, write);
  } catch {
    try {
      write('Claude Guard session was not confirmed.');
    } catch {
      // Terminal output is unavailable; return a fixed failure without details.
    }
    return 2;
  }
}

async function runSession(args, write) {
  if (
    args.length !== 3 ||
    args[0] !== '--claude-guard-session' ||
    !/^[1-9][0-9]{0,4}$/.test(args[1]) ||
    Number(args[1]) > 65535 ||
    !/^[a-f0-9]{32}$/.test(args[2])
  ) {
    write('Claude Guard session is unavailable.');
    return 2;
  }
  if (!(testDeps?.terminal || (() => tty.isatty(0) && tty.isatty(1)))()) {
    write('Claude Guard requires an interactive terminal.');
    return 2;
  }
  write('Enter the 24-character launch key from AEGIS; input is hidden.');
  const key = await (testDeps?.readKey || readLaunchKey)();
  if (typeof key !== 'string' || !/^[a-f0-9]{24}$/.test(key)) {
    write('Claude Guard session was not confirmed.');
    return 2;
  }
  const code = String((testDeps?.randomInt || randomInt)(0, 1000000)).padStart(6, '0');
  const nonce = (testDeps?.randomBytes || randomBytes)(16).toString('hex');
  if (!/^[0-9]{6}$/.test(code) || !/^[a-f0-9]{32}$/.test(nonce)) return 2;
  write(`Compare code ${code} with the AEGIS confirmation dialog.`);
  const selected = await (testDeps?.claim || claim)(Number(args[1]), args[2], code, nonce);
  const accepted = validSelection(selected, args[2], code, nonce, key);
  if (!accepted) {
    if (selected && typeof selected.token === 'string' && /^[a-f0-9]{64}$/.test(selected.token))
      await (testDeps?.finishReport || finishReport)(Number(args[1]), args[2], selected.token);
    write('Claude Guard session was not confirmed.');
    return 2;
  }
  const result = await runChild(selected, Number(args[1]), args[2], write);
  await (testDeps?.finishReport || finishReport)(Number(args[1]), args[2], selected.token);
  return result;
}

/** @param {object} deps Test-only seams. @returns {void} @since v0.21.0 */
function _setDepsForTest(deps) {
  testDeps = deps;
}
/** @returns {void} @since v0.21.0 */
function _resetForTest() {
  testDeps = null;
}
module.exports = { handleClaudeGuardSession, LIMITS, _setDepsForTest, _resetForTest };
