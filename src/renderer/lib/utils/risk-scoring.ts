/**
 * @file risk-scoring.ts — Risk score calculation + trust grades
 * @module renderer/utils/risk-scoring
 * @since 0.2.0
 */

import type { RiskScoreInput } from '../../../shared/types/risk';
import type { TrustGrade } from '../../../shared/types/agent';

// ═══ TIME DECAY ═══

/**
 * Time-decay weight for an event based on its age.
 * @param timestampMs - Event timestamp in ms since epoch
 * @returns 1.0 (recent), 0.5 (>1hr), 0.1 (>24hr)
 * @since 0.2.0
 */
export function getTimeDecayWeight(timestampMs: number): number {
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
 * @param agent - Agent activity metrics
 * @returns Risk score 0–100
 * @since 0.2.0
 */
export function calculateRiskScore(agent: RiskScoreInput): number {
  const sensitive = agent.sensitiveFiles || 0;
  const config = agent.configFiles || 0;
  const sshAws = agent.sshAwsFiles || 0;
  const netConns = agent.networkCount || 0;
  const unknown = agent.unknownDomains || 0;
  const files = agent.fileCount || 0;
  const httpUnencrypted = agent.httpUnencryptedCount || 0;

  const sensitiveContrib = Math.min(40, sensitive * 5 * (1 / (1 + sensitive * 0.1)));
  const configContrib = Math.min(5, config * 0.5);
  const netContrib = Math.min(10, netConns * 0.5);
  const unknownDomainContrib = Math.min(20, unknown * 8);
  const fileContrib = Math.min(5, files * 0.02);
  const sshAwsContrib = Math.min(20, sshAws * 5);
  const httpContrib = httpUnencrypted > 0 ? 15 : 0;

  return Math.min(
    100,
    Math.round(
      sensitiveContrib +
        configContrib +
        netContrib +
        unknownDomainContrib +
        fileContrib +
        sshAwsContrib +
        httpContrib,
    ),
  );
}

// ═══ TRUST GRADE ═══

/**
 * Map a risk score to a trust grade.
 * @param score - Risk score 0–100
 * @returns Trust grade from A+ (safest) to F (highest risk)
 * @since 0.2.0
 */
export function getTrustGrade(score: number): TrustGrade {
  if (score <= 10) return 'A+';
  if (score <= 20) return 'A';
  if (score <= 30) return 'B+';
  if (score <= 40) return 'B';
  if (score <= 55) return 'C';
  if (score <= 70) return 'D';
  return 'F';
}
