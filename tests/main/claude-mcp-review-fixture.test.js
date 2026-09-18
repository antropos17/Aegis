import { expect, it } from 'vitest';
import { reviewScenarioPassed } from '../../scripts/claude-mcp-review-fixture.mjs';

function observed(name = 'approved-ask') {
  const base = {
    name,
    toolDiscovered: true,
    timedOut: false,
    exceeded: false,
    stdoutPrivacyPass: true,
    brokerClosed: true,
    endpointRemoved: true,
    ownerAbortRequired: false,
    privacyLeakDetected: false,
    exitCode: 0,
    cancelled: false,
    toolResultSeen: true,
    privacyPass: true,
    previewCount: 1,
    sentinel: true,
    resultIsError: false,
    report: {
      decision: 'allow',
      authorization: 'operator-confirmed',
      policyDecision: 'ask',
      reason: 'child-exited',
      execution: { state: 'exited', exitCode: 0, outputComplete: true },
    },
  };
  if (name === 'disconnect-during-review') {
    delete base.report;
    Object.assign(base, {
      cancelled: true,
      treeCleanupConfirmed: true,
      sentinel: false,
      toolResultSeen: false,
      exitCode: null,
      privacyPass: false,
    });
  } else if (name !== 'approved-ask') {
    Object.assign(base, {
      sentinel: false,
      resultIsError: true,
      previewCount: name === 'policy-deny' ? 0 : 1,
      negativeAnswerObserved: name === 'declined-ask',
      report: {
        decision: 'deny',
        reason: name === 'policy-deny' ? 'policy-deny' : 'confirmation-denied',
        execution: { state: 'not-started', exitCode: null },
      },
    });
  }
  return base;
}
const names = ['approved-ask', 'declined-ask', 'policy-deny', 'disconnect-during-review'];

it.each([undefined, false, 'true'])(
  'requires an observed negative answer for declined ask (%s)',
  (value) => {
    const item = observed('declined-ask');
    if (value === undefined) delete item.negativeAnswerObserved;
    else item.negativeAnswerObserved = value;
    expect(reviewScenarioPassed(item)).toBe(false);
  },
);

it.each(names)('accepts complete evidence for %s', (name) => {
  expect(reviewScenarioPassed(observed(name))).toBe(true);
});

it.each(names)(
  'rejects setup failure, privacy leaks and incomplete broker cleanup for %s',
  (name) => {
    for (const change of [
      { toolDiscovered: false },
      { timedOut: true },
      { exceeded: true },
      { stdoutPrivacyPass: false },
      { privacyLeakDetected: true },
      { brokerClosed: false },
      { endpointRemoved: false },
      { ownerAbortRequired: true },
    ])
      expect(reviewScenarioPassed({ ...observed(name), ...change })).toBe(false);
  },
);

it('requires affirmative ask evidence rather than only a successful child or sentinel', () => {
  for (const change of [
    { previewCount: 0 },
    { previewCount: 2 },
    { sentinel: false },
    { resultIsError: true },
    { exitCode: 1 },
    { toolResultSeen: false },
    { privacyPass: false },
    { cancelled: true },
  ])
    expect(reviewScenarioPassed({ ...observed(), ...change })).toBe(false);
  for (const change of [
    { decision: 'ask' },
    { authorization: undefined },
    { authorization: 'unexpected' },
    { policyDecision: 'allow' },
    { policyDecision: undefined },
    { execution: { state: 'exited', exitCode: 1, outputComplete: true } },
    { execution: { state: 'interrupted', exitCode: 0, outputComplete: true } },
    { execution: { state: 'exited', exitCode: 0, outputComplete: false } },
  ]) {
    const item = observed();
    Object.assign(item.report, change);
    expect(reviewScenarioPassed(item)).toBe(false);
  }
});

it.each(['declined-ask', 'policy-deny'])('requires actual denial evidence for %s', (name) => {
  for (const change of [
    { sentinel: true },
    { resultIsError: false },
    { toolResultSeen: false },
    { exitCode: 1 },
    { privacyPass: false },
    { cancelled: true },
    { previewCount: name === 'policy-deny' ? 1 : 0 },
  ])
    expect(reviewScenarioPassed({ ...observed(name), ...change })).toBe(false);
  for (const reason of [
    'preparation-unavailable',
    'configuration-changed',
    'unexpected',
    name === 'policy-deny' ? 'confirmation-denied' : 'policy-deny',
  ]) {
    const item = observed(name);
    item.report.reason = reason;
    expect(reviewScenarioPassed(item)).toBe(false);
  }
  const launched = observed(name);
  launched.report.execution.state = 'exited';
  expect(reviewScenarioPassed(launched)).toBe(false);
});

it('disconnect requires an observed preview, cancelled provider tree and no returned report', () => {
  for (const change of [
    { previewCount: 0 },
    { previewCount: 2 },
    { cancelled: false },
    { treeCleanupConfirmed: false },
    { sentinel: true },
    { toolResultSeen: true },
    { report: observed().report },
  ])
    expect(reviewScenarioPassed({ ...observed('disconnect-during-review'), ...change })).toBe(
      false,
    );
});

it.each(['approved-ask', 'declined-ask', 'policy-deny'])(
  'rejects missing or malformed report for %s',
  (name) => {
    for (const report of [
      undefined,
      null,
      {},
      {
        decision: name === 'approved-ask' ? 'allow' : 'deny',
        authorization: 'operator-confirmed',
        policyDecision: 'ask',
      },
    ]) {
      expect(reviewScenarioPassed({ ...observed(name), report })).toBe(false);
    }
  },
);

it('rejects an unknown scenario and an empty setup receipt', () => {
  expect(reviewScenarioPassed({ ...observed(), name: 'unrecognized' })).toBe(false);
  expect(reviewScenarioPassed({})).toBe(false);
});
