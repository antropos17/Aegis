import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { installShims, createHarness } from './helpers/health-umbrella-harness.js';
import supervisor from '../../src/main/platform/etw-file-supervisor.js';
import { observation } from './platform/etw-file-fixtures.js';

const shims = installShims();
let h;
afterAll(() => shims.restore());
afterEach(async () => {
  h?.main._setEtwFileForTest(undefined);
  await h?.tearDown();
});
describe('ETW leaf in the actual application composer', () => {
  it('labels a verified issuer only in main diagnostics while stats and audit stay metadata-only', async () => {
    h = createHarness(shims);
    await h.bringUp();
    const before = h.auditTypes();
    const sensor = supervisor.createSupervisor({
      spawnBroker: () => {
        throw new Error('must-not-launch');
      },
    });
    const raw = observation({
      qpc: '110',
      headerPid: 4,
      issuerStatus: 'verified',
      issuerPid: 71,
      issuerInterval: { fromQpc: '100', toQpc: '120' },
      generationStatus: 'verified',
      generationWitness: '134333333333333337',
      generationSource: 'createTime100ns',
      generationInterval: { fromQpc: '115', toQpc: '120' },
    });
    h.main._setEtwFileForTest({
      getHealth: sensor.getHealth,
      getDiagnostics: () => ({ records: [raw] }),
    });
    h.main._setLatestAgentsForTest([
      {
        pid: 71,
        agent: 'Aider',
        createTime100ns: '134333333333333337',
        instanceId: '71:1788859733333',
        instanceIdSource: 'os',
      },
    ]);
    expect(h.main.getEtwFileDiagnostics().records[0]).toMatchObject({
      agent: 'Aider',
      instanceId: '71:1788859733333',
    });
    expect(h.stats()).not.toHaveProperty('etwObservations');
    expect(h.auditTypes()).toEqual(before);
    expect(raw.agent).toBeNull();
    sensor.dispose();
  });
  it('includes the optional disabled sensor without reducing process coverage', async () => {
    h = createHarness(shims);
    await h.bringUp();
    const sensor = supervisor.createSupervisor({
      spawnBroker: () => {
        throw new Error('must-not-launch');
      },
    });
    h.main._setEtwFileForTest(sensor);
    const health = h.health();
    expect(health.sensors.byId['etw-file'].state).toBe('DISABLED');
    expect(health.state).toBe('HEALTHY');
    expect(health.populationReliable).toBe(true);
    sensor.dispose();
  });
  it('reports failed diagnostic capture without poisoning population or exposing paths', async () => {
    h = createHarness(shims);
    await h.bringUp();
    const before = h.auditTypes();
    const sensor = supervisor.createSupervisor({
      spawnBroker: () => {
        throw new Error('private path');
      },
    });
    sensor.start();
    h.main._setEtwFileForTest(sensor);
    const stats = h.stats();
    expect(stats.appHealth.state).toBe('DEGRADED');
    expect(stats.appHealth.populationReliable).toBe(true);
    expect(stats.appHealth.sensors.byId['etw-file'].lastError).toBe('launch-failed');
    expect(JSON.stringify(stats)).not.toContain('private path');
    expect(stats).not.toHaveProperty('etwObservations');
    expect(h.auditTypes()).toEqual(before);
    sensor.dispose();
  });
});
