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
 * Per-endpoint weights for the endpoint-identity factor.
 *
 * A `flagged` endpoint resolved to a name and that name is on no allowlist — an established
 * identity nobody vouches for. An `unknown` endpoint produced no usable name at all, which
 * is common and benign (plenty of hosts publish no PTR record) and is explicitly NOT an
 * accusation. So flagged weighs 8 and unknown 3 — an unidentified endpoint still moves the
 * score, at a little over a third of a flagged one.
 *
 * FLAGGED keeps the 8 the single pre-split count carried, so an agent whose endpoints are
 * all flagged scores exactly what it scored before the split.
 * @type {{ FLAGGED: number, UNKNOWN: number }}
 * @since 0.10.0
 */
const ENDPOINT_WEIGHTS = { FLAGGED: 8, UNKNOWN: 3 };

/** Shared ceiling for the endpoint-identity factor — unchanged by the flagged/unknown split. */
const ENDPOINT_CEILING = 20;

/**
 * Calculate risk score for an agent (0–100).
 * Diminishing returns for sensitive files, separate SSH/AWS signal,
 * capped contributions per factor to prevent instant-100.
 *
 * `flaggedDomains` and `unknownDomains` are disjoint counts that share ONE ceiling
 * ({@link ENDPOINT_CEILING}), so splitting them cannot inflate the total: the factor's
 * maximum is what it always was.
 * @param {{ sensitiveFiles?: number, configFiles?: number, sshAwsFiles?: number, networkCount?: number, flaggedDomains?: number, unknownDomains?: number, fileCount?: number, httpUnencryptedCount?: number }} agent
 * @returns {number} Risk score 0–100
 * @since 0.2.0
 */
export function calculateRiskScore(agent) {
  const sensitive = agent.sensitiveFiles || 0;
  const config = agent.configFiles || 0;
  const sshAws = agent.sshAwsFiles || 0;
  const netConns = agent.networkCount || 0;
  const flagged = agent.flaggedDomains || 0;
  const unknown = agent.unknownDomains || 0;
  const files = agent.fileCount || 0;
  const httpUnencrypted = agent.httpUnencryptedCount || 0;

  const sensitiveContrib = Math.min(40, sensitive * 5 * (1 / (1 + sensitive * 0.1)));
  const configContrib = Math.min(5, config * 0.5);
  const netContrib = Math.min(10, netConns * 0.5);
  const endpointContrib = Math.min(
    ENDPOINT_CEILING,
    flagged * ENDPOINT_WEIGHTS.FLAGGED + unknown * ENDPOINT_WEIGHTS.UNKNOWN,
  );
  const fileContrib = Math.min(5, files * 0.02);
  const sshAwsContrib = Math.min(20, sshAws * 5);
  const httpContrib = httpUnencrypted > 0 ? 15 : 0;

  return Math.min(
    100,
    Math.round(
      sensitiveContrib +
        configContrib +
        netContrib +
        endpointContrib +
        fileContrib +
        sshAwsContrib +
        httpContrib,
    ),
  );
}

// ═══ TRUST GRADE ═══

/**
 * Map a risk score to a **letter trust grade** (A+…F).
 *
 * DISPLAY ONLY. A grade is printed as a letter — Reports' grade column, the
 * Activity group badge — and decides nothing else. Every colour in the renderer,
 * including the colour that letter is printed in, comes from the risk **bands**
 * (low/medium/high) in trust-badge-utils `getRiskInfo`, reached via
 * `pickByRiskBand`. The two threshold sets are not interchangeable and the
 * grades are finer-grained: score 60 is grade D but band medium, which is
 * exactly how the Radar once drew a red dot beside an amber badge (F-W10).
 *
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
