/**
 * @file risk-scoring.js — Risk score calculation + trust grades
 * @module renderer/utils/risk-scoring
 * @since 0.2.0
 */

// ═══ TIME DECAY ═══

/**
 * Time-decay weight for an event based on its age.
 * @param {number} timestampMs - Event timestamp in ms since epoch
 * @returns {number} 1.0 (recent), 0.5 (>1hr), 0.1 (>24hr)
 * @since 0.2.0
 */
export function getTimeDecayWeight(timestampMs) {
  const ageMs = Date.now() - timestampMs;
  if (ageMs > 86400000) return 0.1;
  if (ageMs > 3600000) return 0.5;
  return 1.0;
}

// ═══ RISK SCORE ═══

/**
 * Calculate risk score for an agent (0–100).
 * Uses logarithmic curve for sensitive files to avoid instant 100.
 * - Base: log2(1 + sensitiveFiles) * 8, capped at 40
 * - Network: unknownDomains * 12, capped at 30
 * - Anomaly: anomalyScore * 0.3, capped at 30
 * @param {{ sensitiveFiles: number, unknownDomains: number, anomalyScore: number }} agent
 * @returns {number} Risk score 0–100
 * @since 0.2.0
 */
export function calculateRiskScore(agent) {
  const sensitive = agent.sensitiveFiles || 0;
  const unknown = agent.unknownDomains || 0;
  const anomaly = agent.anomalyScore || 0;

  const base = Math.min(40, Math.log2(1 + sensitive) * 8);
  const net = Math.min(30, unknown * 12);
  const anom = Math.min(30, anomaly * 0.3);

  return Math.min(100, Math.round(base + net + anom));
}

// ═══ TRUST GRADE ═══

/**
 * Map a risk score to a trust grade.
 * @param {number} score - Risk score 0–100
 * @returns {string} Grade: A+, A, B+, B, C, D, or F
 * @since 0.2.0
 */
export function getTrustGrade(score) {
  if (score <= 10) return 'A+';
  if (score <= 20) return 'A';
  if (score <= 30) return 'B+';
  if (score <= 40) return 'B';
  if (score <= 55) return 'C';
  if (score <= 70) return 'D';
  return 'F';
}
