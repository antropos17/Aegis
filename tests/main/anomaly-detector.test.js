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
    const scoringPath = require.resolve('../../src/main/scoring-utils.js');
    delete require.cache[anomalyPath];
    delete require.cache[baselinesPath];
    delete require.cache[scoringPath];

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
    it('returns result with score 0 when no session data exists', () => {
      const result = anomaly.calculateAnomalyScore('Unknown');
      expect(result.score).toBe(0);
      expect(result.dimensions).toBeDefined();
    });

    it('returns score 0 when no baseline exists', () => {
      bl.ensureSessionData('Test');
      expect(anomaly.calculateAnomalyScore('Test').score).toBe(0);
    });

    it('returns score 0 when session count < 3', () => {
      setupAgent('Test', {}, { sessionCount: 2 });
      expect(anomaly.calculateAnomalyScore('Test').score).toBe(0);
    });

    it('returns score 0 for normal behavior within baselines', () => {
      setupAgent('Test', {
        files: new Set(['a.js', 'b.js']),
        sensitiveCount: 1,
        sensitiveReasons: new Set(),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set([10]),
      }, {});
      expect(anomaly.calculateAnomalyScore('Test').score).toBe(0);
    });

    it('scores file volume deviation via filesystem dimension', () => {
      setupAgent('Test', {
        files: new Set(Array.from({ length: 10 }, (_, i) => `f${i}.js`)),
        sensitiveCount: 0,
        sensitiveReasons: new Set(),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set(),
      }, { averages: { filesPerSession: 2, sensitivePerSession: 0 } });
      const result = anomaly.calculateAnomalyScore('Test');
      // filesystem: fileVol = min(50, round((5-1)*8)) = 32, weight 0.25 → 8
      expect(result.score).toBe(8);
      expect(result.dimensions.filesystem.score).toBe(32);
    });

    it('caps filesystem dimension at 100', () => {
      setupAgent('Test', {
        files: new Set(Array.from({ length: 100 }, (_, i) => `f${i}`)),
        sensitiveCount: 0,
        sensitiveReasons: new Set(),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set(),
      }, { averages: { filesPerSession: 2, sensitivePerSession: 0 } });
      const result = anomaly.calculateAnomalyScore('Test');
      // filesystem: fileVol = min(50, round((50-1)*8)) = 50, weight 0.25 → 13
      expect(result.dimensions.filesystem.score).toBe(50);
      expect(result.score).toBe(13);
    });

    it('scores sensitive count deviation via filesystem dimension', () => {
      setupAgent('Test', {
        files: new Set(['a']),
        sensitiveCount: 10,
        sensitiveReasons: new Set(),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set(),
      }, { averages: { filesPerSession: 10, sensitivePerSession: 2 } });
      const result = anomaly.calculateAnomalyScore('Test');
      // filesystem: sensVol = min(50, round((5-1)*8)) = 32, weight 0.25 → 8
      expect(result.dimensions.filesystem.score).toBe(32);
      expect(result.score).toBe(8);
    });

    it('caps sensitive contribution at 50 within filesystem', () => {
      setupAgent('Test', {
        files: new Set(['a']),
        sensitiveCount: 200,
        sensitiveReasons: new Set(),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set(),
      }, { averages: { filesPerSession: 10, sensitivePerSession: 2 } });
      const result = anomaly.calculateAnomalyScore('Test');
      expect(result.dimensions.filesystem.score).toBe(50);
      expect(result.score).toBe(13);
    });

    it('scores new sensitive categories via process dimension', () => {
      setupAgent('Test', {
        files: new Set(['a']),
        sensitiveCount: 0,
        sensitiveReasons: new Set(['SSH key', 'AWS credentials', 'browser data']),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set(),
      }, { averages: { filesPerSession: 10, sensitivePerSession: 0, knownSensitiveReasons: [] } });
      const result = anomaly.calculateAnomalyScore('Test');
      // process: catScore = min(60, 3*20) = 60, weight 0.25 → 15
      expect(result.dimensions.process.score).toBe(60);
      expect(result.score).toBe(15);
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
      expect(anomaly.calculateAnomalyScore('Test').score).toBe(0);
    });

    it('scores new network endpoints via network dimension', () => {
      setupAgent('Test', {
        files: new Set(),
        sensitiveCount: 0,
        sensitiveReasons: new Set(),
        endpoints: new Set(['evil.com:443', 'bad.net:80', 'shady.io:8080', 'worse.dev:443']),
        directories: new Set(),
        activeHours: new Set(),
      }, { averages: { filesPerSession: 0, sensitivePerSession: 0 } });
      const result = anomaly.calculateAnomalyScore('Test');
      // network: min(100, 4*33) = 100, weight 0.30 → 30
      expect(result.dimensions.network.score).toBe(100);
      expect(result.score).toBe(30);
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
      expect(anomaly.calculateAnomalyScore('Test').score).toBe(0);
    });

    it('scores unusual timing via baseline dimension', () => {
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
      const result = anomaly.calculateAnomalyScore('Test');
      // baseline: 1 unseen hour → 50, weight 0.20 → 10
      expect(result.dimensions.baseline.score).toBe(50);
      expect(result.score).toBe(10);
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
      expect(anomaly.calculateAnomalyScore('Test').score).toBe(0);
    });

    it('caps total composite score at 100', () => {
      const hist = new Array(24).fill(1);
      hist[3] = 0;
      hist[4] = 0;
      setupAgent('Test', {
        files: new Set(Array.from({ length: 200 }, (_, i) => `f${i}`)),
        sensitiveCount: 100,
        sensitiveReasons: new Set(['a', 'b', 'c']),
        endpoints: new Set(['e1', 'e2', 'e3', 'e4']),
        activeHours: new Set([3, 4]),
        directories: new Set(Array.from({ length: 10 }, (_, i) => `/dir${i}`)),
      }, {
        averages: {
          filesPerSession: 1,
          sensitivePerSession: 1,
          knownSensitiveReasons: [],
          typicalDirectories: [],
          hourHistogram: hist,
        },
      });
      // network: 100*0.30=30, filesystem: 100*0.25=25, process: 100*0.25=25, baseline: 100*0.20=20
      expect(anomaly.calculateAnomalyScore('Test').score).toBe(100);
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
      // baseline: null histogram → all zeros → hour 5 is unseen → 50 * 0.20 = 10
      expect(anomaly.calculateAnomalyScore('Test').score).toBe(10);
    });
  });

  describe('dimensions breakdown', () => {
    it('returns all 4 dimensions with score, weight, and factors', () => {
      setupAgent('Test', {
        files: new Set(['a']),
        sensitiveCount: 0,
        sensitiveReasons: new Set(),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set([10]),
      }, {});
      const { dimensions } = anomaly.calculateAnomalyScore('Test');
      for (const key of ['network', 'filesystem', 'process', 'baseline']) {
        expect(dimensions[key]).toHaveProperty('score');
        expect(dimensions[key]).toHaveProperty('weight');
        expect(dimensions[key]).toHaveProperty('factors');
        expect(Array.isArray(dimensions[key].factors)).toBe(true);
      }
    });

    it('network dimension lists new endpoint factors', () => {
      setupAgent('Test', {
        files: new Set(),
        sensitiveCount: 0,
        sensitiveReasons: new Set(),
        endpoints: new Set(['evil.com:443', 'bad.net:80']),
        directories: new Set(),
        activeHours: new Set(),
      }, { averages: { filesPerSession: 0, sensitivePerSession: 0 } });
      const { dimensions } = anomaly.calculateAnomalyScore('Test');
      expect(dimensions.network.score).toBe(66);
      expect(dimensions.network.weight).toBe(0.3);
      expect(dimensions.network.factors).toHaveLength(2);
      expect(dimensions.network.factors[0]).toContain('new endpoint');
    });

    it('filesystem dimension describes file volume and sensitive spikes', () => {
      setupAgent('Test', {
        files: new Set(Array.from({ length: 20 }, (_, i) => `f${i}`)),
        sensitiveCount: 15,
        sensitiveReasons: new Set(),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set(),
      }, { averages: { filesPerSession: 2, sensitivePerSession: 2 } });
      const { dimensions } = anomaly.calculateAnomalyScore('Test');
      expect(dimensions.filesystem.score).toBeGreaterThan(0);
      expect(dimensions.filesystem.weight).toBe(0.25);
      expect(dimensions.filesystem.factors.length).toBeGreaterThanOrEqual(2);
      expect(dimensions.filesystem.factors.some((f) => f.includes('file volume'))).toBe(true);
      expect(dimensions.filesystem.factors.some((f) => f.includes('sensitive access'))).toBe(true);
    });

    it('process dimension includes new categories and directory factors', () => {
      setupAgent('Test', {
        files: new Set(['a']),
        sensitiveCount: 0,
        sensitiveReasons: new Set(['SSH key', 'AWS credentials']),
        endpoints: new Set(),
        directories: new Set(['/a', '/b', '/c', '/d', '/e']),
        activeHours: new Set(),
      }, {
        averages: {
          filesPerSession: 10,
          sensitivePerSession: 0,
          knownSensitiveReasons: [],
          typicalDirectories: [],
        },
      });
      const { dimensions } = anomaly.calculateAnomalyScore('Test');
      expect(dimensions.process.score).toBeGreaterThan(0);
      expect(dimensions.process.weight).toBe(0.25);
      expect(dimensions.process.factors.some((f) => f.includes('new sensitive category'))).toBe(true);
      expect(dimensions.process.factors.some((f) => f.includes('new directories'))).toBe(true);
    });

    it('baseline dimension lists unusual hour factors', () => {
      const hist = new Array(24).fill(1);
      hist[2] = 0;
      hist[3] = 0;
      setupAgent('Test', {
        files: new Set(),
        sensitiveCount: 0,
        sensitiveReasons: new Set(),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set([2, 3]),
      }, { averages: { filesPerSession: 0, sensitivePerSession: 0, hourHistogram: hist } });
      const { dimensions } = anomaly.calculateAnomalyScore('Test');
      expect(dimensions.baseline.score).toBe(100);
      expect(dimensions.baseline.factors).toHaveLength(2);
      expect(dimensions.baseline.factors[0]).toContain('02:00');
      expect(dimensions.baseline.factors[1]).toContain('03:00');
    });

    it('composite equals weighted sum of dimension scores', () => {
      const hist = new Array(24).fill(1);
      hist[3] = 0;
      setupAgent('Test', {
        files: new Set(Array.from({ length: 10 }, (_, i) => `f${i}`)),
        sensitiveCount: 0,
        sensitiveReasons: new Set(['SSH key']),
        endpoints: new Set(['evil.com:443']),
        directories: new Set(),
        activeHours: new Set([3]),
      }, {
        averages: {
          filesPerSession: 2,
          sensitivePerSession: 0,
          knownSensitiveReasons: [],
          hourHistogram: hist,
        },
      });
      const { score, dimensions } = anomaly.calculateAnomalyScore('Test');
      const expected = Math.min(100, Math.round(
        dimensions.network.score * dimensions.network.weight +
        dimensions.filesystem.score * dimensions.filesystem.weight +
        dimensions.process.score * dimensions.process.weight +
        dimensions.baseline.score * dimensions.baseline.weight,
      ));
      expect(score).toBe(expected);
    });

    it('all dimensions zero for normal behavior', () => {
      setupAgent('Test', {
        files: new Set(['a.js']),
        sensitiveCount: 0,
        sensitiveReasons: new Set(),
        endpoints: new Set(),
        directories: new Set(),
        activeHours: new Set([10]),
      }, {});
      const { dimensions } = anomaly.calculateAnomalyScore('Test');
      expect(dimensions.network.score).toBe(0);
      expect(dimensions.filesystem.score).toBe(0);
      expect(dimensions.process.score).toBe(0);
      expect(dimensions.baseline.score).toBe(0);
      expect(dimensions.network.factors).toEqual([]);
      expect(dimensions.filesystem.factors).toEqual([]);
      expect(dimensions.process.factors).toEqual([]);
      expect(dimensions.baseline.factors).toEqual([]);
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
