import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const runtime = require('../../src/main/cedar-runtime');
const official = require('@cedar-policy/cedar-wasm/nodejs');
const { SCHEMA_ID } = require('../../src/main/cedar-schema');
const action = {
  executable: process.execPath,
  cwd: process.cwd(),
  args: ['PRIVATE_ARG'],
  env: { SECRET: 'PRIVATE_VALUE' },
};
const policy = (policies) => ({ schemaVersion: 4, cedarSchema: SCHEMA_ID, policies });
const permit = 'permit(principal, action == AEGIS::Action::"exec", resource);';
const metadata = (result) => ({ decision: result.decision, reason: result.reason });
afterEach(() => runtime._resetForTest());

describe('Cedar native decisions and provenance boundary', () => {
  it('uses official WASM, fixed schema, explicit IDs and forbid precedence', () => {
    expect(official.getCedarVersion()).toBe('4.14.0');
    const compiled = runtime.compileCedarPolicy(
      policy({ allow: permit, deny: 'forbid(principal, action, resource);' }),
    );
    expect(compiled.ok).toBe(true);
    expect(compiled.evaluate(action)).toEqual({
      decision: 'deny',
      reason: 'policy-deny',
      policyIds: ['deny'],
    });
    expect(runtime.compileCedarPolicy(policy({ allow: permit })).evaluate(action)).toEqual({
      decision: 'allow',
      reason: 'policy-allow',
      policyIds: ['allow'],
    });
    expect(runtime.compileCedarPolicy(policy({})).evaluate(action)).toEqual({
      decision: 'deny',
      reason: 'policy-deny',
      policyIds: [],
    });
  });

  it('keeps ask/review conservative across simultaneous permits, independent of map order', () => {
    for (const entries of [
      [
        ['allow', permit],
        ['ask', '@decision("ask") ' + permit],
      ],
      [
        ['ask', '@decision("ask") ' + permit],
        ['allow', permit],
      ],
    ]) {
      const compiled = runtime.compileCedarPolicy(policy(Object.fromEntries(entries)));
      expect(compiled.evaluate(action)).toEqual({
        decision: 'ask',
        reason: 'policy-ask',
        policyIds: ['allow', 'ask'],
      });
    }
    const compiled = runtime.compileCedarPolicy(
      policy({ plain: permit, review: '@reviewRequired("true") ' + permit }),
    );
    expect(compiled.evaluate(action)).toEqual({
      decision: 'ask',
      reason: 'review-required',
      policyIds: ['plain', 'review'],
    });
  });

  it('rejects authority fields, other routes, schema substitutions and unsafe annotations before evaluation', () => {
    for (const candidate of [
      { ...policy({ allow: permit }), principal: 'verified' },
      { ...policy({ allow: permit }), sensorHealth: 'healthy' },
      { ...policy({ allow: permit }), route: 'delete_file' },
      { ...policy({ allow: permit }), cedarSchema: {} },
      policy({
        allow: 'permit(principal, action, resource) when { context.sensorHealth == "healthy" };',
      }),
      policy({ allow: 'permit(principal, action == AEGIS::Action::"mcp_call", resource);' }),
      policy({ allow: '@decision("deny") ' + permit }),
      policy({ allow: '@reviewRequired("false") ' + permit }),
      policy({ allow: '@unknown("PRIVATE") ' + permit }),
      policy({ deny: '@decision("ask") forbid(principal, action, resource);' }),
      policy({ 'invalid id PRIVATE': permit }),
      policy({ allow: 'PRIVATE_MALFORMED' }),
      policy({ allow: null }),
      null,
    ])
      expect(runtime.compileCedarPolicy(candidate)).toEqual({
        ok: false,
        reason: 'policy-invalid',
      });
    const compiled = runtime.compileCedarPolicy(policy({ allow: permit }));
    expect(compiled.evaluate({ ...action, principal: 'verified' })).toEqual({
      decision: 'deny',
      reason: 'request-invalid',
      policyIds: [],
    });
  });

  it('rejects oversized sources, excess policies and overlong IDs before loading WASM', () => {
    let loads = 0;
    runtime._setDepsForTest({
      load: () => {
        loads++;
        return official;
      },
    });
    const policies = (count) =>
      Object.fromEntries(Array.from({ length: count }, (_, index) => ['policy_' + index, permit]));
    for (const candidate of [
      policy(policies(34)),
      policy({ ['a'.repeat(65)]: permit }),
      policy({ excessive: 'x'.repeat(8 * 1024 * 1024) }),
      { ...policy({ allow: permit }), policies: [] },
      { ...policy({ allow: permit }), schemaVersion: '4' },
    ])
      expect(runtime.compileCedarPolicy(candidate)).toEqual({
        ok: false,
        reason: 'policy-invalid',
      });
    expect(loads).toBe(0);
    expect(runtime.compileCedarPolicy(policy(policies(33))).ok).toBe(true);
    expect(runtime.compileCedarPolicy(policy({ ['a'.repeat(64)]: permit })).ok).toBe(true);
    expect(loads).toBe(1);
  });

  it('snapshots inputs and replaces the single official cache slot when evaluators alternate', () => {
    const input = policy({ allow: permit });
    const allow = runtime.compileCedarPolicy(input);
    input.policies.allow = 'forbid(principal, action, resource);';
    const deny = runtime.compileCedarPolicy(input);
    for (const compiled of [allow, deny, allow])
      expect(compiled.evaluate(action).decision).toBe(compiled === deny ? 'deny' : 'allow');
    expect(JSON.stringify(allow)).not.toContain('PRIVATE');
  });
});

