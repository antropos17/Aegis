/** @file risk.ts — Risk scoring, anomaly detection, and baseline types */

import type { TrustGrade } from './agent';

/** Input metrics for risk score calculation */
export interface RiskScoreInput {
  readonly sensitiveFiles: number;
  readonly configFiles: number;
  readonly sshAwsFiles: number;
  readonly networkCount: number;
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

/** Per-agent session tracking data for baseline comparison */
export interface SessionData {
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
  readonly instanceKey: string;
  readonly sensitiveFiles: number;
  readonly unknownDomains: number;
  readonly anomalyScore: number;
  readonly riskScore: number;
  readonly trustGrade: TrustGrade;
  readonly fileCount: number;
  readonly networkCount: number;
  readonly hasApiCalls: boolean;
}
