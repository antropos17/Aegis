'use strict';

const { SCHEMA_ID, executionAttributes } = require('./cedar-schema');
const { validateExecutionPolicy } = require('./execution-policy');
const { equalActionValue, parseActionJson } = require('./action-policy');

function predicate(action) {
  return Object.entries(executionAttributes(action))
    .map(([key, value]) => `resource.${key} == ${JSON.stringify(value)}`)
    .join(' && ');
}

/**
 * Translate a valid schema-3 exact execution policy with explicit first-match
 * exclusions and a default that excludes every rule. No existing file is changed.
 * @param {unknown} input Private schema-3 policy.
 * @returns {{ok: boolean, reason?: string, policy?: object}} Explicit schema-4 policy.
 * @since v0.19.2
 */
function translateSchema3Policy(input) {
  let policy;
  try {
    const bytes = Buffer.from(JSON.stringify(input));
    try {
      policy = parseActionJson(bytes);
    } finally {
      bytes.fill(0);
    }
  } catch (_) {
    return { ok: false, reason: 'policy-invalid' };
  }
  if (policy?.schemaVersion !== 3 || !validateExecutionPolicy(policy))
    return { ok: false, reason: 'policy-invalid' };
  const policies = Object.create(null);
  const earlier = [];
  for (const [index, rule] of policy.rules.entries()) {
    const match = predicate(rule.action);
    const excluded = earlier.length ? ` && !(${earlier.join(' || ')})` : '';
    const review = policy.reviewRequired.some((action) => equalActionValue(action, rule.action));
    const annotation = review
      ? '@reviewRequired("true") '
      : rule.decision === 'ask'
        ? '@decision("ask") '
        : '';
    policies[`rule_${index}`] =
      `${annotation}${rule.decision === 'deny' ? 'forbid' : 'permit'}(principal, action == AEGIS::Action::"exec", resource) when { (${match})${excluded} };`;
    earlier.push(`(${match})`);
  }
  const condition = earlier.length ? `!(${earlier.join(' || ')})` : 'true';
  policies.default = `${policy.defaultDecision === 'ask' ? '@decision("ask") ' : ''}${policy.defaultDecision === 'deny' ? 'forbid' : 'permit'}(principal, action == AEGIS::Action::"exec", resource) when { ${condition} };`;
  return { ok: true, policy: { schemaVersion: 4, cedarSchema: SCHEMA_ID, policies } };
}

module.exports = { translateSchema3Policy };
