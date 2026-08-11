import { describe, it, expect } from 'vitest';
import {
  toStatsRows,
  sortRows,
  formatRelativeTime,
  riskColor,
} from '../../src/renderer/lib/utils/agent-stats-utils.ts';

describe('agent-stats-utils', () => {
  const NOW = 1700000000000;

  /** @returns {import('../../src/shared/types/risk').EnrichedAgent} */
  function makeAgent(overrides = {}) {
    return {
      agent: 'TestAgent',
      pid: 1234,
      process: 'test',
      status: 'running',
      category: 'ai',
      name: 'TestAgent',
      parentEditor: null,
      cwd: null,
      projectName: null,
      instanceId: '1234:1700000000000',
      instanceKey: 'TestAgent',
      sensitiveFiles: 0,
      unknownDomains: 0,
      anomalyScore: 0,
      riskScore: 25,
      trustGrade: 'B',
      fileCount: 10,
      networkCount: 5,
      hasApiCalls: false,
      ...overrides,
    };
  }

  describe('toStatsRows()', () => {
    it('converts single agent to row', () => {
      const rows = toStatsRows([makeAgent()], NOW);
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('TestAgent');
      expect(rows[0].riskScore).toBe(25);
      expect(rows[0].fileCount).toBe(10);
      expect(rows[0].networkCount).toBe(5);
      expect(rows[0].instanceId).toBe('1234:1700000000000');
    });

    it('groups agents by name — representative metrics only (F-W05)', () => {
      const agents = [
        makeAgent({
          pid: 100,
          instanceId: '100:a',
          riskScore: 10,
          fileCount: 5,
          networkCount: 2,
        }),
        makeAgent({
          pid: 200,
          instanceId: '200:b',
          riskScore: 40,
          fileCount: 8,
          networkCount: 3,
        }),
      ];
      const rows = toStatsRows(agents, NOW);
      expect(rows).toHaveLength(1);
      expect(rows[0].riskScore).toBe(40);
      // Not sum 13 / 5 — same population as risk (rep instance).
      expect(rows[0].fileCount).toBe(8);
      expect(rows[0].networkCount).toBe(3);
      expect(rows[0].instanceId).toBe('200:b');
    });

    it('returns empty array for no agents', () => {
      expect(toStatsRows([], NOW)).toEqual([]);
    });
  });

  describe('sortRows()', () => {
    const rows = [
      {
        name: 'Beta',
        pid: 1,
        status: 'active',
        riskScore: 30,
        fileCount: 100,
        networkCount: 2,
        lastSeen: NOW,
        category: 'ai',
        trustGrade: 'B',
      },
      {
        name: 'Alpha',
        pid: 2,
        status: 'active',
        riskScore: 80,
        fileCount: 5,
        networkCount: 20,
        lastSeen: NOW - 5000,
        category: 'ai',
        trustGrade: 'D',
      },
      {
        name: 'Gamma',
        pid: 3,
        status: 'active',
        riskScore: 10,
        fileCount: 50,
        networkCount: 8,
        lastSeen: NOW - 1000,
        category: 'ai',
        trustGrade: 'A',
      },
    ];

    it('sorts by agent name ascending', () => {
      const sorted = sortRows(rows, 'agent', 'asc');
      expect(sorted.map((r) => r.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
    });

    it('sorts by agent name descending', () => {
      const sorted = sortRows(rows, 'agent', 'desc');
      expect(sorted.map((r) => r.name)).toEqual(['Gamma', 'Beta', 'Alpha']);
    });

    it('sorts by risk descending', () => {
      const sorted = sortRows(rows, 'risk', 'desc');
      expect(sorted.map((r) => r.riskScore)).toEqual([80, 30, 10]);
    });

    it('sorts by risk ascending', () => {
      const sorted = sortRows(rows, 'risk', 'asc');
      expect(sorted.map((r) => r.riskScore)).toEqual([10, 30, 80]);
    });

    it('sorts by files descending', () => {
      const sorted = sortRows(rows, 'files', 'desc');
      expect(sorted.map((r) => r.fileCount)).toEqual([100, 50, 5]);
    });

    it('sorts by network descending', () => {
      const sorted = sortRows(rows, 'network', 'desc');
      expect(sorted.map((r) => r.networkCount)).toEqual([20, 8, 2]);
    });

    it('does not mutate original array', () => {
      const original = [...rows];
      sortRows(rows, 'risk', 'desc');
      expect(rows).toEqual(original);
    });
  });

  describe('formatRelativeTime()', () => {
    it('returns "now" for < 1s', () => {
      expect(formatRelativeTime(500)).toBe('now');
    });

    it('returns seconds', () => {
      expect(formatRelativeTime(5000)).toBe('5s ago');
    });

    it('returns minutes', () => {
      expect(formatRelativeTime(180000)).toBe('3m ago');
    });

    it('returns hours', () => {
      expect(formatRelativeTime(7200000)).toBe('2h ago');
    });
  });

  describe('riskColor() — uses getRiskInfo bands (F-W10)', () => {
    it('returns primary for low risk band', () => {
      expect(riskColor(10)).toContain('primary');
      expect(riskColor(34)).toContain('primary');
    });

    it('returns secondary for medium risk band', () => {
      expect(riskColor(35)).toContain('secondary');
      expect(riskColor(50)).toContain('secondary');
      expect(riskColor(65)).toContain('secondary');
    });

    it('returns error for high risk band', () => {
      expect(riskColor(66)).toContain('error');
      expect(riskColor(80)).toContain('error');
    });
  });
});
