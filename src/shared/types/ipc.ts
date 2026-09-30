/**
 * @file ipc.ts — IPC channel names and payload types
 * @module shared/types/ipc
 * @description String literal unions for all IPC channels and key payload shapes.
 */

/** IPC invoke channel names (renderer -> main, request-response) */
export type IpcInvokeChannel =
  | 'local-security:review'
  | 'updates:status'
  | 'updates:check'
  | 'updates:download'
  | 'updates:install'
  | 'get-stats'
  | 'sensitive-alerts:list'
  | 'sensitive-alerts:set-reviewed'
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
  | 'open-external-url'
  | 'get-audit-stats'
  | 'get-rules'
  | 'reload-rules'
  | 'blocklist-add'
  | 'blocklist-remove'
  | 'blocklist-list';

/**
 * IPC event channel names (main -> renderer, push).
 *
 * Documentation, not enforcement: `sendToRenderer` is called from main-process `.js`
 * under `checkJs: false`, so this union documents the preload channels without enforcing main-process sends.
 */
export type IpcEventChannel =
  | 'updates:status'
  | 'file-access'
  | 'stats-update'
  | 'network-update'
  | 'toggle-theme'
  | 'navigate-view'
  | 'scan-batch'
  | 'scan-status'
  /** Per-agent CPU/RAM/GPU records, keyed by `instanceId`. NOT AEGIS's own load. */
  | 'agent-resource-usage'
  | 'token-costs'
  | 'rules:reloaded';

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

/** Native-selected read-only imported result operations on local-security:review. */
export type ResultReviewRequest =
  { readonly action: 'review-result' } | { readonly action: 'result-status'; readonly id: string };

export interface ResultReviewChange {
  readonly id: string;
  readonly path: string;
  readonly type: 'addition' | 'edit' | 'deletion' | 'unknown';
  readonly beforeSha256: string | null;
  readonly afterSha256: string | null;
  readonly beforeBytes: number | null;
  readonly afterBytes: number | null;
  readonly beforePreview: ResultReviewPreview;
  readonly afterPreview: ResultReviewPreview;
}

export interface ResultReviewPreview {
  readonly state: 'absent' | 'incomplete' | 'binary' | 'text' | 'truncated';
  readonly text: string | null;
}

/** Comparison metadata only; payload and imported success/stop/boundary claims stay private. */
export interface ImportedResultReview {
  readonly id: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly comparison: {
    readonly schemaVersion: 1;
    readonly captureSource: 'imported-artifact';
    readonly originalState: 'complete-imported-baseline-unverified' | 'incomplete-unknown';
    readonly retained: true;
    readonly writerState: 'stop-unconfirmed';
    readonly acceptance: 'unreviewed';
    readonly complete: boolean;
    readonly baselineDigest: string;
    readonly snapshotDigest: string;
    readonly bundleDigest: string;
    readonly changes: readonly ResultReviewChange[];
    readonly launchAllowed: false;
    readonly projectExportAllowed: false;
  };
}

/** Public updater state. Executable paths and network options never reach the renderer. */
export interface UpdateStatus {
  readonly status:
    | 'idle'
    | 'unsupported'
    | 'checking'
    | 'up-to-date'
    | 'available'
    | 'downloading'
    | 'ready'
    | 'installing'
    | 'error';
  readonly version: string | null;
  readonly notes: string;
  readonly progress: number;
  readonly error: string | null;
}
