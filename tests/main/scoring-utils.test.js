import { describe, it, expect } from 'vitest';
import {
  scoreNetwork,
  scoreFilesystem,
  scoreProcess,
  scoreBaseline,
} from '../../src/main/scoring-utils.js';

/**
 * Helper: build minimal SessionData for scoring tests.
 * @param {Object} overrides
 */
function makeSession(overrides = {}) {
  return {
    files: overrides.files ?? new Set(),
    sensitiveCount: overrides.sensitiveCount ?? 0,
    sensitiveReasons: overrides.sensitiveReasons ?? new Set(),
    endpoints: overrides.endpoints ?? new Set(),
    directories: overrides.directories ?? new Set(),
    activeHours: overrides.activeHours ?? new Set(),
  };
}

/**
 * Helper: build minimal AgentBaseline for scoring tests.
 * @param {Object} overrides
 */
function makeBaseline(overrides = {}) {
  return {
    sessions: overrides.sessions ?? [],
    averages: {
      filesPerSession: overrides.filesPerSession ?? 0,
      sensitivePerSession: overrides.sensitivePerSession ?? 0,
      knownSensitiveReasons: overrides.knownSensitiveReasons ?? [],
      typicalDirectories: overrides.typicalDirectories ?? [],
      hourHistogram: overrides.hourHistogram ?? new Array(24).fill(0),
    },
  };
}

