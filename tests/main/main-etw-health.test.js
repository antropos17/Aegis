import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { installShims, createHarness } from './helpers/health-umbrella-harness.js';
import supervisor from '../../src/main/platform/etw-file-supervisor.js';

const shims = installShims();
let h;
afterAll(() => shims.restore());
afterEach(async () => {
  h?.main._setEtwFileForTest(undefined);
  await h?.tearDown();
});
describe('ETW leaf in the actual application composer', () => {
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
