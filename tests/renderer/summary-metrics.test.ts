/**
 * SummaryCards metrics — F-W02 Total Agents, F-W01 Avg Risk Score, F-W03 Events/min,
 * F-W06 Sensitive Alerts (retained events, not distinct files),
 * F-W07 Monitoring Duration (session age, not OS uptime).
 */
import { describe, it, expect } from 'vitest';
import {
  countUniqueAgents,
  averageRiskScore,
  eventsPerMinute,
  EVENTS_PER_MIN_WINDOW_MS,
  sensitiveAlertCount,
  monitoringElapsedMs,
  formatMonitoringDuration,
  FILE_ACTIVITY_CHIP_LABEL,
} from '../../src/renderer/lib/utils/summary-metrics';
import en from '../../src/renderer/lib/i18n/translations/en.json';
import type { DetectedAgent } from '../../src/shared/types';

/**
 * A raw scan row as the summary cards receive it before enrichment. `DetectedAgent`
 * declares no `name` at all, so the field is optional here and left absent — that
 * absence is the historical F-W02 collapse the test below reproduces.
 */
type RawAgentRow = Pick<DetectedAgent, 'agent' | 'pid'> & { readonly name?: string };

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
    const agents: readonly RawAgentRow[] = [
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

describe('eventsPerMinute (F-W03)', () => {
  const NOW = 1_700_000_060_000;
  const W = EVENTS_PER_MIN_WINDOW_MS; // 60_000
  const recent = (offsetMs: number) => ({ timestamp: NOW + offsetMs });

  it('returns 0 for no events', () => {
    expect(eventsPerMinute([], NOW)).toBe(0);
  });

  it('counts one recent event', () => {
    expect(eventsPerMinute([recent(-1_000)], NOW)).toBe(1);
  });

  it('counts multiple recent events', () => {
    expect(eventsPerMinute([recent(-1_000), recent(-2_000), recent(-3_000)], NOW)).toBe(3);
  });

  it('excludes events older than the rolling window', () => {
    expect(eventsPerMinute([recent(-W - 1), recent(-500)], NOW)).toBe(1);
  });

  it('includes the exact lower boundary (timestamp === now - windowMs)', () => {
    // Inclusive lower bound: age-out is strictly older than the window.
    expect(eventsPerMinute([recent(-W)], NOW)).toBe(1);
  });

  it('includes an event at exactly now', () => {
    expect(eventsPerMinute([recent(0)], NOW)).toBe(1);
  });

  it('excludes future timestamps (clock skew cannot inflate the rate)', () => {
    expect(eventsPerMinute([recent(1), recent(5_000), recent(-100)], NOW)).toBe(1);
  });

  it('ignores invalid / non-finite timestamps and non-objects', () => {
    expect(
      eventsPerMinute(
        [
          recent(-100),
          { timestamp: NaN },
          { timestamp: Infinity },
          { timestamp: 'nope' },
          null,
          42,
          {},
        ],
        NOW,
      ),
    ).toBe(1);
  });

  it('ages out when the same event list is viewed with a later now (no store mutation)', () => {
    const events = [{ timestamp: NOW - 10_000 }];
    expect(eventsPerMinute(events, NOW)).toBe(1);
    // Advance wall clock past the window without changing the event array.
    expect(eventsPerMinute(events, NOW + W + 1)).toBe(0);
  });

  it('flattens one level of nested event batches', () => {
    expect(eventsPerMinute([[recent(-100), recent(-200)], recent(-300)], NOW)).toBe(3);
  });
});

describe('sensitiveAlertCount (F-W06)', () => {
  it('returns 0 when there is no sensitive activity', () => {
    expect(sensitiveAlertCount(0)).toBe(0);
    expect(sensitiveAlertCount(undefined)).toBe(0);
    expect(sensitiveAlertCount(null)).toBe(0);
  });

  it('returns 1 for a single retained sensitive alert', () => {
    expect(sensitiveAlertCount(1)).toBe(1);
  });

  it('preserves multi-alert totals (same path twice is two alerts in main)', () => {
    // main onActivityPush ++ per sensitive event; path identity is not deduped.
    // totalSensitive=2 may be one file accessed twice or two files once — both are
    // two alerts. The card must not present this as "2 files".
    expect(sensitiveAlertCount(2)).toBe(2);
  });

  it('preserves distinct-path multi-alert totals without collapsing to unique files', () => {
    expect(sensitiveAlertCount(5)).toBe(5);
  });

  it('ignores non-finite and non-number inputs (malformed stats)', () => {
    expect(sensitiveAlertCount(NaN)).toBe(0);
    expect(sensitiveAlertCount(Infinity)).toBe(0);
    expect(sensitiveAlertCount(-Infinity)).toBe(0);
    expect(sensitiveAlertCount('3')).toBe(0);
    expect(sensitiveAlertCount({})).toBe(0);
  });

  it('clamps negative and truncates fractional values', () => {
    expect(sensitiveAlertCount(-1)).toBe(0);
    expect(sensitiveAlertCount(3.9)).toBe(3);
  });

  it('reflects eviction / retention shrink (counter can drop without remediation)', () => {
    // After onActivityEvict of a sensitive event, main sends a lower totalSensitive.
    // The card must follow the retained-event counter, not a lifetime peak.
    const beforeEvict = sensitiveAlertCount(10);
    const afterEvict = sensitiveAlertCount(9);
    expect(beforeEvict).toBe(10);
    expect(afterEvict).toBe(9);
  });

  it('session restart / empty stats → 0 (in-memory counter, not durable)', () => {
    expect(sensitiveAlertCount(0)).toBe(0);
  });

  it('label matches retained-alert semantics, not "files"', () => {
    expect(en.summary.sensitive_alerts).toBe('Sensitive Alerts');
    expect(en.summary.sensitive_alerts.toLowerCase()).not.toContain('file');
  });
});

describe('monitoringElapsedMs / formatMonitoringDuration (F-W07)', () => {
  const STARTED = 1_700_000_000_000;

  it('returns 0 when monitoringStarted is missing or invalid', () => {
    expect(monitoringElapsedMs(undefined, STARTED + 5_000)).toBe(0);
    expect(monitoringElapsedMs(null, STARTED + 5_000)).toBe(0);
    expect(monitoringElapsedMs(NaN, STARTED + 5_000)).toBe(0);
    expect(monitoringElapsedMs('nope', STARTED + 5_000)).toBe(0);
    expect(monitoringElapsedMs(STARTED, NaN)).toBe(0);
  });

  it('computes elapsed ms from a known start timestamp', () => {
    expect(monitoringElapsedMs(STARTED, STARTED + 90_000)).toBe(90_000);
  });

  it('returns 0 for future or equal start (clock skew / not started)', () => {
    expect(monitoringElapsedMs(STARTED + 1_000, STARTED)).toBe(0);
    expect(monitoringElapsedMs(STARTED, STARTED)).toBe(0);
  });

  it('advances when now advances without changing the start timestamp', () => {
    // Same stats.monitoringStarted object field; only wall clock moves (F-W07).
    const t0 = STARTED + 1_000;
    const t1 = STARTED + 3_000;
    expect(monitoringElapsedMs(STARTED, t0)).toBe(1_000);
    expect(monitoringElapsedMs(STARTED, t1)).toBe(3_000);
  });

  it('formats HH:MM:SS boundaries', () => {
    expect(formatMonitoringDuration(STARTED, STARTED)).toBe('00:00:00');
    expect(formatMonitoringDuration(STARTED, STARTED + 1_000)).toBe('00:00:01');
    expect(formatMonitoringDuration(STARTED, STARTED + 61_000)).toBe('00:01:01');
    expect(formatMonitoringDuration(STARTED, STARTED + 3_661_000)).toBe('01:01:01');
  });

  it('truncates fractional elapsed ms toward zero for display', () => {
    expect(monitoringElapsedMs(STARTED, STARTED + 1_500.9)).toBe(1_500);
    expect(formatMonitoringDuration(STARTED, STARTED + 1_500.9)).toBe('00:00:01');
  });

  it('label is monitoring session age, not system/OS uptime', () => {
    expect(en.summary.monitoring_duration).toBe('Monitoring Duration');
    expect(en.summary.monitoring_duration.toLowerCase()).not.toContain('system');
  });
});

describe('FILE_ACTIVITY_CHIP_LABEL (F-W08)', () => {
  it('does not claim a physical file count unit', () => {
    expect(FILE_ACTIVITY_CHIP_LABEL).toBe('File Act');
    expect(FILE_ACTIVITY_CHIP_LABEL.toLowerCase()).not.toBe('files');
  });
});
