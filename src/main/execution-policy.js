'use strict';

const path = require('node:path');
const {
  matchesExecutionBinding,
  isExecutionBindingActive,
  revokeExecutionBinding,
} = require('./execution-binding');
const { readActionFile, parseActionJson, equalActionValue } = require('./action-policy');
const LIMITS = Object.freeze({ rules: 32, args: 128, env: 64 });
const WINDOWS_DEFAULTS = [
  'HOMEDRIVE',
  'HOMEPATH',
  'LOGONSERVER',
  'PATH',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'USERDOMAIN',
  'USERNAME',
  'USERPROFILE',
  'WINDIR',
];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) =>
  object(value) &&
  Object.keys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key));
const text = (value) => typeof value === 'string' && !value.includes('\0');

// Fully qualified paths only: a Windows root-relative path inherits its drive.
function absolute(value) {
  return (
    text(value) &&
    path.isAbsolute(value) &&
    !/^[\\/]{2}/.test(value) &&
    (process.platform !== 'win32' || (/^[a-z]:[\\/]/i.test(value) && !value.slice(2).includes(':')))
  );
}

/** Validate the legacy exact execution descriptor without normalization.
 * @param {unknown} action Candidate action.
 * @returns {boolean} Whether the whole descriptor is valid.
 * @since v0.19.2 */
function validAction(action) {
  if (
    !keys(action, ['executable', 'cwd', 'args', 'env']) ||
    !absolute(action.executable) ||
    !absolute(action.cwd) ||
    !Array.isArray(action.args) ||
    action.args.length > LIMITS.args ||
    !action.args.every(text) ||
    !object(action.env) ||
    Object.keys(action.env).length > LIMITS.env
  )
    return false;
  const names = new Set();
  for (const [name, value] of Object.entries(action.env)) {
    if (
      (name === 'NODE_V8_COVERAGE' && value !== '') ||
      !/^[A-Z_][A-Z0-9_]*$/.test(name) ||
      !text(value) ||
      names.has(name.toUpperCase())
    )
      return false;
    // Uniform across platforms so the same manifest cannot change env semantics.
    names.add(name.toUpperCase());
  }
  return true;
}

/** Validate the unchanged schema-2/3 policy contract, including duplicates.
 * @param {unknown} policy Candidate policy.
 * @returns {boolean} Whether every rule and review reference is valid.
 * @since v0.19.2 */
function validPolicy(policy) {
  if (
    ![2, 3].includes(policy?.schemaVersion) ||
    !keys(
      policy,
      policy.schemaVersion === 3
        ? ['schemaVersion', 'defaultDecision', 'rules', 'reviewRequired']
        : ['schemaVersion', 'defaultDecision', 'rules'],
    ) ||
    !['deny', 'ask'].includes(policy.defaultDecision) ||
    !Array.isArray(policy.rules) ||
    policy.rules.length > LIMITS.rules
  )
    return false;
  for (let i = 0; i < policy.rules.length; i++) {
    const rule = policy.rules[i];
    if (
      !keys(rule, ['action', 'decision']) ||
      !validAction(rule.action) ||
      !['allow', 'ask', 'deny'].includes(rule.decision) ||
      policy.rules.slice(0, i).some((prior) => equalActionValue(prior.action, rule.action))
    )
      return false;
  }
  if (policy.schemaVersion === 3) {
    if (
      !Array.isArray(policy.reviewRequired) ||
      !policy.reviewRequired.length ||
      policy.reviewRequired.length > LIMITS.rules
    )
      return false;
    for (let i = 0; i < policy.reviewRequired.length; i++) {
      const action = policy.reviewRequired[i];
      if (
        !validAction(action) ||
        policy.reviewRequired.slice(0, i).some((prior) => equalActionValue(prior, action)) ||
        !policy.rules.some(
          (rule) => rule.decision === 'allow' && equalActionValue(rule.action, action),
        )
      )
        return false;
    }
  }
  return true;
}