describe('Cedar runtime faults fail closed with redacted diagnostics', () => {
  it('makes one lazy initialization attempt and denies a missing/wrong runtime', () => {
    let calls = 0;
    runtime._setDepsForTest({
      load() {
        calls++;
        throw Error('PRIVATE_RUNTIME_PATH');
      },
    });
    for (let index = 0; index < 2; index++)
      expect(runtime.compileCedarPolicy(policy({ allow: permit }))).toEqual({
        ok: false,
        reason: 'cedar-unavailable',
      });
    expect(calls).toBe(1);
    for (const version of [
      '0.0.0',
      '4.13.0',
      '4.14.1',
      '4.14.0-rc.1',
      '4.14.0+unreviewed',
      '5.0.0',
      undefined,
    ]) {
      let parsed = false;
      runtime._setDepsForTest({
        load: () => ({
          ...official,
          getCedarVersion: () => version,
          policyToJson() {
            parsed = true;
            throw Error('UNQUALIFIED_RUNTIME_USED');
          },
        }),
      });
      expect(runtime.compileCedarPolicy(policy({ allow: permit }))).toEqual({
        ok: false,
        reason: 'cedar-unavailable',
      });
      expect(parsed).toBe(false);
    }
  });

  it('denies parser/validator and cache failures without exposing engine errors', () => {
    for (const fault of [
      {
        policyToJson: () => {
          throw Error('PRIVATE_SOURCE');
        },
      },
      { validate: () => ({ type: 'failure', errors: ['PRIVATE_SOURCE'] }) },
    ]) {
      runtime._setDepsForTest({ load: () => ({ ...official, ...fault }) });
      expect(runtime.compileCedarPolicy(policy({ allow: permit }))).toEqual({
        ok: false,
        reason: 'policy-invalid',
      });
    }
    runtime._setDepsForTest({
      load: () => ({
        ...official,
        preparsePolicySet: () => ({ type: 'failure', errors: ['PRIVATE_SOURCE'] }),
      }),
    });
    expect(runtime.compileCedarPolicy(policy({ allow: permit })).evaluate(action)).toEqual({
      decision: 'deny',
      reason: 'cedar-unavailable',
      policyIds: [],
    });
  });

  it('denies partial errors, unknown decision IDs, malformed responses and exceptions', () => {
    const success = (decision, reason = ['allow'], errors = []) => ({
      type: 'success',
      warnings: [],
      response: { decision, diagnostics: { reason, errors } },
    });
    for (const value of [
      { type: 'failure', errors: ['PRIVATE_SOURCE'] },
      success('allow', ['allow'], [{ policyId: 'allow', error: 'PRIVATE_SOURCE' }]),
      success('allow', ['PRIVATE_SOURCE']),
      success('unknown'),
      success('allow', []),
      {},
    ]) {
      runtime._setDepsForTest({ load: () => ({ ...official, statefulIsAuthorized: () => value }) });
      const result = runtime.compileCedarPolicy(policy({ allow: permit })).evaluate(action);
      expect(metadata(result)).toEqual({ decision: 'deny', reason: 'cedar-evaluation-failed' });
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
    }
    runtime._setDepsForTest({
      load: () => ({
        ...official,
        statefulIsAuthorized: () => {
          throw Error('PRIVATE_SOURCE');
        },
      }),
    });
    expect(runtime.compileCedarPolicy(policy({ allow: permit })).evaluate(action)).toEqual({
      decision: 'deny',
      reason: 'cedar-evaluation-failed',
      policyIds: [],
    });
  });
});
