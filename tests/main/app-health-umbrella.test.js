/**
 * Block B8 — the cross-sensor umbrella (docs/roadmap/sensor-health-degraded.md §10 B8,
 * §15, §16).
 *
 * Every case drives REAL leaves through the REAL scan-loop schedulers and reads the REAL
 * composer, `main.getAppHealth()` / `main.getStats()`. The per-sensor suites prove each
 * leaf on its own with the others stubbed; the app-health suite proves the derivation
 * over literal records. What neither can say is what happens BETWEEN sensors — a
 * population failure closing the network and file gates, a worst-of over leaves written
 * by different modules on different ticks, an identity outage crossed with an OS sleep,
 * a gap that a file tick must not clear. That is this file.
 *
 * `reasons` are asserted as whole arrays in APP_HEALTH_REASON declaration order, never
 * with `toContain`: a spurious extra reason is a finding, not noise.
 *
 * Nothing is fabricated anywhere: under a closed gate the provider is asserted NOT
 * called, a frozen tick writes no session record, and a gap explains a hole without
 * filling one (§5, §15.7).
 *
 * Read the same on win32 and ubuntu by construction — see the harness header for the
 * five places the platforms would otherwise diverge.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { APP_HEALTH_STATE, APP_HEALTH_REASON } from '../../src/main/app-health.js';
import { SENSOR_HEALTH_STATE } from '../../src/main/sensor-health.js';
import {
  installShims,
  createHarness,
  samplePath,
  BASE_SENSOR_IDS,
  CLAUDE,
  CLAUDE_2,
  OLLAMA_PORT,
} from './helpers/health-umbrella-harness.js';

const S = SENSOR_HEALTH_STATE;
const A = APP_HEALTH_STATE;
const R = APP_HEALTH_REASON;
const SCOPE_UNAVAILABLE = 'process-observation-unavailable';

const shims = installShims();

afterAll(() => {
  shims.restore();
});

/** @param {ReturnType<typeof createHarness>} h @returns {string[]} audit types minus the network observations */
function nonNetworkAudit(h) {
  return h.auditTypes().filter((t) => t !== 'network-connection');
}

/** A fresh EPERM per use — the scanner reads `code` and `message` off it. */
function eperm() {
  return Object.assign(new Error('access is denied'), { code: 'EPERM' });
}

