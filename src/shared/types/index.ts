/**
 * @file index.ts — Re-export all AEGIS type definitions
 * @module shared/types
 * @description Central barrel file for all shared TypeScript types.
 */

export type {
  ProcessInfo,
  ParentProcessInfo,
  RawTcpConnection,
  AgentMatch,
  DetectedAgent,
  ScanResult,
  ProcessActionResult,
} from './process';

export type {
  AgentCategory,
  RiskProfile,
  TrustGrade,
  AgentSignature,
  AgentDatabase,
} from './agent';

export type {
  FileAction,
  FileEvent,
  NetworkConnection,
  DeviationWarningType,
  DeviationWarning,
} from './events';

export type {
  IpcInvokeChannel,
  IpcEventChannel,
  SaveInstancePermissionsPayload,
  IpcResult,
} from './ipc';

export type {
  PermissionState,
  PermissionCategory,
  PermissionMap,
  FalsePositiveEntry,
  SensitiveRule,
  ProtectionPreset,
  AppConfig,
} from './config';

export type {
  RiskScoreInput,
  DimensionScore,
  AnomalyDimension,
  AnomalyResult,
  SessionData,
  SessionSnapshot,
  BaselineAverages,
  AgentBaseline,
  Baselines,
  EnrichedAgent,
} from './risk';

export type { CommandCategory, CommandItem, ScoredCommand } from './command-palette';
