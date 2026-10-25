import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  translateSchema2Policy,
  translateSchema3Policy,
} = require('../../src/main/cedar-translator');
const { evaluateExecutionPolicy } = require('../../src/main/execution-policy');
const runtime = require('../../src/main/cedar-runtime');
const action = {
  executable: process.execPath,
  cwd: process.cwd(),
  args: ['first', 'second'],
  env: { A: 'a', B: 'b' },
};
const policy = (rules = [{ action, decision: 'allow' }], defaultDecision = 'deny') => ({
  schemaVersion: 2,
  rules,
  defaultDecision,
});
const metadata = ({ decision, reason }) => ({ decision, reason });
const compile = (input) => {
  const result = translateSchema2Policy(input);
  assert.equal(result.ok, true);
  const compiled = runtime.compileCedarPolicy(result.policy);
  assert.equal(compiled.ok, true);
  return { compiled, translated: result.policy };
};
afterEach(() => runtime._resetForTest());
describe('schema-2 translator input contract', () => {
  it('rejects whole-policy and parser-invalid inputs separately from invalid requests', () => {
    const good = policy();
    const badRule = { action: { ...action, env: { lower: 'bad' } }, decision: 'deny' };
    const cyclic = {};
    cyclic.self = cyclic;
    for (const candidate of [
      null,
      undefined,
      [],
      'text',
      cyclic,
      { ...good, schemaVersion: 1 },
      { ...good, schemaVersion: 4 },
      { ...good, unknown: true },
      { ...good, defaultDecision: 'allow' },
      { ...good, reviewRequired: [] },
      { ...good, rules: [...good.rules, good.rules[0]] },
      { ...good, rules: [badRule, ...good.rules] },
      { ...good, rules: [...good.rules, badRule] },
      { ...good, rules: [{ ...good.rules[0], unknown: true }] },
      { ...good, rules: [{ action: { ...action, args: ['\0'] }, decision: 'allow' }] },
      { ...good, rules: [{ action: { ...action, args: ['\ud800'] }, decision: 'allow' }] },
      { ...good, rules: [{ action: { ...action, env: { A: 1n } }, decision: 'allow' }] },
    ])
      assert.deepEqual(translateSchema2Policy(candidate), { ok: false, reason: 'policy-invalid' });
    const { compiled } = compile(good);
    for (const request of [
      { ...action, unknown: true },
      { ...action, executable: 'relative' },
      { ...action, args: ['\0'] },
      { ...action, env: { lower: '' } },
      { ...action, env: { NODE_V8_COVERAGE: 'private-path' } },
    ]) {
      assert.deepEqual(evaluateExecutionPolicy(good, request), {
        decision: 'deny',
        reason: 'request-invalid',
      });
      assert.deepEqual(metadata(compiled.evaluate(request)), {
        decision: 'deny',
        reason: 'request-invalid',
      });
    }
  });

  it('retains the validator rule/argument/environment limits', () => {
    const rules = Array.from({ length: 32 }, (_, index) => ({
      action: { ...action, args: [String(index)] },
      decision: index % 2 ? 'deny' : 'allow',
    }));
    const { compiled } = compile(policy(rules));
    assert.deepEqual(metadata(compiled.evaluate(rules[31].action)), {
      decision: 'deny',
      reason: 'policy-deny',
    });
    assert.equal(
      translateSchema2Policy(
        policy([...rules, { action: { ...action, args: ['33'] }, decision: 'allow' }]),
      ).ok,
      false,
    );
    const maximum = {
      ...action,
      args: Array.from({ length: 128 }, (_, index) => String(index)),
      env: Object.fromEntries(
        Array.from({ length: 64 }, (_, index) => [`KEY_${index}`, String(index)]),
      ),
    };
    const maximumPolicy = policy([{ action: maximum, decision: 'allow' }]);
    assert.deepEqual(metadata(compile(maximumPolicy).compiled.evaluate(maximum)), {
      decision: 'allow',
      reason: 'policy-allow',
    });
    for (const invalid of [
      { ...maximum, args: [...maximum.args, '129'] },
      { ...maximum, env: { ...maximum.env, EXTRA: '65' } },
    ])
      assert.equal(
        translateSchema2Policy(policy([{ action: invalid, decision: 'allow' }])).ok,
        false,
      );
  });

  it('keeps both entrypoints version-specific and snapshots input before emission', () => {
    const two = policy();
    const three = { ...two, schemaVersion: 3, reviewRequired: [action] };
    assert.deepEqual(translateSchema3Policy(two), { ok: false, reason: 'policy-invalid' });
    assert.deepEqual(translateSchema2Policy(three), { ok: false, reason: 'policy-invalid' });
    const legacyThree = runtime.compileCedarPolicy(translateSchema3Policy(three).policy);
    assert.deepEqual(metadata(legacyThree.evaluate(action)), {
      decision: 'ask',
      reason: 'review-required',
    });
    const input = JSON.parse(JSON.stringify(two));
    const result = translateSchema2Policy(input);
    input.rules[0].decision = 'deny';
    input.rules[0].action.args.push('changed');
    assert.deepEqual(metadata(runtime.compileCedarPolicy(result.policy).evaluate(action)), {
      decision: 'allow',
      reason: 'policy-allow',
    });
  });
});
