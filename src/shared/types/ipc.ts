/**
 * @file ipc.ts — IPC channel names and payload types
 * @module shared/types/ipc
 * @description String literal unions for all IPC channels and key payload shapes.
 */

/** IPC invoke channel names (renderer -> main, request-response) */
export type IpcInvokeChannel =
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
  | 'get-all-permissions'
  | 'save-agent-permissions'
  | 'save-instance-permissions'
  | 'reset-permissions-to-defaults'
  | 'get-agent-database'
  | 'get-custom-agents'
  | 'save-custom-agents'
  | 'export-agent-database'
  | 'import-agent-database'
  | 'get-audit-entries-before'
  | 'open-audit-log-dir'
  | 'export-full-audit'
  | 'export-config'
  | 'import-config'
  | 'reveal-in-explorer'
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
  | 'file-access'
  | 'stats-update'
  | 'network-update'
  | 'toggle-theme'
  | 'scan-batch'
  | 'scan-status';

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
