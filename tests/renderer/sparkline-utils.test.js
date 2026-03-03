import { describe, it, expect } from 'vitest';
import { computePoints, computeAreaPoints } from '../../src/renderer/lib/utils/sparkline-utils.ts';

describe('sparkline-utils', () => {
  const WIDTH = 100;
  const HEIGHT = 30;
  const PADDING = 2;

  describe('computePoints()', () => {
    it('returns empty string for less than 2 data points', () => {
      expect(computePoints([], WIDTH, HEIGHT, PADDING)).toBe('');
      expect(computePoints([5], WIDTH, HEIGHT, PADDING)).toBe('');
    });

    it('computes two-point line spanning full width', () => {
      const result = computePoints([0, 10], WIDTH, HEIGHT, PADDING);
      const pairs = result.split(' ');
      expect(pairs).toHaveLength(2);

      // First point: x=0, y should be bottom (max padding)
      const [x1, y1] = pairs[0].split(',').map(Number);
      expect(x1).toBe(0);
      // value=0 (min) => y = padding + usableHeight = 2 + 26 = 28
      expect(y1).toBe(28);

      // Last point: x=100, y should be top (min padding)
      const [x2, y2] = pairs[1].split(',').map(Number);
      expect(x2).toBe(100);
      // value=10 (max) => y = padding = 2
      expect(y2).toBe(2);
    });

    it('handles flat data (all same values)', () => {
      const result = computePoints([5, 5, 5], WIDTH, HEIGHT, PADDING);
      const pairs = result.split(' ');
      expect(pairs).toHaveLength(3);

      // All points should be at the same Y (center-ish area)
      const ys = pairs.map((p) => parseFloat(p.split(',')[1]));
      expect(new Set(ys).size).toBe(1);
    });

    it('distributes X coordinates evenly', () => {
      const result = computePoints([1, 2, 3, 4, 5], WIDTH, HEIGHT, PADDING);
      const xs = result.split(' ').map((p) => parseFloat(p.split(',')[0]));
      expect(xs[0]).toBe(0);
      expect(xs[1]).toBe(25);
      expect(xs[2]).toBe(50);
      expect(xs[3]).toBe(75);
      expect(xs[4]).toBe(100);
    });

    it('inverts Y axis (higher values = lower Y coordinate)', () => {
      const result = computePoints([0, 5, 10], WIDTH, HEIGHT, PADDING);
      const ys = result.split(' ').map((p) => parseFloat(p.split(',')[1]));
      // value 0 => highest Y (bottom), value 10 => lowest Y (top)
      expect(ys[0]).toBeGreaterThan(ys[2]);
    });

    it('respects custom width/height', () => {
      const result = computePoints([0, 10], 200, 60, 4);
      const pairs = result.split(' ');
      const [x2] = pairs[1].split(',').map(Number);
      expect(x2).toBe(200);
    });

    it('handles negative values', () => {
      const result = computePoints([-10, 0, 10], WIDTH, HEIGHT, PADDING);
      const pairs = result.split(' ');
      expect(pairs).toHaveLength(3);

      const ys = pairs.map((p) => parseFloat(p.split(',')[1]));
      // -10 (min) at bottom, 10 (max) at top
      expect(ys[0]).toBeGreaterThan(ys[2]);
    });
  });

  describe('computeAreaPoints()', () => {
    it('returns empty string for empty input', () => {
      expect(computeAreaPoints('', WIDTH, HEIGHT)).toBe('');
    });

    it('appends bottom-right and bottom-left corners', () => {
      const linePoints = '0,2 50,15 100,28';
      const result = computeAreaPoints(linePoints, WIDTH, HEIGHT);
      expect(result).toBe('0,2 50,15 100,28 100,30 0,30');
    });

    it('uses correct width/height for corners', () => {
      const linePoints = '0,4 200,4';
      const result = computeAreaPoints(linePoints, 200, 60);
      expect(result).toBe('0,4 200,4 200,60 0,60');
    });
  });
});
