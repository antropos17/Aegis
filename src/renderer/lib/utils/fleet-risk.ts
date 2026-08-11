/**
 * @file fleet-risk.ts — Fleet-level risk aggregations with explicit semantics
 * @module renderer/utils/fleet-risk
 * @description Header and RiskIndex intentionally use different aggregations
 *   (F-W09). Keep the math and labels paired so average health is never mistaken
 *   for worst-case risk.
 * @since 0.10.0
 */

/**
 * Visible Header label for fleet average health (100 − mean riskScore).
 * Higher is better — inverse of risk.
 */
export const FLEET_AVG_HEALTH_LABEL = 'avg health';

/**
 * Visible RiskIndex title for worst-case (max) riskScore across rows.
 * Higher is worse.
 */
export const FLEET_WORST_RISK_TITLE = 'Worst Risk';

/**
 * Noun for RiskIndex cardinality when the collection is process/instance rows
 * (enrichedAgents length), not unique display names (F-W11).
 */
export function processCardinalityNoun(count: number): string {
  return count === 1 ? 'process' : 'processes';
}

/**
 * Average fleet **health**: `round(100 − mean(riskScore))`, clamped to [0, 100].
 * Empty list → null (caller shows placeholder).
 *
 * @param riskScores - Per-row risk scores (typically one per process instance)
 * @returns Health 0–100, or null when empty
 * @since 0.10.0
 */
export function fleetAverageHealth(riskScores: ReadonlyArray<number>): number | null {
  if (!Array.isArray(riskScores) || riskScores.length === 0) return null;
  let sum = 0;
  let n = 0;
  for (const s of riskScores) {
    if (typeof s !== 'number' || !Number.isFinite(s)) continue;
    sum += s;
    n += 1;
  }
  if (n === 0) return null;
  return Math.max(0, Math.min(100, Math.round(100 - sum / n)));
}

/**
 * Worst-case fleet **risk**: max of finite risk scores. Empty → 0.
 *
 * @param riskScores - Per-row risk scores
 * @returns Risk 0–100
 * @since 0.10.0
 */
export function fleetWorstRisk(riskScores: ReadonlyArray<number>): number {
  if (!Array.isArray(riskScores) || riskScores.length === 0) return 0;
  let max = 0;
  let any = false;
  for (const s of riskScores) {
    if (typeof s !== 'number' || !Number.isFinite(s)) continue;
    if (!any || s > max) max = s;
    any = true;
  }
  if (!any) return 0;
  return Math.max(0, Math.min(100, Math.round(max)));
}
