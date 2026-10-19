// @ts-check
'use strict';

const { isMainThread, parentPort, workerData } = require('node:worker_threads');
const { validateExecutionAction } = require('./execution-policy');
const { isProxy } = require('node:util').types;

const LIMITS = Object.freeze({
  policyBytes: 8 * 1024 * 1024,
  actionBytes: 64 * 1024,
  policies: 33,
});
const ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
/** @typedef {{decision: string, reason: string, policyIds: string[]}} Metadata */
/** @typedef {{policy: {schemaVersion: number, cedarSchema: string, policies: Record<string, string>}, action: object}} Request */

/** @param {string} reason @returns {Metadata} */
const deny = (reason) => ({ decision: 'deny', reason, policyIds: [] });

/** Refuse proxies before any reflective inspection can execute their traps.
 * @param {unknown} value @returns {object} */
function dataObject(value) {
  if (!value || typeof value !== 'object') throw Error();
  if (isProxy(value)) throw Error();
  return value;
}

/** Copy a bounded dense array using one own data length and own index data.
 * @param {unknown} value @param {number} maximum @returns {unknown[]} */
function denseArray(value, maximum) {
  const data = dataObject(value);
  if (!Array.isArray(data) || Object.getPrototypeOf(data) !== Array.prototype) throw Error();
  const descriptor = Object.getOwnPropertyDescriptor(data, 'length');
  if (!descriptor || !('value' in descriptor)) throw Error();
  const length = descriptor.value;
  if (
    !Number.isInteger(length) ||
    length < 0 ||
    length > maximum ||
    Reflect.ownKeys(data).length !== length + 1
  )
    throw Error();
  const copy = [];
  for (let index = 0; index < length; index++) {
    const entry = Object.getOwnPropertyDescriptor(data, String(index));
    if (!entry || !('value' in entry)) throw Error();
    copy[index] = entry.value;
  }
  return copy;
}

/** Accept data records without invoking getters, inherited hooks or toJSON.
 * @param {unknown} value @param {number} maximum @returns {Record<string, unknown>} */
function record(value, maximum) {
  const data = dataObject(value);
  const prototype = Object.getPrototypeOf(data);
  if (prototype !== Object.prototype && prototype !== null) throw Error();
  const keys = Reflect.ownKeys(data);
  if (keys.length > maximum) throw Error();
  const copy = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(data, key);
    if (typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor))
      throw Error();
    copy[key] = descriptor.value;
  }
  return copy;
}

/** @param {Record<string, unknown>} value @param {string[]} keys @returns {void} */
function exact(value, keys) {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    throw Error();
}

/** @param {unknown} value @param {number} maximum @returns {string} */
function text(value, maximum) {
  if (typeof value !== 'string' || value.length > maximum || Buffer.byteLength(value) > maximum)
    throw Error();
  return value;
}

/** Snapshot bounded private values before worker cloning; contains no launch authority.
 * @param {unknown} policyInput Schema-4 policy data.
 * @param {unknown} actionInput Exact execution descriptor data.
 * @returns {{ok: true, request: Request} | {ok: false, reason: string}}
 * @since v0.19.2 */
