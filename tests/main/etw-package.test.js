import { describe, expect, it } from 'vitest';
import { etwPassed, etwRecoveryPassed } from '../../tools/development/etw-package.mjs';
import { etwFailuresPassed } from '../../tools/development/etw-failure-contract.mjs';
import { etwDualPassed } from '../../tools/development/etw-dual-contract.mjs';

function receipt() {
  return {
    status: 'PASS',
    productionAdmission: false,
    ...Object.fromEntries(
      [
        'packaged',
        'diagnosticBuild',
        'bundleSelfContained',
        'windowInputIsolated',
        'liveReady',
        'readCandidate',
        'candidateMetadataOnly',
        'scopeExcluded',
        'ringBounded',
        'populationReliable',
        'healthVisible',
        'quitDuringCapture',
        'closureConfirmed',
        'contentExcluded',
        'noDiagnosticAudit',
      ].map((key) => [key, true]),
    ),
    health: { state: 'DEGRADED', detail: 'experimental-correlation' },
    summary: {
      stopVerified: true,
      phase: 'stopped',
      exitCode: 0,
      stopReason: 'shutdown',
      finalCounters: {
        queryStatus: 0,
        eventsLost: '0',
        realTimeBuffersLost: '0',
        logBuffersLost: '0',
      },
      finalTotals: {
        dropped: '7',
        ingressDropped: '5',
        outputDropped: '2',
        outputOverflowDropped: '1',
        outputInvalidatedDropped: '1',
      },
    },
  };
}
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

function recoveryReceipt() {
  const proof = {
    native: {
      pid: 71,
      tid: 81,
      birth: '116444736010000001',
      fromQpc: '100',
      toQpc: '200',
      reads: 160,
      pending: 160,
    },
    record: {
      provider: 'edd08927-9cc4-4e65-b970-c2560fb5c289',
      eventId: 15,
      version: 1,
      qpc: '150',
      issuerInterval: { fromQpc: '99', toQpc: '180' },
      generationInterval: { fromQpc: '160', toQpc: '170' },
      generationSource: 'createTime100ns',
      issuerStatus: 'verified',
      generationStatus: 'verified',
      issuerPid: 71,
      issuingTid: 81,
      generationWitness: '116444736010000001',
      instanceId: '71:1000',
      agent: 'Aider',
    },
  };
  return {
    status: 'PASS',
    productionAdmission: false,
    newSessionAfterRecovery: true,
    normal: { ...receipt(), syncProof: structuredClone(proof), asyncProof: structuredClone(proof) },
    crash: {
      status: 'PASS',
      closureConfirmed: true,
      failureVisible: true,
      guardClosureConfirmed: true,
      noAutomaticRestart: true,
      rapidExitNoWrongGeneration: true,
      rapidExitUnresolved: true,
      rapidExitObserved: 1,
      syncProof: structuredClone(proof),
      asyncProof: structuredClone(proof),
      summary: {
        recoveryVerified: true,
        stopVerified: false,
        exitCode: 4,
        collectorExit: 70,
        finalTotals: null,
        observationGap: true,
      },
    },
  };
}

function failureReceipt() {
  return {
    status: 'PASS',
    productionAdmission: false,
    regression: recoveryReceipt(),
    cases: Object.fromEntries(
      [
        'collector-before-start',
        'collector-before-arm',
        'guard-exit',
        'broker-exit',
        'app-exit',
      ].map((mode) => [
        mode,
        {
          mode,
          status: 'PASS',
          packaged: true,
          diagnosticBuild: true,
          windowInputIsolated: true,
          closureConfirmed: true,
          contentExcluded: true,
          noDiagnosticAudit: true,
          before: { status: 4201, present: false },
          after: { status: 4201, present: false },
          presence: { status: 0, present: true },
          failureVisible: true,
          noAutomaticRestart: true,
          abruptAppExit: mode === 'app-exit',
          appExitCode: 73,
          restartBlocked: mode === 'broker-exit',
          summary: {
            recoveryVerified: mode.startsWith('collector-before-') || mode === 'guard-exit',
            recoveryCause:
              mode === 'guard-exit' ? 'collector-and-guard-exited' : 'collector-exited',
            capture: null,
            finalTotals: null,
            observationGap: true,
            collectorExit: mode === 'guard-exit' ? 2 : 70,
            exitCode:
              mode.startsWith('collector-before-') || mode === 'guard-exit'
                ? 4
                : mode === 'broker-exit'
                  ? 72
                  : 2,
            finalCounters: mode.startsWith('collector-before-')
              ? { queryStatus: mode === 'collector-before-start' ? 4201 : 0 }
              : mode === 'guard-exit'
                ? { queryStatus: 4201 }
                : null,
          },
        },
      ]),
    ),
  };
}
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

function dualReceipt() {
  const r = failureReceipt();
  for (const mode of [
    'dual-before-start',
    'dual-before-arm',
    'dual-guard-first',
    'dual-collector-first',
  ]) {
    const c = structuredClone(r.cases['collector-before-arm']);
    c.mode = mode;
    c.helperPids = [71, 72, 73, 74];
    c.summary.stopVerified = false;
    c.summary.phase = 'recovered';
    c.summary.recoveryCause = 'collector-and-guard-exited';
    c.summary.finalCounters.queryStatus = mode === 'dual-before-start' ? 4201 : 0;
    r.cases[mode] = c;
  }
  return r;
}
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
