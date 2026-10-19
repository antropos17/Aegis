import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createSelection } = require('../fixtures/policy-characterization/selection.cjs');
const { evaluateActionPolicy } = require('../../src/main/action-policy');
const { prepareExecution } = require('../../src/main/execution-policy');
let fixture;
beforeEach(() => {
  fixture = createSelection();
});
afterEach(() => fixture.cleanup());
const metadata = (decision, reason = `policy-${decision}`) => ({ decision, reason });
const executionPolicy = (rules, extra = {}) => ({
  schemaVersion: 2,
  defaultDecision: 'deny',
  rules,
  ...extra,
});
const actionPolicy = (rules, extra = {}) => ({
  schemaVersion: 1,
  cwd: fixture.root,
  defaultDecision: 'deny',
  rules,
  ...extra,
});
async function claude(policy, toolInput = fixture.input) {
  fixture.write(policy);
  return evaluateActionPolicy(
    fixture.policyPath,
    Buffer.from(
      JSON.stringify({
        ...fixture.providerRequest,
        tool_input: toolInput,
      }),
    ),
  );
}
async function execution(policy, action = fixture.action, options) {
  fixture.write(policy, { schemaVersion: 1, action });
  return prepareExecution(fixture.policyPath, fixture.requestPath, options);
}

// Predicates are exact and unique. Permuting valid disjoint rules is safe;
// equivalent predicates are invalid, so there is no valid overlapping-rule case.
describe('policy characterization: valid disjoint rule order', () => {
  it.each(['forward', 'reverse'])(
    'selects all Claude rules and both defaults in %s order',
    async (order) => {
      const entries = ['allow', 'ask', 'deny'].map((decision) => ({
        tool: 'Bash',
        input: { ...fixture.input, decisionLabel: decision },
        decision,
      }));
      if (order === 'reverse') entries.reverse();
      for (const defaultDecision of ['ask', 'deny']) {
        const policy = actionPolicy(entries, { defaultDecision });
        for (const entry of entries)
          expect(await claude(policy, entry.input)).toEqual(metadata(entry.decision));
        expect(await claude(policy, { command: 'UNMATCHED' })).toEqual(metadata(defaultDecision));
      }
    },
  );

  it.each(['forward', 'reverse'])(
    'selects all execution rules and both defaults in %s order',
    async (order) => {
      const entries = ['allow', 'ask', 'deny'].map((decision) => ({
        action: { ...fixture.action, args: [decision] },
        decision,
      }));
      if (order === 'reverse') entries.reverse();
      for (const defaultDecision of ['ask', 'deny']) {
        const policy = executionPolicy(entries, { defaultDecision });
        for (const entry of entries) {
          const result = await execution(policy, entry.action);
          expect({ decision: result.decision, reason: result.reason }).toEqual(
            metadata(entry.decision),
          );
          if (entry.decision === 'allow') {
            expect(result.launch).toEqual({ ...entry.action, env: expect.any(Object) });
            expect(result.launch.env.NODE_V8_COVERAGE).toBe('');
          } else expect(result).toEqual(metadata(entry.decision));
        }
        expect(await execution(policy)).toEqual(metadata(defaultDecision));
      }
    },
  );
});

