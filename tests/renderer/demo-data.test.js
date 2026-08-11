import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writable, get } from 'svelte/store';
import {
  startDemoMode,
  buildStats,
  buildAnomalies,
  _setDepsForTest,
  _resetDeps,
} from '../../src/renderer/lib/stores/demo-data.js';
// The marker and its predicate live apart from the engine: they must survive into a
// production bundle that carries no demo data at all (see demo-provenance.js).
import { isDemoPayload, DEMO_MARK } from '../../src/renderer/lib/stores/demo-provenance.js';
import { DEMO_AGENTS_POOL, SCENARIOS } from '../../src/renderer/lib/stores/demo-pools.js';

/** Create a fresh set of writable stores for each test. */
function makeStores() {
  return {
    agents: writable([]),
    events: writable([]),
    stats: writable({}),
    network: writable([]),
    anomalies: writable({}),
    monitorResourceUsage: writable(null),
  };
}

describe('demo-data', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _setDepsForTest({
      randInt: (min, _max) => min,
      pick: (arr) => arr[0],
    });
  });

  afterEach(() => {
    _resetDeps();
    vi.useRealTimers();
  });

  describe('startDemoMode()', () => {
    it('returns a cleanup function', () => {
      const stores = makeStores();
      const cleanup = startDemoMode(stores);
      expect(typeof cleanup).toBe('function');
      cleanup();
    });

    it('seeds initial agent data immediately', () => {
      const stores = makeStores();
      const cleanup = startDemoMode(stores);
      const agents = get(stores.agents);
      expect(agents.length).toBeGreaterThan(0);
      expect(agents[0]).toHaveProperty('agent');
      expect(agents[0]).toHaveProperty('pid');
      cleanup();
    });

    it('seeds stats after staggered init', () => {
      const stores = makeStores();
      const cleanup = startDemoMode(stores);
      vi.advanceTimersByTime(1); // flush staggered rAF fallback
      const s = get(stores.stats);
      expect(s).toHaveProperty('totalFiles');
      expect(s).toHaveProperty('currentAgents');
      cleanup();
    });

    it('cleanup clears all intervals (no leaks)', () => {
      const stores = makeStores();
      const cleanup = startDemoMode(stores);
      vi.advanceTimersByTime(1); // flush staggered init
      cleanup();

      const agentsBefore = get(stores.agents);
      const eventsBefore = get(stores.events);
      vi.advanceTimersByTime(60000);
      expect(get(stores.agents)).toEqual(agentsBefore);
      expect(get(stores.events)).toEqual(eventsBefore);
    });
  });

  describe('scenario phases', () => {
    it('cycles: calm → elevated → critical → reset', () => {
      const stores = makeStores();
      const cleanup = startDemoMode(stores);
      vi.advanceTimersByTime(1); // flush staggered init

      // Initial phase = calm (index 0), agentCount = 3
      expect(get(stores.agents)).toHaveLength(SCENARIOS[0].agentCount);

      // Advance past calm duration → elevated
      vi.advanceTimersByTime(SCENARIOS[0].duration);
      expect(get(stores.agents)).toHaveLength(SCENARIOS[1].agentCount);

      // Advance past elevated → critical
      vi.advanceTimersByTime(SCENARIOS[1].duration);
      expect(get(stores.agents)).toHaveLength(SCENARIOS[2].agentCount);

      // Advance past critical → reset
      vi.advanceTimersByTime(SCENARIOS[2].duration);
      expect(get(stores.agents)).toHaveLength(SCENARIOS[3].agentCount);

      cleanup();
    });

    it('wraps back to calm after reset', () => {
      const stores = makeStores();
      const cleanup = startDemoMode(stores);
      vi.advanceTimersByTime(1); // flush staggered init

      const totalDuration = SCENARIOS.reduce((s, p) => s + p.duration, 0);
      vi.advanceTimersByTime(totalDuration);

      // Should be back to calm
      expect(get(stores.agents)).toHaveLength(SCENARIOS[0].agentCount);
      cleanup();
    });
  });

  describe('buildStats()', () => {
    it('returns object with correct shape', () => {
      const agents = [
        { agent: 'TestBot', category: 'ai' },
        { agent: 'Helper', category: 'tool' },
      ];
      const result = buildStats({
        activeAgents: agents,
        totalFiles: 100,
        totalSensitive: 10,
        monitoringStarted: Date.now() - 60000,
      });

      expect(result).toHaveProperty('totalFiles', 100);
      expect(result).toHaveProperty('totalSensitive', 10);
      expect(result).toHaveProperty('aiSensitive');
      expect(result).toHaveProperty('uptimeMs');
      expect(result).toHaveProperty('monitoringStarted');
      expect(result).toHaveProperty('peakAgents', 12);
      expect(result).toHaveProperty('currentAgents', 2);
      expect(result).toHaveProperty('aiAgentCount', 1);
      expect(result).toHaveProperty('otherAgentCount', 1);
      expect(result).toHaveProperty('uniqueAgents');
      expect(result.uniqueAgents).toEqual(['TestBot', 'Helper']);
    });

    it('computes aiSensitive as 85% of totalSensitive', () => {
      const result = buildStats({
        activeAgents: [],
        totalFiles: 50,
        totalSensitive: 20,
        monitoringStarted: Date.now(),
      });
      expect(result.aiSensitive).toBe(17); // Math.round(20 * 0.85)
    });
  });

  describe('buildAnomalies()', () => {
    it('returns object with correct shape', () => {
      const agents = [
        { agent: 'Bot1', category: 'ai' },
        { agent: 'Bot2', category: 'ai' },
      ];
      const result = buildAnomalies({ activeAgents: agents, scenario: { name: 'calm' } });

      expect(typeof result).toBe('object');
      expect(result).toHaveProperty('Bot1');
      expect(result).toHaveProperty('Bot2');
      expect(typeof result.Bot1).toBe('number');
      expect(typeof result.Bot2).toBe('number');
    });

    it('scores are capped at 100', () => {
      const agents = Array.from({ length: 10 }, (_, i) => ({
        agent: `Agent${i}`,
        category: 'ai',
      }));
      const result = buildAnomalies({ activeAgents: agents, scenario: { name: 'critical' } });

      Object.values(result).forEach((score) => {
        expect(score).toBeLessThanOrEqual(100);
      });
    });

    it('calm scores are lower than critical scores', () => {
      const agents = [{ agent: 'Bot', category: 'ai' }];
      const calm = buildAnomalies({ activeAgents: agents, scenario: { name: 'calm' } });
      const crit = buildAnomalies({ activeAgents: agents, scenario: { name: 'critical' } });
      expect(calm.Bot).toBeLessThan(crit.Bot);
    });
  });

  describe('demo provenance marker', () => {
    // A record shaped exactly as the main process emits one — no marker key at all.
    // This is the control: without it, "the marker is present on demo data" proves
    // nothing, because a predicate that returns true for everything would also pass.
    const REAL_AGENT = {
      agent: 'Claude Code',
      process: 'claude',
      pid: 3421,
      status: 'running',
      category: 'coding-assistant',
      parentEditor: null,
      cwd: 'X:/Future/ESCAPE/AEGIS',
      projectName: 'AEGIS',
      startTime: 1754380000000,
      instanceId: '3421:1754380000000',
      instanceIdSource: 'os',
    };
    const REAL_EVENT = {
      agent: 'Claude Code',
      pid: 3421,
      parentEditor: null,
      cwd: 'X:/Future/ESCAPE/AEGIS',
      file: 'X:/Future/ESCAPE/AEGIS/package.json',
      sensitive: false,
      selfAccess: false,
      reason: '',
      action: 'modified',
      timestamp: 1754380001000,
      category: 'coding-assistant',
      attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
    };
    const REAL_STATS = {
      totalFiles: 812,
      totalSensitive: 11,
      uptimeMs: 840000,
      monitoringStarted: 1754379000000,
    };

    describe('isDemoPayload()', () => {
      it('rejects payloads the main process produces', () => {
        expect(isDemoPayload(REAL_AGENT)).toBe(false);
        expect(isDemoPayload(REAL_EVENT)).toBe(false);
        expect(isDemoPayload(REAL_STATS)).toBe(false);
      });

      it('rejects non-objects and null', () => {
        expect(isDemoPayload(null)).toBe(false);
        expect(isDemoPayload(undefined)).toBe(false);
        expect(isDemoPayload('_demo')).toBe(false);
        expect(isDemoPayload(1)).toBe(false);
      });

      it('requires the marker to be exactly true, not merely truthy', () => {
        expect(isDemoPayload({ [DEMO_MARK]: 'yes' })).toBe(false);
        expect(isDemoPayload({ [DEMO_MARK]: 1 })).toBe(false);
        expect(isDemoPayload({ [DEMO_MARK]: false })).toBe(false);
        expect(isDemoPayload({ [DEMO_MARK]: true })).toBe(true);
      });
    });

    it('marks every agent record seeded into the store', () => {
      const stores = makeStores();
      const cleanup = startDemoMode(stores);

      const agents = get(stores.agents);
      expect(agents.length).toBeGreaterThan(0);
      agents.forEach((a) => expect(isDemoPayload(a)).toBe(true));

      cleanup();
    });

    it('marks the agent records synchronously, before stats lands', () => {
      // stats.set() is deferred a frame (rAF) while agents.set() is synchronous.
      // Without a marker ON the agents, that gap is a window in which fabricated
      // agents are on screen and nothing in the stores says so.
      const stores = makeStores();
      const cleanup = startDemoMode(stores);

      expect(get(stores.stats)).toEqual({});
      expect(get(stores.agents).some((a) => isDemoPayload(a))).toBe(true);

      cleanup();
    });

    it('marks the stats payload', () => {
      const stores = makeStores();
      const cleanup = startDemoMode(stores);
      vi.advanceTimersByTime(1); // flush staggered rAF fallback

      expect(isDemoPayload(get(stores.stats))).toBe(true);

      cleanup();
    });

    it('marks emitted file events and network connections', () => {
      const stores = makeStores();
      const cleanup = startDemoMode(stores);
      vi.advanceTimersByTime(1); // flush staggered init
      vi.advanceTimersByTime(2000); // emitterDelay → intervals registered
      vi.advanceTimersByTime(5000); // file emitter (2s) + network emitter (5s)

      const events = get(stores.events);
      const network = get(stores.network);
      expect(events.length).toBeGreaterThan(0);
      expect(network.length).toBeGreaterThan(0);
      events.forEach((e) => expect(isDemoPayload(e)).toBe(true));
      network.forEach((n) => expect(isDemoPayload(n)).toBe(true));

      cleanup();
    });

    it('re-marks after a scenario advance', () => {
      const stores = makeStores();
      const cleanup = startDemoMode(stores);
      vi.advanceTimersByTime(1);
      vi.advanceTimersByTime(SCENARIOS[0].duration); // calm → elevated

      expect(get(stores.agents).every((a) => isDemoPayload(a))).toBe(true);
      expect(isDemoPayload(get(stores.stats))).toBe(true);

      cleanup();
    });

    it('does not write the marker onto the shared pool constants', () => {
      const stores = makeStores();
      const cleanup = startDemoMode(stores);
      vi.advanceTimersByTime(1);
      vi.advanceTimersByTime(SCENARIOS[0].duration);

      DEMO_AGENTS_POOL.forEach((a) => expect(isDemoPayload(a)).toBe(false));

      cleanup();
    });

    it('separates a demo store snapshot from a real one', () => {
      // The exact predicate `demoDataActive` (stores/ipc.ts) applies to the raw
      // agents/stats stores. Asserted here rather than by importing ipc.ts, which
      // starts its own demo engine at module scope when window.aegis is absent.
      const active = (agents, stats) =>
        agents.some((a) => isDemoPayload(a)) || isDemoPayload(stats);

      const stores = makeStores();
      const cleanup = startDemoMode(stores);
      vi.advanceTimersByTime(1);

      expect(active(get(stores.agents), get(stores.stats))).toBe(true);
      expect(active([REAL_AGENT], REAL_STATS)).toBe(false);
      expect(active([], {})).toBe(false);

      cleanup();
    });
  });
});
