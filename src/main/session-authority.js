'use strict';

const { createHash, randomBytes } = require('node:crypto');
const ID = /^[a-f0-9]{32}$/;
const HASH = /^[a-f0-9]{64}$/;
const OPERATION = /^[a-z][a-z0-9.-]{1,31}$/;
const LIMITS = Object.freeze({ issued: 128, ttlMs: 60000, bytes: 65536 });
let testDeps = null;

function exact(value, fields) {
  return (
    value &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === fields.length &&
    fields.every(
      (key) => Object.hasOwn(value, key) && 'value' in Object.getOwnPropertyDescriptor(value, key),
    )
  );
}

/** Hash bounded owned request/snapshot bytes without retaining their contents.
 * @param {Buffer} bytes Exact byte representation.
 * @returns {string} SHA-256 binding. @since v0.17.0 */
function digestSessionBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > LIMITS.bytes) throw Error('session-input-invalid');
  return createHash('sha256').update(bytes).digest('hex');
}

/** Validate the canonical private owner binding persisted by the ledger.
 * @param {object} value Trusted binding candidate.
 * @returns {boolean} Whether the closed shape and scalar bounds hold. @since v0.17.0 */
function validOperationBinding(value) {
  return Boolean(
    exact(value, [
      'sessionId',
      'epoch',
      'policyRevision',
      'operationId',
      'operation',
      'requestDigest',
      'snapshotDigest',
      'nonce',
      'expiresAt',
    ]) &&
    ['sessionId', 'epoch', 'operationId', 'nonce'].every(
      (key) => typeof value[key] === 'string' && ID.test(value[key]),
    ) &&
    ['policyRevision', 'requestDigest', 'snapshotDigest'].every(
      (key) => typeof value[key] === 'string' && HASH.test(value[key]),
    ) &&
    typeof value.operation === 'string' &&
    OPERATION.test(value.operation) &&
    Number.isSafeInteger(value.expiresAt) &&
    value.expiresAt >= 0,
  );
}

/** Create an authority only inside a trusted owner, after that owner admits its context.
 * This validates syntax, not OS ownership or native protection. Never expose this factory
 * or issuer over IPC. A restart creates a distinct WeakMap and rejects old capabilities.
 * Policy outcomes come from the existing evaluator; this module adds no policy rules.
 * @param {{sessionId: string, epoch: string, policyRevision: string}} context Owner-selected scope.
 * @param {{operations: string[]}} options Fixed operation allowlist.
 * @returns {object} Private issuer/reservation/revocation interface. @since v0.17.0 */
function createSessionAuthority(context, { operations }) {
  if (
    !exact(context, ['sessionId', 'epoch', 'policyRevision']) ||
    !['sessionId', 'epoch'].every(
      (key) => typeof context[key] === 'string' && ID.test(context[key]),
    ) ||
    typeof context.policyRevision !== 'string' ||
    !HASH.test(context.policyRevision) ||
    !Array.isArray(operations) ||
    !operations.length ||
    operations.length > 16 ||
    new Set(operations).size !== operations.length ||
    !operations.every((operation) => typeof operation === 'string' && OPERATION.test(operation))
  )
    throw Error('session-context-invalid');
  const scope = Object.freeze({ ...context });
  const allowed = new Set(operations);
  const entries = new WeakMap();
  const live = new Set();
  const now = testDeps?.now || Date.now;
  let issued = 0;
  let revoked = false;
  const invalidate = (entry) => {
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.state = 'spent';
    entry.controller.abort();
    live.delete(entry);
  };
  const active = (entry) => {
    if (!entry || revoked || entry.controller.signal.aborted || now() >= entry.binding.expiresAt) {
      invalidate(entry);
      return false;
    }
    return entry.state !== 'spent';
  };
  return Object.freeze({
    scope,
    issue(request, policyOutcome, { approved = false } = {}) {
      if (
        revoked ||
        issued >= LIMITS.issued ||
        !exact(request, [
          'operationId',
          'operation',
          'requestDigest',
          'snapshotDigest',
          'expiresAt',
        ]) ||
        !['allow', 'ask'].includes(policyOutcome?.decision) ||
        (policyOutcome.decision === 'ask' && approved !== true) ||
        !allowed.has(request.operation) ||
        !Number.isSafeInteger(request.expiresAt) ||
        request.expiresAt <= now() ||
        request.expiresAt - now() > LIMITS.ttlMs
      )
        throw Error('session-capability-unavailable');
      const binding = Object.freeze({
        ...scope,
        ...request,
        nonce: randomBytes(16).toString('hex'),
      });
      if (!validOperationBinding(binding)) throw Error('session-capability-unavailable');
      const capability = Object.freeze({});
      const entry = { binding, state: 'issued', controller: new AbortController(), timer: null };
      entry.timer = setTimeout(() => invalidate(entry), Math.max(0, binding.expiresAt - now()));
      entry.timer.unref?.();
      issued++;
      entries.set(capability, entry);
      live.add(entry);
      return capability;
    },
    reserve(capability, expected) {
      const entry = entries.get(capability);
      if (!active(entry) || entry.state !== 'issued') throw Error('session-capability-unavailable');
      if (
        !exact(expected, ['operationId', 'operation', 'requestDigest', 'snapshotDigest']) ||
        !Object.keys(expected).every((key) => expected[key] === entry.binding[key])
      ) {
        invalidate(entry);
        throw Error('session-capability-unavailable');
      }
      entry.state = 'reserved';
      return entry.binding;
    },
    reserved(capability) {
      const entry = entries.get(capability);
      return active(entry) && entry.state === 'reserved';
    },
    signal(capability) {
      const entry = entries.get(capability);
      if (!entry) throw Error('session-capability-unavailable');
      return entry.controller.signal;
    },
    cancel(capability) {
      invalidate(entries.get(capability));
    },
    finish(capability) {
      invalidate(entries.get(capability));
    },
    revoke() {
      revoked = true;
      for (const entry of live) invalidate(entry);
    },
  });
}

/** @param {object} deps Trusted clock seam. @returns {void} @since v0.17.0 */
function _setDepsForTest(deps) {
  testDeps = deps;
}
/** @returns {void} @since v0.17.0 */
function _resetForTest() {
  testDeps = null;
}

module.exports = {
  createSessionAuthority,
  digestSessionBytes,
  validOperationBinding,
  LIMITS,
  _setDepsForTest,
  _resetForTest,
};
