import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writable, get } from 'svelte/store';
import {
  startDemoMode,
  buildStats,
  buildAnomalies,
  _setDepsForTest,
  _resetDeps,
} from '../../src/renderer/lib/stores/demo-data.js';
import { SCENARIOS } from '../../src/renderer/lib/stores/demo-pools.js';

/** Create a fresh set of writable stores for each test. */
function makeStores() {
  return {
    agents: writable([]),
    events: writable([]),
    stats: writable({}),
    network: writable([]),
    anomalies: writable({}),
    resourceUsage: writable({}),
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

    it('seeds initial stats immediately', () => {
      const stores = makeStores();
      const cleanup = startDemoMode(stores);
      const s = get(stores.stats);
      expect(s).toHaveProperty('totalFiles');
      expect(s).toHaveProperty('currentAgents');
      cleanup();
    });

    it('cleanup clears all intervals (no leaks)', () => {
      const stores = makeStores();
      const cleanup = startDemoMode(stores);
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

      // Initial phase = calm (index 0), agentCount = 2
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
      expect(result).toHaveProperty('peakAgents', 5);
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
});
