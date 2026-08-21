/**
 * Fleet risk aggregations — F-W09 / F-W11.
 */
import { describe, it, expect } from 'vitest';
import {
  fleetAverageHealth,
  fleetWorstRisk,
  processCardinalityNoun,
  FLEET_AVG_HEALTH_LABEL,
  FLEET_WORST_RISK_TITLE,
} from '../../src/renderer/lib/utils/fleet-risk';

describe('fleetAverageHealth (F-W09 Header)', () => {
  it('returns null for empty', () => {
    expect(fleetAverageHealth([])).toBeNull();
  });

  it('computes 100 − mean risk, rounded', () => {
    // mean risk 20 → health 80
    expect(fleetAverageHealth([10, 30])).toBe(80);
  });

  it('differs from max risk for the same scores', () => {
    const scores = [10, 90];
    expect(fleetAverageHealth(scores)).toBe(50); // 100 - 50
    expect(fleetWorstRisk(scores)).toBe(90);
    expect(fleetAverageHealth(scores)).not.toBe(fleetWorstRisk(scores));
  });
});

describe('fleetWorstRisk (F-W09 RiskIndex)', () => {
  it('returns 0 for empty', () => {
    expect(fleetWorstRisk([])).toBe(0);
  });

  it('returns the maximum score', () => {
    expect(fleetWorstRisk([10, 40, 25])).toBe(40);
  });
});

describe('processCardinalityNoun (F-W11)', () => {
  it('uses process/processes for instance-row counts', () => {
    expect(processCardinalityNoun(1)).toBe('process');
    expect(processCardinalityNoun(2)).toBe('processes');
  });

  it('does not use the agent noun', () => {
    expect(processCardinalityNoun(2)).not.toContain('agent');
  });
});

describe('label constants (F-W09)', () => {
  it('Header and RiskIndex labels encode different aggregations', () => {
    expect(FLEET_AVG_HEALTH_LABEL).toMatch(/health/i);
    expect(FLEET_WORST_RISK_TITLE).toMatch(/worst/i);
    expect(FLEET_AVG_HEALTH_LABEL.toLowerCase()).not.toBe(FLEET_WORST_RISK_TITLE.toLowerCase());
  });
});
