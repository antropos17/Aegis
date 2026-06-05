/// <reference types="vite/client" />
import { writable } from 'svelte/store';
import type { Writable } from 'svelte/store';
import { startDemoMode } from './demo-data.js';
import type {
  DetectedAgent,
  FileEvent,
  NetworkConnection,
  FalsePositiveEntry,
} from '../../../shared/types';

/** Payload shape for the scan-batch IPC push channel */
interface ScanBatchData {
  readonly agents?: DetectedAgent[];
  readonly stats?: Record<string, unknown>;
  readonly resourceUsage?: Record<string, unknown>;
  readonly anomalyScores?: Record<string, number>;
}

/** Scan-status push payload */
interface ScanStatusData {
  readonly scanning?: boolean;
}

/** Result of a process intervention (kill/suspend/resume) from the main process */
interface ProcessActionResult {
  readonly success: boolean;
  readonly error?: string;
}

/** Result of an alert-only watchlist add from the main process */
interface WatchlistAddResult {
  readonly success: boolean;
  readonly entry?: unknown;
  readonly error?: string;
}

/** Minimal type for the window.aegis IPC bridge exposed by preload.js */
interface AegisIpcBridge {
  onScanBatch(cb: (data: ScanBatchData) => void): void;
  onFileAccess(cb: (data: FileEvent | FileEvent[]) => void): void;
  onStatsUpdate(cb: (data: Record<string, unknown>) => void): void;
  onNetworkUpdate(cb: (data: NetworkConnection[]) => void): void;
  onScanStatus(cb: (data: ScanStatusData) => void): void;
  getStats(): Promise<Record<string, unknown>>;
  getResourceUsage(): Promise<Record<string, unknown>>;
  getFalsePositives(): Promise<FalsePositiveEntry[]>;
  killProcess(pid: number): Promise<ProcessActionResult>;
  suspendProcess(pid: number): Promise<ProcessActionResult>;
  resumeProcess(pid: number): Promise<ProcessActionResult>;
  blocklistAdd(entry: {
    signature: string;
    pid?: number | null;
    reason?: string;
  }): Promise<WatchlistAddResult>;
}

declare global {
  interface Window {
    aegis?: AegisIpcBridge;
  }
}

export const agents: Writable<DetectedAgent[]> = writable([]);
export const events: Writable<FileEvent[]> = writable([]);
export const stats: Writable<Record<string, unknown>> = writable({});
export const network: Writable<NetworkConnection[]> = writable([]);
export const anomalies: Writable<Record<string, number>> = writable({});
export const resourceUsage: Writable<Record<string, unknown>> = writable({});
export const falsePositives: Writable<FalsePositiveEntry[]> = writable([]);
export const scanActive: Writable<boolean> = writable(false);

/**
 * True once the first scan batch has arrived from the main process. Monotonic
 * (only ever flips false→true). Lets the UI distinguish "first scan hasn't
 * landed yet" (show skeletons) from "scan ran and found zero agents" (show an
 * empty state) instead of latching on agent count, which left quiet machines
 * stuck on skeletons forever.
 */
export const firstScanDone: Writable<boolean> = writable(false);

/** PID of agent to highlight in AgentPanel (set by Timeline dot click) */
export const focusedAgentPid: Writable<number | null> = writable(null);

/**
 * PID of the currently selected (expanded) agent card. Persistent across the
 * session — the target for Command Palette kill/suspend actions. Distinct from
 * {@link focusedAgentPid}, which auto-clears after a scroll-into-view.
 */
export const selectedAgentPid: Writable<number | null> = writable(null);

/** True when running in a browser without Electron IPC. */
export const isDemoMode: boolean = import.meta.env.VITE_DEMO_MODE === 'true' || !window.aegis;

if (!isDemoMode) {
  // Primary path: coalesce all store updates into a single microtask
  // so Svelte batches DOM repaints instead of 4 separate cascades.
  window.aegis!.onScanBatch((data) => {
    queueMicrotask(() => {
      if (data.agents) agents.set(data.agents);
      if (data.stats) stats.set(data.stats);
      if (data.resourceUsage) resourceUsage.set(data.resourceUsage);
      if (data.anomalyScores) anomalies.set(data.anomalyScores);
      // A batch landed — the first scan has completed, even if it found nothing.
      firstScanDone.set(true);
    });
  });

  // Individual channels for non-batch sources (file watcher, network monitor)
  window.aegis!.onFileAccess((data) => {
    const batch = Array.isArray(data) ? data : [data];
    events.update((arr) => [...arr.slice(-499), ...batch]);
  });
  window.aegis!.onStatsUpdate((data) => stats.set(data));
  window.aegis!.onNetworkUpdate((data) => {
    const arr = Array.isArray(data) ? data : [];
    network.set(arr.length > 500 ? arr.slice(-500) : arr);
  });
  window.aegis!.onScanStatus((data) => scanActive.set(data?.scanning ?? false));

  // Fetch initial data
  window.aegis!.getStats().then((data) => stats.set(data));
  window.aegis!.getResourceUsage().then((data) => resourceUsage.set(data));
  window.aegis!.getFalsePositives().then((data) => falsePositives.set(data || []));
} else {
  // Demo mode seeds agents synchronously (≥2 every scenario), so the live
  // `populated` check drives the dashboard — no `firstScanDone` latch needed,
  // and the original skeleton→populated flow is preserved.
  const cleanupDemo = startDemoMode({ agents, events, stats, network, anomalies, resourceUsage });
  if (import.meta.hot) {
    import.meta.hot.dispose(() => cleanupDemo());
  }
}
