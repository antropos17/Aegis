/**
 * @file ipc.ts — IPC channel names and payload types
 * @module shared/types/ipc
 * @description String literal unions for all IPC channels and key payload shapes.
 */

/** IPC invoke channel names (renderer -> main, request-response) */
export type IpcInvokeChannel =
  | 'scan-processes'
  | 'get-stats'
  | 'get-resource-usage'
  | 'export-log'
  | 'export-csv'
  | 'generate-report'
  | 'get-settings'
  | 'save-settings'
  | 'test-notification'
  | 'analyze-agent'
  | 'analyze-session'
  | 'open-threat-report'
  | 'get-agent-baseline'
  | 'get-all-permissions'
  | 'get-agent-permissions'
  | 'save-agent-permissions'
  | 'get-instance-permissions'
  | 'save-instance-permissions'
  | 'reset-permissions-to-defaults'
  | 'capture-screenshot'
  | 'get-agent-database'
  | 'get-project-dir'
  | 'get-custom-agents'
  | 'save-custom-agents'
  | 'export-agent-database'
  | 'import-agent-database'
  | 'get-audit-stats'
  | 'get-audit-entries-before'
  | 'open-audit-log-dir'
  | 'export-full-audit'
  | 'get-log-stats'
  | 'open-log-dir'
  | 'export-full-log'
  | 'export-config'
  | 'import-config'
  | 'reveal-in-explorer'
  | 'get-local-models'
  | 'get-app-version'
  | 'export-zip'
  | 'kill-process'
  | 'suspend-process'
  | 'resume-process'
  | 'get-false-positives'
  | 'add-false-positive'
  | 'open-external-url';

/** IPC event channel names (main -> renderer, push) */
export type IpcEventChannel =
  | 'scan-results'
  | 'file-access'
  | 'stats-update'
  | 'monitoring-paused'
  | 'network-update'
  | 'resource-usage'
  | 'baseline-warnings'
  | 'anomaly-scores'
  | 'toggle-theme'
  | 'scan-status';

/** IPC send channel names (renderer -> main, fire-and-forget) */
export type IpcSendChannel = 'other-panel-expanded';

/** Payload for save-instance-permissions invoke */
export interface SaveInstancePermissionsPayload {
  readonly agentName: string;
  readonly parentEditor: string | null;
  readonly permissions: Record<string, string>;
  readonly cwd: string | null;
}

/** Generic IPC success/failure result */
export interface IpcResult {
  readonly success: boolean;
  readonly error?: string;
  readonly path?: string;
  readonly count?: number;
}
