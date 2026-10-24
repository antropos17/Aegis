import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { translateSchema3Policy } = require('../../src/main/cedar-translator');
const runtime = require('../../src/main/cedar-runtime');
const { compileCedarPolicy } = runtime;
const official = require('@cedar-policy/cedar-wasm/nodejs');
afterEach(() => runtime._resetForTest());
const { evaluateExecutionPolicy } = require('../../src/main/execution-policy');
const SEED = 0x5eedc3;
const metadata = ({ decision, reason }) => ({ decision, reason });

describe('Cedar generated equivalence', () => {
  it('compares 10000 seeded inputs across exact fields, defaults, review and validation', () => {
    let wasmEvaluations = 0;
    runtime._setDepsForTest({
      load: () => ({
        ...official,
        statefulIsAuthorized(call) {
          wasmEvaluations++;
          return official.statefulIsAuthorized(call);
        },
      }),
    });
    let state = SEED;
    const next = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    const counts = {
      requests: 0,
      valid: 0,
      invalidPolicy: 0,
      invalidRequest: 0,
      allow: 0,
      ask: 0,
      deny: 0,
      reviewed: 0,
    };
    const touched = new Set();
    for (let group = 0; group < 20; group++) {
      const nonce = next().toString(36);
      const base = {
        executable: process.execPath,
        cwd: process.cwd(),
        args: ['base', nonce],
        env: { A: nonce, B: 'literal' },
      };
      const actions = Array.from({ length: 4 }, (_, index) => ({
        ...base,
        args: [String(index), nonce],
      }));
      const rules = actions.map((action, index) => ({
        action,
        decision: ['allow', 'allow', 'ask', 'deny'][index],
      }));
      if (group % 2) rules.reverse();
      const legacy = {
        schemaVersion: 3,
        rules,
        reviewRequired: [actions[0]],
        defaultDecision: group % 2 ? 'ask' : 'deny',
      };
      const translated = translateSchema3Policy(legacy);
      expect(translated.ok).toBe(true);
      const compiled = compileCedarPolicy(translated.policy);
      expect(compiled.ok).toBe(true);
      for (let index = 0; index < 500; index++) {
        counts.requests++;
        if (index < 10) {
          const malformed = [
            { ...legacy, rules: [...rules, rules[0]] },
            {
              ...legacy,
              rules: [
                ...rules,
                {
                  ...rules[0],
                  action: {
                    env: { B: 'literal', A: nonce },
                    args: rules[0].action.args,
                    cwd: base.cwd,
                    executable: base.executable,
                  },
                },
              ],
            },
            { ...legacy, reviewRequired: [] },
            { ...legacy, reviewRequired: [actions[0], actions[0]] },
            { ...legacy, reviewRequired: [actions[2]] },
            { ...legacy, reviewRequired: [actions[3]] },
            { ...legacy, defaultDecision: 'allow' },
            { ...legacy, unknown: nonce },
            { ...legacy, rules: [{ ...rules[0], unknown: nonce }] },
            { ...legacy, reviewRequired: [{ ...actions[0], args: [nonce] }] },
          ][index];
          expect(evaluateExecutionPolicy(malformed, actions[0])).toEqual({
            decision: 'deny',
            reason: 'policy-invalid',
          });
          expect(translateSchema3Policy(malformed)).toEqual({
            ok: false,
            reason: 'policy-invalid',
          });
          counts.invalidPolicy++;
          continue;
        }
        const literal = next().toString(36);
        const kind = index % 20;
        let request = actions[kind % 4];
        switch (kind) {
          case 4:
            request = { ...actions[0], executable: base.executable + literal };
            touched.add('executable');
            break;
          case 5:
            request = { ...actions[0], cwd: base.cwd + '/' + literal };
            touched.add('cwd');
            break;
          case 6:
            request = { ...actions[0], args: [literal, 'base'] };
            touched.add('args-value');
            break;
          case 7:
            request = { ...actions[0], args: [...actions[0].args].reverse() };
            touched.add('args-order');
            break;
          case 8:
            request = { ...actions[0], args: [] };
            touched.add('args-empty');
            break;
          case 9:
            request = { ...actions[0], args: [literal, '\n\t"\\Ş🚀'] };
            touched.add('args-escaping');
            break;
          case 10:
            request = { ...actions[0], env: { ...base.env, A: nonce + literal } };
            touched.add('env-value');
            break;
          case 11:
            request = { ...actions[0], env: {} };
            touched.add('env-empty');
            break;
          case 12:
            request = { ...actions[0], env: { ...base.env, EXTRA: literal } };
            touched.add('env-extra');
            break;
          case 13:
            request = { ...actions[0], env: { B: 'literal', A: nonce } };
            touched.add('env-order');
            break;
          case 14:
            request = { ...actions[0], env: { lower: literal } };
            touched.add('invalid-env');
            break;
          case 15:
            request = { ...actions[0], args: [literal + '\0'] };
            touched.add('invalid-args');
            break;
          case 16:
            request = { ...actions[0], unknown: literal };
            touched.add('unknown-field');
            break;
          case 17:
            request = { ...actions[0], executable: literal };
            touched.add('invalid-path');
            break;
          case 18:
            request = { ...actions[0], env: { NODE_V8_COVERAGE: literal } };
            touched.add('coverage-env');
            break;
          case 19:
            request = { ...actions[0], env: { A: '', B: 'literal' } };
            touched.add('env-empty-value');
            break;
        }
        const expected = evaluateExecutionPolicy(legacy, request);
        const actual = compiled.evaluate(request);
        expect(metadata(actual), `seed=${SEED} group=${group} case=${index} field=${kind}`).toEqual(
          expected,
        );
        counts[expected.reason === 'request-invalid' ? 'invalidRequest' : 'valid']++;
        counts[actual.decision]++;
        if (actual.reason === 'review-required') counts.reviewed++;
      }
    }
    expect(counts.requests).toBe(10000);
    expect(wasmEvaluations).toBe(7300);
    expect(wasmEvaluations).toBe(counts.valid);
    expect(touched.size).toBe(16);
    expect(counts.invalidPolicy).toBe(200);
    expect(counts.invalidRequest).toBeGreaterThan(1000);
    expect(counts.reviewed).toBeGreaterThan(0);
    // eslint-disable-next-line no-console -- Record the fixed seed and category counts in CI output.
    console.info(
      `Cedar equivalence seed=${SEED} (0x${SEED.toString(16)}) ${JSON.stringify({ ...counts, wasmEvaluations })} fields=${[...touched].sort().join(',')}`,
    );
  }, 60000);
});