describe('app-health umbrella (B8)', () => {
  /** @type {ReturnType<typeof createHarness>} */
  let h;

  afterEach(async () => {
    await h.tearDown();
  });

  describe('S1 — baseline convergence', () => {
    it('S1a. handle-pool path: every leaf reaches a definite state and the app is HEALTHY', async () => {
      h = createHarness(shims);
      const health = await h.bringUp();

      expect(health.state).toBe(A.HEALTHY);
      expect(health.reasons).toEqual([]);
      expect(health.sensors.effective.state).toBe(S.HEALTHY);
      // The registration list itself: exactly what main.js composes, nothing dropped,
      // nothing fabricated (no proc-snapshot leaf without a birth-time platform).
      expect(Object.keys(health.sensors.byId).sort()).toEqual([...BASE_SENSOR_IDS]);
      const ids = health.sensors.byId;
      expect(ids.process.state).toBe(S.HEALTHY);
      expect(ids['fs-chokidar'].state).toBe(S.HEALTHY);
      expect(ids['fs-handle'].state).toBe(S.HEALTHY);
      expect(ids['fs-rm'].state).toBe(S.UNSUPPORTED);
      expect(ids.network.state).toBe(S.HEALTHY);
      expect(ids['ide-extension'].state).toBe(S.HEALTHY);
      expect(ids.wsl.state).toBe(S.UNSUPPORTED);
      expect(ids['llm-ollama'].state).toBe(S.HEALTHY);
      expect(ids['llm-lmstudio'].state).toBe(S.HEALTHY);
      // Two records sit out of the worst-of; seven carry it.
      expect(health.sensors.raw.participatingCount).toBe(7);
      expect(health.sensors.raw.totalCount).toBe(9);
      expect(health.populationState).toBe(S.HEALTHY);
      expect(health.populationReliable).toBe(true);
      expect(health.identityDegraded).toBe(false);
      expect(health.identityQuality).toBe('unknown');
      expect(health.watchPlan.state).toBe(S.HEALTHY);
      // Every provider was actually asked — a green here is not a skipped observation.
      expect(h.listProcesses).toHaveBeenCalled();
      expect(h.getRawTcpConnections).toHaveBeenCalled();
      expect(h.getFileHandles).toHaveBeenCalledWith(CLAUDE.pid);
      expect(h.sessionTracker.activeCount()).toBe(1);
      expect(nonNetworkAudit(h)).toEqual(['agent-enter']);
      expect(h.auditTypes()).toContain('network-connection');

      const stats = h.expectSiblings();
      expect(stats.observationGap.state).toBe('NONE');
      expect(stats.observationGap.suspendCount).toBe(0);
      expect(stats.monitoringPaused).toBe(false);
    });

    // The contract, written as the contract. Known red on master today: with the
    // Restart Manager owning the file tick, `scanAllFileHandles` returns from the RM
    // delegation and the `fs-handle` record is never written ("handle sensor not
    // sampled", src/main/file-watcher.js:953-956), so the effective worst-of never
    // leaves STARTING and `sensor-starting` holds the app at SENSORS_STARTING for the
    // whole process life. `it.fails` names that mechanism rather than skipping the case
    // (a skipped test is a green that proves nothing, ai-mistakes #21); the file-watcher
    // fix lands from its own PR, and the day it merges this marker must be dropped.
    it.fails(
      'S1b. Restart Manager path: the same convergence — red until file-watcher.js:953-956 samples or retires fs-handle',
      async () => {
        h = createHarness(shims);
        const getSensitiveHolders = vi.fn(async () => []);
        h.watcher._setDepsForTest({ getSensitiveHolders });
        expect(h.health().sensors.byId['fs-rm'].state).toBe(S.STARTING);

        const health = await h.bringUp();

        // The RM path ran and observed: this half holds on master.
        expect(getSensitiveHolders).toHaveBeenCalled();
        expect(h.getFileHandles).not.toHaveBeenCalled();
        expect(health.sensors.byId['fs-rm'].state).toBe(S.HEALTHY);
        // The contract: a machine whose every mechanism observed is HEALTHY.
        expect(health.sensors.byId['fs-handle'].state).not.toBe(S.STARTING);
        expect(health.state).toBe(A.HEALTHY);
        expect(health.reasons).toEqual([]);
      },
    );
  });

  describe('S2 — startup is SENSORS_STARTING, never FAILED', () => {
    beforeEach(() => {
      h = createHarness(shims);
    });

    it('S2. before the first tick, after the first tick, and at no point FAILED', async () => {
      // Nothing observed yet: every participating leaf STARTING, no plan built. The
      // population flag is already false here — the collapsed boolean the derivation
      // must NOT read (ai-mistakes #29).
      const before = h.health();
      expect(before.populationState).toBe(S.STARTING);
      expect(before.populationReliable).toBe(false);
      expect(before.state).toBe(A.SENSORS_STARTING);
      expect(before.reasons).toEqual([
        R.POPULATION_STARTING,
        R.SENSOR_STARTING,
        R.WATCH_PLAN_STARTING,
      ]);
      expect(before.watchPlan.state).toBe(S.STARTING);

      await h.readyWatchPlane();
      await h.tickProcess();

      // The process leaf has observed; the file leaf has not had its 8 s tick.
      const after = h.health();
      expect(after.populationState).toBe(S.HEALTHY);
      expect(after.populationReliable).toBe(true);
      expect(after.sensors.byId['fs-handle'].state).toBe(S.STARTING);
      expect(after.sensors.effective.state).toBe(S.STARTING);
      expect(after.state).toBe(A.SENSORS_STARTING);
      expect(after.reasons).toEqual([R.SENSOR_STARTING]);
      expect(after.state).not.toBe(A.FAILED);
      expect(before.state).not.toBe(A.FAILED);

      // The scan-batch the renderer would have received carries the same composition.
      const batch = h.deps.sendToRenderer.mock.calls.find((c) => c[0] === 'scan-batch');
      expect(batch[1].stats.appHealth.state).toBe(A.SENSORS_STARTING);
      expect(batch[1].stats.appHealth.reasons).toEqual([R.SENSOR_STARTING]);
    });
  });

  describe('S3 / S4 — the population cascade and its per-sensor recovery', () => {
    beforeEach(() => {
      h = createHarness(shims);
    });

    it('S3. EPERM on the process leaf closes the network and file gates; chokidar keeps observing, unattributed', async () => {
      await h.bringUp();
      h.getRawTcpConnections.mockClear();
      h.getFileHandles.mockClear();

      h.listProcesses.mockRejectedValue(eperm());
      await h.runStartup();
      h.errorWatchRoot(0, 'EMFILE: too many open files');
      h.deliverWatchEvent(2, samplePath('secrets.js'));

      const health = h.health();
      expect(health.state).toBe(A.FAILED);
      expect(health.reasons).toEqual([
        R.POPULATION_FAILED,
        R.SENSOR_FAILED,
        R.SENSOR_DEGRADED,
        R.WATCH_ROOTS_UNAVAILABLE,
      ]);
      expect(health.populationState).toBe(S.FAILED);
      expect(health.populationReliable).toBe(false);
      expect(health.sensors.effective.failedSensorIds).toEqual(['process']);
      // Registration order: the fs leaves sorted, then network.
      expect(health.sensors.effective.degradedSensorIds).toEqual([
        'fs-chokidar',
        'fs-handle',
        'network',
      ]);
      const ids = health.sensors.byId;
      expect(ids.process.detail).toBe('permission-denied');
      expect(ids.process.consecutiveFailures).toBe(1);
      // Both consumers refused the stale scope and said so — neither provider ran.
      expect(ids.network.detail).toBe(SCOPE_UNAVAILABLE);
      expect(ids.network.lastError).toBe(SCOPE_UNAVAILABLE);
      expect(ids['fs-handle'].detail).toBe(SCOPE_UNAVAILABLE);
      expect(h.getRawTcpConnections).not.toHaveBeenCalled();
      expect(h.getFileHandles).not.toHaveBeenCalled();
      // A refusal is not a scoped success: the last success is the pre-failure one.
      expect(ids.network.lastSuccessAt).toBeLessThan(ids.network.lastAttemptAt);
      expect(ids['fs-handle'].lastSuccessAt).toBeLessThan(ids['fs-handle'].lastAttemptAt);
      // The watch plane degraded on its own axis, and the gate never touched it.
      expect(ids['fs-chokidar'].detail).toBe('watch-roots-unavailable');
      expect(health.watchPlan.state).toBe(S.DEGRADED);
      expect(health.watchPlan.unavailableGroups.map((g) => g.id)).toEqual(['credential-dirs']);
      // chokidar still delivered the path — with no owner, because none can be vouched for.
      const ev = h.fsState.activityLog.at(-1);
      expect(ev.action).toBe('modified');
      expect(ev.attribution).toEqual({
        status: 'unattributed',
        evidence: ['population-unavailable'],
      });
      expect(ev.agent).toBe('');
      // No session was closed on the strength of an empty, unreliable list.
      expect(h.sessionTracker.activeCount()).toBe(1);
      expect(nonNetworkAudit(h)).toEqual(['agent-enter']);
      expect(h.expectSiblings().observationGap.state).toBe('NONE');
    });

    it('S4. recovery is per sensor: the process leaf returns first, the file leaf on its own tick', async () => {
      await h.bringUp();
      h.listProcesses.mockRejectedValue(eperm());
      await h.runStartup();
      expect(h.health().state).toBe(A.FAILED);

      h.listProcesses.mockResolvedValue([CLAUDE]);
      await h.tickProcess();

      // The population is back, and with it the network leaf — its pid set changed, so
      // the process tick re-triggered the TCP scan (scan-loop.js). The file leaf has
      // had no tick since the refusal and still says so.
      const mid = h.health();
      expect(mid.populationState).toBe(S.HEALTHY);
      expect(mid.sensors.byId.process.consecutiveFailures).toBe(0);
      expect(mid.sensors.byId.network.state).toBe(S.HEALTHY);
      expect(mid.sensors.byId['fs-handle'].state).toBe(S.DEGRADED);
      expect(mid.sensors.byId['fs-handle'].detail).toBe(SCOPE_UNAVAILABLE);
      expect(mid.state).toBe(A.DEGRADED);
      expect(mid.reasons).toEqual([R.SENSOR_DEGRADED]);
      expect(mid.sensors.effective.degradedSensorIds).toEqual(['fs-handle']);

      // 8 s into the same startup run: the file tick observes and the app is whole.
      await h.advance(5000);
      const after = h.health();
      expect(after.sensors.byId['fs-handle'].state).toBe(S.HEALTHY);
      expect(after.state).toBe(A.HEALTHY);
      expect(after.reasons).toEqual([]);
    });
  });

  describe('S5 — worst-of across leaves written by different modules', () => {
    beforeEach(() => {
      h = createHarness(shims, { processes: [CLAUDE, CLAUDE_2] });
    });

    it('S5. a FAILED network beside a partial handle scan is DEGRADED, and the aggregate names both', async () => {
      const base = await h.bringUp();
      expect(base.state).toBe(A.HEALTHY);
      expect(h.sessionTracker.activeCount()).toBe(2);

      h.getRawTcpConnections.mockRejectedValue(new Error('spawn ETIMEDOUT'));
      h.getFileHandles.mockImplementation(async (pid) => {
        if (pid === CLAUDE_2.pid) throw new Error('handle spawn failed');
        return [];
      });
      await h.runStartup();

      const health = h.health();
      expect(health.state).toBe(A.DEGRADED);
      expect(health.reasons).toEqual([R.SENSOR_FAILED, R.SENSOR_DEGRADED]);
      // The severity maximum is FAILED; the app is not, because the population is.
      expect(health.sensors.effective.state).toBe(S.FAILED);
      expect(health.sensors.effective.failedSensorIds).toEqual(['network']);
      expect(health.sensors.effective.degradedSensorIds).toEqual(['fs-handle']);
      expect(health.populationState).toBe(S.HEALTHY);
      const ids = health.sensors.byId;
      expect(ids.network.detail).toBe('provider-failure');
      expect(ids.network.consecutiveFailures).toBe(1);
      expect(ids['fs-handle'].detail).toBe('failed-1-of-2');
      expect(ids['fs-handle'].consecutiveFailures).toBe(0);
      // The partial scan kept the observation it did make.
      expect(h.getFileHandles).toHaveBeenCalledWith(CLAUDE.pid);
      expect(h.getFileHandles).toHaveBeenCalledWith(CLAUDE_2.pid);
      expect(h.deps.logger.error).toHaveBeenCalledWith('main', 'Network scan failed', {
        error: 'spawn ETIMEDOUT',
      });
    });
  });

  describe('S6 / S7 — the proc-snapshot leaf crossed with the gap and with the projection', () => {
    beforeEach(() => {
      h = createHarness(shims);
    });

    it('S6. an identity outage after a sleep freezes the tick, leaves the gap armed, and degrades the app', async () => {
      const setSnapshot = h.installSnapshotLeaf(S.HEALTHY, 'sidecar');
      const base = await h.bringUp();
      expect(base.identityQuality).toBe('witnessed');
      expect(base.state).toBe(A.HEALTHY);
      expect(Object.keys(base.sensors.byId)).toContain('proc-snapshot');

      setSnapshot(S.FAILED);
      await h.sleep(4000);
      await h.tickProcess();

      const health = h.health();
      expect(h.freezeLogs()).toEqual([{ reason: 'identity-degraded', agents: 1 }]);
      expect(health.identityDegraded).toBe(true);
      expect(health.identityQuality).toBe('unknown');
      expect(health.state).toBe(A.DEGRADED);
      expect(health.reasons).toEqual([R.SENSOR_FAILED, R.IDENTITY_DEGRADED]);
      expect(health.sensors.effective.failedSensorIds).toEqual(['proc-snapshot']);
      // The population itself was enumerated fine — this is not a population failure.
      expect(health.populationState).toBe(S.HEALTHY);
      // The gap is a sibling and it is still armed: a frozen tick observed nothing.
      const stats = h.expectSiblings();
      expect(stats.observationGap.state).toBe('RESUMED');
      expect(stats.observationGap.clearedAt).toBeNull();
      expect(stats.observationGap.gapMs).toBe(4000);
      expect(h.sessionTracker.activeCount()).toBe(1);
      expect(nonNetworkAudit(h)).toEqual(['agent-enter', 'observation-gap']);

      setSnapshot(S.HEALTHY, 'sidecar');
      await h.tickProcess();
      const after = h.health();
      expect(after.state).toBe(A.HEALTHY);
      expect(after.reasons).toEqual([]);
      expect(h.stats().observationGap.state).toBe('NONE');
      expect(h.freezeLogs()).toHaveLength(1);
    });

    it('S7. the accepted CIM fallback is projected out while a real network failure is not', async () => {
      h.installSnapshotLeaf(S.DEGRADED, 'cim-fallback');
      const base = await h.bringUp();
      // The quality is DERIVED by the scanner from the leaf it was handed.
      expect(base.identityQuality).toBe('birth-time');
      expect(base.identityDegraded).toBe(false);
      expect(base.state).toBe(A.HEALTHY);
      expect(base.reasons).toEqual([]);
      expect(base.sensors.raw.state).toBe(S.DEGRADED);
      expect(base.sensors.effective.state).toBe(S.HEALTHY);
      expect(base.sensors.projections).toEqual([
        {
          sensorId: 'proc-snapshot',
          from: S.DEGRADED,
          to: S.HEALTHY,
          reason: 'identity-birth-time-fallback',
        },
      ]);
      expect(base.sensors.byId['proc-snapshot'].state).toBe(S.DEGRADED);

      h.getRawTcpConnections.mockRejectedValue(new Error('spawn ETIMEDOUT'));
      await h.tickNetwork();

      const health = h.health();
      expect(health.state).toBe(A.DEGRADED);
      expect(health.reasons).toEqual([R.SENSOR_FAILED]);
      expect(health.sensors.raw.state).toBe(S.FAILED);
      expect(health.sensors.raw.degradedSensorIds).toEqual(['proc-snapshot']);
      expect(health.sensors.effective.failedSensorIds).toEqual(['network']);
      expect(health.sensors.effective.degradedSensorIds).toEqual([]);
      expect(health.sensors.effective.participatingCount).toBe(
        health.sensors.raw.participatingCount,
      );
      expect(health.sensors.projections).toHaveLength(1);
      expect(h.freezeLogs()).toEqual([]);
    });
  });

  describe('S8 — only a reconciled process tick clears a resumed gap', () => {
    beforeEach(() => {
      h = createHarness(shims);
    });

    it('S8. a file tick and a network tick after resume observe, stamp, and leave the gap armed', async () => {
      await h.bringUp();
      const handleBefore = h.health().sensors.byId['fs-handle'].lastSuccessAt;

      // The process tick parks on the provider, the machine sleeps under it, and the
      // straddled tick is frozen — so the run reaches its file and network ticks with
      // the gap still RESUMED and no reconciled process tick in between.
      let resolveList;
      h.listProcesses.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveList = resolve;
          }),
      );
      h.startup();
      await h.advance(3000);
      expect(resolveList).toBeTypeOf('function');
      await h.sleep(4000);
      resolveList([CLAUDE]);
      await h.flush();
      expect(h.freezeLogs()).toEqual([{ reason: 'suspend-straddle', agents: 1 }]);

      await h.advance(1000); // 8 s: the file tick
      await h.advance(4000); // 12 s: the network tick

      const health = h.health();
      const ids = health.sensors.byId;
      // Both sensors observed after the resume and stamped at write time (§10 B5).
      expect(ids['fs-handle'].state).toBe(S.HEALTHY);
      expect(ids['fs-handle'].lastSuccessAt).toBeGreaterThan(handleBefore);
      expect(ids['fs-handle'].lastSuccessAt).toBeGreaterThan(h.stats().observationGap.resumedAt);
      expect(ids.network.state).toBe(S.HEALTHY);
      expect(health.state).toBe(A.HEALTHY);
      expect(health.reasons).toEqual([]);
      // ...and neither cleared the gap: that is the process reconcile's to do.
      const stats = h.expectSiblings();
      expect(stats.observationGap.state).toBe('RESUMED');
      expect(stats.observationGap.clearedAt).toBeNull();
      expect(stats.appHealth.state).toBe(A.HEALTHY);
      expect(h.sessionTracker.activeCount()).toBe(1);

      await h.tickProcess();
      expect(h.stats().observationGap.state).toBe('NONE');
      expect(h.freezeLogs()).toHaveLength(1);
      expect(nonNetworkAudit(h)).toEqual(['agent-enter', 'observation-gap']);
    });
  });

  describe('S9 — a secondary detector degrades the app without closing the population gate', () => {
    beforeEach(() => {
      h = createHarness(shims, { llm: { [OLLAMA_PORT]: 'timeout' } });
    });

    it('S9. an Ollama probe timeout is DEGRADED, and the pid-scoped sensors still observe', async () => {
      const health = await h.bringUp();

      expect(health.state).toBe(A.DEGRADED);
      expect(health.reasons).toEqual([R.SENSOR_DEGRADED]);
      expect(health.sensors.effective.degradedSensorIds).toEqual(['llm-ollama']);
      const ids = health.sensors.byId;
      expect(ids['llm-ollama'].lastError).toBe('probe-unreachable:timeout');
      expect(ids['llm-ollama'].lastSuccessAt).toBeNull();
      expect(ids['llm-lmstudio'].state).toBe(S.HEALTHY);
      // Not folded into the process leaf (§10 B3): the gate stayed open.
      expect(health.populationState).toBe(S.HEALTHY);
      expect(health.populationReliable).toBe(true);
      expect(ids.network.state).toBe(S.HEALTHY);
      expect(ids['fs-handle'].state).toBe(S.HEALTHY);
      expect(h.getRawTcpConnections).toHaveBeenCalled();
      expect(h.getFileHandles).toHaveBeenCalledWith(CLAUDE.pid);
    });
  });
});
