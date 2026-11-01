import { describe, expect, it } from 'vitest';
import {
  projectScannerReadiness,
  recordScannerReadiness,
  readScannerSnapshotDiagnostic,
} from '../../scripts/qualification/windows-native-read-readiness.mjs';

const witness = { pid: 42, birth: '134373359662404617' };
const ready = () => ({
  readiness: { populationReliable: true, identityDegraded: false, monitoringPaused: false },
  agents: [{ pid: witness.pid, instanceIdSource: 'os', createTime100ns: witness.birth }],
});

describe('native-read scanner readiness diagnostics', () => {
  it('reads existing getters through a serialized self-contained closure and projects only safe bounded fields', () => {
    const closed = new Function('return (' + readScannerSnapshotDiagnostic.toString() + ')')();
    const requested = [];
    const diagnostic = closed({ app: {} }, (name) => {
      requested.push(name);
      if (name.endsWith('/process-scanner.js'))
        return {
          getProcessCapabilities: () => ({ populationAsOf: 1700000000100, private: 'PRIVATE' }),
          getProcessSensorHealth: () => ({ lastSuccessAt: 1700000000100 }),
        };
      if (name.endsWith('/scan-loop.js'))
        return {
          getScanCadence: () => ({
            maxProcessGapMs: 40000,
            skippedProcessTicks: 1000001,
            lastSkippedAt: 1700000000200,
            private: 'PRIVATE_CADENCE',
          }),
        };
      return name.endsWith('/process-snapshot.js')
        ? {
            getSnapshotHealth: () => ({
              state: 'FAILED',
              detail: 'none',
              lastError: 'PRIVATE_C:/profile',
              lastAttemptAt: 1700000000000,
              lastSuccessAt: null,
              pid: 42,
            }),
            getSourceStats: () => ({ lastSource: 'none', transitions: 99999 }),
            getMode: () => 'strict',
          }
        : {
            getState: () => ({
              connected: false,
              sticky: 'PRIVATE_FAILURE',
              failures: 999,
              caps: { class: 'class5', sequence: false, topology: true },
              firstFailure: {
                kind: 'child-exit',
                exitCode: 2,
                stderrClass: 'probe-birth-mismatch',
                private: 'PRIVATE_FIRST',
              },
              private: 'PRIVATE_PATH',
            }),
          };
    });
    expect(requested).toEqual([
      './src/main/platform/process-snapshot.js',
      './src/main/platform/proc-snapshot-client.js',
      './src/main/process-scanner.js',
      './src/main/scan-loop.js',
    ]);
    expect(diagnostic).toEqual({
      schema: 'aegis-native-read-snapshot-diagnostic/2',
      snapshotAvailable: true,
      clientAvailable: true,
      state: 'FAILED',
      detail: 'none',
      source: 'none',
      mode: 'strict',
      transitions: 512,
      errorPresent: true,
      connected: false,
      stickyPresent: true,
      failures: 3,
      capabilityClass: 'class5',
      sequence: false,
      topology: true,
      firstFailure: {
        kind: 'child-exit',
        exitCode: 2,
        stderrClass: 'probe-birth-mismatch',
        nativeStatus: null,
        responseClass: null,
      },
      populationAsOf: 1700000000100,
      processLastSuccessAt: 1700000000100,
      snapshotLastAttemptAt: 1700000000000,
      snapshotLastSuccessAt: null,
      scanCadence: {
        maxProcessGapMs: 40000,
        skippedProcessTicks: 1000000,
        lastSkippedAt: 1700000000200,
      },
    });
    expect(JSON.stringify(diagnostic)).not.toMatch(/PRIVATE|"pid"|"birth"/);
  });

  it('projects existing cadence and observation times as null when invalid without exporting raw health', () => {
    const diagnostic = readScannerSnapshotDiagnostic({ app: {} }, (name) => {
      if (name.endsWith('/process-scanner.js'))
        return {
          getProcessCapabilities: () => ({ populationAsOf: 'PRIVATE_TIME', agents: ['PRIVATE'] }),
          getProcessSensorHealth: () => ({ lastSuccessAt: 8640000000000001 }),
        };
      if (name.endsWith('/scan-loop.js'))
        return {
          getScanCadence: () => ({
            maxProcessGapMs: 3600001,
            skippedProcessTicks: -1,
            lastSkippedAt: NaN,
          }),
        };
      if (name.endsWith('/process-snapshot.js'))
        return {
          getSnapshotHealth: () => ({ lastAttemptAt: -1, lastSuccessAt: 1.5 }),
          getSourceStats: () => ({}),
          getMode: () => 'auto',
        };
      throw new Error('PRIVATE_GETTER');
    });
    expect(diagnostic).toMatchObject({
      populationAsOf: null,
      processLastSuccessAt: null,
      snapshotLastAttemptAt: null,
      snapshotLastSuccessAt: null,
      scanCadence: { maxProcessGapMs: null, skippedProcessTicks: null, lastSkippedAt: null },
    });
    expect(JSON.stringify(diagnostic)).not.toContain('PRIVATE');
  });

  it('keeps unknown enum values and invalid counters null without exporting raw errors', () => {
    const diagnostic = readScannerSnapshotDiagnostic({ app: {} }, (name) =>
      name.endsWith('/process-snapshot.js')
        ? {
            getSnapshotHealth: () => ({
              state: 'PRIVATE_STATE',
              detail: 'PRIVATE_DETAIL',
              lastError: {},
            }),
            getSourceStats: () => ({ lastSource: 'PRIVATE_SOURCE', transitions: -1 }),
            getMode: () => 'PRIVATE_MODE',
          }
        : {
            getState: () => ({
              connected: 'true',
              sticky: {},
              failures: Infinity,
              caps: { class: 'PRIVATE_CLASS' },
              firstFailure: {
                kind: 'PRIVATE_KIND',
                exitCode: 'PRIVATE_CODE',
                stderrClass: 'PRIVATE_CLASS',
              },
            }),
          },
    );
    expect(diagnostic).toMatchObject({
      state: null,
      detail: null,
      source: null,
      mode: null,
      transitions: null,
      errorPresent: null,
      connected: null,
      stickyPresent: null,
      failures: null,
      capabilityClass: null,
      firstFailure: null,
    });
    expect(JSON.stringify(diagnostic)).not.toContain('PRIVATE');
    const unavailable = readScannerSnapshotDiagnostic({ app: {} }, () => {
      throw new Error('PRIVATE_LOAD');
    });
    expect(unavailable).toEqual(readScannerSnapshotDiagnostic({}));
  });

  it.each([
    [3221225506, 3221225506],
    [3221225475, 3221225475],
    [0, 0],
    [4294967295, 4294967295],
    [-1, null],
    [4294967296, null],
    [1.5, null],
    ['PRIVATE_0xC0000022', null],
  ])('projects nativeStatus only as uint32: %s', (nativeStatus, expected) => {
    const diagnostic = readScannerSnapshotDiagnostic({ app: {} }, (name) => {
      if (name.endsWith('/process-snapshot.js')) throw new Error('unavailable');
      return {
        getState: () => ({
          firstFailure: {
            kind: 'child-exit',
            exitCode: 2,
            stderrClass: 'probe-query-failed',
            nativeStatus,
          },
        }),
      };
    });
    expect(diagnostic.firstFailure.nativeStatus).toBe(expected);
    expect(JSON.stringify(diagnostic)).not.toContain('PRIVATE');
  });
  it.each([
    'query-unavailable',
    'query-failed',
    'query-limit',
    'query-growth',
    'snapshot-entry-bounds',
    'snapshot-chain-limit',
    'snapshot-negative-offset',
    'snapshot-overlapping-offset',
    'PRIVATE_UNKNOWN',
  ])('projects only the closed runtime response class %s', (responseClass) => {
    const diagnostic = readScannerSnapshotDiagnostic({ app: {} }, (name) => {
      if (name.endsWith('/process-snapshot.js')) throw new Error('unavailable');
      return {
        getState: () => ({
          firstFailure: {
            kind: 'sidecar-error',
            exitCode: null,
            stderrClass: 'none',
            nativeStatus: null,
            responseClass,
          },
        }),
      };
    });
    expect(diagnostic.firstFailure.responseClass).toBe(
      responseClass === 'PRIVATE_UNKNOWN' ? null : responseClass,
    );
    expect(JSON.stringify(diagnostic)).not.toContain('PRIVATE');
  });

  it('accepts only the exact actor with all three scanner conditions', () => {
    expect(projectScannerReadiness(ready(), witness)).toMatchObject({
      accepted: true,
      populationReliable: true,
      identityNonDegraded: true,
      monitoringActive: true,
      actorExactMatch: true,
    });
  });

  it.each([
    [
      'unreliable population',
      (v) => (v.readiness.populationReliable = false),
      'populationReliable',
    ],
    ['unknown population', (v) => delete v.readiness.populationReliable, 'populationReliable'],
    ['degraded identity', (v) => (v.readiness.identityDegraded = true), 'identityNonDegraded'],
    ['unknown identity quality', (v) => delete v.readiness.identityDegraded, 'identityNonDegraded'],
    ['paused monitoring', (v) => (v.readiness.monitoringPaused = true), 'monitoringActive'],
    ['unknown pause state', (v) => delete v.readiness.monitoringPaused, 'monitoringActive'],
    ['missing actor', (v) => (v.agents = []), 'actorPidObserved'],
    ['foreign actor', (v) => (v.agents[0].pid = 43), 'actorPidObserved'],
    [
      'fallback identity',
      (v) => (v.agents[0].instanceIdSource = 'fallback'),
      'actorOsIdentityObserved',
    ],
    [
      'wrong full birth',
      (v) => (v.agents[0].createTime100ns = '134373359662404618'),
      'actorBirthMatched',
    ],
    [
      'numeric birth',
      (v) => (v.agents[0].createTime100ns = Number(witness.birth)),
      'actorBirthMatched',
    ],
    ['missing readiness', (v) => delete v.readiness, 'readinessAvailable'],
    ['missing agents', (v) => delete v.agents, 'agentsAvailable'],
    ['malformed agents', (v) => (v.agents = {}), 'agentsAvailable'],
  ])('identifies %s while refusing admission', (_name, change, condition) => {
    const value = ready();
    change(value);
    const projection = projectScannerReadiness(value, witness);
    expect(projection.accepted).toBe(false);
    expect(projection[condition]).toBe(false);
  });

  it('distinguishes a missing projection from a reliable empty population', () => {
    const missing = projectScannerReadiness(null, witness);
    const empty = ready();
    empty.agents = [];
    expect(missing).toMatchObject({ accepted: false, projectionAvailable: false });
    expect(projectScannerReadiness(empty, witness)).toMatchObject({
      accepted: false,
      projectionAvailable: true,
      populationReliable: true,
      agentsAvailable: true,
      projectedAgentCount: 0,
      actorPidObserved: false,
    });
  });

  it('requires OS source and exact birth on the same actor row', () => {
    const value = ready();
    value.agents = [
      { pid: witness.pid, instanceIdSource: 'os', createTime100ns: 'wrong' },
      { pid: witness.pid, instanceIdSource: 'fallback', createTime100ns: witness.birth },
    ];
    expect(projectScannerReadiness(value, witness)).toMatchObject({
      actorPidObserved: true,
      actorOsIdentityObserved: true,
      actorBirthMatched: true,
      actorExactMatch: false,
      accepted: false,
    });
  });

  it('retains a fixed schema without private actor or scanner payloads', () => {
    const value = ready();
    value.agents = Array.from({ length: 200 }, () => ({
      ...value.agents[0],
      name: 'PRIVATE_NAME',
      instanceId: 'PRIVATE_INSTANCE',
      path: 'C:/PRIVATE_PATH',
    }));
    value.readiness.detail = 'PRIVATE_DETAIL';
    value.admission = { raw: 'PRIVATE_ADMISSION' };
    const projection = projectScannerReadiness(value, witness);
    expect(Object.keys(projection).sort()).toEqual(
      [
        'accepted',
        'actorBirthMatched',
        'actorExactMatch',
        'actorOsIdentityObserved',
        'actorPidObserved',
        'agentsAvailable',
        'identityNonDegraded',
        'monitoringActive',
        'populationReliable',
        'projectedAgentCount',
        'projectionAvailable',
        'readinessAvailable',
      ].sort(),
    );
    expect(projection.projectedAgentCount).toBe(128);
    expect(JSON.stringify(projection)).not.toMatch(/PRIVATE|134373359662404617|"pid"/);
    for (const [key, result] of Object.entries(projection)) {
      expect(typeof result).toBe(key === 'projectedAgentCount' ? 'number' : 'boolean');
    }
  });

  it('overwrites one last snapshot and saturates the sample count without a history', () => {
    const observation = { samples: 0, last: null };
    for (let sample = 0; sample < 600; sample++) {
      expect(recordScannerReadiness(ready(), witness, observation)).toBe(true);
    }
    expect(recordScannerReadiness(null, witness, observation)).toBe(false);
    expect(Object.keys(observation).sort()).toEqual(['last', 'samples']);
    expect(observation.samples).toBe(512);
    expect(observation.last).toEqual(projectScannerReadiness(null, witness));
    expect(JSON.stringify(observation).length).toBeLessThan(400);
  });
});
