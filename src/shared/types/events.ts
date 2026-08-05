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
  /** OS connection table reported this PID as the socket owner, same scan tick. @since v0.12.0 */
  | 'os-tcp-owner-pid'
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

/**
 * Classification of a remote endpoint. A hard three-way distinction, like
 * {@link AttributionStatus} — not a score, and not the old `flagged` boolean.
 * - `allowlisted`: verified against published evidence (an operator IP range, or a
 *   forward-confirmed name on the allowlist).
 * - `unknown`: no usable identity was established. NOT an accusation — the absence of a
 *   PTR record says nothing about the endpoint.
 * - `flagged`: identity WAS established and it is on no allowlist.
 */
export type NetworkVerdict = 'allowlisted' | 'unknown' | 'flagged';

/**
 * Closed list of verdict reason codes — mirrors `VERDICT_REASONS` in
 * src/main/network-monitor.js. Every verdict records which rule produced it.
 * - `ip-allowlist`: remote address is inside a published operator IP range; no DNS was used.
 * - `domain-allowlist`: forward-confirmed name is an allowlisted host or a subdomain of one.
 * - `domain-not-allowlisted`: forward-confirmed name, on no allowlist.
 * - `ptr-missing`: no PTR record, or the reverse lookup failed.
 * - `ptr-unconfirmed`: a PTR name existed but did not resolve back to this address.
 */
export type NetworkVerdictReason =
  | 'ip-allowlist'
  | 'domain-allowlist'
  | 'domain-not-allowlisted'
  | 'ptr-missing'
  | 'ptr-unconfirmed';

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
  /**
   * `true` for anything not `allowlisted` — i.e. it keeps its original meaning, "not
   * confirmed as a known endpoint", so an unidentified endpoint is never shown as safe.
   * Prefer {@link NetworkConnection.verdict}: this boolean cannot tell `unknown` from
   * `flagged`, which is the distinction the classifier exists to make.
   */
  readonly flagged: boolean;
  /**
   * Optional: absent on records emitted before the three-outcome classifier (demo pools,
   * cached scans from an older build). Consumers must fall back rather than assume.
   */
  readonly verdict?: NetworkVerdict;
  /** The rule that produced {@link NetworkConnection.verdict}. Absent wherever `verdict` is. */
  readonly verdictReason?: NetworkVerdictReason;
  readonly httpUnencrypted: boolean;
  readonly userAgent: string | null;
}

/**
 * Closed set of audit record types.
 *
 * NOT enforced at runtime inside `audit-logger.log()`: the logger's own tests pass
 * arbitrary type strings, and rejecting them would break the suite for no gain. This union
 * is the enforced boundary for TypeScript consumers (renderer, shared) — the write path is
 * guarded instead by `deriveStatus()` throwing on an unknown evidence code.
 *
 * `permission-deny` is declared but emitted by nothing in `src/`. It is kept because the
 * renderer's `AUDIT_EVENT_TYPES` and its `_denied` branch already handle it; removing it
 * would need a coordinated renderer change, and inventing its field semantics for a code
 * path that never runs would be manufacturing an answer.
 *
 * `buffer-overflow-drop` is internally generated by `audit-drop-tracker.js` — no agent owns
 * it. See {@link AuditRecordV1} for what its identity fields hold.
 */
export type AuditEventType =
  | 'file-access'
  | 'config-access'
  | 'network-connection'
  | 'anomaly-alert'
  | 'agent-enter'
  | 'agent-exit'
  | 'permission-deny'
  | 'buffer-overflow-drop';

/**
 * A v1 audit record as written to the daily JSONL, after `flush()` appends `seq`/`hash`.
 *
 * Identity and attribution are TOP-LEVEL here. Before v1 they were smuggled into `details`
 * on the belief that changing the field set would break the hash chain — it does not:
 * `verifyChain()` rebuilds each record's preimage from that record's own stored fields, so
 * a daily file holding both v0 and v1 records verifies end to end (proven by execution, not
 * by reading).
 *
 * Null semantics are load-bearing and differ per field:
 * - `pid: null` — no OS pid was observed. NEVER 0 for "unknown": pid 0 is a real value
 *   meaning a synthetic agent (editor extension / WSL-inner / local LLM runtime).
 * - `instanceId: null` — no process identity available at the call site. Not fabricated by
 *   joining on a name, which would invent a key not grounded in an OS observation.
 * - `attribution: null` — the ownership question does not APPLY to this event type. That is
 *   categorically different from `status: 'unattributed'`, which means the question applies
 *   and the owner is unknown. A reader must not conflate them.
 *
 * `attribution: 'confirmed'` does not imply a non-null `instanceId`: it describes how the
 * OWNER was resolved, not what identity data the call site happened to have.
 */
export interface AuditRecordV1 {
  readonly schemaVersion: 1;
  readonly timestamp: string;
  readonly type: AuditEventType;
  /** Display name; `''` when unattributed or internally generated (C-01: never fabricated). */
  readonly agent: string;
  readonly pid: number | null;
  readonly instanceId: string | null;
  readonly action: string;
  readonly path: string;
  readonly severity: string;
  /** Vestigial — always 0 in v1. Retained for shape stability; derive nothing from it. */
  readonly riskScore: number;
  readonly attribution: Attribution | null;
  readonly details: Record<string, unknown> | null;
  readonly seq: number;
  readonly hash: string;
}

/**
 * A pre-v1 audit record. Identified by the ABSENCE of `schemaVersion` — and only for a
 * record that parses and whose hash verifies. A parse failure means a corrupt write, not a
 * legacy record; the two must never be conflated.
 */
export interface AuditRecordV0 {
  readonly timestamp: string;
  readonly type: string;
  readonly agent?: string;
  readonly action?: string;
  readonly path?: string;
  readonly severity?: string;
  readonly riskScore?: number;
  readonly details?: Record<string, unknown> | null;
  readonly seq: number;
  readonly hash: string;
}

/** Either shape — what a reader of an exported daily file actually encounters. */
export type AuditRecord = AuditRecordV0 | AuditRecordV1;

/**
 * Attribution as returned by the v0→v1 read normalizer.
 *
 * `evidence: null` means the evidence was NEVER RECORDED (a v0 record stored only the
 * derived status string), which is a different claim from `[]` — recorded as empty.
 * Deliberately NOT assignable to {@link Attribution}, whose `evidence` is non-nullable, so
 * that mixing a normalized record into a code path expecting a real attribution fails
 * typecheck instead of silently reading `null` as "no evidence".
 */
export interface NormalizedAttribution {
  readonly status: AttributionStatus;
  readonly evidence: readonly AttributionEvidence[] | null;
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
