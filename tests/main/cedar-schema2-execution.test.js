import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createSelection } = require('../fixtures/policy-characterization/selection.cjs');
const {
  prepareExecution,
  evaluateExecutionPolicy,
  validateExecutionAction,
} = require('../../src/main/execution-policy');
const {
  captureExecutionBinding,
  revokeExecutionBinding,
} = require('../../src/main/execution-binding');
const { translateSchema2Policy } = require('../../src/main/cedar-translator');
const runtime = require('../../src/main/cedar-runtime');
const official = require('@cedar-policy/cedar-wasm/nodejs');
const metadata = ({ decision, reason }) => ({ decision, reason });
let fixture;
beforeEach(() => {
  fixture = createSelection();
});
afterEach(() => {
  fixture.cleanup();
  runtime._resetForTest();
});
const policy = (rules, defaultDecision = 'deny') => ({ schemaVersion: 2, rules, defaultDecision });
async function selected(input, action = fixture.action, options = {}) {
  fixture.write(input, { schemaVersion: 1, action });
  return prepareExecution(fixture.policyPath, fixture.requestPath, options);
}
function translated(input) {
  const result = translateSchema2Policy(input);
  assert.equal(result.ok, true);
  return result.policy;
}

describe('schema-2 translation through actual selected-file preparation', () => {
  it('preserves exact metadata and complete launch descriptors for every decision/default/order/review mode', async () => {
    const actions = ['allow', 'ask', 'deny'].map((label) => ({
      ...fixture.action,
      args: [label],
      env: { EXPLICIT: 'value', NODE_V8_COVERAGE: '' },
    }));
    const entries = actions.map((action, index) => ({
      action,
      decision: ['allow', 'ask', 'deny'][index],
    }));
    for (const rules of [entries, [...entries].reverse()])
      for (const fallback of ['ask', 'deny']) {
        const original = policy(rules, fallback);
        const cedarPolicy = translated(original);
        for (const action of [...actions, { ...actions[0], args: ['unmatched'] }])
          for (const review of [true, false, 'true', 1]) {
            const expected = evaluateExecutionPolicy(original, action);
            assert.equal(expected.reason, `policy-${expected.decision}`);
            const legacy = await selected(original, action, { review });
            const cedar = await selected(cedarPolicy, action, { review });
            assert.deepEqual(metadata(legacy), expected);
            assert.deepEqual(metadata(cedar), expected);
            assert.deepEqual(cedar.launch, legacy.launch);
            assert.equal(
              Boolean(cedar.launch),
              expected.decision === 'allow' || (review === true && expected.decision === 'ask'),
            );
            assert.equal(cedar.policyIds.length, 1);
            if (cedar.launch) {
              assert.equal(Object.getPrototypeOf(cedar.launch.env), null);
              assert.equal(cedar.launch.env.NODE_V8_COVERAGE, '');
              assert.equal(cedar.launch.env.EXPLICIT, 'value');
              assert.equal(cedar.launch.executable, action.executable);
              assert.equal(cedar.launch.cwd, action.cwd);
              assert.deepEqual(cedar.launch.args, action.args);
            }
          }
      }
    for (const fallback of ['ask', 'deny']) {
      const original = policy([], fallback);
      assert.deepEqual(
        metadata(await selected(translated(original), fixture.action, { review: true })),
        { decision: fallback, reason: `policy-${fallback}` },
      );
    }
  });

  it('characterizes expanded translations that exceed the existing selected-file limit', async () => {
    const rules = Array.from({ length: 32 }, (_, index) => ({
      action: { ...fixture.action, args: ['x'.repeat(1024) + index] },
      decision: 'allow',
    }));
    const original = policy(rules);
    const cedarPolicy = translated(original);
    assert.ok(Buffer.byteLength(JSON.stringify(original)) < 64 * 1024);
    assert.ok(Buffer.byteLength(JSON.stringify(cedarPolicy)) > 64 * 1024);
    const compiled = runtime.compileCedarPolicy(cedarPolicy);
    assert.equal(compiled.ok, true);
    assert.deepEqual(metadata(compiled.evaluate(rules[0].action)), {
      decision: 'allow',
      reason: 'policy-allow',
    });
    assert.equal((await selected(original, rules[0].action)).decision, 'allow');
    assert.deepEqual(await selected(cedarPolicy, rules[0].action, { review: true }), {
      decision: 'deny',
      reason: 'input-unavailable',
    });
  });

  it('keeps invalid requests ahead of malformed policy parsing and denies unavailable files without launch', async () => {
    const original = policy([{ action: fixture.action, decision: 'allow' }]);
    for (const candidate of [original, translated(original)]) {
      fixture.write(Buffer.from('{PRIVATE_MALFORMED'), {
        schemaVersion: 1,
        action: { ...fixture.action, unknown: true },
      });
      assert.deepEqual(
        await prepareExecution(fixture.policyPath, fixture.requestPath, { review: true }),
        { decision: 'deny', reason: 'request-invalid' },
      );
      assert.deepEqual(
        await selected({ ...candidate, unknown: true }, fixture.action, { review: true }),
        { decision: 'deny', reason: 'policy-invalid' },
      );
      assert.deepEqual(
        await selected(Buffer.from('{PRIVATE_MALFORMED'), fixture.action, { review: true }),
        { decision: 'deny', reason: 'input-unavailable' },
      );
      fixture.write(candidate, Buffer.from([0xff]));
      assert.deepEqual(
        await prepareExecution(fixture.policyPath, fixture.requestPath, { review: true }),
        { decision: 'deny', reason: 'input-unavailable' },
      );
      fixture.write(candidate);
      fs.unlinkSync(fixture.policyPath);
      assert.deepEqual(
        await prepareExecution(fixture.policyPath, fixture.requestPath, { review: true }),
        { decision: 'deny', reason: 'input-unavailable' },
      );
    }
  });

  it('rejects unrelated invalid rules and schema-2 review fields before matching allow', async () => {
    const good = { action: fixture.action, decision: 'allow' };
    for (const bad of [
      { action: { ...fixture.action, args: ['other'], env: { lower: '' } }, decision: 'deny' },
      { ...good, unknown: true },
    ])
      for (const rules of [
        [bad, good],
        [good, bad],
      ]) {
        const original = policy(rules);
        assert.deepEqual(translateSchema2Policy(original), { ok: false, reason: 'policy-invalid' });
        assert.deepEqual(await selected(original, fixture.action, { review: true }), {
          decision: 'deny',
          reason: 'policy-invalid',
        });
      }
    const withReview = { ...policy([good]), reviewRequired: [fixture.action] };
    assert.deepEqual(translateSchema2Policy(withReview), { ok: false, reason: 'policy-invalid' });
    assert.deepEqual(await selected(withReview, fixture.action, { review: true }), {
      decision: 'deny',
      reason: 'policy-invalid',
    });
  });

  it('retains binding refusal for changed policy/request bytes and missing pinned input', async () => {
    const original = policy([{ action: fixture.action, decision: 'allow' }]);
    for (const candidate of [original, translated(original)])
      for (const kind of ['policy', 'request', 'missing']) {
        fixture.write(candidate);
        const binding = await captureExecutionBinding(fixture.policyPath, fixture.requestPath);
        try {
          if (kind === 'missing') fs.unlinkSync(fixture.policyPath);
          else
            fs.appendFileSync(kind === 'policy' ? fixture.policyPath : fixture.requestPath, '\n');
          assert.deepEqual(
            await prepareExecution(fixture.policyPath, fixture.requestPath, {
              binding,
              review: true,
            }),
            {
              decision: 'deny',
              reason: kind === 'missing' ? 'configuration-unavailable' : 'configuration-changed',
            },
          );
          assert.deepEqual(
            await prepareExecution(fixture.policyPath, fixture.requestPath, {
              binding,
              review: true,
            }),
            { decision: 'deny', reason: 'configuration-changed' },
          );
        } finally {
          revokeExecutionBinding(binding);
        }
      }
  });

  it('denies Cedar initialization/evaluation errors without launch while original schema 2 stays independent', async () => {
    const original = policy([{ action: fixture.action, decision: 'allow' }]);
    const cedarPolicy = translated(original);
    runtime._setDepsForTest({
      load() {
        throw Error('PRIVATE_INITIALIZATION');
      },
    });
    assert.equal((await selected(original)).decision, 'allow');
    assert.deepEqual(await selected(cedarPolicy, fixture.action, { review: true }), {
      decision: 'deny',
      reason: 'cedar-unavailable',
    });
    runtime._setDepsForTest({
      load: () => ({
        ...official,
        statefulIsAuthorized() {
          throw Error('PRIVATE_EVALUATION ' + fixture.root);
        },
      }),
    });
    const failed = await selected(cedarPolicy, fixture.action, { review: true });
    assert.deepEqual(failed, {
      decision: 'deny',
      reason: 'cedar-evaluation-failed',
      policyIds: [],
    });
    assert.equal(JSON.stringify(failed).includes('PRIVATE'), false);
    assert.equal(JSON.stringify(failed).includes(fixture.root), false);
    runtime._resetForTest();
    assert.equal((await selected(cedarPolicy)).decision, 'allow');
  });

  it('characterizes lone-surrogate JS values outside the selected-JSON-valid equivalence domain', async () => {
    const original = policy([], 'ask');
    const cedarPolicy = translated(original);
    for (const action of [
      { ...fixture.action, args: ['\ud800'] },
      { ...fixture.action, env: { A: '\ud800' } },
      { ...fixture.action, executable: fixture.action.executable + '\ud800' },
    ]) {
      assert.equal(validateExecutionAction(action), true);
      assert.deepEqual(evaluateExecutionPolicy(original, action), {
        decision: 'ask',
        reason: 'policy-ask',
      });
      for (const candidate of [original, cedarPolicy])
        assert.deepEqual(await selected(candidate, action, { review: true }), {
          decision: 'deny',
          reason: 'input-unavailable',
        });
      assert.deepEqual(translateSchema2Policy(policy([{ action, decision: 'allow' }])), {
        ok: false,
        reason: 'policy-invalid',
      });
    }
  });
});
