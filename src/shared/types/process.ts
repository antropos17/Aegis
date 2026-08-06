/**
 * @file process.ts — Process scanning and platform types
 * @module shared/types/process
 * @description Types for process detection, platform operations, and scan results.
 */

/** Raw process entry from tasklist CSV output */
export interface ProcessInfo {
  readonly name: string;
  readonly pid: number;
}

/** Parent process info from Win32_Process CIM instance */
export interface ParentProcessInfo {
  readonly name: string;
  readonly ppid: number;
  /**
   * OS process-creation time (epoch ms). Supplied by win32 only; darwin/linux map
   * entries omit it, so the field is null there.
   */
  readonly startTime?: number | null;
}

/**
 * Provenance of a {@link DetectedAgent.instanceId} — see main/process-identity.js.
 * `os` = bound to an OS birth time (reuse-resistant); `synthetic` = named pid-0
 * entity with no OS process; `unknown` = real pid whose birth time is unreadable.
 */
export type InstanceIdSource = 'os' | 'synthetic' | 'unknown';

/** Raw TCP connection from Get-NetTCPConnection */
export interface RawTcpConnection {
  readonly pid: number;
  readonly ip: string;
  readonly port: number;
  readonly state: string;
}

/** Agent name + process-name patterns for matching */
export interface AgentMatch {
  readonly name: string;
  readonly patterns: readonly string[];
}

/** Agent detected by process scanner */
export interface DetectedAgent {
  readonly agent: string;
  readonly process: string;
  readonly pid: number;
  readonly status: 'running';
  readonly category: string;
  readonly parentEditor?: string | null;
  readonly cwd?: string | null;
  readonly projectName?: string | null;
  /**
   * OS process-creation time (epoch ms), attached by
   * `process-utils.enrichWithParentChains`. Null when the platform withholds it
   * (darwin/linux today) or for synthetic pid-0 agents. Distinct from the
   * AEGIS-observed session `firstSeen`.
   */
  readonly startTime?: number | null;
  /**
   * Process instance key, `pid` bound to `startTime` — the reuse-resistant
   * identity. Stamped by `process-utils.enrichWithParentChains`; absent on a raw
   * scanner result. See main/process-identity.js for the three value spaces.
   */
  readonly instanceId?: string;
  /** Where {@link DetectedAgent.instanceId} came from. */
  readonly instanceIdSource?: InstanceIdSource;
  /**
   * `true` only on records fabricated by the browser demo engine
   * (renderer/lib/stores/demo-data.js). ABSENT on everything the main process
   * produces — a scanner has no way to set it, so absence is the observed case and
   * presence is the claim. Read it through `isDemoPayload()`
   * (renderer/lib/stores/demo-provenance.js), never by truthiness — the predicate lives
   * apart from the engine so a production bundle can check provenance without carrying
   * the demo data.
   */
  readonly _demo?: boolean;
}

/** Result of a process scan cycle */
export interface ScanResult {
  readonly agents: readonly DetectedAgent[];
  readonly changed: boolean;
}

/** Result of kill/suspend/resume operations */
export interface ProcessActionResult {
  readonly success: boolean;
  readonly error?: string;
}