describe('policy characterization: whole-policy validation', () => {
  it.each(['before', 'after'])(
    'rejects an unrelated invalid Claude rule %s the matching allow',
    async (position) => {
      const good = { tool: 'Bash', input: fixture.input, decision: 'allow' };
      for (const bad of [
        { tool: 'Write', input: { command: 'OTHER' }, decision: 'deny' },
        { tool: 'Bash', input: { command: 'OTHER' }, decision: 'deny', unknown: true },
      ]) {
        const rules = position === 'before' ? [bad, good] : [good, bad];
        expect(await claude(actionPolicy(rules))).toEqual(metadata('deny', 'policy-invalid'));
      }
    },
  );

  it.each(['before', 'after'])(
    'rejects an unrelated invalid execution rule %s the matching allow',
    async (position) => {
      const good = { action: fixture.action, decision: 'allow' };
      for (const bad of [
        {
          action: { ...fixture.action, args: ['OTHER'], env: { lower: 'value' } },
          decision: 'deny',
        },
        { action: { ...fixture.action, args: ['OTHER'] }, decision: 'deny', unknown: true },
      ]) {
        const rules = position === 'before' ? [bad, good] : [good, bad];
        expect(await execution(executionPolicy(rules))).toEqual(metadata('deny', 'policy-invalid'));
      }
    },
  );

  it('rejects same-decision duplicates, including reordered nested predicate keys', async () => {
    const reordered = { options: { labels: ['a', 'b'], timeout: 1 }, command: 'PRIVATE_COMMAND' };
    expect(
      await claude(
        actionPolicy(
          [fixture.input, reordered].map((input) => ({
            tool: 'Bash',
            input,
            decision: 'allow',
          })),
        ),
      ),
    ).toEqual(metadata('deny', 'policy-invalid'));
    const action = {
      env: {},
      args: fixture.action.args,
      cwd: fixture.root,
      executable: process.execPath,
    };
    expect(
      await execution(
        executionPolicy(
          [fixture.action, action].map((selected) => ({
            action: selected,
            decision: 'allow',
          })),
        ),
      ),
    ).toEqual(metadata('deny', 'policy-invalid'));
  });

  it('preserves the distinct structural-invalid and malformed-file reasons', async () => {
    expect(
      await execution(executionPolicy([{ action: fixture.action, decision: 'allow', unknown: 1 }])),
    ).toEqual(metadata('deny', 'policy-invalid'));
    expect(await execution(Buffer.from('{PRIVATE_MALFORMED'))).toEqual(
      metadata('deny', 'input-unavailable'),
    );
    fixture.write(executionPolicy([]), { schemaVersion: 1, action: fixture.action, unknown: true });
    expect(await prepareExecution(fixture.policyPath, fixture.requestPath)).toEqual(
      metadata('deny', 'request-invalid'),
    );
    expect(await claude(Buffer.from('{PRIVATE_MALFORMED'))).toEqual(
      metadata('deny', 'policy-invalid'),
    );
  });
});

describe('policy characterization: schema 3 selective private review', () => {
  it('requires review only for the listed allow action, independent of rule order', async () => {
    const other = { ...fixture.action, args: ['OTHER'] };
    for (const rules of [
      [
        { action: fixture.action, decision: 'allow' },
        { action: other, decision: 'allow' },
      ],
      [
        { action: other, decision: 'allow' },
        { action: fixture.action, decision: 'allow' },
      ],
    ]) {
      const policy = executionPolicy(rules, {
        schemaVersion: 3,
        reviewRequired: [fixture.action],
        defaultDecision: 'ask',
      });
      expect(await execution(policy)).toEqual(metadata('ask', 'review-required'));
      expect((await execution(policy, other)).decision).toBe('allow');
      expect(await execution(policy, { ...other, args: ['UNMATCHED'] })).toEqual(metadata('ask'));
      const reviewed = await execution(policy, fixture.action, { review: true });
      expect({ decision: reviewed.decision, reason: reviewed.reason }).toEqual(
        metadata('ask', 'review-required'),
      );
      expect(reviewed.launch.args).toEqual(fixture.action.args);
    }
  });

  it('trusted review exposes an ask descriptor without changing ask into allow, and never exposes deny', async () => {
    for (const kind of ['explicit', 'default']) {
      const policy = executionPolicy(
        kind === 'explicit' ? [{ action: fixture.action, decision: 'ask' }] : [],
        { defaultDecision: 'ask' },
      );
      for (const review of [false, 'true', 1])
        expect(await execution(policy, fixture.action, { review })).toEqual(metadata('ask'));
      const reviewed = await execution(policy, fixture.action, { review: true });
      expect({ decision: reviewed.decision, reason: reviewed.reason }).toEqual(metadata('ask'));
      expect(reviewed.launch.args).toEqual(fixture.action.args);
    }
    expect(
      await execution(
        executionPolicy([{ action: fixture.action, decision: 'deny' }]),
        fixture.action,
        { review: true },
      ),
    ).toEqual(metadata('deny'));
  });

  it('invalidates review references to ask, deny, absent or duplicate actions before any allow', async () => {
    const other = { ...fixture.action, args: ['OTHER'] };
    for (const decision of ['ask', 'deny']) {
      const policy = executionPolicy(
        [
          { action: fixture.action, decision: 'allow' },
          { action: other, decision },
        ],
        { schemaVersion: 3, reviewRequired: [other] },
      );
      expect(await execution(policy)).toEqual(metadata('deny', 'policy-invalid'));
    }
    for (const reviewRequired of [
      [other],
      [
        fixture.action,
        { env: {}, args: fixture.action.args, cwd: fixture.root, executable: process.execPath },
      ],
    ]) {
      expect(
        await execution(
          executionPolicy([{ action: fixture.action, decision: 'allow' }], {
            schemaVersion: 3,
            reviewRequired,
          }),
        ),
      ).toEqual(metadata('deny', 'policy-invalid'));
    }
  });
});
