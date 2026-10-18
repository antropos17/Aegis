import {
  receipt,
  recoveryReceipt,
  failureReceipt,
  dualReceipt,
} from '../fixtures/etw-package-receipts.js';
import { describe, expect, it } from 'vitest';
import { etwPassed, etwRecoveryPassed } from '../../tools/development/etw-package.mjs';
import { etwFailuresPassed } from '../../tools/development/etw-failure-contract.mjs';
import { etwDualPassed } from '../../tools/development/etw-dual-contract.mjs';

describe('packaged ETW diagnostic evidence', () => {
  it('accepts measured diagnostic losses without claiming production admission', () => {
    expect(etwPassed(receipt())).toBe(true);
  });
  it.each([
    'liveReady',
    'readCandidate',
    'scopeExcluded',
    'populationReliable',
    'healthVisible',
    'quitDuringCapture',
    'closureConfirmed',
    'contentExcluded',
    'noDiagnosticAudit',
  ])('requires the actual %s observation', (key) => {
    const r = receipt();
    delete r[key];
    expect(etwPassed(r)).toBe(false);
  });
  it('rejects unverified stop, unmeasured counters, false health and inconsistent losses', () => {
    for (const mutate of [
      (r) => {
        r.summary.stopVerified = false;
      },
      (r) => {
        r.summary.exitCode = 2;
      },
      (r) => {
        r.summary.finalCounters.eventsLost = null;
      },
      (r) => {
        r.summary.finalCounters.queryStatus = 5;
      },
      (r) => {
        r.summary.finalTotals.dropped = '0';
      },
      (r) => {
        r.health.state = 'HEALTHY';
      },
      (r) => {
        r.productionAdmission = true;
      },
    ]) {
      const r = receipt();
      mutate(r);
      expect(etwPassed(r)).toBe(false);
    }
  });
});

describe('packaged ETW failure boundaries', () => {
  it('requires all five boundaries plus actual attribution and fresh-session regression', () => {
    expect(etwFailuresPassed(failureReceipt())).toBe(true);
  });
  it.each([
    (r) => {
      delete r.cases['guard-exit'];
    },
    (r) => {
      r.cases['collector-before-arm'].summary.recoveryVerified = false;
    },
    (r) => {
      r.cases['collector-before-start'].summary.finalCounters.queryStatus = 0;
    },
    (r) => {
      r.cases['guard-exit'].restartBlocked = true;
    },
    (r) => {
      r.cases['broker-exit'].summary.finalCounters = { queryStatus: 0 };
    },
    (r) => {
      r.cases['guard-exit'].after = { status: 5, present: false };
    },
    (r) => {
      r.cases['app-exit'].appExitCode = 0;
    },
    (r) => {
      r.cases['app-exit'].presence = { status: 4201, present: false };
    },
    (r) => {
      r.regression.normal.asyncProof.native.pending = 0;
    },
  ])('rejects missing, unknown or inconsistent boundary evidence (%#)', (mutate) => {
    const r = failureReceipt();
    mutate(r);
    expect(etwFailuresPassed(r)).toBe(false);
  });
});

describe('packaged ETW dual-loss evidence', () => {
  it('requires both ready loss orders, both early boundaries and the existing seven regressions', () => {
    expect(etwDualPassed(dualReceipt())).toBe(true);
  });
  it.each([
    (r) => {
      delete r.cases['dual-before-arm'];
    },
    (r) => {
      r.cases['dual-guard-first'].helperPids.pop();
    },
    (r) => {
      r.cases['dual-collector-first'].summary.recoveryCause = 'collector-exited';
    },
    (r) => {
      r.cases['dual-before-start'].summary.finalCounters.queryStatus = 0;
    },
    (r) => {
      r.cases['dual-before-arm'].summary.capture = {};
    },
    (r) => {
      r.cases['dual-guard-first'].summary.finalTotals = {};
    },
    (r) => {
      r.cases['dual-collector-first'].after.status = 87;
    },
    (r) => {
      r.cases['dual-guard-first'].restartBlocked = true;
    },
    (r) => {
      r.cases['dual-collector-first'].summary.exitCode = 0;
    },
    (r) => {
      r.cases['dual-guard-first'].noAutomaticRestart = false;
    },
    (r) => {
      r.regression.normal.asyncProof.native.pending = 0;
    },
  ])('rejects incomplete or inflated dual-loss evidence (%#)', (mutate) => {
    const r = dualReceipt();
    mutate(r);
    expect(etwDualPassed(r)).toBe(false);
  });
});

describe('packaged ETW recovery qualification', () => {
  it('requires separate failed-but-cleaned and normally stopped captures with independent read witnesses', () => {
    expect(etwRecoveryPassed(recoveryReceipt())).toBe(true);
  });
  it.each([
    (r) => {
      r.crash.summary.exitCode = 0;
    },
    (r) => {
      r.crash.summary.recoveryVerified = false;
    },
    (r) => {
      r.crash.summary.finalTotals = {};
    },
    (r) => {
      r.crash.guardClosureConfirmed = false;
    },
    (r) => {
      r.normal.asyncProof.native.pending = 0;
    },
    (r) => {
      r.crash.syncProof.record.generationWitness = '116444736010000002';
    },
    (r) => {
      r.normal.syncProof.record.issuerInterval.fromQpc = '150';
    },
    (r) => {
      r.crash.asyncProof.record.generationInterval.toQpc = '181';
    },
    (r) => {
      r.crash.rapidExitUnresolved = false;
    },
    (r) => {
      r.normal.summary.stopVerified = false;
    },
    (r) => {
      r.newSessionAfterRecovery = false;
    },
  ])('rejects incomplete or contradictory live evidence (%#)', (mutate) => {
    const r = recoveryReceipt();
    mutate(r);
    expect(etwRecoveryPassed(r)).toBe(false);
  });
});
