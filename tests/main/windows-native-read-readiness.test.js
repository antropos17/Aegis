import { describe, expect, it } from 'vitest';
import {
  projectScannerReadiness,
  recordScannerReadiness,
} from '../../scripts/qualification/windows-native-read-readiness.mjs';

const witness = { pid: 42, birth: '134373359662404617' };
const ready = () => ({
  readiness: { populationReliable: true, identityDegraded: false, monitoringPaused: false },
  agents: [{ pid: witness.pid, instanceIdSource: 'os', createTime100ns: witness.birth }],
});

describe('native-read scanner readiness diagnostics', () => {
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
