import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

describe('anomaly-detector', () => {
  let anomaly;
  let bl;

  beforeEach(() => {
    // Clear require cache to get fresh module instances (with fresh deviationWarningsSent)
    const anomalyPath = require.resolve('../../src/main/anomaly-detector.js');
    const baselinesPath = require.resolve('../../src/main/baselines.js');
    delete require.cache[anomalyPath];
    delete require.cache[baselinesPath];

    // Load real baselines module, then manipulate its internal data
    bl = require('../../src/main/baselines.js');
    // Clear session data
    const sd = bl.getSessionData();
    for (const key of Object.keys(sd)) delete sd[key];
    // Clear baselines agents
    const baselines = bl.getBaselines();
    for (const key of Object.keys(baselines.agents)) delete baselines.agents[key];

    anomaly = require('../../src/main/anomaly-detector.js');
  });

  function setupAgent(agentName, sessionOverrides, baselineOverrides) {
    const sd = bl.ensureSessionData(agentName);
    // Merge session overrides
    if (sessionOverrides.files) sd.files = sessionOverrides.files;
    if (sessionOverrides.sensitiveCount !== undefined) sd.sensitiveCount = sessionOverrides.sensitiveCount;
    if (sessionOverrides.sensitiveReasons) sd.sensitiveReasons = sessionOverrides.sensitiveReasons;
    if (sessionOverrides.endpoints) sd.endpoints = sessionOverrides.endpoints;
    if (sessionOverrides.directories) sd.directories = sessionOverrides.directories;
    if (sessionOverrides.activeHours) sd.activeHours = sessionOverrides.activeHours;

    // Setup baseline
    const baselines = bl.getBaselines();
    baselines.agents[agentName] = {
      sessionCount: baselineOverrides.sessionCount ?? 5,
      averages: {
        filesPerSession: 2,
        sensitivePerSession: 1,
        knownSensitiveReasons: [],
        typicalDirectories: [],
        hourHistogram: new Array(24).fill(1),
        ...(baselineOverrides.averages || {}),
      },
      sessions: baselineOverrides.sessions || [
        { networkEndpoints: [] },
        { networkEndpoints: [] },
        { networkEndpoints: [] },
        { networkEndpoints: [] },
        { networkEndpoints: [] },
      ],
    };
  }

  describe('calculateAnomalyScore', () => {
    it('returns 0 when no session data exists', () => {
      expect(anomaly.calculateAnomalyScore('Unknown')).toBe(0);
    });

    it('returns 0 when no baseline exists', () => {
      bl.ensureSessionData('Test');
      expect(anomaly.calculateAnomalyScore('Test')).toBe(0);
    });

    it('returns 0 when session count < 3', () => {
      setupAgent('Test', {}, { sessionCount: 2 });
      expect(anomaly.calculateAnomalyScore('Test')).toBe(0);
    });

    it('returns 0 for normal behavior within baselines', () => {
      setupAgent('Test', {
        files: new Set(['a.js', 'b.js']),
        sensitiveCount: 1,
        sensitiveReasons: new Set(),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set([10]),
      }, {});
      expect(anomaly.calculateAnomalyScore('Test')).toBe(0);
    });

    it('scores file volume deviation (>3x triggers points)', () => {
      setupAgent('Test', {
        files: new Set(Array.from({ length: 10 }, (_, i) => `f${i}.js`)),
        sensitiveCount: 0,
        sensitiveReasons: new Set(),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set(),
      }, { averages: { filesPerSession: 2, sensitivePerSession: 0 } });
      const score = anomaly.calculateAnomalyScore('Test');
      expect(score).toBe(20);
    });

    it('caps file volume at 30 points', () => {
      setupAgent('Test', {
        files: new Set(Array.from({ length: 100 }, (_, i) => `f${i}`)),
        sensitiveCount: 0,
        sensitiveReasons: new Set(),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set(),
      }, { averages: { filesPerSession: 2, sensitivePerSession: 0 } });
      const score = anomaly.calculateAnomalyScore('Test');
      expect(score).toBe(30);
    });

    it('scores sensitive count deviation', () => {
      setupAgent('Test', {
        files: new Set(['a']),
        sensitiveCount: 10,
        sensitiveReasons: new Set(),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set(),
      }, { averages: { filesPerSession: 10, sensitivePerSession: 2 } });
      const score = anomaly.calculateAnomalyScore('Test');
      expect(score).toBe(20);
    });

    it('caps sensitive count at 25 points', () => {
      setupAgent('Test', {
        files: new Set(['a']),
        sensitiveCount: 200,
        sensitiveReasons: new Set(),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set(),
      }, { averages: { filesPerSession: 10, sensitivePerSession: 2 } });
      const score = anomaly.calculateAnomalyScore('Test');
      expect(score).toBe(25);
    });

    it('scores new sensitive categories (10pts each, max 20)', () => {
      setupAgent('Test', {
        files: new Set(['a']),
        sensitiveCount: 0,
        sensitiveReasons: new Set(['SSH key', 'AWS credentials', 'browser data']),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set(),
      }, { averages: { filesPerSession: 10, sensitivePerSession: 0, knownSensitiveReasons: [] } });
      const score = anomaly.calculateAnomalyScore('Test');
      expect(score).toBe(20);
    });

    it('does not score known sensitive categories', () => {
      setupAgent('Test', {
        files: new Set(['a']),
        sensitiveCount: 0,
        sensitiveReasons: new Set(['SSH key']),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set(),
      }, { averages: { filesPerSession: 10, sensitivePerSession: 0, knownSensitiveReasons: ['SSH key'] } });
      expect(anomaly.calculateAnomalyScore('Test')).toBe(0);
    });

    it('scores new network endpoints (5pts each, max 15)', () => {
      setupAgent('Test', {
        files: new Set(),
        sensitiveCount: 0,
        sensitiveReasons: new Set(),
        endpoints: new Set(['evil.com:443', 'bad.net:80', 'shady.io:8080', 'worse.dev:443']),
        directories: new Set(),
        activeHours: new Set(),
      }, { averages: { filesPerSession: 0, sensitivePerSession: 0 } });
      const score = anomaly.calculateAnomalyScore('Test');
      expect(score).toBe(15);
    });

    it('does not score endpoints seen in recent sessions', () => {
      setupAgent('Test', {
        files: new Set(),
        sensitiveCount: 0,
        sensitiveReasons: new Set(),
        endpoints: new Set(['api.anthropic.com:443']),
        directories: new Set(),
        activeHours: new Set(),
      }, {
        averages: { filesPerSession: 0, sensitivePerSession: 0 },
        sessions: [
          { networkEndpoints: ['api.anthropic.com:443'] },
          { networkEndpoints: [] },
          { networkEndpoints: [] },
          { networkEndpoints: [] },
          { networkEndpoints: [] },
        ],
      });
      expect(anomaly.calculateAnomalyScore('Test')).toBe(0);
    });

    it('scores unusual timing (+10 for unseen hour)', () => {
      const hist = new Array(24).fill(1);
      hist[3] = 0;
      setupAgent('Test', {
        files: new Set(),
        sensitiveCount: 0,
        sensitiveReasons: new Set(),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set([3]),
      }, { averages: { filesPerSession: 0, sensitivePerSession: 0, hourHistogram: hist } });
      expect(anomaly.calculateAnomalyScore('Test')).toBe(10);
    });

    it('does not score timing for known hours', () => {
      setupAgent('Test', {
        files: new Set(),
        sensitiveCount: 0,
        sensitiveReasons: new Set(),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set([10, 14]),
      }, { averages: { filesPerSession: 0, sensitivePerSession: 0, hourHistogram: new Array(24).fill(1) } });
      expect(anomaly.calculateAnomalyScore('Test')).toBe(0);
    });

    it('caps total score at 100', () => {
      const hist = new Array(24).fill(1);
      hist[3] = 0;
      setupAgent('Test', {
        files: new Set(Array.from({ length: 200 }, (_, i) => `f${i}`)),
        sensitiveCount: 100,
        sensitiveReasons: new Set(['a', 'b', 'c']),
        endpoints: new Set(['e1', 'e2', 'e3', 'e4']),
        activeHours: new Set([3]),
        directories: new Set(),
      }, {
        averages: {
          filesPerSession: 1,
          sensitivePerSession: 1,
          knownSensitiveReasons: [],
          hourHistogram: hist,
        },
      });
      expect(anomaly.calculateAnomalyScore('Test')).toBe(100);
    });

    it('handles null hourHistogram gracefully', () => {
      setupAgent('Test', {
        files: new Set(),
        sensitiveCount: 0,
        sensitiveReasons: new Set(),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set([5]),
      }, { averages: { filesPerSession: 0, sensitivePerSession: 0, hourHistogram: null } });
      expect(anomaly.calculateAnomalyScore('Test')).toBe(10);
    });
  });

  describe('checkDeviations', () => {
    it('returns empty array when no agents have session data', () => {
      expect(anomaly.checkDeviations()).toEqual([]);
    });

    it('skips agents with sessionCount < 3', () => {
      setupAgent('Test', {
        files: new Set(Array.from({ length: 50 }, (_, i) => `f${i}`)),
      }, { sessionCount: 1 });
      expect(anomaly.checkDeviations()).toEqual([]);
    });

    it('warns on file volume 3x above average', () => {
      setupAgent('Test', {
        files: new Set(Array.from({ length: 10 }, (_, i) => `f${i}`)),
        sensitiveCount: 0,
        sensitiveReasons: new Set(),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set(),
      }, { averages: { filesPerSession: 2, sensitivePerSession: 0 } });
      const warnings = anomaly.checkDeviations();
      const fileWarn = warnings.find(w => w.type === 'files');
      expect(fileWarn).toBeDefined();
      expect(fileWarn.agent).toBe('Test');
      expect(fileWarn.message).toContain('normally accesses');
      expect(typeof fileWarn.anomalyScore).toBe('number');
    });

    it('warns on sensitive access 3x above average', () => {
      setupAgent('Test', {
        files: new Set(['a']),
        sensitiveCount: 15,
        sensitiveReasons: new Set(),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set(),
      }, { averages: { filesPerSession: 10, sensitivePerSession: 3 } });
      const warnings = anomaly.checkDeviations();
      const sensWarn = warnings.find(w => w.type === 'sensitive');
      expect(sensWarn).toBeDefined();
      expect(sensWarn.message).toContain('sensitive file access');
    });

    it('warns on new sensitive category', () => {
      setupAgent('Test', {
        files: new Set(['a']),
        sensitiveCount: 1,
        sensitiveReasons: new Set(['browser data']),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set(),
      }, { averages: { filesPerSession: 10, sensitivePerSession: 10, knownSensitiveReasons: [] } });
      const warnings = anomaly.checkDeviations();
      const catWarn = warnings.find(w => w.type === 'new-sensitive');
      expect(catWarn).toBeDefined();
      expect(catWarn.message).toContain('browser data');
    });

    it('warns on new network endpoint', () => {
      setupAgent('Test', {
        files: new Set(),
        sensitiveCount: 0,
        sensitiveReasons: new Set(),
        endpoints: new Set(['evil.com:443']),
        directories: new Set(),
        activeHours: new Set(),
      }, { averages: { filesPerSession: 0, sensitivePerSession: 0 } });
      const warnings = anomaly.checkDeviations();
      const netWarn = warnings.find(w => w.type === 'network');
      expect(netWarn).toBeDefined();
      expect(netWarn.message).toContain('evil.com:443');
    });

    it('warns on 4+ new directories', () => {
      setupAgent('Test', {
        files: new Set(),
        sensitiveCount: 0,
        sensitiveReasons: new Set(),
        endpoints: new Set(),
        directories: new Set(['/a', '/b', '/c', '/d']),
        activeHours: new Set(),
      }, { averages: { filesPerSession: 0, sensitivePerSession: 0, typicalDirectories: [] } });
      const warnings = anomaly.checkDeviations();
      const dirWarn = warnings.find(w => w.type === 'directories');
      expect(dirWarn).toBeDefined();
      expect(dirWarn.message).toContain('4 new directories');
    });

    it('does not warn for 3 new dirs (below threshold)', () => {
      setupAgent('Test', {
        files: new Set(),
        sensitiveCount: 0,
        sensitiveReasons: new Set(),
        endpoints: new Set(),
        directories: new Set(['/a', '/b', '/c']),
        activeHours: new Set(),
      }, { averages: { filesPerSession: 0, sensitivePerSession: 0, typicalDirectories: [] } });
      expect(anomaly.checkDeviations().find(w => w.type === 'directories')).toBeUndefined();
    });

    it('warns on unusual hour activity', () => {
      const hist = new Array(24).fill(1);
      hist[3] = 0;
      setupAgent('Test', {
        files: new Set(),
        sensitiveCount: 0,
        sensitiveReasons: new Set(),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set([3]),
      }, { averages: { filesPerSession: 0, sensitivePerSession: 0, hourHistogram: hist } });
      const warnings = anomaly.checkDeviations();
      const timeWarn = warnings.find(w => w.type === 'timing');
      expect(timeWarn).toBeDefined();
      expect(timeWarn.message).toContain('03:00');
    });

    it('deduplicates warnings (same warning not sent twice)', () => {
      setupAgent('Test', {
        files: new Set(Array.from({ length: 20 }, (_, i) => `f${i}`)),
        sensitiveCount: 0,
        sensitiveReasons: new Set(),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set(),
      }, { averages: { filesPerSession: 2, sensitivePerSession: 0 } });
      const first = anomaly.checkDeviations();
      const second = anomaly.checkDeviations();
      expect(first.filter(w => w.type === 'files').length).toBe(1);
      expect(second.filter(w => w.type === 'files').length).toBe(0);
    });
  });
});
