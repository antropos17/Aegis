/**
 * @file platform/proc-snapshot-client.js
 * @module main/platform/proc-snapshot-client
 * @description Supervises the process-snapshot sidecar: one long-lived child that
 *   answers `snap` requests over stdio, with a bounded restart budget and a
 *   fail-honest surface. Owns NO policy — which provider serves a pass, and what
 *   happens when this one cannot, is decided by process-snapshot.js.
 *
 *   Everything is injectable (`_setInternalsForTest`), because the Windows binary
 *   is never executed by CI: all five required contexts run on Linux, so the
 *   supervision logic here is proven against a fake child or it is not proven at
 *   all.
 *
 *   Failure policy, deliberately conservative — a snapshot that arrives late is
 *   worth nothing, since the caller can read the CIM map in ~1.3 s anyway:
 *     - one request in flight at a time (the scan loop is single-flight already);
 *     - a timeout, a crash, a desynchronised stream or a failed write kills the
 *       child and burns one of {@link MAX_FAILURES_IN_WINDOW} restarts;
 *     - restarts back off 1 s / 5 s / 30 s, and exhausting the budget disables the
 *       sidecar for the rest of the session with exactly one warning;
 *     - a missing binary or an unknown protocol version disables it immediately —
 *       neither condition fixes itself mid-session, and retrying every scan tick
 *       would just be a spawn storm behind a silent fallback.
 *
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.12.0
 */
'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const logger = require('../logger');
const { PROTOCOL_VERSION, encodeFrame, createFrameDecoder } = require('./proc-snapshot-protocol');

/** @type {string} Binary name, identical in the repo build dir and in resources/. */
const EXE_NAME = 'aegis-procsnap.exe';

/**
 * Default deadline for a handshake or a snapshot. Below the measured CIM p50
 * (1284 ms, N=32, 486 processes): a sidecar that cannot beat the fallback's median
 * is not worth waiting for.
 * @type {number}
 */
const DEFAULT_TIMEOUT_MS = 1200;

/** @type {number} Sliding window the restart budget is counted over. */
const FAILURE_WINDOW_MS = 600000;
/** @type {number} Failures inside the window before the sidecar is given up on. */
const MAX_FAILURES_IN_WINDOW = 3;
/** @type {number[]} Backoff after the 1st, 2nd, … failure in the window. */
const BACKOFF_MS = [1000, 5000, 30000];

/** @type {readonly string[]} Capability classes a hello may announce. */
const KNOWN_CLASSES = ['basic', 'class5'];

let _spawn = childProcess.spawn;
let _now = () => Date.now();
let _resolveExePath = _defaultExePath;

/** @type {import('child_process').ChildProcess|null} */
let _child = null;
/** @type {{class: string, sequence: boolean, topology: boolean}|null} */
let _caps = null;
/** @type {Promise<any>|null} */
let _starting = null;
/** @type {{id: number, resolve: Function, reject: Function, timer: any}|null} */
let _pending = null;
/**
 * True from the moment a caller asks for a snapshot until that call settles —
 * INCLUDING the handshake, which `_pending` does not cover. Two callers arriving
 * during one spawn would otherwise both attach to the same handshake and the second
 * would overwrite the first's response slot, leaving the first hanging until its
 * timeout.
 * @type {boolean}
 */
let _inFlight = false;
/** @type {{resolve: Function, reject: Function, timer: any}|null} */
let _helloWaiter = null;
let _nextId = 1;
/** @type {number[]} Epoch-ms of failures inside the sliding window. */
let _failures = [];
let _nextAttemptAt = 0;
/** @type {string|null} Non-null once the sidecar is given up on for this session. */
let _sticky = null;
let _exitHookInstalled = false;

/**
 * Where the binary lives: packaged next to the app resources, or in the repo
 * build directory during development. Both paths are FIXED — the executable is
 * never looked up on PATH, so nothing on PATH can substitute itself for it.
 * @returns {string|null} the first existing candidate, or null when none exists.
 */
function _defaultExePath() {
  const candidates = [];
  if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
    candidates.push(path.join(process.resourcesPath, 'sidecar', EXE_NAME));
  }
  candidates.push(path.join(__dirname, '..', '..', '..', 'build', 'sidecar', EXE_NAME));
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (_) {
      // Unreadable candidate is simply not a candidate.
    }
  }
  return null;
}

/**
 * Drop the current child and settle whatever was waiting on it. Idempotent.
 * @param {string} reason
 * @returns {void}
 */
