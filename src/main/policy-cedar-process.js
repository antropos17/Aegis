// @ts-check
'use strict';

const { spawn } = require('node:child_process');
const { debuglog } = require('node:util');
const inspector = require('node:inspector');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { snapshotRequest, metadataReply } = require('./cedar-worker-thread');
/** @typedef {import('./cedar-worker-thread').Metadata} Metadata */
/** @typedef {{timeoutMs?: number, signal?: AbortSignal}} Options */
const CAP = 256 * 1024 * 1024;
const REPLY_MAXIMUM = 8192;
const CODES = ['ok', 'cedar-process-failed', 'cedar-process-timeout', 'cedar-process-unconfirmed'];
/** @param {string} reason @returns {Metadata} */
const deny = (reason) => ({ decision: 'deny', reason, policyIds: [] });

/** Refuse effective cached diagnostics and startup/inspection hooks before private IO.
 * The embedding host and installed dependencies must themselves remain trusted.
 * @returns {boolean} Whether the current trusted host can handle private values.
 * @since v0.19.2 */
function privateAdmissionSafe() {
  try {
    return (
      !['stream', 'child_process', 'net', 'worker'].some((name) => debuglog(name).enabled) &&
      !inspector.url() &&
      process.execArgv.every(
        (arg) => !/inspect|debug|require|import|loader|experimental-/i.test(arg),
      ) &&
      !(
        /** @type {NodeJS.Process & {_preload_modules?: unknown[]}} */ (process)._preload_modules
          ?.length
      ) &&
      !Object.keys(process.env).some(
        (key) =>
          /^(NODE_OPTIONS|NODE_V8_COVERAGE|NODE_DEBUG_NATIVE|DOTNET_STARTUP_HOOKS|DOTNET_ADDITIONAL_DEPS|DOTNET_SHARED_STORE|CORECLR_ENABLE_PROFILING|COR_ENABLE_PROFILING)$/i.test(
            key,
          ) && process.env[key],
      )
    );
  } catch (_) {
    return false;
  }
}

/** @param {object} value @param {string[]} keys @returns {boolean} */
const exact = (value, keys) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

/** @param {Buffer} bytes @param {string[]} ids @returns {{reason: string, result: Metadata|null}|null} */
function receipt(bytes, ids) {
  try {
    if (bytes.length < 5 || bytes.readUInt32LE(0) !== bytes.length - 4) return null;
    const value = JSON.parse(bytes.subarray(4).toString('utf8'));
    if (
      !exact(value, ['schemaVersion', 'op', 'closed', 'reason', 'limits', 'result']) ||
      value.schemaVersion !== 1 ||
      value.op !== 'result' ||
      value.closed !== true ||
      !CODES.includes(value.reason)
    )
      return null;
    const expected = {
      processMemoryBytes: CAP,
      jobMemoryBytes: CAP,
      activeProcesses: 1,
      processUserTicks: 20000000,
      jobUserTicks: 20000000,
      wallMs: 10000,
    };
    if (
      !exact(value.limits, Object.keys(expected)) ||
      Object.entries(expected).some(([key, entry]) => value.limits[key] !== entry)
    )
      return null;
    const result = value.reason === 'ok' ? metadataReply(value.result, ids) : null;
    if ((value.reason === 'ok' && !result) || (value.reason !== 'ok' && value.result !== null))
      return null;
    return { reason: value.reason, result };
  } catch (_) {
    return null;
  }
}

/** Create a dormant Windows-only owner for one disposable Cedar Job at a time.
 * helperPath/spawnProcess/platform are trusted composition and test seams; no app caller exists.
 * A lost helper without a validated whole-Job receipt permanently retains admission.
 * @param {{helperPath?: string, spawnProcess?: typeof spawn, platform?: string, admissionCheck?: () => boolean}} [deps] Trusted helper binding/test seams.
 * @returns {{evaluate: (policy: unknown, action: unknown, options?: Options) => Promise<Metadata>, close: () => void}}
 * @since v0.19.2 */
