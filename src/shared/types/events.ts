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

/**
 * How the owning agent was attached to a file event.
 * - `confirmed`: resolved from a PID (Restart Manager holder / per-PID handle scan).
 * - `inferred`: guessed from a path (own config dir or cwd containment); no PID proof.
 * - `unattributed`: owner unknown — NO agent is substituted (C-01).
 */
export type AttributionStatus = 'confirmed' | 'inferred' | 'unattributed';

/**
 * Closed list of attribution evidence codes — mirrors `EVIDENCE_CODES` in
 * src/main/attribution.js. PID-backed codes yield `confirmed`, heuristic codes
 * yield `inferred`, negative codes yield `unattributed`.
 */
export type AttributionEvidence =
  | 'rm-holder-pid'
  | 'handle-scan-pid'
  | 'self-config-path'
  | 'cwd-containment'
  | 'no-owner-match'
  | 'no-ai-agents-online';

/**
 * Attribution record carried by a file event. Deliberately carries NO numeric
 * confidence: the status is a hard three-way distinction, not a score to threshold.
 */
export interface Attribution {
  readonly status: AttributionStatus;
  readonly evidence: readonly AttributionEvidence[];
}

/** File access event from watcher or handle scan */
export interface FileEvent {
  /** Owning agent's display name, or `''` when the event is unattributed. */
  readonly agent: string;
  /**
   * Owning agent's PID, or `null` when the event is unattributed. Never 0 for an
   * unknown owner — pid 0 is used by synthetic WSL / local-runtime agents.
   */
  readonly pid: number | null;
  readonly parentEditor: string | null;
  readonly cwd: string | null;
  readonly file: string;
  readonly sensitive: boolean;
  readonly selfAccess: boolean;
  readonly reason: string;
  readonly action: FileAction;
  readonly timestamp: number;
  readonly category: string;
  /** Optional: absent on events emitted before v0.11.0 (older activity-log entries). */
  readonly attribution?: Attribution;
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
