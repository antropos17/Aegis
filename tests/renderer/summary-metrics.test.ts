/**
 * SummaryCards metrics — F-W02 Total Agents, F-W01 Avg Risk Score.
 */
import { describe, it, expect } from 'vitest';
import {
  countUniqueAgents,
  averageRiskScore,
} from '../../src/renderer/lib/utils/summary-metrics.ts';

describe('countUniqueAgents (F-W02)', () => {
  it('counts multiple agents that only carry the raw `agent` field', () => {
    // DetectedAgent shape — no `.name`. Historical bug: Set([undefined]).size === 1.
    const agents = [
      { agent: 'Claude Code', pid: 1 },
      { agent: 'Cursor', pid: 2 },
      { agent: 'Ollama', pid: 3 },
    ];
    expect(countUniqueAgents(agents)).toBe(3);
  });

  it('does not collapse to 1 when every row lacks .name (historical failure)', () => {
    const agents = [
      { agent: 'A', pid: 1 },
      { agent: 'B', pid: 2 },
    ];
    // Wrong: new Set(agents.map(a => a.name)).size === 1
    expect(new Set(agents.map((a) => a.name)).size).toBe(1);
    expect(countUniqueAgents(agents)).toBe(2);
  });

  it('returns 0 for empty list', () => {
    expect(countUniqueAgents([])).toBe(0);
  });

  it('dedupes same display name across process instances', () => {
    // Two Claude Code instances → one "agent type" on the Total Agents card
    // (Header uniqueAgentCount semantics; instance count is a separate metric).
    const agents = [
      { name: 'Claude Code', agent: 'Claude Code', instanceId: '1:a', riskScore: 10 },
      { name: 'Claude Code', agent: 'Claude Code', instanceId: '2:b', riskScore: 90 },
    ];
    expect(countUniqueAgents(agents)).toBe(1);
  });

  it('prefers enriched name over raw agent when both exist', () => {
    expect(countUniqueAgents([{ name: 'Display', agent: 'raw-process' }])).toBe(1);
    // Still one unique key (name wins for the set membership of that row).
    expect(
      countUniqueAgents([
        { name: 'X', agent: 'X' },
        { name: 'Y', agent: 'Y' },
      ]),
    ).toBe(2);
  });

  it('ignores empty and missing identity fields', () => {
    expect(countUniqueAgents([{ agent: '' }, { name: '' }, {}])).toBe(0);
  });
});

describe('averageRiskScore (F-W01)', () => {
  it('returns the arithmetic mean of riskScore values, rounded', () => {
    const agents = [
      { name: 'A', riskScore: 10 },
      { name: 'B', riskScore: 30 },
    ];
    expect(averageRiskScore(agents)).toBe(20);
  });

  it('follows riskScore when anomaly-like values would disagree', () => {
    // If the card still averaged "anomaly" maps (e.g. 80 and 90), it would show 85.
    // Authoritative risk is low — F-W01 requires the risk domain.
    const agents = [
      { name: 'A', riskScore: 5, anomalyScore: 80 },
      { name: 'B', riskScore: 15, anomalyScore: 90 },
    ];
    expect(averageRiskScore(agents)).toBe(10);
    const fakeAnomalyMean = Math.round((80 + 90) / 2);
    expect(averageRiskScore(agents)).not.toBe(fakeAnomalyMean);
  });

  it('returns 0 for zero agents (never NaN)', () => {
    expect(averageRiskScore([])).toBe(0);
    expect(Number.isNaN(averageRiskScore([]))).toBe(false);
  });

  it('ignores non-finite riskScore values', () => {
    const agents = [
      { riskScore: 40 },
      { riskScore: NaN },
      { riskScore: Infinity },
      { riskScore: 20 },
    ];
    expect(averageRiskScore(agents)).toBe(30);
  });

  it('returns 0 when every riskScore is missing or invalid', () => {
    expect(averageRiskScore([{}, { riskScore: undefined }, { riskScore: NaN }])).toBe(0);
  });

  it('updates when the riskScore list changes (reactive input contract)', () => {
    const before = averageRiskScore([{ riskScore: 10 }, { riskScore: 10 }]);
    const after = averageRiskScore([{ riskScore: 10 }, { riskScore: 50 }]);
    expect(before).toBe(10);
    expect(after).toBe(30);
  });
});
