import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { createSelection } = require('../fixtures/policy-characterization/selection.cjs');
const { prepareExecution } = require('../../src/main/execution-policy');
const {
  captureExecutionBinding,
  revokeExecutionBinding,
} = require('../../src/main/execution-binding');
const { translateSchema3Policy } = require('../../src/main/cedar-translator');
const runtime = require('../../src/main/cedar-runtime');
let fixture;
beforeEach(() => {
  fixture = createSelection();
});
afterEach(() => {
  fixture.cleanup();
  runtime._resetForTest();
});
const metadata = ({ decision, reason }) => ({ decision, reason });
async function selected(policy, action = fixture.action, options) {
  fixture.write(policy, { schemaVersion: 1, action });
  return prepareExecution(fixture.policyPath, fixture.requestPath, options);
}
const legacy = (rules, defaultDecision = 'deny', reviewRequired = [fixture.action]) => ({
  schemaVersion: 3,
  rules,
  reviewRequired,
  defaultDecision,
});

describe('Cedar selected execution route preserves preparation boundaries', () => {
  it('matches schema-3 decision/reason/classification and actual launch metadata for both rule orders/defaults/review modes', async () => {
    const actions = ['review', 'plain', 'ask', 'deny'].map((label) => ({
      ...fixture.action,
      args: [label],
    }));
    const entries = actions.map((action, index) => ({
      action,
      decision: ['allow', 'allow', 'ask', 'deny'][index],
    }));
    for (const rules of [entries, [...entries].reverse()])
      for (const defaultDecision of ['ask', 'deny']) {
        const policy = legacy(rules, defaultDecision, [actions[0]]);
        const translated = translateSchema3Policy(policy);
        expect(translated.ok).toBe(true);
        for (const action of [...actions, { ...fixture.action, args: ['default'] }])
          for (const review of [false, true, 'true']) {
            const old = await selected(policy, action, { review });
            const cedar = await selected(translated.policy, action, { review });
            expect(metadata(cedar)).toEqual(metadata(old));
            expect(cedar.launch).toEqual(old.launch);
            expect(Boolean(cedar.launch)).toBe(
              cedar.decision === 'allow' || (review === true && cedar.decision === 'ask'),
            );
            expect(cedar.policyIds).toHaveLength(1);
            if (cedar.launch) expect(cedar.launch.env.NODE_V8_COVERAGE).toBe('');
          }
      }
  });

  it('keeps request validation ahead of policy parsing and malformed/unavailable reasons unchanged', async () => {
    const policy = translateSchema3Policy(
      legacy([{ action: fixture.action, decision: 'allow' }]),
    ).policy;
    expect(await selected(policy, { ...fixture.action, unknown: true })).toEqual({
      decision: 'deny',
      reason: 'request-invalid',
    });
    expect(await selected({ ...policy, principal: 'verified' })).toEqual({
      decision: 'deny',
      reason: 'policy-invalid',
    });
    expect(await selected(Buffer.from('{PRIVATE_MALFORMED'))).toEqual({
      decision: 'deny',
      reason: 'input-unavailable',
    });
    fixture.write(policy, Buffer.from([0xff]));
    expect(await prepareExecution(fixture.policyPath, fixture.requestPath)).toEqual({
      decision: 'deny',
      reason: 'input-unavailable',
    });
    fixture.write(policy);
    fs.unlinkSync(fixture.policyPath);
    expect(await prepareExecution(fixture.policyPath, fixture.requestPath)).toEqual({
      decision: 'deny',
      reason: 'input-unavailable',
    });
  });

  it('retains pinned-file checks and denies initialization failure without a launch', async () => {
    const policy = translateSchema3Policy(
      legacy([{ action: fixture.action, decision: 'allow' }]),
    ).policy;
    fixture.write(policy);
    const binding = await captureExecutionBinding(fixture.policyPath, fixture.requestPath);
    try {
      fixture.write({ ...policy, policies: {} });
      expect(
        await prepareExecution(fixture.policyPath, fixture.requestPath, { binding, review: true }),
      ).toEqual({ decision: 'deny', reason: 'configuration-changed' });
    } finally {
      revokeExecutionBinding(binding);
    }
    runtime._setDepsForTest({
      load: () => {
        throw Error('PRIVATE_INITIALIZATION');
      },
    });
    expect(await selected(policy, fixture.action, { review: true })).toEqual({
      decision: 'deny',
      reason: 'cedar-unavailable',
    });
  });

  it('keeps schemas 1/2/3 out of Cedar even when its runtime is unavailable', async () => {
    runtime._setDepsForTest({
      load: () => {
        throw Error('must not load');
      },
    });
    const two = {
      schemaVersion: 2,
      rules: [{ action: fixture.action, decision: 'allow' }],
      defaultDecision: 'deny',
    };
    expect((await selected(two)).decision).toBe('allow');
    expect(await selected({ ...two, schemaVersion: 3, reviewRequired: [fixture.action] })).toEqual({
      decision: 'ask',
      reason: 'review-required',
    });
    expect(await selected({ ...two, schemaVersion: 1 })).toEqual({
      decision: 'deny',
      reason: 'policy-invalid',
    });
  });
  it('denies an actual evaluation exception without launch and recovers on the same pinned files', async () => {
    const official = require('@cedar-policy/cedar-wasm/nodejs');
    const policy = translateSchema3Policy(
      legacy([{ action: fixture.action, decision: 'allow' }]),
    ).policy;
    fixture.write(policy);
    const binding = await captureExecutionBinding(fixture.policyPath, fixture.requestPath);
    let broken = true;
    let evaluations = 0;
    runtime._setDepsForTest({
      load: () => ({
        ...official,
        statefulIsAuthorized(call) {
          evaluations++;
          if (broken) throw Error('PRIVATE_EVALUATION ' + fixture.root);
          return official.statefulIsAuthorized(call);
        },
      }),
    });
    try {
      const failed = await prepareExecution(fixture.policyPath, fixture.requestPath, {
        binding,
        review: true,
      });
      expect(failed).toEqual({
        decision: 'deny',
        reason: 'cedar-evaluation-failed',
        policyIds: [],
      });
      expect(failed.launch).toBeUndefined();
      expect(JSON.stringify(failed)).not.toContain('PRIVATE');
      expect(JSON.stringify(failed)).not.toContain(fixture.root);
      broken = false;
      const unreviewed = await prepareExecution(fixture.policyPath, fixture.requestPath, {
        binding,
        review: 'true',
      });
      expect(unreviewed).toEqual({
        decision: 'ask',
        reason: 'review-required',
        policyIds: ['rule_0'],
      });
      const recovered = await prepareExecution(fixture.policyPath, fixture.requestPath, {
        binding,
        review: true,
      });
      expect(metadata(recovered)).toEqual({ decision: 'ask', reason: 'review-required' });
      expect(recovered.launch.args).toEqual(fixture.action.args);
      expect(evaluations).toBe(3);
    } finally {
      revokeExecutionBinding(binding);
    }
  });
});
