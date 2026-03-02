/**
 * @file agent.ts — Agent database types
 * @module shared/types/agent
 * @description Types for agent signatures, categories, and trust grades.
 */

/** Agent category from agent-database.json */
export type AgentCategory =
  | 'coding-assistant'
  | 'ai-ide'
  | 'cli-tool'
  | 'autonomous-agent'
  | 'desktop-agent'
  | 'browser-agent'
  | 'agent-framework'
  | 'security-devops'
  | 'ide-extension'
  | 'container-runtime'
  | 'local-llm-runtime';

/** Risk profile assigned to each agent */
export type RiskProfile = 'low' | 'medium' | 'high';

/** Trust grade derived from risk score (A+ best, F worst) */
export type TrustGrade = 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D' | 'F';

/** Single agent signature from agent-database.json */
export interface AgentSignature {
  readonly id: string;
  readonly names: readonly string[];
  readonly displayName: string;
  readonly vendor: string;
  readonly category: AgentCategory;
  readonly icon: string;
  readonly color: string;
  readonly defaultTrust: number;
  readonly website: string;
  readonly description: string;
  readonly knownDomains: readonly string[];
  readonly knownPorts: readonly number[];
  readonly configPaths: readonly string[];
  readonly parentEditors: readonly string[];
  readonly riskProfile: RiskProfile;
}

/** Top-level agent database structure */
export interface AgentDatabase {
  readonly version: string;
  readonly lastUpdated: string;
  readonly agents: readonly AgentSignature[];
}
