import { describe, expect, it } from 'vitest';
import { etwPassed, etwRecoveryPassed } from '../../tools/development/etw-package.mjs';

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
