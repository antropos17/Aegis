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
}

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
