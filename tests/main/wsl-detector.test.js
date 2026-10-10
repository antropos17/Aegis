import { describe, it, expect, afterEach, vi } from 'vitest';
import detector from '../../src/main/wsl-detector.js';

afterEach(() => {
  detector._resetForTest();
  vi.restoreAllMocks();
});

describe('passive WSL process coverage', () => {
  it.each(['win32', 'linux', 'darwin'])(
    'never spawns or schedules a guest probe on %s',
    async (platform) => {
      const execFile = vi.fn((_cmd, _args, _opts, cb) => cb(null, '42 opencode'));
      const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
      detector._setDepsForTest({ platform, execFile });

      expect(detector.getCachedWslAgents()).toEqual([]);
      expect(await detector.detectWslAgents()).toEqual([]);
      await new Promise(setImmediate);
      clock.mockReturnValue(121001);
      expect(detector.getCachedWslAgents()).toEqual([]);
      expect(await detector.detectWslAgents()).toEqual([]);
      await new Promise(setImmediate);

      expect(execFile).not.toHaveBeenCalled();
    },
  );

  it('reports Windows process coverage unavailable before and after passive scans', async () => {
    detector._setDepsForTest({ platform: 'win32', execFile: vi.fn() });
    const initial = detector.getWslSensorHealth();
    expect(initial).toMatchObject({
      sensorId: 'wsl',
      state: 'UNSUPPORTED',
      detail: 'wsl-process-coverage-unavailable',
      lastAttemptAt: null,
      lastSuccessAt: null,
      consecutiveFailures: 0,
    });
    await detector.detectWslAgents();
    detector.getCachedWslAgents();
    expect(detector.getWslSensorHealth()).toEqual(initial);
  });

  it('returns fresh empty arrays so a caller cannot seed synthetic cached agents', async () => {
    detector._setDepsForTest({ platform: 'win32', execFile: vi.fn() });
    detector.getCachedWslAgents().push({ agent: 'consumer mutation', pid: 0 });
    const detected = await detector.detectWslAgents();
    detected.push({ agent: 'consumer mutation', pid: 0 });
    expect(detector.getCachedWslAgents()).toEqual([]);
    expect(await detector.detectWslAgents()).toEqual([]);
  });

  it('returns a detached plain health snapshot', () => {
    detector._setDepsForTest({ platform: 'win32', execFile: vi.fn() });
    const health = detector.getWslSensorHealth();
    expect(JSON.parse(JSON.stringify(health))).toEqual(health);
    health.state = 'HEALTHY';
    expect(detector.getWslSensorHealth().state).toBe('UNSUPPORTED');
  });
});
