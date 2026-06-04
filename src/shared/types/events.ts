/**
 * @file events.ts — File, network, and anomaly event types
 * @module shared/types/events
 * @description Types for file watcher events, network connections, and deviation warnings.
 */

/**
 * File watcher action types.
 * - created/modified/deleted: chokidar write events.
 * - accessed: open file handle read-detect (handle.exe / lsof / /proc).
 * - holding: Windows Restart Manager — a process holds a handle to a sensitive
 *   resource AT THE SCAN TICK (point-in-time hold, not a read). Distinct from
 *   'accessed' so the source (rm-hold vs chokidar-write) is never conflated.
 */
export type FileAction = 'created' | 'modified' | 'deleted' | 'accessed' | 'holding';

/** File access event from watcher or handle scan */
export interface FileEvent {
  readonly agent: string;
  readonly pid: number;
  readonly parentEditor: string | null;
  readonly cwd: string | null;
  readonly file: string;
  readonly sensitive: boolean;
  readonly selfAccess: boolean;
  readonly reason: string;
  readonly action: FileAction;
  readonly timestamp: number;
  readonly category: string;
}

/** Enriched network connection from scanNetworkConnections */
export interface NetworkConnection {
  readonly agent: string;
  readonly pid: number;
  readonly parentEditor: string | null;
  readonly cwd: string | null;
  readonly category: string;
  readonly remoteIp: string;
  readonly remotePort: number;
  readonly domain: string;
  readonly state: string;
  readonly flagged: boolean;
  readonly httpUnencrypted: boolean;
  readonly userAgent: string | null;
}

/** Deviation warning type identifiers */
export type DeviationWarningType =
  | 'files'
  | 'sensitive'
  | 'new-sensitive'
  | 'network'
  | 'directories'
  | 'timing';

/** Behavioural deviation warning from anomaly detector */
export interface DeviationWarning {
  readonly agent: string;
  readonly type: DeviationWarningType;
  readonly message: string;
  readonly anomalyScore: number;
}
