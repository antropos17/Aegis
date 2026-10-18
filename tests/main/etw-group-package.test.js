import { describe, expect, it } from 'vitest';
import { totalReceipt, groupReceipt } from '../fixtures/etw-package-receipts.js';
import { etwGroupPassed } from '../../tools/development/etw-group-contract.mjs';

describe('packaged main-held ETW recovery qualification', () => {
  it('requires all five four-process losses, seventeen regressions and a surviving original main', () => {
    expect(etwGroupPassed(groupReceipt())).toBe(true);
  });
  it('accepts an unverified fallback exit only after independently verified main recovery', () => {
    const r = groupReceipt();
    r.cases['broker-exit'].summary.recoveryPeers.fallbackExit = 2;
    expect(etwGroupPassed(r)).toBe(true);
    r.cases['broker-exit'].summary.recoveryVerified = false;
    expect(etwGroupPassed(r)).toBe(false);
  });
  it.each([
    (s) => {
      s.exitCode = 2;
    },
    (s) => {
      s.finalCounters.queryStatus = 5;
    },
    (s) => {
      s.recoveryPeers.fallbackExit = null;
    },
    (s) => {
      s.recoveryPeers.fallbackExit = 3;
    },
  ])('rejects incomplete main recovery after an unverified fallback exit (%#)', (mutate) => {
    const r = groupReceipt();
    const summary = r.cases['broker-exit'].summary;
    summary.recoveryPeers.fallbackExit = 2;
    mutate(summary);
    expect(etwGroupPassed(r)).toBe(false);
  });
  it.each([
    (r) => {
      delete r.cases['group-before-start'];
    },
    (r) => {
      r.cases['group-before-arm'].mainSurvived = false;
    },
    (r) => {
      r.cases['group-broker-first'].mainCustodyObserved = false;
    },
    (r) => {
      r.cases['group-triple-first'].summary.brokerExit = 0;
    },
    (r) => {
      r.cases['group-broker-first'].summary.collectorExit = 0;
    },
    (r) => {
      r.cases['group-triple-first'].summary.recoveryPeers.guardExit = 0;
    },
    (r) => {
      r.cases['group-broker-first'].summary.recoveryPeers.fallbackExit = 0;
    },
    (r) => {
      r.cases['group-before-start'].summary.finalCounters.queryStatus = 0;
    },
    (r) => {
      r.cases['group-before-arm'].summary.finalTotals = {};
    },
    (r) => {
      r.cases['group-broker-first'].helperPids.pop();
    },
    (r) => {
      r.cases['group-triple-first'].summary.capture = null;
    },
    (r) => {
      r.cases['group-broker-first'].restartBlocked = true;
    },
    (r) => {
      r.cases['group-access-denied'].cleanupConsentPendingObserved = false;
    },
    (r) => {
      r.cases['group-access-denied'].summary.recoveryPeers.accessDenied = false;
    },
    (r) => {
      r.cases['group-before-arm'].after.status = 87;
    },
    (r) => {
      r.cases['broker-exit'] = totalReceipt().cases['broker-exit'];
    },
    (r) => {
      delete r.cases['triple-fallback-first'];
    },
    (r) => {
      r.regression.normal.asyncProof.native.pending = 0;
    },
  ])(
    'rejects incomplete custody, fabricated final totals or earlier-only evidence (%#)',
    (mutate) => {
      const r = groupReceipt();
      mutate(r);
      expect(etwGroupPassed(r)).toBe(false);
    },
  );
});
