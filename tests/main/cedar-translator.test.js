import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { translateSchema3Policy } = require('../../src/main/cedar-translator');
const { compileCedarPolicy } = require('../../src/main/cedar-runtime');
const { evaluateExecutionPolicy } = require('../../src/main/execution-policy');
const action = {
  executable: process.execPath,
  cwd: process.cwd(),
  args: ['first', 'second'],
  env: { A: 'a', B: 'b' },
};
const make = (rules = [{ action, decision: 'allow' }], defaults = 'deny') => ({
  schemaVersion: 3,
  rules,
  reviewRequired: [action],
  defaultDecision: defaults,
});
const meta = (result) => ({ decision: result.decision, reason: result.reason });

describe('Cedar schema-3 translation contract', () => {
  it('emits every earlier exclusion and an explicit default, with review and ask annotations', () => {
    const rules = ['allow', 'ask', 'deny'].map((decision, index) => ({
      action: index ? { ...action, args: [String(index)] } : action,
      decision,
    }));
    const translated = translateSchema3Policy(make(rules, 'ask'));
    expect(translated.ok).toBe(true);
    expect(translated.policy.policies.rule_0).toContain('@reviewRequired("true")');
    expect(translated.policy.policies.rule_1).toContain('@decision("ask")');
    for (let index = 1; index < rules.length; index++) {
      const source = translated.policy.policies[`rule_${index}`];
      expect(source).toContain(' && !(');
      for (const prior of rules.slice(0, index))
        expect(source).toContain(JSON.stringify(prior.action.executable));
    }
    const evaluator = compileCedarPolicy(translated.policy);
    for (const selected of [...rules.map((rule) => rule.action), { ...action, args: ['default'] }])
      expect(meta(evaluator.evaluate(selected))).toEqual(
        evaluateExecutionPolicy(make(rules, 'ask'), selected),
      );
    expect(evaluator.evaluate({ ...action, args: ['default'] }).policyIds).toEqual(['default']);
  });

  it('preserves literal paths, ordered arguments, exact environment keys and control characters', () => {
    const unusual = {
      ...action,
      args: ['quote"', 'back\\slash', '\n\r\t\b\f\u0001', 'Şəki', '🚀'],
      env: { A: 'first\nsecond', B: '\b\f' },
    };
    const legacy = make([{ action: unusual, decision: 'allow' }]);
    legacy.reviewRequired = [unusual];
    const compiled = compileCedarPolicy(translateSchema3Policy(legacy).policy);
    expect(compiled.ok).toBe(true);
    for (const selected of [
      unusual,
      { ...unusual, env: { B: '\b\f', A: 'first\nsecond' } },
      { ...unusual, args: [...unusual.args].reverse() },
      { ...unusual, executable: unusual.executable.toUpperCase() },
      { ...unusual, cwd: unusual.cwd + '/.' },
      { ...unusual, env: { ...unusual.env, EXTRA: '' } },
    ])
      expect(meta(compiled.evaluate(selected))).toEqual(evaluateExecutionPolicy(legacy, selected));
  });

  it('supports all 32 disjoint rules and maximum args/env counts within selected-file limits', () => {
    const boundary = {
      ...action,
      args: Array.from({ length: 128 }, (_, index) => String(index)),
      env: Object.fromEntries(
        Array.from({ length: 64 }, (_, index) => [`KEY_${index}`, String(index)]),
      ),
    };
    const rules = Array.from({ length: 32 }, (_, index) => ({
      action: { ...action, args: [String(index)] },
      decision: index % 2 ? 'deny' : 'allow',
    }));
    const legacy = make(rules);
    legacy.reviewRequired = [rules[0].action];
    const compiled = compileCedarPolicy(translateSchema3Policy(legacy).policy);
    expect(compiled.ok).toBe(true);
    expect(meta(compiled.evaluate(rules[31].action))).toEqual(
      evaluateExecutionPolicy(legacy, rules[31].action),
    );
    const single = make([{ action: boundary, decision: 'allow' }]);
    single.reviewRequired = [boundary];
    const large = compileCedarPolicy(translateSchema3Policy(single).policy);
    expect(large.ok).toBe(true);
    expect(meta(large.evaluate(boundary))).toEqual(evaluateExecutionPolicy(single, boundary));
  });

  it('rejects duplicate predicates/reviews, invalid references and unknown fields as legacy does', () => {
    const valid = make();
    for (const candidate of [
      { ...valid, schemaVersion: 2 },
      { ...valid, unknown: true },
      { ...valid, defaultDecision: 'allow' },
      {
        ...valid,
        rules: [
          ...valid.rules,
          {
            action: {
              env: { B: 'b', A: 'a' },
              args: action.args,
              cwd: action.cwd,
              executable: action.executable,
            },
            decision: 'deny',
          },
        ],
      },
      { ...valid, reviewRequired: [] },
      { ...valid, reviewRequired: [action, action] },
      { ...valid, reviewRequired: [{ ...action, args: ['missing'] }] },
      { ...valid, rules: [{ action, decision: 'ask' }] },
      { ...valid, rules: [{ action, decision: 'deny' }] },
      { ...valid, rules: [{ ...valid.rules[0], unknown: true }] },
      { ...valid, rules: [{ action: { ...action, env: { lower: 'bad' } }, decision: 'allow' }] },
    ])
      expect(translateSchema3Policy(candidate)).toEqual({ ok: false, reason: 'policy-invalid' });
  });
});
