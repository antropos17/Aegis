/**
 * @file config.ts — Configuration and permission types
 * @module shared/types/config
 * @description Types for app settings, permissions, and sensitive-pattern rules.
 */

import type { AgentSignature } from './agent';

/** Permission state for an agent capability */
export type PermissionState = 'monitor' | 'block' | 'allow';

/** Permission category identifiers (six dimensions) */
export type PermissionCategory =
  | 'filesystem'
  | 'sensitive'
  | 'network'
  | 'terminal'
  | 'clipboard'
  | 'screen';

/** Permission map: category to state */
export type PermissionMap = Record<PermissionCategory, PermissionState>;

/** False positive pattern entry */
export interface FalsePositiveEntry {
  readonly agentName: string;
  readonly pattern: string;
  readonly timestamp: number;
}

/** Compiled custom sensitive rule */
export interface SensitiveRule {
  readonly pattern: RegExp;
  readonly reason: string;
}

/** Protection preset (scan interval tiers) */
export type ProtectionPreset = 'minimal' | 'standard' | 'aggressive';

/** Application settings persisted to disk */
export interface AppConfig {
  scanIntervalSec: number;
  notificationsEnabled: boolean;
  customSensitivePatterns: string[];
  startMinimized: boolean;
  autoStartWithWindows: boolean;
  anthropicApiKey: string;
  darkMode: boolean;
  uiScale: number;
  timelineZoom: number;
  agentPermissions: Record<string, PermissionMap>;
  ignoredDirectories: string[];
  ignoreCommonBuildDirs: boolean;
  seenAgents: string[];
  customAgents: AgentSignature[];
  hardwareAcceleration: boolean;
  falsePositivePatterns: FalsePositiveEntry[];
}
