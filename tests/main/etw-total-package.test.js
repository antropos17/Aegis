import { describe, expect, it } from 'vitest';
import { dualReceipt } from '../fixtures/etw-package-receipts.js';
import { etwTotalPassed } from '../../tools/development/etw-total-contract.mjs';

function totalReceipt() {
  const r = dualReceipt();
  for (const mode of [
    'triple-before-start',
    'triple-before-arm',
    'triple-collector-first',
    'triple-guard-first',
    'triple-fallback-first',
    'triple-access-denied',
  ]) {
    const c = structuredClone(r.cases['dual-before-arm']);
    c.mode = mode;
    c.summary.recoveryCause = 'all-three-helpers-exited';
    c.summary.recoveryPeers = {
      guardExit: 71,
      fallbackExit: 74,
      brokerElevated: false,
      cleanupElevated: mode === 'triple-access-denied',
      accessDenied: mode === 'triple-access-denied',
    };
    c.summary.finalCounters.queryStatus = mode.endsWith('before-start') ? 4201 : 0;
    r.cases[mode] = c;
  }
  return r;
}

describe('packaged ETW all-helper-loss evidence', () => {
  it('requires original peer exits, ordinary broker cleanup and all eleven regressions', () => {
    expect(etwTotalPassed(totalReceipt())).toBe(true);
  });
  it.each([
    (r) => {
      delete r.cases['triple-before-start'];
    },
    (r) => {
      r.cases['triple-before-arm'].summary.capture = {};
    },
    (r) => {
      r.cases['triple-guard-first'].helperPids.pop();
    },
    (r) => {
      r.cases['triple-collector-first'].summary.recoveryPeers.guardExit = 0;
    },
    (r) => {
      r.cases['triple-fallback-first'].summary.recoveryPeers.fallbackExit = 0;
    },
    (r) => {
      r.cases['triple-collector-first'].summary.recoveryPeers.brokerElevated = true;
    },
    (r) => {
      r.cases['triple-guard-first'].summary.recoveryCause = 'collector-and-guard-exited';
    },
    (r) => {
      r.cases['triple-fallback-first'].summary.finalTotals = {};
    },
    (r) => {
      r.cases['triple-before-start'].summary.finalCounters.queryStatus = 0;
    },
    (r) => {
      r.cases['triple-before-arm'].summary.finalCounters.queryStatus = 5;
    },
    (r) => {
      r.cases['triple-guard-first'].after.status = 87;
    },
    (r) => {
      r.cases['triple-collector-first'].noAutomaticRestart = false;
    },
    (r) => {
      r.cases['triple-fallback-first'].summary.exitCode = 0;
    },
    (r) => {
      delete r.cases['dual-guard-first'];
    },
    (r) => {
      r.regression.normal.asyncProof.native.pending = 0;
    },
    (r) => {
      r.cases['triple-access-denied'].summary.recoveryPeers.accessDenied = false;
    },
    (r) => {
      r.cases['triple-access-denied'].summary.recoveryPeers.cleanupElevated = false;
    },
  ])('rejects incomplete, elevated or inflated recovery evidence (%#)', (mutate) => {
    const r = totalReceipt();
    mutate(r);
    expect(etwTotalPassed(r)).toBe(false);
  });
});
