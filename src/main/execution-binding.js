'use strict';

const path = require('node:path');
const { randomBytes, createHmac, timingSafeEqual } = require('node:crypto');
const { readActionFile, parseActionJson } = require('./action-policy');
const LIMITS = Object.freeze({ captureMs: 1500 });
const bindings = new WeakMap();
let testDeps = null;
const mac = (key, kind, bytes) => createHmac('sha256', key).update(kind).update(bytes).digest();

/**
 * Revoke an in-process configuration capability. No serialized identifier can
 * recover it. Revocation does not cancel an already executing child.
 * @param {object} binding Opaque capability from capture.
 * @returns {void}
 * @since v0.15.1
 */
function revokeExecutionBinding(binding) {
  const entry = bindings.get(binding);
  if (!entry || entry.revoked) return;
  entry.revoked = true;
  entry.key.fill(0);
  entry.request.fill(0);
  entry.policy.fill(0);
  entry.policyPath = null;
  entry.requestPath = null;
}

/**
 * Bind the exact bytes of two readable bounded JSON files without retaining raw
 * action data or exposing a digest. This observes configuration, not approval.
 * @param {string} policyPath Selected policy file.
 * @param {string} requestPath Selected request file.
 * @param {{signal?: AbortSignal}} [options] Owning connection cancellation.
 * @returns {Promise<object>} Nonserializable in-process capability.
 * @since v0.15.1
 */
async function captureExecutionBinding(policyPath, requestPath, { signal } = {}) {
  if (signal?.aborted) throw new Error('binding-unavailable');
  const read = testDeps?.read || readActionFile;
  const now = testDeps?.now || (() => performance.now());
  const started = now();
  const buffers = [];
  let cancelled = false;
  let finished = false;
  let timer;
  let abort;
  let createdBinding;
  const clearBuffers = () => {
    for (const buffer of buffers) buffer.fill(0);
  };
  const selected = async (filename) => {
    const buffer = await read(filename);
    if (!Buffer.isBuffer(buffer)) throw new Error('binding-unavailable');
    if (cancelled || finished) {
      buffer.fill(0);
      throw new Error('binding-unavailable');
    }
    buffers.push(buffer);
    parseActionJson(buffer);
    return buffer;
  };
  try {
    return await Promise.race([
      (async () => {
        const [policy, request] = await Promise.all([selected(policyPath), selected(requestPath)]);
        if (cancelled || signal?.aborted || now() - started >= LIMITS.captureMs)
          throw new Error('binding-unavailable');
        const key = randomBytes(32);
        const binding = Object.freeze({});
        bindings.set(binding, {
          key,
          policy: mac(key, 'policy', policy),
          request: mac(key, 'request', request),
          policyPath: path.resolve(policyPath),
          requestPath: path.resolve(requestPath),
          revoked: false,
        });
        createdBinding = binding;
        return binding;
      })().finally(() => {
        finished = true;
        clearBuffers();
      }),
      new Promise((_resolve, reject) => {
        abort = () => {
          cancelled = true;
          clearBuffers();
          reject(new Error('binding-unavailable'));
        };
        timer = setTimeout(abort, LIMITS.captureMs);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      }),
    ]);
  } catch {
    revokeExecutionBinding(createdBinding);
    throw new Error('binding-unavailable');
  } finally {
    cancelled = true;
    clearBuffers();
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/**
 * Check capability liveness immediately before a launch, without rereading files.
 * @param {object} binding Opaque capability.
 * @param {string} policyPath Bound policy path.
 * @param {string} requestPath Bound request path.
 * @returns {boolean} Whether this exact scope is still live.
 * @since v0.15.1
 */
function isExecutionBindingActive(binding, policyPath, requestPath) {
  const entry = bindings.get(binding);
  if (!entry || entry.revoked) return false;
  try {
    if (
      entry.policyPath === path.resolve(policyPath) &&
      entry.requestPath === path.resolve(requestPath)
    )
      return true;
  } catch {
    /* Invalid paths cannot authorize a binding. */
  }
  revokeExecutionBinding(binding);
  return false;
}

/**
 * Compare the same bounded bytes that the evaluator will parse. A mismatch or
 * invalid capability permanently refuses this scope, even if files are restored.
 * @param {object} binding Opaque capability.
 * @param {string} policyPath Current selected policy path.
 * @param {string} requestPath Current selected request path.
 * @param {'policy'|'request'} kind Which read is being checked.
 * @param {Buffer} bytes Exact private read used for subsequent parsing.
 * @returns {boolean} Whether the live capability matches this read.
 * @since v0.15.1
 */
function matchesExecutionBinding(binding, policyPath, requestPath, kind, bytes) {
  const entry = bindings.get(binding);
  if (!entry || entry.revoked) return false;
  let matches = false;
  try {
    if (
      ['policy', 'request'].includes(kind) &&
      Buffer.isBuffer(bytes) &&
      entry.policyPath === path.resolve(policyPath) &&
      entry.requestPath === path.resolve(requestPath)
    ) {
      const actual = mac(entry.key, kind, bytes);
      try {
        matches = timingSafeEqual(actual, entry[kind]);
      } finally {
        actual.fill(0);
      }
    }
  } catch {
    /* Fail closed without exporting paths or hash material. */
  }
  if (!matches) revokeExecutionBinding(binding);
  return matches;
}

/** @param {object} deps Trusted test reader/clock. @returns {void} @since v0.15.1 */
function _setDepsForTest(deps) {
  testDeps = deps;
}
/** @returns {void} @since v0.15.1 */
function _resetForTest() {
  testDeps = null;
}
module.exports = {
  captureExecutionBinding,
  matchesExecutionBinding,
  isExecutionBindingActive,
  revokeExecutionBinding,
  LIMITS,
  _setDepsForTest,
  _resetForTest,
};
