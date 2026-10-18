import { describe, expect, it } from 'vitest';
import { groupReceipt } from '../fixtures/etw-package-receipts.js';
import {
  ORPHAN_MODES,
  etwOrphanCasePassed,
  etwOrphanPassed,
} from '../../tools/development/etw-orphan-contract.mjs';

function orphanCase(mode) {
  const guardianOnly = mode === 'custodian-exit';
  return {
    status: 'PASS',
    mode,
    productionAdmission: false,
    packaged: true,
    diagnosticBuild: true,
    windowInputIsolated: true,
    mainCustodyObserved: true,
    observerExited: true,
    closureConfirmed: true,
    contentExcluded: true,
    noDiagnosticAudit: true,
    before: { status: 4201, present: false },
    after: { status: 4201, present: false },
    reserved: { originalPids: [71, 72, 73, 74, 75], custodianPid: 76 },
    mainPid: 71,
    helperPids: [72, 73, 74, 75, 76],
    appExitCode: guardianOnly ? 0 : 73,
    abruptAppExit: !guardianOnly,
    liveReady: !mode.includes('-before-'),
    presence: {
      status: mode === 'orphan-before-start' ? 4201 : 0,
      present: mode !== 'orphan-before-start',
    },
    mainAndBrokerSurvivedUntilTripleExit: mode === 'orphan-native-first',
    terminal: {
      custodianExit: 4,
      receipt: {
        kind: 'terminal',
        recovered: true,
        absent: true,
        exits: [73, 75, 70, 71, 74],
        queryStatus: mode === 'orphan-before-start' ? 4201 : 0,
        restrictedProbeStatus: mode === 'orphan-access-denied' ? 5 : null,
        finalTotals: null,
        observationGap: true,
      },
    },
    custodianExit: guardianOnly ? 76 : undefined,
    mainSurvived: guardianOnly,
    failureVisible: guardianOnly,
    noAutomaticRestart: guardianOnly,
    summary: { recoveryVerified: true, exitCode: 4, finalTotals: null, observationGap: true },
  };
}
function fullReceipt() {
  const r = groupReceipt();
  for (const mode of ORPHAN_MODES) r.cases[mode] = orphanCase(mode);
  return r;
}
describe('packaged recovery after the original main and four native processes exit', () => {
  it('requires six new captures plus every previous regression', () => {
    expect(etwOrphanPassed(fullReceipt())).toBe(true);
  });
  it.each([
    (r) => {
      delete r.cases['orphan-before-start'];
    },
    (r) => {
      r.cases['orphan-before-arm'].terminal.receipt.queryStatus = 4201;
    },
    (r) => {
      r.cases['orphan-main-first'].terminal.receipt.exits[0] = 0;
    },
    (r) => {
      r.cases['orphan-native-first'].mainAndBrokerSurvivedUntilTripleExit = false;
    },
    (r) => {
      r.cases['orphan-access-denied'].terminal.receipt.restrictedProbeStatus = null;
    },
    (r) => {
      r.cases['orphan-main-first'].terminal.receipt.absent = false;
    },
    (r) => {
      r.cases['orphan-main-first'].terminal.custodianExit = 2;
    },
    (r) => {
      r.cases['orphan-main-first'].reserved.originalPids.pop();
    },
    (r) => {
      r.cases['orphan-main-first'].mainPid = 99;
    },
    (r) => {
      r.cases['orphan-main-first'].helperPids.pop();
    },
    (r) => {
      r.cases['orphan-main-first'].reserved.custodianPid = 73;
    },
    (r) => {
      r.cases['orphan-main-first'].helperPids.push(99);
    },
    (r) => {
      r.cases['orphan-main-first'].after = { status: 5, present: false };
    },
    (r) => {
      r.cases['orphan-main-first'].terminal.receipt.finalTotals = {};
    },
    (r) => {
      r.cases['custodian-exit'].custodianExit = 0;
    },
    (r) => {
      r.cases['custodian-exit'].noAutomaticRestart = false;
    },
    (r) => {
      delete r.cases['group-before-arm'];
    },
    (r) => {
      r.regression.normal.asyncProof.native.pending = 0;
    },
  ])('rejects an incomplete original group, cleanup, observation or regression (%#)', (mutate) => {
    const r = fullReceipt();
    mutate(r);
    expect(etwOrphanPassed(r)).toBe(false);
  });
  it('never treats query denial as observed absence', () => {
    const c = orphanCase('orphan-before-start');
    c.presence.status = 5;
    expect(etwOrphanCasePassed(c)).toBe(false);
  });
  it('accepts observed normal broker exit only with original-object closure and live-trace cleanup proof', () => {
    const c = orphanCase('orphan-main-first');
    c.terminal.receipt.exits[1] = 0;
    expect(etwOrphanCasePassed(c)).toBe(true);
    c.terminal.receipt.queryStatus = 4201;
    expect(etwOrphanCasePassed(c)).toBe(false);
    c.terminal.receipt.queryStatus = 0;
    c.terminal.receipt.exits[1] = 2;
    expect(etwOrphanCasePassed(c)).toBe(false);
    c.terminal.receipt.exits[1] = 0;
    c.closureConfirmed = false;
    expect(etwOrphanCasePassed(c)).toBe(false);
  });
});
