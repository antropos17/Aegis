import { expect, it } from 'vitest';
import {
  statusScenarioPassed,
  verifyStatusRoute,
} from '../../scripts/claude-status-provider-fixture.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
function fixture(decision = 'allow', catalog = false) {
  const status = (attempts) => ({
    schemaVersion: 1,
    mode: 'action-route-status',
    scope: 'current-mcp-connection',
    selection: catalog ? 'catalog' : 'single-action',
    selectedActionCount: catalog ? 2 : 1,
    activity: 'idle',
    messagesObserved: 4 + attempts * 3,
    actionAttempts: attempts,
    ownerInvocations: attempts,
    ownerSettled: attempts,
    ownerFailures: 0,
    selectionRejected: 0,
    cancellationRequests: 0,
    limits: { messages: 128, actionAttempts: 16 },
    authorization: 'none',
    control: 'direct-child-only',
    outsideRouteCoverage: 'unknown',
    descendantControl: 'unsupported',
    blockingVerification: 'not-performed',
    providerIdentity: 'unverified',
  });
  const step = (tool, report, resultIsError = false) => ({
    tool,
    toolDiscovered: true,
    toolResultSeen: true,
    privacyPass: true,
    resultIsError,
    report,
  });
  const bytes = decision === 'allow' ? 1 : 0;
  return {
    decision,
    catalog,
    toolDiscovered: true,
    protocolError: false,
    privacyLeakDetected: false,
    failed: false,
    exitCode: 0,
    timedOut: false,
    cancelled: false,
    exceeded: false,
    stdoutPrivacyPass: true,
    requestedSteps: 3,
    completedSteps: 3,
    steps: [
      step('status', status(0)),
      step(
        'action',
        {
          schemaVersion: 1,
          mode: 'action-exec',
          decision,
          reason: decision === 'allow' ? 'child-exited' : 'policy-' + decision,
          execution: {
            state: decision === 'allow' ? 'exited' : 'not-started',
            exitCode: decision === 'allow' ? 0 : null,
            outputComplete: true,
            termination: 'not-requested',
          },
          control: 'direct-child-only',
          descendantControl: 'unsupported',
        },
        decision !== 'allow',
      ),
      step('status', status(1)),
    ],
    observations: [
      { unusedBytes: 0, selectedBytes: 0 },
      { unusedBytes: 0, selectedBytes: bytes },
      { unusedBytes: 0, selectedBytes: bytes },
    ],
    unusedBytes: 0,
    selectedBytes: bytes,
  };
}
it.each(['allow', 'deny', 'ask'])(
  'accepts coherent single and catalog %s observations',
  (decision) => {
    expect(statusScenarioPassed(fixture(decision))).toBe(true);
    expect(statusScenarioPassed(fixture(decision, true))).toBe(true);
  },
);
it('rejects missing setup evidence, errors, incomplete steps and privacy failures', () => {
  for (const mutation of [
    { toolDiscovered: false },
    { protocolError: true },
    { privacyLeakDetected: true },
    { failed: true },
    { exitCode: 1 },
    { timedOut: true },
    { cancelled: true },
    { exceeded: true },
    { stdoutPrivacyPass: false },
    { requestedSteps: 2 },
    { completedSteps: 2 },
    { steps: [] },
    { observations: [] },
    { decision: 'unknown' },
    { catalog: undefined },
  ])
    expect(statusScenarioPassed({ ...fixture(), ...mutation })).toBe(false);
});
it.each(['actionAttempts', 'ownerInvocations', 'ownerSettled'])(
  'requires initial zero and final one for %s',
  (counter) => {
    for (const [index, invalid] of [
      [0, 1],
      [2, 0],
      [2, 2],
      [2, '1'],
    ]) {
      const item = fixture();
      item.steps[index].report[counter] = invalid;
      expect(statusScenarioPassed(item)).toBe(false);
    }
  },
);
it.each(['ownerFailures', 'selectionRejected', 'cancellationRequests'])(
  'requires zero %s in both status snapshots',
  (counter) => {
    for (const index of [0, 2]) {
      const item = fixture();
      item.steps[index].report[counter] = 1;
      expect(statusScenarioPassed(item)).toBe(false);
    }
  },
);
it('rejects incorrect status scope, selection, limits or protection assertions', () => {
  for (const change of [
    { scope: 'global' },
    { selection: 'catalog' },
    { selectedActionCount: 2 },
    { activity: 'owner-pending' },
    { authorization: 'operator-confirmed' },
    { outsideRouteCoverage: 'complete' },
    { descendantControl: 'supported' },
    { blockingVerification: 'verified' },
    { providerIdentity: 'verified' },
    { limits: { messages: 129, actionAttempts: 16 } },
    { mode: 'action-exec' },
  ]) {
    const item = fixture();
    Object.assign(item.steps[2].report, change);
    expect(statusScenarioPassed(item)).toBe(false);
  }
});
it('requires bounded increasing message observations without imposing a fixed handshake count', () => {
  const item = fixture();
  item.steps[0].report.messagesObserved = 10;
  item.steps[2].report.messagesObserved = 30;
  expect(statusScenarioPassed(item)).toBe(true);
  for (const count of [0, 10, 129, 3.5, undefined]) {
    item.steps[2].report.messagesObserved = count;
    expect(statusScenarioPassed(item)).toBe(false);
  }
});
it('requires actual correlated result blocks and correct step kinds', () => {
  for (const index of [0, 1, 2])
    for (const change of [
      { tool: 'wrong' },
      { toolResultSeen: false },
      { toolDiscovered: false },
      { privacyPass: false },
      { privacyLeakDetected: true },
      { report: undefined },
    ]) {
      const item = fixture();
      Object.assign(item.steps[index], change);
      expect(statusScenarioPassed(item)).toBe(false);
    }
});
it.each(['allow', 'deny', 'ask'])(
  'checks action outcome and absence of extra side effects for %s',
  (decision) => {
    for (const change of [{ unusedBytes: 1 }, { selectedBytes: 2 }])
      expect(statusScenarioPassed({ ...fixture(decision), ...change })).toBe(false);
    for (let index = 0; index < 3; index++) {
      const item = fixture(decision);
      item.observations[index].unusedBytes = 1;
      expect(statusScenarioPassed(item)).toBe(false);
    }
    const item = fixture(decision);
    item.steps[1].report.decision = 'unknown';
    expect(statusScenarioPassed(item)).toBe(false);
    const before = fixture(decision);
    before.observations[0].selectedBytes = 1;
    expect(statusScenarioPassed(before)).toBe(false);
  },
);
it('rejects claimed success without successful direct-child result or with unexpected approval', () => {
  for (const change of [
    { execution: { state: 'not-started', exitCode: 0, outputComplete: true } },
    { execution: { state: 'exited', exitCode: 1, outputComplete: true } },
    { execution: { state: 'exited', exitCode: 0, outputComplete: false } },
    { authorization: 'operator-confirmed' },
    { policyDecision: 'ask' },
  ]) {
    const item = fixture();
    Object.assign(item.steps[1].report, change);
    expect(statusScenarioPassed(item)).toBe(false);
  }
});
it.each(['deny', 'ask'])(
  'rejects %s caused by setup failure or mismatched error indicator',
  (decision) => {
    const item = fixture(decision);
    item.steps[1].report.reason = 'preparation-unavailable';
    expect(statusScenarioPassed(item)).toBe(false);
    const other = fixture(decision);
    other.steps[1].resultIsError = false;
    expect(statusScenarioPassed(other)).toBe(false);
  },
);
it.each([null, {}, { steps: null }, { observations: [null] }])(
  'rejects malformed receipts',
  (item) => {
    expect(statusScenarioPassed(item)).toBe(false);
  },
);

