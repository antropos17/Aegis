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
 * Diminishing returns for sensitive files, separate SSH/AWS signal,
 * capped contributions per factor to prevent instant-100.
 * @param {{ sensitiveFiles: number, configFiles: number, sshAwsFiles: number, networkCount: number, unknownDomains: number, fileCount: number }} agent
 * @returns {number} Risk score 0–100
 * @since 0.2.0
 */
export function calculateRiskScore(agent) {
  const sensitive = agent.sensitiveFiles || 0;
  const config = agent.configFiles || 0;
  const sshAws = agent.sshAwsFiles || 0;
  const netConns = agent.networkCount || 0;
  const unknown = agent.unknownDomains || 0;
  const files = agent.fileCount || 0;

  const sensitiveContrib = Math.min(40, sensitive * 5 * (1 / (1 + sensitive * 0.1)));
  const configContrib = Math.min(5, config * 0.5);
  const netContrib = Math.min(10, netConns * 0.5);
  const unknownDomainContrib = Math.min(20, unknown * 8);
  const fileContrib = Math.min(5, files * 0.02);
  const sshAwsContrib = Math.min(20, sshAws * 5);

  return Math.min(
    100,
    Math.round(
      sensitiveContrib +
        configContrib +
        netContrib +
        unknownDomainContrib +
        fileContrib +
        sshAwsContrib,
    ),
  );
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
