import { describe, expect, it } from 'vitest';
import { agentReadPassed } from '../../tools/development/agent-read-contract.mjs';
import { observation } from './platform/etw-file-fixtures.js';

// Modeled oracle vectors, not genuine provider or packaged-application evidence.
function receipt() {
  const instanceId = '71:1788859733333',
    birth = '134333333333333337',
    file = 'C:\\fixture\\.env.test';
  return {
    status: 'PASS',
    productionAdmission: false,
    realAgent: 'Claude Code',
    file,
    agentPid: 71,
    ...Object.fromEntries(
      [
        'packaged',
        'diagnosticBuild',
        'fixtureOnly',
        'liveReady',
        'warmupRead',
        'actualToolRead',
        'onlyRequestedReads',
        'returnedCanary',
        'uiReadAndRisk',
        'appClosed',
        'contentExcluded',
        'noDiagnosticAudit',
      ].map((key) => [key, true]),
    ),
    agentIdentity: { pid: 71, createTime100ns: birth, instanceId, instanceIdSource: 'os' },
    readProof: observation({
      qpc: '110',
      path: file,
      pathEvidence: 'candidate-object',
      issuerStatus: 'verified',
      issuerPid: 71,
      issuerInterval: { fromQpc: '100', toQpc: '120' },
      generationStatus: 'verified',
      generationWitness: birth,
      generationSource: 'createTime100ns',
      generationInterval: { fromQpc: '115', toQpc: '120' },
      agent: 'Claude Code',
      instanceId,
    }),
    rendererObservation: {
      agent: 'Claude Code',
      pid: 71,
      instanceId,
      path: file,
      pathEvidence: 'candidate-object',
      sensitiveReason: 'Environment variables',
      reads: 1,
    },
    agentExit: 0,
    appExit: 0,
    independentAbsence: { status: 4201, present: false },
    remainingNativeProcesses: 0,
    summary: {
      phase: 'stopped',
      exitCode: 0,
      stopVerified: true,
      stopReason: 'shutdown',
      finalCounters: { queryStatus: 0 },
      finalTotals: { dropped: '0' },
    },
  };
}
describe('genuine-agent journey acceptance oracle', () => {
  it('requires explicit ordinary-package controls and capture beyond one minute', () => {
    const value = {
      ...receipt(),
      mode: 'ordinary',
      diagnosticBuild: false,
      noDiagnosticArguments: true,
      noAutomaticCapture: true,
      operatorStartedCapture: true,
      continuousCaptureMs: 65000,
    };
    expect(agentReadPassed(value)).toBe(true);
    for (const [key, replacement] of Object.entries({
      diagnosticBuild: true,
      noDiagnosticArguments: false,
      noAutomaticCapture: false,
      operatorStartedCapture: false,
      continuousCaptureMs: 59999,
    }))
      expect(agentReadPassed({ ...value, [key]: replacement }), key).toBe(false);
    value.summary.stopReason = 'operator-stop';
    expect(agentReadPassed(value)).toBe(false);
    value.operatorStoppedCapture = true;
    expect(agentReadPassed(value)).toBe(true);
    expect(agentReadPassed({ ...value, mode: 'diagnostic', diagnosticBuild: true })).toBe(false);
  });
  it('accepts a separately identified first read only without fixture warmup', () => {
    const value = {
      ...receipt(),
      scenario: 'first-read',
      firstReadOnly: true,
      issuerPreparedBeforeRead: true,
      warmupRead: false,
    };
    expect(agentReadPassed(value)).toBe(true);
    expect(agentReadPassed({ ...value, firstReadOnly: false })).toBe(false);
    expect(agentReadPassed({ ...value, warmupRead: true })).toBe(false);
    expect(agentReadPassed({ ...value, issuerPreparedBeforeRead: false })).toBe(false);
  });
  it('accepts consistent evidence without upgrading the candidate path', () => {
    const value = receipt();
    expect(agentReadPassed(value)).toBe(true);
    expect(value.readProof.pathEvidence).toBe('candidate-object');
  });
  it('requires every genuine-read, visible-risk, privacy and package observation', () => {
    for (const key of [
      'packaged',
      'diagnosticBuild',
      'actualToolRead',
      'returnedCanary',
      'onlyRequestedReads',
      'uiReadAndRisk',
      'contentExcluded',
      'noDiagnosticAudit',
    ]) {
      const value = receipt();
      value[key] = false;
      expect(agentReadPassed(value), key).toBe(false);
    }
  });
  it('refuses candidate issuers, PID reuse, path mismatch and forged labels', () => {
    for (const mutate of [
      (r) => (r.readProof.issuerStatus = 'candidate'),
      (r) => (r.agentIdentity.createTime100ns = '134333333333333338'),
      (r) => (r.rendererObservation.path = 'C:\\other\\.env'),
      (r) => (r.rendererObservation.pathEvidence = 'confirmed'),
      (r) => (r.readProof.agent = 'Other agent'),
    ]) {
      const value = receipt();
      mutate(value);
      expect(agentReadPassed(value)).toBe(false);
    }
  });
  it('refuses unknown or incomplete native cleanup and retained failed results', () => {
    for (const mutate of [
      (r) => (r.independentAbsence = { status: 5, present: null }),
      (r) => (r.remainingNativeProcesses = 1),
      (r) => (r.summary.stopVerified = false),
      (r) => (r.agentTerminationRequested = true),
      (r) => (r.agentCleanupUnconfirmed = true),
      (r) => (r.summary.exitCode = 2),
      (r) => (r.status = 'FAIL'),
    ]) {
      const value = receipt();
      mutate(value);
      expect(agentReadPassed(value)).toBe(false);
    }
  });
});
