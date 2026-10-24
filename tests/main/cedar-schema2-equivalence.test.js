import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { translateSchema2Policy } = require('../../src/main/cedar-translator');
const {
  evaluateExecutionPolicy,
  validateExecutionAction,
} = require('../../src/main/execution-policy');
const { parseActionJson } = require('../../src/main/action-policy');
const runtime = require('../../src/main/cedar-runtime');
const official = require('@cedar-policy/cedar-wasm/nodejs');
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

describe('explicit schema-2 Cedar translation', () => {
  it('preserves all decisions, both defaults, rule orders and empty policies without review annotations', () => {
    const rules = ['allow', 'ask', 'deny'].map((decision) => ({
      action: { ...action, args: [decision] },
      decision,
    }));
    for (const ordered of [rules, [...rules].reverse()])
      for (const fallback of ['deny', 'ask']) {
        const legacy = policy(ordered, fallback);
        const { compiled, translated } = compile(legacy);
        assert.equal(JSON.stringify(translated).includes('reviewRequired'), false);
        for (const rule of rules) {
          const expected = { decision: rule.decision, reason: `policy-${rule.decision}` };
          assert.deepEqual(evaluateExecutionPolicy(legacy, rule.action), expected);
          assert.deepEqual(metadata(compiled.evaluate(rule.action)), expected);
        }
        const unmatched = { ...action, args: ['unmatched'] };
        assert.deepEqual(metadata(compiled.evaluate(unmatched)), {
          decision: fallback,
          reason: `policy-${fallback}`,
        });
        assert.deepEqual(compiled.evaluate(unmatched).policyIds, ['default']);
        for (let index = 1; index < rules.length; index++)
          for (const prior of ordered.slice(0, index))
            assert.equal(
              translated.policies[`rule_${index}`].includes(
                JSON.stringify(prior.action.args).replaceAll('"', '\\"'),
              ),
              true,
            );
        const empty = compile(policy([], fallback)).compiled;
        assert.deepEqual(metadata(empty.evaluate(action)), {
          decision: fallback,
          reason: `policy-${fallback}`,
        });
        assert.deepEqual(empty.evaluate(action).policyIds, ['default']);
      }
  });

  it('matches unusual literals in every field and distinguishes single-field near misses', () => {
    for (const literal of [
      '\u0001',
      '\b',
      '\f',
      '\u001f',
      '\n\r\t',
      '"',
      '\\',
      '\\u0001',
      '\\u{1}',
      'Şəki🚀',
    ])
      for (const field of ['executable', 'cwd', 'args', 'env']) {
        const selected = {
          ...action,
          [field]:
            field === 'args'
              ? [literal, 'tail']
              : field === 'env'
                ? { A: literal, B: 'b' }
                : action[field] + literal,
        };
        const legacy = policy([{ action: selected, decision: 'allow' }]);
        const { compiled } = compile(legacy);
        assert.deepEqual(metadata(compiled.evaluate(selected)), {
          decision: 'allow',
          reason: 'policy-allow',
        });
        const changed = {
          ...selected,
          [field]:
            field === 'args'
              ? [literal + 'different', 'tail']
              : field === 'env'
                ? { A: literal + 'different', B: 'b' }
                : selected[field] + 'different',
        };
        assert.deepEqual(metadata(compiled.evaluate(changed)), {
          decision: 'deny',
          reason: 'policy-deny',
        });
        assert.deepEqual(
          metadata(compiled.evaluate(changed)),
          evaluateExecutionPolicy(legacy, changed),
        );
      }
  });

  it('compares 10000 selected-JSON-valid generated requests with 10000 official WASM calls', () => {
    const seed = 0x52ceda;
    let state = seed;
    const next = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    let wasm = 0;
    runtime._setDepsForTest({
      load: () => ({
        ...official,
        statefulIsAuthorized(call) {
          wasm++;
          return official.statefulIsAuthorized(call);
        },
      }),
    });
    const counts = { valid: 0, allow: 0, ask: 0, deny: 0, defaults: 0 };
    const fields = new Set();
    const literals = [
      '\u0001',
      '\b',
      '\f',
      '\u001f',
      '\n\r\t',
      '"',
      '\\',
      '\\u0001',
      '\\u{1}',
      'Şəki🚀',
    ];
    for (let group = 0; group < 40; group++) {
      const nonce = next().toString(36);
      const literal = literals[group % literals.length];
      const base = {
        ...action,
        executable: action.executable + literal,
        cwd: action.cwd + literal,
        env: { A: nonce, B: literal },
      };
      const actions = Array.from({ length: 3 }, (_, index) => ({
        ...base,
        args: [String(index), nonce, literal],
      }));
      const rules = actions.map((selected, index) => ({
        action: selected,
        decision: (group % 2 ? ['deny', 'allow', 'ask'] : ['allow', 'ask', 'deny'])[index],
      }));
      if (group % 2) rules.reverse();
      const legacy = policy(rules, group % 2 ? 'ask' : 'deny');
      const { compiled, translated } = compile(legacy);
      assert.ok(Buffer.byteLength(JSON.stringify(translated)) <= 64 * 1024);
      for (let index = 0; index < 250; index++) {
        const suffix = next().toString(36);
        let request = actions[index % 3];
        switch (index % 16) {
          case 3:
            request = { ...actions[0], executable: base.executable + suffix };
            fields.add('executable');
            break;
          case 4:
            request = { ...actions[0], cwd: base.cwd + suffix };
            fields.add('cwd');
            break;
          case 5:
            request = { ...actions[0], args: [suffix, nonce, literal] };
            fields.add('args-value');
            break;
          case 6:
            request = { ...actions[0], args: [...actions[0].args].reverse() };
            fields.add('args-order');
            break;
          case 7:
            request = { ...actions[0], args: [] };
            fields.add('args-empty');
            break;
          case 8:
            request = { ...actions[0], env: { ...base.env, A: nonce + suffix } };
            fields.add('env-value');
            break;
          case 9:
            request = { ...actions[0], env: {} };
            fields.add('env-empty');
            break;
          case 10:
            request = { ...actions[0], env: { ...base.env, EXTRA: '' } };
            fields.add('env-extra');
            break;
          case 11:
            request = { ...actions[0], env: { B: literal, A: nonce } };
            fields.add('env-order');
            break;
          case 12:
            request = { ...actions[0], env: { ...base.env, A: '' } };
            fields.add('env-empty-value');
            break;
          case 13:
            request = { ...actions[0], args: [...actions[0].args, '\\u{1}'] };
            fields.add('args-extra');
            break;
          case 14:
            request = { ...actions[0], env: { ...base.env, NODE_V8_COVERAGE: '' } };
            fields.add('env-suppression');
            break;
          case 15:
            request = { ...actions[0], executable: base.executable + '\\u0001' };
            fields.add('literal-near-miss');
            break;
        }
        const selected = parseActionJson(
          Buffer.from(JSON.stringify({ schemaVersion: 1, action: request })),
        );
        assert.equal(validateExecutionAction(selected.action), true);
        const expected = evaluateExecutionPolicy(legacy, request);
        const actual = compiled.evaluate(request);
        assert.deepEqual(metadata(actual), expected, `seed=${seed} group=${group} case=${index}`);
        if (index % 16 >= 3 && index % 16 !== 11) {
          assert.equal(expected.decision, legacy.defaultDecision);
          counts.defaults++;
        }
        counts.valid++;
        counts[actual.decision]++;
      }
    }
    assert.equal(counts.valid, 10000);
    assert.equal(wasm, 10000);
    assert.equal(fields.size, 13);
    for (const decision of ['allow', 'ask', 'deny']) assert.ok(counts[decision] > 0);
    // eslint-disable-next-line no-console -- Record reproducible counts without private descriptors.
    console.info(
      `Schema2 Cedar seed=${seed} (0x${seed.toString(16)}) ${JSON.stringify({ ...counts, wasm })}`,
    );
  }, 60000);
});