describe('scoring-utils', () => {
  // ── scoreNetwork ──

  describe('scoreNetwork', () => {
    it('returns 0 when no new endpoints', () => {
      const sd = makeSession({ endpoints: new Set(['api.example.com']) });
      const ab = makeBaseline({
        sessions: [{ networkEndpoints: ['api.example.com'] }],
      });
      const result = scoreNetwork(sd, ab);
      expect(result.score).toBe(0);
      expect(result.factors).toHaveLength(0);
    });

    it('scores 33 per new endpoint', () => {
      const sd = makeSession({ endpoints: new Set(['new1.com']) });
      const ab = makeBaseline({ sessions: [{ networkEndpoints: ['old.com'] }] });
      const result = scoreNetwork(sd, ab);
      expect(result.score).toBe(33);
      expect(result.factors).toContain('new endpoint new1.com');
    });

    it('caps at 100 for many new endpoints', () => {
      const sd = makeSession({
        endpoints: new Set(['a.com', 'b.com', 'c.com', 'd.com']),
      });
      const ab = makeBaseline({ sessions: [{ networkEndpoints: [] }] });
      const result = scoreNetwork(sd, ab);
      expect(result.score).toBe(100);
    });

    it('considers only last 5 sessions', () => {
      // 6 sessions — first one has 'old.com', last 5 do not
      const sessions = [
        { networkEndpoints: ['old.com'] },
        ...Array(5).fill({ networkEndpoints: [] }),
      ];
      const sd = makeSession({ endpoints: new Set(['old.com']) });
      const ab = makeBaseline({ sessions });
      const result = scoreNetwork(sd, ab);
      // old.com was only in session[0] which is outside slice(-5)
      expect(result.score).toBe(33);
    });

    it('returns 0 with empty sessions array', () => {
      const sd = makeSession({ endpoints: new Set() });
      const ab = makeBaseline({ sessions: [] });
      const result = scoreNetwork(sd, ab);
      expect(result.score).toBe(0);
    });
  });

  // ── scoreFilesystem ──

  describe('scoreFilesystem', () => {
    it('returns 0 when ratio is 3 or below', () => {
      const sd = makeSession({ files: new Set(['a', 'b', 'c']), sensitiveCount: 3 });
      const ab = makeBaseline({ filesPerSession: 1, sensitivePerSession: 1 });
      const result = scoreFilesystem(sd, ab);
      expect(result.score).toBe(0);
    });

    it('scores file volume when ratio exceeds 3', () => {
      // 8 files vs avg 2 → ratio 4 → fileVol = min(50, (4-1)*8) = 24
      const sd = makeSession({ files: new Set(Array.from({ length: 8 }, (_, i) => `f${i}`)) });
      const ab = makeBaseline({ filesPerSession: 2, sensitivePerSession: 0 });
      const result = scoreFilesystem(sd, ab);
      expect(result.score).toBe(24);
      expect(result.factors[0]).toContain('file volume');
    });

    it('scores sensitive volume when ratio exceeds 3', () => {
      // 8 sensitive vs avg 2 → ratio 4 → sensVol = min(50, (4-1)*8) = 24
      const sd = makeSession({ files: new Set(), sensitiveCount: 8 });
      const ab = makeBaseline({ filesPerSession: 0, sensitivePerSession: 2 });
      const result = scoreFilesystem(sd, ab);
      expect(result.score).toBe(24);
      expect(result.factors[0]).toContain('sensitive access');
    });

    it('caps combined score at 100', () => {
      // Both at extreme ratios
      const sd = makeSession({
        files: new Set(Array.from({ length: 100 }, (_, i) => `f${i}`)),
        sensitiveCount: 100,
      });
      const ab = makeBaseline({ filesPerSession: 1, sensitivePerSession: 1 });
      const result = scoreFilesystem(sd, ab);
      expect(result.score).toBe(100);
    });

    it('returns 0 when averages are 0', () => {
      const sd = makeSession({ files: new Set(['x']), sensitiveCount: 5 });
      const ab = makeBaseline({ filesPerSession: 0, sensitivePerSession: 0 });
      const result = scoreFilesystem(sd, ab);
      expect(result.score).toBe(0);
    });
  });

  // ── scoreProcess ──

  describe('scoreProcess', () => {
    it('returns 0 when no new categories or dirs', () => {
      const sd = makeSession({
        sensitiveReasons: new Set(['known-reason']),
        directories: new Set(['/home']),
      });
      const ab = makeBaseline({
        knownSensitiveReasons: ['known-reason'],
        typicalDirectories: ['/home'],
      });
      const result = scoreProcess(sd, ab);
      expect(result.score).toBe(0);
    });

    it('scores 20 per new sensitive category', () => {
      const sd = makeSession({
        sensitiveReasons: new Set(['new-reason']),
        directories: new Set(),
      });
      const ab = makeBaseline({ knownSensitiveReasons: [] });
      const result = scoreProcess(sd, ab);
      expect(result.score).toBe(20);
      expect(result.factors[0]).toContain('new sensitive category');
    });

    it('caps category score at 60', () => {
      const sd = makeSession({
        sensitiveReasons: new Set(['a', 'b', 'c', 'd']),
        directories: new Set(),
      });
      const ab = makeBaseline({ knownSensitiveReasons: [] });
      const result = scoreProcess(sd, ab);
      // 4 * 20 = 80, but capped at 60 for categories
      expect(result.score).toBe(60);
    });

    it('scores new directories when 4+ new dirs', () => {
      const sd = makeSession({
        sensitiveReasons: new Set(),
        directories: new Set(['/a', '/b', '/c', '/d']),
      });
      const ab = makeBaseline({ typicalDirectories: [] });
      const result = scoreProcess(sd, ab);
      // 4 new dirs → (4-3)*10 = 10
      expect(result.score).toBe(10);
      expect(result.factors[0]).toContain('4 new directories');
    });

    it('does not score directories when fewer than 4 new', () => {
      const sd = makeSession({
        sensitiveReasons: new Set(),
        directories: new Set(['/a', '/b', '/c']),
      });
      const ab = makeBaseline({ typicalDirectories: [] });
      const result = scoreProcess(sd, ab);
      expect(result.score).toBe(0);
    });
  });

  // ── scoreBaseline ──

  describe('scoreBaseline', () => {
    it('returns 0 when all hours are known', () => {
      const histogram = new Array(24).fill(0);
      histogram[9] = 5;
      histogram[14] = 3;
      const sd = makeSession({ activeHours: new Set([9, 14]) });
      const ab = makeBaseline({ hourHistogram: histogram });
      const result = scoreBaseline(sd, ab);
      expect(result.score).toBe(0);
    });

    it('scores 50 per unseen hour', () => {
      const histogram = new Array(24).fill(0);
      histogram[9] = 5;
      const sd = makeSession({ activeHours: new Set([3]) });
      const ab = makeBaseline({ hourHistogram: histogram });
      const result = scoreBaseline(sd, ab);
      expect(result.score).toBe(50);
      expect(result.factors[0]).toContain('unusual hour 03:00');
    });

    it('caps at 100 for many unseen hours', () => {
      const sd = makeSession({ activeHours: new Set([1, 2, 3]) });
      const ab = makeBaseline({ hourHistogram: new Array(24).fill(0) });
      const result = scoreBaseline(sd, ab);
      expect(result.score).toBe(100);
    });

    it('handles missing hourHistogram gracefully', () => {
      const sd = makeSession({ activeHours: new Set([12]) });
      const ab = { sessions: [], averages: {} };
      const result = scoreBaseline(sd, ab);
      // Default histogram is all zeros → hour 12 is unseen → score 50
      expect(result.score).toBe(50);
    });
  });
});