function _teardown(reason) {
  const pending = _pending;
  _pending = null;
  if (pending) {
    clearTimeout(pending.timer);
    pending.reject(new Error(`proc-snapshot: ${reason}`));
  }
  const waiter = _helloWaiter;
  _helloWaiter = null;
  if (waiter) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error(`proc-snapshot: ${reason}`));
  }
  const child = _child;
  _child = null;
  _caps = null;
  if (!child) return;
  try {
    if (child.stdout) child.stdout.removeAllListeners();
    if (child.stderr) child.stderr.removeAllListeners();
    if (child.removeAllListeners) child.removeAllListeners();
    if (child.stdin && child.stdin.end) child.stdin.end();
    if (child.kill) child.kill();
  } catch (_) {
    // A child that resists teardown is already gone for our purposes.
  }
}

/**
 * Give up on the sidecar for the rest of the session. One warning, never a
 * per-tick repeat.
 * @param {string} reason
 * @returns {void}
 */
function _disable(reason) {
  if (_sticky) return;
  _sticky = reason;
  logger.warn(
    'proc-snapshot',
    `Snapshot sidecar disabled for this session (${reason}) — the CIM observation serves instead`,
  );
  _teardown(reason);
}

/**
 * Count one failure against the restart budget and schedule the next attempt.
 * @param {string} reason
 * @returns {void}
 */
function _recordFailure(reason) {
  const now = _now();
  _failures = _failures.filter((t) => now - t < FAILURE_WINDOW_MS);
  _failures.push(now);
  logger.debug('proc-snapshot', `Sidecar failure (${reason})`, { failures: _failures.length });
  _teardown(reason);
  if (_failures.length >= MAX_FAILURES_IN_WINDOW) {
    _disable(`restart budget exhausted (${reason})`);
    return;
  }
  _nextAttemptAt = now + BACKOFF_MS[Math.min(_failures.length - 1, BACKOFF_MS.length - 1)];
}

/**
 * Validate the capability block a hello carries. The caps ARE the sidecar's
 * runtime probe result; a hello that omits them tells us nothing about what the
 * snapshots will contain, so it is rejected rather than guessed at.
 * @param {*} caps
 * @returns {{class: string, sequence: boolean, topology: boolean}|null}
 */
function _normalizeCaps(caps) {
  if (caps === null || typeof caps !== 'object') return null;
  if (!KNOWN_CLASSES.includes(caps.class)) return null;
  return {
    class: caps.class,
    sequence: caps.sequence === true,
    topology: caps.topology !== false,
  };
}

/**
 * Dispatch one decoded message.
 * @param {Object} msg
 * @returns {void}
 */
function _onMessage(msg) {
  if (msg.t === 'hello') {
    if (!_helloWaiter) {
      logger.debug('proc-snapshot', 'Ignored an unexpected second hello frame');
      return;
    }
    if (msg.proto !== PROTOCOL_VERSION) {
      _disable(`protocol version mismatch: sidecar ${msg.proto}, client ${PROTOCOL_VERSION}`);
      return;
    }
    const caps = _normalizeCaps(msg.caps);
    if (!caps) {
      _disable('hello carried no usable capability block');
      return;
    }
    _caps = caps;
    const waiter = _helloWaiter;
    _helloWaiter = null;
    clearTimeout(waiter.timer);
    logger.info('proc-snapshot', 'Snapshot sidecar ready', { caps, pid: msg.pid });
    waiter.resolve();
    return;
  }

  if (msg.t !== 'snap' && msg.t !== 'err') {
    logger.debug('proc-snapshot', `Ignored unknown frame type "${msg.t}"`);
    return;
  }
  if (!_pending || _pending.id !== msg.id) {
    logger.debug('proc-snapshot', 'Ignored a response with no matching request', { id: msg.id });
    return;
  }
  const pending = _pending;
  _pending = null;
  clearTimeout(pending.timer);

  if (msg.t === 'err') {
    // The child is alive and said no. That is a provider failure for this pass,
    // not a supervision failure, so the restart budget is not touched.
    pending.reject(new Error(`proc-snapshot: sidecar error ${msg.code || 'unknown'}`));
    return;
  }
  if (!Array.isArray(msg.procs) || !KNOWN_CLASSES.includes(msg.source)) {
    pending.reject(new Error('proc-snapshot: malformed snapshot response'));
    return;
  }
  pending.resolve({ source: msg.source, procs: msg.procs });
}

/** Install the one process-exit hook that closes the child on app shutdown. */
function _installExitHook() {
  if (_exitHookInstalled) return;
  _exitHookInstalled = true;
  process.once('exit', () => {
    try {
      _teardown('parent exiting');
    } catch (_) {
      // Nothing useful can be done from an exit handler.
    }
  });
}

/**
 * Spawn the sidecar and wait for its hello.
 * @param {number} timeoutMs
 * @returns {Promise<import('child_process').ChildProcess>}
 */
