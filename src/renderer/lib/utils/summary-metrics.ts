/**
 * @file summary-metrics.ts — Pure metric helpers for SummaryCards
 * @module renderer/utils/summary-metrics
 * @description Keeps Total Agents / Avg Risk Score free of wrong-field and
 *   anomaly/risk mix-ups (CORRECTNESS F-W02 / F-W01).
 * @since 0.10.0
 */

/**
 * Count distinct agents for the "Total Agents" card.
 *
 * Prefers enriched `name` (risk store), then raw DetectedAgent `agent`.
 * Never counts `undefined` as a unique agent (historical F-W02 collapse).
 *
 * @param agents - Raw or enriched agent list
 * @returns Distinct non-empty display-name count
 */
export function countUniqueAgents(
  agents: ReadonlyArray<{ readonly name?: string; readonly agent?: string }>,
): number {
  if (!Array.isArray(agents) || agents.length === 0) return 0;
  const keys = new Set<string>();
  for (const a of agents) {
    const key =
      typeof a?.name === 'string' && a.name.length > 0
        ? a.name
        : typeof a?.agent === 'string' && a.agent.length > 0
          ? a.agent
          : null;
    if (key !== null) keys.add(key);
  }
  return keys.size;
}

/**
 * Arithmetic mean of authoritative riskScore values (0–100 scale), rounded.
 * Ignores non-finite values. Empty list → 0 (never NaN).
 *
 * Must NOT receive anomaly scores — those are a different domain (F-W01).
 *
 * @param agents - Objects carrying riskScore (typically EnrichedAgent)
 * @returns Rounded mean risk, or 0
 */
export function averageRiskScore(agents: ReadonlyArray<{ readonly riskScore?: number }>): number {
  if (!Array.isArray(agents) || agents.length === 0) return 0;
  const scores: number[] = [];
  for (const a of agents) {
    const s = a?.riskScore;
    if (typeof s === 'number' && Number.isFinite(s)) scores.push(s);
  }
  if (scores.length === 0) return 0;
  return Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
}
