import { describe, it, expect } from 'vitest';
import {
  clampScore,
  getRiskInfo,
  getBadgeDimension,
} from '../../src/renderer/lib/utils/trust-badge-utils.ts';

describe('trust-badge-utils', () => {
  describe('clampScore()', () => {
    it('clamps negative values to 0', () => {
      expect(clampScore(-10)).toBe(0);
      expect(clampScore(-1)).toBe(0);
    });

    it('clamps values above 100 to 100', () => {
      expect(clampScore(150)).toBe(100);
      expect(clampScore(101)).toBe(100);
    });

    it('rounds to nearest integer', () => {
      expect(clampScore(42.7)).toBe(43);
      expect(clampScore(42.3)).toBe(42);
    });

    it('passes through valid integers unchanged', () => {
      expect(clampScore(0)).toBe(0);
      expect(clampScore(50)).toBe(50);
      expect(clampScore(100)).toBe(100);
    });
  });

  describe('getRiskInfo()', () => {
    it('returns low risk for scores 0–34', () => {
      expect(getRiskInfo(0).level).toBe('low');
      expect(getRiskInfo(20).level).toBe('low');
      expect(getRiskInfo(34).level).toBe('low');
    });

    it('returns medium risk for scores 35–65', () => {
      expect(getRiskInfo(35).level).toBe('medium');
      expect(getRiskInfo(50).level).toBe('medium');
      expect(getRiskInfo(65).level).toBe('medium');
    });

    it('returns high risk for scores 66–100', () => {
      expect(getRiskInfo(66).level).toBe('high');
      expect(getRiskInfo(80).level).toBe('high');
      expect(getRiskInfo(100).level).toBe('high');
    });

    it('uses --fancy-accent color for low risk', () => {
      const info = getRiskInfo(20);
      expect(info.color).toBe('var(--fancy-accent)');
      expect(info.label).toBe('Low Risk');
    });

    it('uses --fancy-warning color for medium risk', () => {
      const info = getRiskInfo(50);
      expect(info.color).toBe('var(--fancy-warning)');
      expect(info.label).toBe('Medium');
    });

    it('uses --fancy-danger color for high risk', () => {
      const info = getRiskInfo(80);
      expect(info.color).toBe('var(--fancy-danger)');
      expect(info.label).toBe('High Risk');
    });

    it('returns glow color as rgba string', () => {
      const low = getRiskInfo(10);
      const mid = getRiskInfo(50);
      const high = getRiskInfo(80);

      expect(low.glowColor).toContain('rgba');
      expect(mid.glowColor).toContain('rgba');
      expect(high.glowColor).toContain('rgba');
    });

    it('clamps out-of-range scores before evaluation', () => {
      expect(getRiskInfo(-50).level).toBe('low');
      expect(getRiskInfo(200).level).toBe('high');
    });

    it('handles boundary score 35 as medium', () => {
      expect(getRiskInfo(35).level).toBe('medium');
    });

    it('handles boundary score 66 as high', () => {
      expect(getRiskInfo(66).level).toBe('high');
    });
  });

  describe('getBadgeDimension()', () => {
    it('returns 20 for sm', () => {
      expect(getBadgeDimension('sm')).toBe(20);
    });

    it('returns 28 for md', () => {
      expect(getBadgeDimension('md')).toBe(28);
    });

    it('returns 36 for lg', () => {
      expect(getBadgeDimension('lg')).toBe(36);
    });
  });
});