/** Evaluate the current exact policy contract without file I/O or launch.
 * @param {unknown} policy Schema 2 or 3 policy.
 * @param {unknown} action Exact execution descriptor.
 * @returns {{decision: string, reason: string}} Fixed legacy metadata.
 * @since v0.19.2 */
function evaluateExecutionPolicy(policy, action) {
  if (!validAction(action)) return { decision: 'deny', reason: 'request-invalid' };
  if (!validPolicy(policy)) return { decision: 'deny', reason: 'policy-invalid' };
  const rule = policy.rules.find((candidate) => equalActionValue(candidate.action, action));
  const selected = rule ? rule.decision : policy.defaultDecision;
  const reviewRequired =
    policy.schemaVersion === 3 &&
    policy.reviewRequired.some((candidate) => equalActionValue(candidate, action));
  const decision = reviewRequired && selected === 'allow' ? 'ask' : selected;
  const reason = reviewRequired && selected === 'allow' ? 'review-required' : `policy-${decision}`;
  return { decision, reason };
}

async function selectedJson(filename, check) {
  const bytes = await readActionFile(filename);
  try {
    if (check && !check(bytes)) throw new Error('configuration-changed');
    return parseActionJson(bytes);
  } finally {
    bytes.fill(0);
  }
}

/**
 * Prepare a private direct-execution descriptor from two explicitly selected
 * files. Only the execution owner may consume launch; never serialize it into a
 * report. A matching rule binds strings, not executable bytes or filesystem state.
 * @param {string} policyPath Schema 2/3 exact policy or explicit schema 4 Cedar policy.
 * @param {string} requestPath Schema 1 direct execution request.
 * @param {{binding?: object, review?: boolean}} [options] Binding and trusted private-review mode.
 * @returns {Promise<object>} Fixed decision and optional private launch descriptor.
 * @since v0.15.1
 */
async function prepareExecution(policyPath, requestPath, options = {}) {
  const pinned = Object.hasOwn(options, 'binding');
  const binding = options.binding;
  const review = options.review === true;
  if (pinned && !isExecutionBindingActive(binding, policyPath, requestPath))
    return { decision: 'deny', reason: 'configuration-changed' };
  const check = (kind) =>
    pinned
      ? (bytes) => matchesExecutionBinding(binding, policyPath, requestPath, kind, bytes)
      : undefined;
  let request;
  let policy;
  let cedar;
  try {
    request = await selectedJson(requestPath, check('request'));
    if (
      !keys(request, ['schemaVersion', 'action']) ||
      request.schemaVersion !== 1 ||
      !validAction(request.action)
    )
      return { decision: 'deny', reason: 'request-invalid' };
    policy = await selectedJson(policyPath, check('policy'));
    if (policy?.schemaVersion === 4) {
      cedar = require('./cedar-runtime').compileCedarPolicy(policy);
      if (!cedar.ok) return { decision: 'deny', reason: cedar.reason };
    } else if (!validPolicy(policy)) return { decision: 'deny', reason: 'policy-invalid' };
  } catch (error) {
    if (pinned) {
      revokeExecutionBinding(binding);
      return {
        decision: 'deny',
        reason:
          error.message === 'configuration-changed'
            ? 'configuration-changed'
            : 'configuration-unavailable',
      };
    }
    return { decision: 'deny', reason: 'input-unavailable' };
  }
  const result = cedar
    ? cedar.evaluate(request.action)
    : evaluateExecutionPolicy(policy, request.action);
  const { decision } = result;
  if (decision !== 'allow' && !(review && decision === 'ask')) return result;
  // Node/libuv otherwise silently copy these names from the parent's environment.
  const env = Object.create(null);
  for (const name of process.platform === 'win32' ? WINDOWS_DEFAULTS : []) env[name] = '';
  env.NODE_V8_COVERAGE = '';
  for (const [name, value] of Object.entries(request.action.env)) env[name] = value;
  return { ...result, launch: { ...request.action, env } };
}

module.exports = {
  prepareExecution,
  LIMITS,
  evaluateExecutionPolicy,
  validateExecutionAction: validAction,
  validateExecutionPolicy: validPolicy,
};
