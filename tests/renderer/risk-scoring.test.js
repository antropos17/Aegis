import { describe, it, expect, vi } from 'vitest';
import { calculateRiskScore, getTrustGrade, getTimeDecayWeight } from '../../src/renderer/lib/utils/risk-scoring.js';

describe('risk-scoring', () => {
  describe('calculateRiskScore()', () => {
    it('zero inputs → 0', () => {
      expect(calculateRiskScore({})).toBe(0);
      expect(calculateRiskScore({
        sensitiveFiles: 0, configFiles: 0, sshAwsFiles: 0,
        networkCount: 0, unknownDomains: 0, fileCount: 0,
      })).toBe(0);
    });

    it('sensitive files with diminishing returns', () => {
      const score1 = calculateRiskScore({ sensitiveFiles: 1 });
      const score5 = calculateRiskScore({ sensitiveFiles: 5 });
      const score20 = calculateRiskScore({ sensitiveFiles: 20 });
      expect(score1).toBeGreaterThan(0);
      expect(score5).toBeGreaterThan(score1);
      expect(score20).toBeGreaterThan(score5);
      // Diminishing returns: gap between 1→5 should be larger than 5→20 proportionally
      expect(score20).toBeLessThanOrEqual(40); // capped at 40
    });

    it('SSH/AWS cap at 20', () => {
      const score = calculateRiskScore({ sshAwsFiles: 100 });
      expect(score).toBeLessThanOrEqual(20);
    });

    it('unknown domains cap at 20', () => {
      const score = calculateRiskScore({ unknownDomains: 100 });
      expect(score).toBeLessThanOrEqual(20);
    });

    it('network cap at 10', () => {
      const score = calculateRiskScore({ networkCount: 1000 });
      expect(score).toBeLessThanOrEqual(10);
    });

    it('config files cap at 5', () => {
      const score = calculateRiskScore({ configFiles: 100 });
      expect(score).toBeLessThanOrEqual(5);
    });

    it('combined never exceeds 100', () => {
      const score = calculateRiskScore({
        sensitiveFiles: 1000,
        configFiles: 1000,
        sshAwsFiles: 1000,
        networkCount: 1000,
        unknownDomains: 1000,
        fileCount: 100000,
      });
      expect(score).toBeLessThanOrEqual(100);
    });

    it('high threat scenario → near max', () => {
      const score = calculateRiskScore({
        sensitiveFiles: 50,
        configFiles: 20,
        sshAwsFiles: 10,
        networkCount: 30,
        unknownDomains: 5,
        fileCount: 500,
      });
      expect(score).toBeGreaterThan(70);
    });
  });

  describe('getTrustGrade()', () => {
    const cases = [
      [0, 'A+'], [10, 'A+'],
      [11, 'A'], [20, 'A'],
      [21, 'B+'], [30, 'B+'],
      [31, 'B'], [40, 'B'],
      [41, 'C'], [55, 'C'],
      [56, 'D'], [70, 'D'],
      [71, 'F'], [100, 'F'],
    ];

    for (const [score, grade] of cases) {
      it(`score ${score} → ${grade}`, () => {
        expect(getTrustGrade(score)).toBe(grade);
      });
    }
  });

  describe('getTimeDecayWeight()', () => {
    it('< 1hr → 1.0', () => {
      expect(getTimeDecayWeight(Date.now() - 1000)).toBe(1.0);
      expect(getTimeDecayWeight(Date.now() - 3500000)).toBe(1.0);
    });

    it('1-24hr → 0.5', () => {
      expect(getTimeDecayWeight(Date.now() - 7200000)).toBe(0.5);
    });

    it('> 24hr → 0.1', () => {
      expect(getTimeDecayWeight(Date.now() - 100000000)).toBe(0.1);
    });
  });
});
