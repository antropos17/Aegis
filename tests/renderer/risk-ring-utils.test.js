import { describe, it, expect } from 'vitest';
import {
  computeRing,
  getStrokeWidth,
  getTrackWidth,
} from '../../src/renderer/lib/utils/risk-ring-utils.ts';

describe('risk-ring-utils', () => {
  describe('computeRing()', () => {
    it('returns zero offset for score 100 (full arc)', () => {
      const r = computeRing(100, 200);
      expect(r.dashOffset).toBeCloseTo(0, 1);
      expect(r.clamped).toBe(100);
    });

    it('returns full offset for score 0 (empty arc)', () => {
      const r = computeRing(0, 200);
      expect(r.dashOffset).toBeCloseTo(r.circumference, 1);
      expect(r.clamped).toBe(0);
    });

    it('returns half offset for score 50', () => {
      const r = computeRing(50, 200);
      expect(r.dashOffset).toBeCloseTo(r.circumference * 0.5, 1);
    });

    it('clamps negative scores to 0', () => {
      const r = computeRing(-20, 200);
      expect(r.clamped).toBe(0);
      expect(r.dashOffset).toBeCloseTo(r.circumference, 1);
    });

    it('clamps scores above 100', () => {
      const r = computeRing(150, 200);
      expect(r.clamped).toBe(100);
      expect(r.dashOffset).toBeCloseTo(0, 1);
    });

    it('flags isDanger for scores >= 66', () => {
      expect(computeRing(65, 200).isDanger).toBe(false);
      expect(computeRing(66, 200).isDanger).toBe(true);
      expect(computeRing(100, 200).isDanger).toBe(true);
    });

    it('delegates risk info to getRiskInfo', () => {
      const low = computeRing(20, 200);
      expect(low.risk.level).toBe('low');
      expect(low.risk.color).toBe('var(--fancy-accent)');

      const mid = computeRing(50, 200);
      expect(mid.risk.level).toBe('medium');

      const high = computeRing(80, 200);
      expect(high.risk.level).toBe('high');
    });

    it('circumference scales with size', () => {
      const small = computeRing(50, 100);
      const large = computeRing(50, 300);
      expect(large.circumference).toBeGreaterThan(small.circumference);
    });
  });

  describe('getStrokeWidth()', () => {
    it('returns at least 4px', () => {
      expect(getStrokeWidth(10)).toBeGreaterThanOrEqual(4);
    });

    it('scales proportionally with size', () => {
      expect(getStrokeWidth(200)).toBeGreaterThan(getStrokeWidth(100));
    });
  });

  describe('getTrackWidth()', () => {
    it('returns at least 2px', () => {
      expect(getTrackWidth(10)).toBeGreaterThanOrEqual(2);
    });

    it('is thinner than stroke width', () => {
      expect(getTrackWidth(200)).toBeLessThan(getStrokeWidth(200));
    });
  });
});
