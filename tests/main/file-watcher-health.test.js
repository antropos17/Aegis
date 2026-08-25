/**
 * Block B2 — filesystem sensor health wiring.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fileWatcher from '../../src/main/file-watcher.js';
import { SENSOR_HEALTH_STATE, aggregateSensorHealth } from '../../src/main/sensor-health.js';

function makeState(overrides = {}) {
  return {
    getCustomRules: () => [],
    getLatestAgents: () => [{ pid: 100, agent: 'Claude Code', category: 'ai' }],
    getLatestAiAgents: () => [{ pid: 100, agent: 'Claude Code', category: 'ai' }],
    isMonitoringPaused: () => false,
    isOtherPanelExpanded: () => false,
    activityLog: [],
    knownHandles: new Map(),
    watchers: [],
    recordFileAccess: vi.fn(),
    onFileEvent: vi.fn(),
    onActivityPush: vi.fn(),
    ...overrides,
  };
}

describe('file-watcher health (B2)', () => {
  beforeEach(() => {
    fileWatcher.init(makeState());
    fileWatcher._resetForTest();
  });

  it('getFileSensorHealth returns plain serializable snapshots', () => {
    const snap = fileWatcher.getFileSensorHealth();
    expect(Object.keys(snap).sort()).toEqual(['fs-chokidar', 'fs-handle', 'fs-rm'].sort());
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });

  describe('fs-handle', () => {
    it('successful empty observation is HEALTHY (not FAILED)', async () => {
      fileWatcher._setDepsForTest({
        getFileHandles: vi.fn().mockResolvedValue([]),
        isReadDetectionAvailable: true,
      });
      const events = await fileWatcher.scanAllFileHandles([
        { pid: 1, agent: 'Claude Code', category: 'ai', instanceId: '1:u' },
      ]);
      expect(events).toEqual([]);
      expect(fileWatcher.getFileSensorHealth()['fs-handle'].state).toBe(
        SENSOR_HEALTH_STATE.HEALTHY,
      );
    });

    it('full getFileHandles failure is FAILED with empty compatibility array', async () => {
      fileWatcher._setDepsForTest({
        getFileHandles: vi.fn().mockRejectedValue(new Error('spawn failed')),
        isReadDetectionAvailable: true,
      });
      const events = await fileWatcher.scanAllFileHandles([
        { pid: 1, agent: 'Claude Code', category: 'ai', instanceId: '1:u' },
      ]);
      expect(events).toEqual([]);
      const h = fileWatcher.getFileSensorHealth()['fs-handle'];
      expect(h.state).toBe(SENSOR_HEALTH_STATE.FAILED);
      expect(h.lastError).toMatch(/spawn failed/);
    });

    it('FAILED recovers to HEALTHY on next valid scan', async () => {
      const getHandles = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([]);
      fileWatcher._setDepsForTest({
        getFileHandles: getHandles,
        isReadDetectionAvailable: true,
      });
      const agents = [{ pid: 1, agent: 'Claude Code', category: 'ai', instanceId: '1:u' }];
      await fileWatcher.scanAllFileHandles(agents);
      expect(fileWatcher.getFileSensorHealth()['fs-handle'].state).toBe(SENSOR_HEALTH_STATE.FAILED);
      await fileWatcher.scanAllFileHandles(agents);
      const h = fileWatcher.getFileSensorHealth()['fs-handle'];
      expect(h.state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
      expect(h.consecutiveFailures).toBe(0);
    });

    it('partial agent failure keeps successful events and marks DEGRADED', async () => {
      const getHandles = vi.fn(async (pid) => {
        if (pid === 1) throw new Error('agent1 fail');
        return ['/home/user/.ssh/id_rsa'];
      });
      fileWatcher._setDepsForTest({
        getFileHandles: getHandles,
        isReadDetectionAvailable: true,
      });
      const events = await fileWatcher.scanAllFileHandles([
        { pid: 1, agent: 'A', category: 'ai', instanceId: '1:u' },
        { pid: 2, agent: 'B', category: 'ai', instanceId: '2:u' },
      ]);
      expect(events.some((e) => e.file.includes('.ssh'))).toBe(true);
      expect(fileWatcher.getFileSensorHealth()['fs-handle'].state).toBe(
        SENSOR_HEALTH_STATE.DEGRADED,
      );
    });

    it('B-S04: read-detection unavailable → DEGRADED not HEALTHY empty', async () => {
      fileWatcher._setDepsForTest({
        getFileHandles: vi.fn().mockResolvedValue([]),
        isReadDetectionAvailable: false,
      });
      const events = await fileWatcher.scanAllFileHandles([
        { pid: 1, agent: 'Claude Code', category: 'ai', instanceId: '1:u' },
      ]);
      expect(events).toEqual([]);
      const h = fileWatcher.getFileSensorHealth()['fs-handle'];
      expect(h.state).toBe(SENSOR_HEALTH_STATE.DEGRADED);
      expect(h.lastError).toBe('read-detection-unavailable');
    });
  });

  describe('fs-rm', () => {
    it('successful zero holders is HEALTHY', async () => {
      fileWatcher._setDepsForTest({
        getSensitiveHolders: vi.fn().mockResolvedValue([]),
      });
      // Force RM path: isRestartManagerAvailable may be false in test env — inject
      // holders is enough only when rmEnabled() is true (function present + available).
      // _isRmAvailable comes from platform; when undefined/falsy, rmEnabled is false.
      // Override by setting holders and stubbing: use scan when RM function set and
      // platform says available — on non-win32 platformHasRm is false.
      // Use getSensitiveHolders + mock isRestartManagerAvailable via enabling path:
      // rmEnabled requires _getSensitiveHolders function AND (_isRmAvailable undefined OR true).
      // _isRmAvailable is const from platform at load — on linux false/undefined.
      // Check: `if (typeof _isRmAvailable === 'function' && !_isRmAvailable()) return false`
      // If _isRmAvailable is undefined, typeof is not function → rmEnabled true when holders set.
      const events = await fileWatcher.scanAllFileHandles([
        { pid: 1, agent: 'Claude Code', category: 'ai', instanceId: '1:u' },
      ]);
      expect(events).toEqual([]);
      // If RM path taken:
      const h = fileWatcher.getFileSensorHealth()['fs-rm'];
      if (h.state !== SENSOR_HEALTH_STATE.UNSUPPORTED) {
        expect(h.state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
      }
    });

    it('RM fetch failure is FAILED with empty array', async () => {
      fileWatcher._setDepsForTest({
        getSensitiveHolders: vi.fn().mockRejectedValue(new Error('rm powershell failed')),
      });
      const events = await fileWatcher.scanAllFileHandles([
        { pid: 1, agent: 'Claude Code', category: 'ai', instanceId: '1:u' },
      ]);
      expect(events).toEqual([]);
      const h = fileWatcher.getFileSensorHealth()['fs-rm'];
      if (h.state === SENSOR_HEALTH_STATE.UNSUPPORTED) {
        // Platform without RM never enters scanViaRestartManager — skip.
        return;
      }
      expect(h.state).toBe(SENSOR_HEALTH_STATE.FAILED);
      expect(h.lastError).toMatch(/rm powershell failed/);
    });

    it('B-S09: single-flight skip does not mark FAILED or advance lastSuccessAt', async () => {
      let release;
      const gate = new Promise((r) => {
        release = r;
      });
      let calls = 0;
      fileWatcher._setDepsForTest({
        getSensitiveHolders: vi.fn(async () => {
          calls += 1;
          if (calls === 1) await gate;
          return [];
        }),
      });
      const agents = [{ pid: 1, agent: 'Claude Code', category: 'ai', instanceId: '1:u' }];
      const p1 = fileWatcher.scanAllFileHandles(agents);
      // Second call while first in flight — skip
      const mid = fileWatcher.getFileSensorHealth()['fs-rm'];
      if (mid.state === SENSOR_HEALTH_STATE.UNSUPPORTED) {
        release();
        await p1;
        return;
      }
      const p2 = fileWatcher.scanAllFileHandles(agents);
      const during = fileWatcher.getFileSensorHealth()['fs-rm'];
      // Still STARTING or prior — not FAILED from skip
      expect(during.state).not.toBe(SENSOR_HEALTH_STATE.FAILED);
      release();
      await Promise.all([p1, p2]);
      expect(calls).toBe(1); // second was single-flight skip
    });
  });

  // Exactly one of the two read leaves observes on a given tick; the other is
  // UNSUPPORTED with a detail naming the owner. Without this a leaf no code path
  // writes stays STARTING for the whole process and the app reads SENSORS_STARTING
  // forever — the B8 cross-sensor regression.
  describe('read-mechanism ownership (RM vs handle pool)', () => {
    const AGENTS = [{ pid: 1, agent: 'Claude Code', category: 'ai', instanceId: '1:u' }];
    const S = SENSOR_HEALTH_STATE;
    const T0 = 1700000000000;

    afterEach(() => {
      vi.useRealTimers();
    });

    it('A. RM owns: one tick leaves fs-rm HEALTHY and fs-handle UNSUPPORTED, out of the worst-of', async () => {
      fileWatcher._setDepsForTest({ getSensitiveHolders: vi.fn().mockResolvedValue([]) });
      await fileWatcher.scanAllFileHandles(AGENTS);
      const snap = fileWatcher.getFileSensorHealth();
      expect(snap['fs-rm'].state).toBe(S.HEALTHY);
      expect(snap['fs-handle'].state).toBe(S.UNSUPPORTED);
      expect(snap['fs-handle'].detail).toBe('rm-owns-observation');
      const agg = aggregateSensorHealth([snap['fs-handle'], snap['fs-rm']]);
      expect(agg.state).toBe(S.HEALTHY);
      expect(agg.participatingCount).toBe(1);
      expect(agg.totalCount).toBe(2);
    });

    it('B. pool owns: one tick leaves fs-handle HEALTHY and fs-rm UNSUPPORTED', async () => {
      fileWatcher._setDepsForTest({
        getFileHandles: vi.fn().mockResolvedValue([]),
        isReadDetectionAvailable: true,
      });
      await fileWatcher.scanAllFileHandles(AGENTS);
      const snap = fileWatcher.getFileSensorHealth();
      expect(snap['fs-handle'].state).toBe(S.HEALTHY);
      expect(snap['fs-rm'].state).toBe(S.UNSUPPORTED);
      // A platform with no Restart Manager keeps its own reason (createInitialFsHealth);
      // only a platform that HAS one is told the pool owns observation.
      expect(snap['fs-rm'].detail).toBe(
        process.platform === 'win32' ? 'pool-owns-observation' : 'platform-no-rm',
      );
      const agg = aggregateSensorHealth([snap['fs-handle'], snap['fs-rm']]);
      expect(agg.state).toBe(S.HEALTHY);
      expect(agg.participatingCount).toBe(1);
    });

    it('C. RM→pool switch: fs-handle returns in a fresh lifetime, fs-rm leaves the worst-of', async () => {
      const getFileHandles = vi.fn().mockResolvedValue([]);
      fileWatcher._setDepsForTest({
        getSensitiveHolders: vi.fn().mockResolvedValue([]),
        getFileHandles,
        isReadDetectionAvailable: true,
      });
      await fileWatcher.scanAllFileHandles(AGENTS);
      expect(fileWatcher.getFileSensorHealth()['fs-handle'].state).toBe(S.UNSUPPORTED);
      expect(getFileHandles).not.toHaveBeenCalled();

      // The probe result arriving after the first tick (restart-manager._rmAvailable).
      fileWatcher._setDepsForTest({ isRestartManagerAvailable: false });
      await fileWatcher.scanAllFileHandles(AGENTS);
      expect(getFileHandles).toHaveBeenCalled();
      const snap = fileWatcher.getFileSensorHealth();
      expect(snap['fs-handle'].state).toBe(S.HEALTHY);
      expect(snap['fs-handle'].consecutiveFailures).toBe(0);
      expect(snap['fs-handle'].lastSuccessAt).toBeTypeOf('number');
      expect(snap['fs-rm'].state).toBe(S.UNSUPPORTED);
      expect(snap['fs-rm'].detail).toBe('pool-owns-observation');
    });

    it('D. hot-only RM beside the pool (the bench harness shape): no leaf is inactive', async () => {
      fileWatcher._setDepsForTest({
        getHotSensitiveHolders: vi.fn().mockResolvedValue([]),
        getFileHandles: vi.fn().mockResolvedValue([]),
        isReadDetectionAvailable: true,
      });
      await fileWatcher.scanAllFileHandles(AGENTS);
      await fileWatcher.scanHotFileHolders(AGENTS);
      const snap = fileWatcher.getFileSensorHealth();
      expect(snap['fs-handle'].state).toBe(S.HEALTHY);
      expect(snap['fs-rm'].state).toBe(S.HEALTHY);
    });

    it('E. the decision is latched: a second RM tick does not rewrite the inactive leaf', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
      fileWatcher._setDepsForTest({ getSensitiveHolders: vi.fn().mockResolvedValue([]) });
      await fileWatcher.scanAllFileHandles(AGENTS);
      const first = fileWatcher.getFileSensorHealth()['fs-handle'];
      expect(first.lastAttemptAt).toBe(T0);

      vi.setSystemTime(T0 + 5000);
      await fileWatcher.scanAllFileHandles(AGENTS);
      expect(fileWatcher.getFileSensorHealth()['fs-rm'].lastAttemptAt).toBe(T0 + 5000);
      expect(fileWatcher.getFileSensorHealth()['fs-handle']).toEqual(first);
    });

    it('F. a closed population gate on the first tick still settles ownership', async () => {
      fileWatcher._setDepsForTest({
        getSensitiveHolders: vi.fn().mockResolvedValue([]),
        getProcessCapabilities: () => ({
          populationState: S.STARTING,
          populationReliable: false,
          populationAsOf: null,
          identityQuality: 'unknown',
        }),
      });
      const events = await fileWatcher.scanAllFileHandles(AGENTS);
      expect(events).toEqual([]);
      const snap = fileWatcher.getFileSensorHealth();
      expect(snap['fs-rm'].state).toBe(S.DEGRADED);
      expect(snap['fs-rm'].detail).toBe('process-observation-unavailable');
      expect(snap['fs-handle'].state).toBe(S.UNSUPPORTED);
      expect(snap['fs-handle'].detail).toBe('rm-owns-observation');
    });
  });
});
