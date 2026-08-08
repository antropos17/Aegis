/** @file risk.ts — Risk scoring, anomaly detection, and baseline types */

import type { TrustGrade } from './agent';

/**
 * Input metrics for risk score calculation.
 *
 * `flaggedDomains` and `unknownDomains` are DISJOINT counts, not a subset relation: an
 * endpoint is counted in exactly one of them, and an allowlisted endpoint in neither. They
 * mirror {@link NetworkVerdict} — an endpoint whose identity was established and found on no
 * allowlist (`flagged`) is a stronger signal than one whose identity could not be
 * established at all (`unknown`), and they must not weigh the same.
 */
export interface RiskScoreInput {
  readonly sensitiveFiles: number;
  readonly configFiles: number;
  readonly sshAwsFiles: number;
  readonly networkCount: number;
  /** Endpoints with a forward-confirmed name that is on no allowlist (verdict `flagged`). */
  readonly flaggedDomains: number;
  /**
   * Endpoints whose identity could not be established (verdict `unknown`). Since the split
   * this is NO LONGER the count of everything non-allowlisted — that total is
   * `flaggedDomains + unknownDomains`.
   */
  readonly unknownDomains: number;
  readonly fileCount: number;
  readonly httpUnencryptedCount?: number;
}

/** Per-dimension anomaly score with contributing factors */
export interface DimensionScore {
  readonly score: number;
  readonly weight: number;
  readonly factors: readonly string[];
}

/** Anomaly scoring dimension names */
export type AnomalyDimension = 'network' | 'filesystem' | 'process' | 'baseline';

/** Multi-dimensional anomaly calculation result */
export interface AnomalyResult {
  readonly score: number;
  readonly dimensions: Readonly<Record<AnomalyDimension, DimensionScore>>;
}

/** Per-INSTANCE session tracking data for baseline comparison */
export interface SessionData {
  /**
   * Display name of the agent this bucket belongs to. The bucket itself is keyed
   * by `instanceId` (baselines.js `sessionData`), so this field is the only way
   * back to the cross-session profile in {@link Baselines}, which stays keyed on
   * the name.
   */
  readonly agentName: string;
  readonly files: Set<string>;
  sensitiveCount: number;
  readonly directories: Set<string>;
  readonly endpoints: Set<string>;
  readonly sensitiveReasons: Set<string>;
  readonly activeHours: Set<number>;
  readonly startTime: number;
}

/** Historical session snapshot persisted to disk */
export interface SessionSnapshot {
  readonly startTime: number;
  readonly endTime: number;
  readonly totalFiles: number;
  readonly sensitiveFiles: number;
  readonly directories: readonly string[];
  readonly networkEndpoints: readonly string[];
  readonly sensitiveReasons: readonly string[];
  readonly activeHours: readonly number[];
}

/** Rolling averages computed from session history */
export interface BaselineAverages {
  filesPerSession: number;
  sensitivePerSession: number;
  typicalDirectories: string[];
  knownEndpoints: string[];
  knownSensitiveReasons: string[];
  hourHistogram: number[];
}

/** Per-agent baseline data with session history */
export interface AgentBaseline {
  sessionCount: number;
  sessions: SessionSnapshot[];
  averages: BaselineAverages;
}

/** Top-level baselines structure */
export interface Baselines {
  agents: Record<string, AgentBaseline>;
}

/** Agent enriched with computed risk scores and trust grade */
export interface EnrichedAgent {
  readonly agent: string;
  readonly pid: number;
  readonly process: string;
  readonly status: 'running';
  readonly category: string;
  readonly name: string;
  readonly parentEditor: string | null;
  readonly cwd: string | null;
  readonly projectName: string | null;
  /**
   * The canonical process-INSTANCE key, copied verbatim from the `scan-batch` record —
   * never rebuilt here. This is what file events and network connections are correlated
   * by; see main/process-identity.js for the three value spaces.
   *
   * `null` when the batch carried no key: a record from a build older than the stamp, or
   * an agent that no stamp site ever reached (the `attachModels` pid-0 synthetics). Such
   * an agent correlates to NOTHING rather than to a namesake — see the quarantine policy
   * at `byInstance` in renderer/lib/stores/risk.ts.
   *
   * Distinct from {@link EnrichedAgent.instanceKey}, which is durable and stays on
   * name+cwd. This one is per-boot and must never be persisted.
   * @since v0.12.0
   */
  readonly instanceId: string | null;
  readonly instanceKey: string;
  readonly sensitiveFiles: number;
  /**
   * Endpoints not confirmed as allowlisted — `flagged` and `unknown` together. Unchanged by
   * the scoring split: {@link RiskScoreInput} separates the two, this total does not.
   */
  readonly unknownDomains: number;
  readonly anomalyScore: number;
  readonly riskScore: number;
  readonly trustGrade: TrustGrade;
  readonly fileCount: number;
  readonly networkCount: number;
  readonly hasApiCalls: boolean;
}
