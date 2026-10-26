'use strict';

const { SCHEMA, SCHEMA_ID, executionAttributes } = require('./cedar-schema');
const LIMITS = Object.freeze({ policies: 33, sourceBytes: 8 * 1024 * 1024 });
let testDeps = null;
let runtime;
let attempted = false;
let active = null;
const deny = (reason) => ({ decision: 'deny', reason, policyIds: [] });
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const uid = (type, id) => ({ type: `AEGIS::${type}`, id });

function engine() {
  if (!attempted) {
    attempted = true;
    try {
      const candidate = testDeps?.load
        ? testDeps.load()
        : require('@cedar-policy/cedar-wasm/nodejs');
      if (candidate.getCedarVersion() !== '4.14.0') return undefined;
      runtime = candidate;
    } catch (_) {
      runtime = undefined;
    }
  }
  return runtime;
}

function envelope(policy) {
  return (
    object(policy) &&
    Object.keys(policy).length === 3 &&
    policy.schemaVersion === 4 &&
    policy.cedarSchema === SCHEMA_ID &&
    object(policy.policies) &&
    Object.keys(policy.policies).length <= LIMITS.policies &&
    Object.entries(policy.policies).every(
      ([id, source]) => /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(id) && typeof source === 'string',
    )
  );
}

/**
 * Validate and privately compile one selected schema-4 execution policy.
 * Initialization, parsing, validation and evaluation failures deny with fixed codes.
 * @param {unknown} input Private schema-4 policy; selected files additionally use the existing JSON limits.
 * @returns {{ok: boolean, reason?: string, evaluate?: function(object): object}} Opaque evaluator.
 * @since v0.19.2
 */
function compileCedarPolicy(input) {
  let policy;
  try {
    const json = JSON.stringify(input);
    if (Buffer.byteLength(json) > LIMITS.sourceBytes)
      return { ok: false, reason: 'policy-invalid' };
    policy = JSON.parse(json);
    if (
      !envelope(policy) ||
      Object.values(policy.policies).reduce((sum, source) => sum + Buffer.byteLength(source), 0) >
        LIMITS.sourceBytes
    )
      return { ok: false, reason: 'policy-invalid' };
  } catch (_) {
    return { ok: false, reason: 'policy-invalid' };
  }
  const cedar = engine();
  if (!cedar) return { ok: false, reason: 'cedar-unavailable' };
  const policies = { staticPolicies: policy.policies };
  const annotations = new Map();
  try {
    for (const [id, source] of Object.entries(policy.policies)) {
      const parsed = cedar.policyToJson(source);
      if (parsed.type !== 'success') return { ok: false, reason: 'policy-invalid' };
      const meta = parsed.json.annotations || {};
      if (
        Object.keys(meta).some((key) => !['decision', 'reviewRequired'].includes(key)) ||
        (Object.hasOwn(meta, 'decision') && !['allow', 'ask'].includes(meta.decision)) ||
        (Object.hasOwn(meta, 'reviewRequired') && meta.reviewRequired !== 'true') ||
        (parsed.json.effect === 'forbid' && Object.keys(meta).length)
      )
        return { ok: false, reason: 'policy-invalid' };
      annotations.set(id, {
        effect: parsed.json.effect,
        ask: meta.decision === 'ask',
        review: meta.reviewRequired === 'true',
      });
    }
    const validated = cedar.validate({
      schema: SCHEMA,
      policies,
      validationSettings: { mode: 'strict' },
    });
    if (
      validated.type !== 'success' ||
      validated.validationErrors.length ||
      validated.validationWarnings.length ||
      validated.otherWarnings.length
    )
      return { ok: false, reason: 'policy-invalid' };
  } catch (_) {
    return { ok: false, reason: 'policy-invalid' };
  }
  // The official WASM cache has no deletion API. Reuse one fixed slot instead
  // of accumulating a new native cache entry for every policy or request.
  const compiled = { policies, annotations };
  return {
    ok: true,
    evaluate(action) {
      if (!require('./execution-policy').validateExecutionAction(action))
        return deny('request-invalid');
      try {
        if (active !== compiled) {
          active = null;
          if (
            cedar.preparseSchema(SCHEMA_ID, SCHEMA).type !== 'success' ||
            cedar.preparsePolicySet(SCHEMA_ID, policies).type !== 'success'
          )
            return deny('cedar-unavailable');
          active = compiled;
        }
        const attributes = executionAttributes(action);
        const result = cedar.statefulIsAuthorized({
          principal: uid('UnboundAgent', 'unbound'),
          action: uid('Action', 'exec'),
          resource: uid('Execution', 'selected'),
          context: {},
          preparsedSchemaName: SCHEMA_ID,
          preparsedPolicySetId: SCHEMA_ID,
          validateRequest: true,
          entities: [{ uid: uid('Execution', 'selected'), attrs: attributes, parents: [] }],
        });
        if (
          result.type !== 'success' ||
          result.warnings.length ||
          result.response.diagnostics.errors.length
        )
          return deny('cedar-evaluation-failed');
        const policyIds = [...result.response.diagnostics.reason].sort();
        if (policyIds.some((id) => !annotations.has(id))) return deny('cedar-evaluation-failed');
        if (result.response.decision === 'deny')
          return { decision: 'deny', reason: 'policy-deny', policyIds };
        if (
          result.response.decision !== 'allow' ||
          !policyIds.length ||
          policyIds.some((id) => annotations.get(id).effect !== 'permit')
        )
          return deny('cedar-evaluation-failed');
        const reviewRequired = policyIds.some((id) => annotations.get(id).review);
        const ask = reviewRequired || policyIds.some((id) => annotations.get(id).ask);
        return {
          decision: ask ? 'ask' : 'allow',
          reason: reviewRequired ? 'review-required' : `policy-${ask ? 'ask' : 'allow'}`,
          policyIds,
        };
      } catch (_) {
        active = null;
        return deny('cedar-evaluation-failed');
      }
    },
  };
}

/**
 * Replace the runtime loader for isolated failure-path tests.
 * @param {object|null} deps Test-only loader.
 * @returns {void}
 * @since v0.19.2
 */
function _setDepsForTest(deps) {
  testDeps = deps;
  runtime = undefined;
  attempted = false;
  active = null;
}

/**
 * Restore the official loader and discard private active-policy references.
 * @returns {void}
 * @since v0.19.2
 */
function _resetForTest() {
  _setDepsForTest(null);
}

module.exports = { compileCedarPolicy, LIMITS, _setDepsForTest, _resetForTest };