it.each(['throws', 'timeout', 'overflow', 'cancel'])(
  'preserves scratch eligibility when provider cleanup is unknown after %s',
  async (failure) => {
    const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-status-fixture-'));
    let active;
    const receipt = { scenarios: [], rejectedProxyRequests: 0 };
    try {
      await verifyStatusRoute({
        owned,
        env: {},
        receipt,
        action: { executable: process.execPath, cwd: owned, args: [], env: {} },
        configPath: path.join(owned, 'mcp.json'),
        setScenario: (value) => {
          active = value;
        },
        run: async () => {
          if (failure === 'throws') throw Error('PRIVATE_PROVIDER_ERROR');
          return {
            code: 1,
            stdout: '',
            timedOut: failure === 'timeout',
            exceeded: failure === 'overflow',
            cancelled: failure === 'cancel',
            treeCleanupConfirmed: false,
          };
        },
      });
      expect(receipt.unreapedProcess).toBe(true);
      expect(receipt.cleanupUnconfirmed).toBe(true);
      expect(receipt.pass).toBe(false);
      expect(active).toBeNull();
      expect(fs.existsSync(owned)).toBe(true);
      expect(JSON.stringify(receipt)).not.toContain('PRIVATE_PROVIDER_ERROR');
    } finally {
      expect(path.dirname(owned)).toBe(path.resolve(os.tmpdir()));
      expect(fs.lstatSync(owned).isSymbolicLink()).toBe(false);
      fs.rmSync(owned, { recursive: true, force: true });
    }
  },
);
