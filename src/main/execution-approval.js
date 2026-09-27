'use strict';

const LIMITS = Object.freeze({ ttlMs: 5000 });
const approvals = new WeakMap();
let testDeps = null;

/**
 * Mint one private launch-attempt grant after the owner obtains approval.
 * The executor independently verifies that binding is a live configuration
 * capability; this module binds object identity and never serializes authority.
 * @param {object} binding Owner-selected configuration capability.
 * @param {object|null} [input] Frozen exact-file snapshot for one import route.
 * @returns {object} Frozen opaque grant valid for at most five seconds.
 * @since v0.15.1
 */
function createExecutionApproval(binding, input = null) {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding))
    throw new Error('approval-unavailable');
  const now = testDeps?.now || (() => performance.now());
  const approval = Object.freeze({});
  approvals.set(approval, { binding, input, expiresAt: now() + LIMITS.ttlMs, now, active: true });
  return approval;
}

/**
 * Revoke a grant and release its binding reference.
 * @param {object} approval Opaque grant, or an unrecognized value.
 * @returns {void}
 * @since v0.15.1
 */
function revokeExecutionApproval(approval) {
  const entry = approvals.get(approval);
  if (entry) {
    entry.active = false;
    entry.binding = null;
  }
}

/**
 * Check grant identity, binding identity and monotonic expiry without consuming.
 * @param {object} approval Exact private grant object.
 * @param {object} binding Exact configuration capability object.
 * @param {object|null} [input] Exact approved import descriptor identity.
 * @returns {boolean} Whether one launch attempt remains within the deadline.
 * @since v0.15.1
 */
function isExecutionApprovalActive(approval, binding, input = null) {
  const entry = approvals.get(approval);
  if (!entry || !entry.active) return false;
  if (entry.now() >= entry.expiresAt) {
    revokeExecutionApproval(approval);
    return false;
  }
  return entry.binding === binding && entry.input === input;
}

/**
 * Atomically consume the grant immediately before the owning runner spawns.
 * @param {object} approval Exact private grant object.
 * @param {object} binding Exact independently verified configuration capability.
 * @param {object|null} [input] Exact approved import descriptor identity.
 * @returns {boolean} Whether this caller consumed the sole launch attempt.
 * @since v0.15.1
 */
function consumeExecutionApproval(approval, binding, input = null) {
  if (!isExecutionApprovalActive(approval, binding, input)) return false;
  revokeExecutionApproval(approval);
  return true;
}

/** @param {object} deps Trusted test monotonic clock. @returns {void} @since v0.15.1 */
function _setDepsForTest(deps) {
  testDeps = deps;
}
/** @returns {void} @since v0.15.1 */
function _resetForTest() {
  testDeps = null;
}
module.exports = {
  createExecutionApproval,
  isExecutionApprovalActive,
  consumeExecutionApproval,
  revokeExecutionApproval,
  LIMITS,
  _setDepsForTest,
  _resetForTest,
};