function _startChild(timeoutMs) {
  const exePath = _resolveExePath();
  if (!exePath) {
    _disable('sidecar binary not found');
    return Promise.reject(new Error('proc-snapshot: sidecar binary not found'));
  }
  let child;
  try {
    child = _spawn(exePath, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  } catch (err) {
    _recordFailure(`spawn threw: ${err.message}`);
    return Promise.reject(new Error(`proc-snapshot: spawn failed — ${err.message}`));
  }
  _child = child;
  const decoder = createFrameDecoder();
  _installExitHook();

  child.stdout.on('data', (chunk) => {
    if (_child !== child) return;
    const { frames, errors, fatal } = decoder.push(chunk);
    for (const e of errors) logger.warn('proc-snapshot', `Frame error: ${e}`);
    if (fatal) {
      _recordFailure('stream desynchronised');
      return;
    }
    for (const frame of frames) _onMessage(frame);
  });
  child.stderr.on('data', (chunk) => {
    const text = String(chunk).trim();
    if (text) logger.debug('proc-snapshot', `sidecar stderr: ${text}`);
  });
  child.on('error', (err) => {
    if (_child !== child) return;
    _recordFailure(`child error: ${err.message}`);
  });
  child.on('exit', (code, signal) => {
    if (_child !== child) return;
    _recordFailure(`child exited (code=${code}, signal=${signal})`);
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => _recordFailure(`handshake timed out after ${timeoutMs} ms`),
      timeoutMs,
    );
    if (timer.unref) timer.unref();
    _helloWaiter = { resolve: () => resolve(child), reject, timer };
  });
}

/**
 * The live child, spawning and handshaking it if needed.
 * @param {number} timeoutMs
 * @returns {Promise<import('child_process').ChildProcess>}
 */
function _ensureChild(timeoutMs) {
  if (_child && _caps) return Promise.resolve(_child);
  if (_starting) return _starting;
  const now = _now();
  if (now < _nextAttemptAt) {
    return Promise.reject(new Error(`proc-snapshot: backing off for ${_nextAttemptAt - now} ms`));
  }
  const started = _startChild(timeoutMs);
  _starting = started;
  const clear = () => {
    if (_starting === started) _starting = null;
  };
  started.then(clear, clear);
  return started;
}

/**
 * Ask the sidecar for one full process snapshot.
 * @param {Object} [opts]
 * @param {number} [opts.timeoutMs=1200]
 * @returns {Promise<{source: string, procs: Array<Object>}>} rejects on every
 *   failure mode — the caller decides what to fall back to.
 * @since v0.12.0
 */
function requestSnapshot(opts = {}) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  if (_sticky) return Promise.reject(new Error(`proc-snapshot: unavailable — ${_sticky}`));
  if (_inFlight) return Promise.reject(new Error('proc-snapshot: a snapshot is already in flight'));

  _inFlight = true;
  const settled = (value) => {
    _inFlight = false;
    return value;
  };
  return _ensureChild(timeoutMs)
    .then(
      (child) =>
        new Promise((resolve, reject) => {
          const id = _nextId++;
          const timer = setTimeout(
            () => _recordFailure(`snapshot timed out after ${timeoutMs} ms`),
            timeoutMs,
          );
          if (timer.unref) timer.unref();
          _pending = { id, resolve, reject, timer };
          try {
            child.stdin.write(encodeFrame({ t: 'snap', id }));
          } catch (err) {
            _recordFailure(`stdin write failed: ${err.message}`);
          }
        }),
    )
    .then(settled, (err) => {
      settled();
      throw err;
    });
}

/**
 * Observable supervision state, for the provider chooser's health record.
 * @returns {{available: boolean, sticky: string|null, connected: boolean,
 *   caps: {class: string, sequence: boolean, topology: boolean}|null, failures: number}}
 */
function getState() {
  return {
    available: _sticky === null,
    sticky: _sticky,
    connected: _child !== null && _caps !== null,
    caps: _caps ? { ..._caps } : null,
    failures: _failures.length,
  };
}

/**
 * Close the child (app shutdown). The sidecar also exits on stdin EOF, so this is
 * belt and braces rather than the only path.
 * @returns {void}
 */
function shutdown() {
  _teardown('shutdown');
}

/** @internal Replace spawn / clock / path resolution (for tests). */
function _setInternalsForTest(overrides) {
  if (overrides.spawn) _spawn = overrides.spawn;
  if (overrides.now) _now = overrides.now;
  if (overrides.resolveExePath) _resolveExePath = overrides.resolveExePath;
}

/** @internal Restore the real internals and clear all supervision state. */
function _resetForTest() {
  _teardown('reset');
  _spawn = childProcess.spawn;
  _now = () => Date.now();
  _resolveExePath = _defaultExePath;
  _starting = null;
  _inFlight = false;
  _nextId = 1;
  _failures = [];
  _nextAttemptAt = 0;
  _sticky = null;
}

module.exports = {
  EXE_NAME,
  DEFAULT_TIMEOUT_MS,
  MAX_FAILURES_IN_WINDOW,
  BACKOFF_MS,
  requestSnapshot,
  getState,
  shutdown,
  _setInternalsForTest,
  _resetForTest,
};