function createCedarProcessClient({
  helperPath = path.resolve(__dirname, '../../build/sidecar/cedar-job/aegis-cedar-job.exe'),
  spawnProcess = spawn,
  platform = process.platform,
  admissionCheck = privateAdmissionSafe,
} = {}) {
  /** @type {{stop: (reason: string) => void}|null} */
  let active = null;
  let closed = false;
  /** @param {unknown} policy @param {unknown} action @param {Options} [options] @returns {Promise<Metadata>} */
  function evaluate(policy, action, options = {}) {
    if (closed) return Promise.resolve(deny('cedar-process-closed'));
    if (active) return Promise.resolve(deny('cedar-process-busy'));
    if (platform !== 'win32' || !admissionCheck())
      return Promise.resolve(deny('cedar-unavailable'));
    /** @type {{stop: (reason: string) => void}} */
    const lifetime = { stop: (_reason) => {} };
    active = lifetime;
    const started = performance.now();
    let timeoutMs, signal;
    try {
      timeoutMs = options.timeoutMs ?? 10000;
      signal = options.signal;
      if (
        !Number.isInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > 10000 ||
        (signal !== undefined && !(signal instanceof AbortSignal)) ||
        typeof helperPath !== 'string' ||
        !path.isAbsolute(helperPath)
      )
        throw Error();
    } catch (_) {
      active = null;
      return Promise.resolve(deny('request-invalid'));
    }
    if (signal?.aborted) {
      active = null;
      return Promise.resolve(deny('cedar-process-cancelled'));
    }
    const snapshot = snapshotRequest(policy, action);
    if (!snapshot.ok) {
      active = null;
      return Promise.resolve(deny(snapshot.reason));
    }
    const deadline = started + timeoutMs;
    if (performance.now() >= deadline) {
      active = null;
      return Promise.resolve(deny('cedar-process-timeout'));
    }
    const body = Buffer.from(
      JSON.stringify({ schemaVersion: 1, op: 'evaluate', request: snapshot.request }),
    );
    const frame = Buffer.alloc(body.length + 4);
    frame.writeUInt32LE(body.length);
    body.copy(frame, 4);
    if (performance.now() >= deadline) {
      active = null;
      return Promise.resolve(deny('cedar-process-timeout'));
    }
    return new Promise((resolve) => {
      /** @type {import('node:child_process').ChildProcessWithoutNullStreams|undefined} */
      let child;
      let settled = false,
        invalid = false,
        transcriptInvalid = false,
        exited = false;
      let bytes = Buffer.alloc(0),
        stderrBytes = 0;
      /** @type {ReturnType<typeof setTimeout>|undefined} */
      let killTimer;
      /** @param {Metadata} result */
      const settle = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        resolve(result);
      };
      /** @param {string} reason */
      const stop = (reason) => {
        invalid = true;
        settle(deny(reason));
        if (!child || exited || killTimer) return;
        // EOF revokes the native owner. Hard helper loss is only a last-resort denial;
        // kill-on-close is an OS guarantee, not an observed whole-Job receipt.
        try {
          child.stdin.end();
        } catch (_) {}
        killTimer = setTimeout(() => {
          try {
            child?.kill();
          } catch (_) {}
        }, 1000);
      };
      /** Transport faults permanently invalidate all retained closure evidence.
       * A timeout/cancel denial alone does not poison a later clean receipt.
       * @param {string} reason */
      const poison = (reason) => {
        transcriptInvalid = true;
        bytes = Buffer.alloc(0);
        stop(reason);
      };
      const cancel = () => stop('cedar-process-cancelled');
      const timer = setTimeout(
        () => stop('cedar-process-timeout'),
        Math.max(1, deadline - performance.now()),
      );
      lifetime.stop = stop;
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted || closed) {
        stop('cedar-process-cancelled');
        active = null;
        return;
      }
      try {
        /** @type {NodeJS.ProcessEnv} */
        const env = {};
        for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP'])
          if (process.env[key]) env[key] = process.env[key];
        child = spawnProcess(helperPath, [], {
          env,
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        child.on('error', () => {
          poison('cedar-process-failed');
          if (!child?.pid && active === lifetime) active = null;
        });
        child.stdin.on('error', () => poison('cedar-process-failed'));
        child.stdout.on('error', () => poison('cedar-process-protocol'));
        child.stderr.on('error', () => poison('cedar-process-protocol'));
        child.stdout.on('data', (chunk) => {
          if (transcriptInvalid) return;
          if (bytes.length + chunk.length > REPLY_MAXIMUM + 4)
            return poison('cedar-process-protocol');
          bytes = Buffer.concat([bytes, chunk]);
        });
        child.stderr.on('data', (chunk) => {
          stderrBytes += chunk.length;
          poison('cedar-process-failed');
        });
        child.once('close', (code) => {
          exited = true;
          clearTimeout(killTimer);
          const candidate =
            !transcriptInvalid && code === 0 && stderrBytes === 0
              ? receipt(bytes, Object.keys(snapshot.request.policy.policies))
              : null;
          if (!candidate) transcriptInvalid = true;
          if (candidate && active === lifetime) active = null;
          if (invalid) return;
          if (performance.now() >= deadline) return stop('cedar-process-timeout');
          if (!candidate) return stop('cedar-process-unconfirmed');
          settle(candidate.result || deny(candidate.reason));
        });
        if (performance.now() >= deadline) return stop('cedar-process-timeout');
        child.stdin.write(frame); // Keep open until native exit or explicit revocation.
      } catch (_) {
        poison('cedar-process-failed');
        if (!child && active === lifetime) active = null;
      }
    });
  }
  return {
    evaluate,
    close() {
      closed = true;
      active?.stop('cedar-process-cancelled');
    },
  };
}

module.exports = { createCedarProcessClient, privateAdmissionSafe };
