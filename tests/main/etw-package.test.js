import { describe, expect, it } from 'vitest';
import { etwPassed } from '../../tools/development/etw-package.mjs';

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
