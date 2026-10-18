import { describe, expect, it } from 'vitest';
import {
  DURABLE_MODES,
  etwDurableCasePassed,
  etwDurablePassed,
} from '../../tools/development/etw-durable-contract.mjs';

function receipt(mode) {
  return {
    status: 'PASS',
    mode,
    productionAdmission: false,
    packaged: true,
    diagnosticBuild: true,
    windowInputIsolated: true,
    originalObjectsObserved: true,
    allSixExited: true,
    closureConfirmed: true,
    contentExcluded: true,
    noDiagnosticAudit: true,
    journalWriteAccessDenied: true,
    recoveryBeforeNewTrace: true,
    recoveryMainWasFresh: true,
    observationGap: true,
    finalTotals: null,
    before: { status: 4201, present: false },
    beforeRecovery: {
      status: mode.endsWith('before-start') ? 4201 : 0,
      present: !mode.endsWith('before-start'),
    },
    after: { status: 4201, present: false },
    reserved: { originalPids: [71, 72, 73, 74, 75], custodianPid: 76 },
    mainPid: 71,
    appExitCode: 73,
    peerExit: { custodianExit: 76, originalExits: [73, 75, 70, 71, 74] },
    recovery: {
      mainPid: 81,
      journalRecovered: true,
      presence: { status: 4201, present: false },
      restrictedProbeStatus: mode === 'orphan-total-denial' ? 5 : null,
      terminal: {
        custodianExit: 4,
        receipt: { absent: true, finalTotals: null, observationGap: true },
      },
    },
    liveOwnerBlocked: true,
    liveOwnerUnaffected: true,
  };
}
describe('packaged recovery after all six original processes exit', () => {
  it.each(DURABLE_MODES)(
    'accepts complete original-object and fresh-main evidence for %s',
    (mode) => {
      expect(etwDurableCasePassed(receipt(mode))).toBe(true);
    },
  );
  it.each([
    (c) => {
      c.peerExit.custodianExit = 4;
    },
    (c) => {
      c.peerExit.originalExits.pop();
    },
    (c) => {
      c.peerExit.originalExits[0] = 0;
    },
    (c) => {
      c.originalObjectsObserved = false;
    },
    (c) => {
      c.reserved.custodianPid = 72;
    },
    (c) => {
      c.allSixExited = false;
    },
    (c) => {
      c.journalWriteAccessDenied = false;
    },
    (c) => {
      c.recovery.journalRecovered = false;
    },
    (c) => {
      c.beforeRecovery.status = 4201;
    },
    (c) => {
      c.recovery.presence.status = 0;
    },
    (c) => {
      c.recovery.mainPid = c.mainPid;
    },
    (c) => {
      c.recovery.terminal.custodianExit = 2;
    },
    (c) => {
      c.recovery.terminal.receipt.finalTotals = {};
    },
    (c) => {
      c.liveOwnerUnaffected = false;
    },
    (c) => {
      c.productionAdmission = true;
    },
  ])('rejects incomplete or contradictory recovery evidence %#', (mutate) => {
    const c = receipt('orphan-total-running');
    mutate(c);
    expect(etwDurableCasePassed(c)).toBe(false);
  });
  it('requires actual denied control and all previous regressions', () => {
    const c = receipt('orphan-total-denial');
    c.recovery.restrictedProbeStatus = null;
    expect(etwDurableCasePassed(c)).toBe(false);
    expect(
      etwDurablePassed({
        status: 'PASS',
        cases: Object.fromEntries(DURABLE_MODES.map((mode) => [mode, receipt(mode)])),
      }),
    ).toBe(false);
  });
});