function snapshotRequest(policyInput, actionInput) {
  let action;
  try {
    let actionBytes = 0;
    /** @param {unknown} value @returns {string} */
    const actionText = (value) => {
      const copied = text(value, LIMITS.actionBytes);
      actionBytes += Buffer.byteLength(copied);
      if (actionBytes > LIMITS.actionBytes) throw Error();
      return copied;
    };
    const input = record(actionInput, 4);
    exact(input, ['executable', 'cwd', 'args', 'env']);
    const copiedArgs = denseArray(input.args, 128).map(actionText);
    const env = record(input.env, 64);
    const copiedEnv = Object.fromEntries(
      Object.entries(env).map(([key, value]) => [actionText(key), actionText(value)]),
    );
    action = {
      executable: actionText(input.executable),
      cwd: actionText(input.cwd),
      args: copiedArgs,
      env: copiedEnv,
    };
    if (
      Buffer.byteLength(JSON.stringify(action)) > LIMITS.actionBytes ||
      !validateExecutionAction(action)
    )
      throw Error();
  } catch (_) {
    return { ok: false, reason: 'request-invalid' };
  }
  try {
    const input = record(policyInput, 3);
    exact(input, ['schemaVersion', 'cedarSchema', 'policies']);
    if (input.schemaVersion !== 4 || input.cedarSchema !== 'aegis-execution-v1') throw Error();
    const entries = record(input.policies, LIMITS.policies);
    let bytes = 0;
    const policies = Object.fromEntries(
      Object.entries(entries).map(([id, source]) => {
        if (!ID.test(id)) throw Error();
        const copied = text(source, LIMITS.policyBytes);
        bytes += Buffer.byteLength(copied);
        if (bytes > LIMITS.policyBytes) throw Error();
        return [id, copied];
      }),
    );
    const policy = { schemaVersion: 4, cedarSchema: 'aegis-execution-v1', policies };
    if (Buffer.byteLength(JSON.stringify(policy)) > LIMITS.policyBytes) throw Error();
    return { ok: true, request: { policy, action } };
  } catch (_) {
    return { ok: false, reason: 'policy-invalid' };
  }
}

/** Validate and copy closed metadata, including known, sorted unique policy IDs.
 * @param {unknown} input Candidate worker result.
 * @param {string[]} knownIds IDs admitted with this request.
 * @returns {Metadata|null} Sanitized metadata or invalid protocol.
 * @since v0.19.2 */
function metadataReply(input, knownIds) {
  try {
    const value = record(input, 3);
    exact(value, ['decision', 'reason', 'policyIds']);
    const failures = [
      'request-invalid',
      'policy-invalid',
      'cedar-unavailable',
      'cedar-evaluation-failed',
    ];
    const pairs = {
      allow: ['policy-allow'],
      ask: ['policy-ask', 'review-required'],
      deny: ['policy-deny', ...failures],
    };
    const decision = text(value.decision, 5);
    const reason = text(value.reason, 32);
    if (
      !Object.hasOwn(pairs, decision) ||
      !pairs[/** @type {keyof typeof pairs} */ (decision)].includes(reason)
    )
      return null;
    const policyIds = denseArray(value.policyIds, LIMITS.policies).map((value) => {
      const id = text(value, 64);
      if (!ID.test(id) || !knownIds.includes(id)) throw Error();
      return id;
    });
    if (policyIds.some((id, index) => index > 0 && id <= policyIds[index - 1])) return null;
    if (
      (decision !== 'deny' && !policyIds.length) ||
      (failures.includes(reason) && policyIds.length)
    )
      return null;
    return { decision, reason, policyIds };
  } catch (_) {
    return null;
  }
}

/** Evaluate one private message with the existing official synchronous runtime.
 * @param {unknown} input Untrusted worker data.
 * @returns {Metadata} Closed decision metadata; never diagnostics or a launch descriptor.
 * @since v0.19.2 */
function evaluateRequest(input) {
  try {
    const envelope = record(input, 2);
    exact(envelope, ['policy', 'action']);
    const snapshot = snapshotRequest(envelope.policy, envelope.action);
    if (!snapshot.ok) return deny(snapshot.reason);
    const { policy, action } = snapshot.request;
    const compiled = require('./cedar-runtime').compileCedarPolicy(policy);
    const result =
      compiled.ok && compiled.evaluate
        ? compiled.evaluate(action)
        : deny(compiled.reason === 'policy-invalid' ? 'policy-invalid' : 'cedar-unavailable');
    return metadataReply(result, Object.keys(policy.policies)) || deny('cedar-evaluation-failed');
  } catch (_) {
    return deny('cedar-evaluation-failed');
  }
}

if (!isMainThread && parentPort && require.main === module) {
  // No message listener: exactly one evaluation and one reply per thread.
  parentPort.postMessage(evaluateRequest(workerData));
  parentPort.close();
}

module.exports = { snapshotRequest, metadataReply, evaluateRequest, LIMITS };
