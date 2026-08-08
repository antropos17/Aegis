/// <reference types="vite/client" />
import { writable, derived } from 'svelte/store';
import type { Readable, Writable } from 'svelte/store';
import { isDemoPayload } from './demo-provenance.js';
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
  /**
   * Per-display-name anomaly scores (max over that name's live instances).
   * Consumed by App.svelte toasts and SummaryCards — not by live risk correlation.
   */
  readonly anomalyScores?: Record<string, number>;
  /**
   * Per-instance anomaly scores keyed by the same `instanceId` the agent carries in
   * this batch. Source of truth for risk.ts anomaly contribution (IDENTITY-RECON C2).
   */
  readonly anomalyScoresByInstance?: Record<string, number>;
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

/**
 * Audit-log statistics from `get-audit-stats`.
 *
 * The counts are not interchangeable: `totalEntries` counts everything the logger was
 * handed — including entries evicted and gone for good — `persistedEntries` only what
 * reached disk, `droppedEntries` what was evicted, and `bufferDepth` what is waiting.
 * `droppedEntries + bufferDepth` is how much would be missing if the process stopped now.
 */
interface AuditStats {
  readonly totalEntries: number;
  readonly persistedEntries: number;
  readonly droppedEntries: number;
  readonly bufferDepth: number;
  readonly totalSize: number;
  readonly currentSize: number;
  readonly firstEntry: string | null;
  readonly lastEntry: string | null;
}

/** Result of an alert-only watchlist add from the main process */
interface WatchlistAddResult {
  readonly success: boolean;
  readonly entry?: unknown;
  readonly error?: string;
}

/**
 * Per process-instance token + cost record pushed on the `token-costs` channel.
 * Mirrors the main process `CostRecord` (token-tracker.js). `estimated` reports
 * whether the TOKEN COUNTS are measured vs guessed — not whether the dollar
 * figure is audited. Keyed by `instanceId` so a recycled pid never inherits a
 * dead instance's record; `pid` rides alongside for display and legacy matching.
 */
interface TokenCostRecord {
  readonly instanceId: string;
  readonly pid: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly estimated: boolean;
  readonly models: string[];
}

/** Minimal type for the window.aegis IPC bridge exposed by preload.js */
interface AegisIpcBridge {
  onScanBatch(cb: (data: ScanBatchData) => void): void;
  onFileAccess(cb: (data: FileEvent | FileEvent[]) => void): void;
  onStatsUpdate(cb: (data: Record<string, unknown>) => void): void;
  onNetworkUpdate(cb: (data: NetworkConnection[]) => void): void;
  onScanStatus(cb: (data: ScanStatusData) => void): void;
  onTokenCosts(cb: (data: TokenCostRecord[]) => void): void;
  getStats(): Promise<Record<string, unknown>>;
  getAuditStats(): Promise<AuditStats>;
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
/**
 * Name-keyed anomaly scores (max over instances of that name). Still filled from
 * `scan-batch.anomalyScores` for App.svelte toasts and SummaryCards. Live per-instance
 * risk correlation reads {@link anomaliesByInstance} instead.
 */
export const anomalies: Writable<Record<string, number>> = writable({});
/**
 * Instance-keyed anomaly scores from `scan-batch.anomalyScoresByInstance`.
 * Key = stamped `instanceId` string; value = that instance's anomaly score.
 * Missing keys and null-identity agents contribute 0 in risk.ts — never a name lookup.
 */
export const anomaliesByInstance: Writable<Record<string, number>> = writable({});
export const resourceUsage: Writable<Record<string, unknown>> = writable({});
export const falsePositives: Writable<FalsePositiveEntry[]> = writable([]);
export const scanActive: Writable<boolean> = writable(false);

/** Per process-instance token + cost records, refreshed each scan via the `token-costs` push. */
export const tokenCosts: Writable<TokenCostRecord[]> = writable([]);

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

/**
 * True only in a bundle built WITH the demo scenario engine (`npm run build:demo`, and
 * the dev server, which serves the browser preview).
 *
 * A build-time literal, and the only gate on the demo engine. Vite replaces
 * `import.meta.env.VITE_DEMO_MODE` with a string literal, so in the default build the
 * comparison folds to `false` and Rollup drops every branch behind it — including the
 * dynamic `import('./demo-data.js')` below, which is why `demo-pools.js` and its
 * fictional hostnames never reach `dist/renderer`. Anything that fabricates data must be
 * reached through this flag, never through a runtime check like `!window.aegis`: a
 * runtime check keeps the import reachable and the pools shipped.
 */
export const isDemoBuild: boolean = import.meta.env.VITE_DEMO_MODE === 'true';

/** True when the Electron preload bridge (`window.aegis`) is present. */
export const bridgeAvailable: boolean = !!window.aegis;

/**
 * True when no live IPC is available: a demo build, or any window without the preload
 * bridge. Kept as the gate for desktop-only actions (export buttons, audit log) — the
 * "Desktop app only" affordances it disables are exactly the ones that need the bridge.
 *
 * Broader than {@link isDemoBuild} on purpose, and no longer interchangeable with it: a
 * production build with no bridge lands here too, and that case must NOT be told it is a
 * demo. Read {@link isDemoBuild} when the question is "does this bundle carry simulated
 * data", {@link liveDataUnavailable} when it is "is this window dead".
 */
export const isDemoMode: boolean = isDemoBuild || !bridgeAvailable;

/**
 * True when a production build is running without the preload bridge — the case that
 * used to silently start the demo engine and fill the dashboard with fabricated agents.
 * Nothing is scanned and nothing is substituted; the UI states this outright
 * (App.svelte → BridgeUnavailableBanner).
 */
export const liveDataUnavailable: boolean = !isDemoBuild && !bridgeAvailable;

/**
 * True while the stores actually hold fabricated data — read off the payloads
 * themselves, not off {@link isDemoMode}.
 *
 * The distinction is the point. `isDemoMode` is decided once, at module evaluation,
 * from a build flag and the presence of `window.aegis`; it describes the BUILD. This
 * store describes the DATA, and only goes true because `demo-data.js` stamped its own
 * output (`DEMO_MARK`). A payload therefore carries its own provenance, which is what
 * makes "is this screen real?" answerable from a store value and assertable in a test.
 *
 * Reads the raw `agents` / `stats` stores, never `enrichedAgents`: risk enrichment
 * spreads records and the marker must not depend on that survival. `agents` is seeded
 * synchronously by the demo engine while `stats` lands a frame later, so checking both
 * leaves no window in which fabricated agents are on screen unmarked.
 */
export const demoDataActive: Readable<boolean> = derived(
  [agents, stats],
  ([$agents, $stats]) => $agents.some((a) => isDemoPayload(a)) || isDemoPayload($stats),
);

// The branch order matters, and the condition below is written as the raw literal
// comparison rather than `isDemoBuild` so the whole block is statically removable: it is
// what keeps `demo-data.js` (and the fabricated pools behind it) out of the default
// bundle. See {@link isDemoBuild}.
if (import.meta.env.VITE_DEMO_MODE === 'true') {
  // Demo build only. The engine seeds agents synchronously once loaded (≥2 every
  // scenario), so the live `populated` check drives the dashboard — no `firstScanDone`
  // latch needed. The import costs one microtask before the first paint of data, which
  // the demo's own 2s emitter delay already dwarfs.
  import('./demo-data.js').then(({ startDemoMode }) => {
    const cleanupDemo = startDemoMode({ agents, events, stats, network, anomalies, resourceUsage });
    if (import.meta.hot) {
      import.meta.hot.dispose(() => cleanupDemo());
    }
  });
} else if (bridgeAvailable) {
  // Primary path: coalesce all store updates into a single microtask
  // so Svelte batches DOM repaints instead of 4 separate cascades.
  window.aegis!.onScanBatch((data) => {
    queueMicrotask(() => {
      if (data.agents) agents.set(data.agents);
      if (data.stats) stats.set(data.stats);
      if (data.resourceUsage) resourceUsage.set(data.resourceUsage);
      if (data.anomalyScores) anomalies.set(data.anomalyScores);
      // Per-instance map rides the same batch; replace (not merge) so a dead instance
      // does not keep a stale score after it leaves the agent list.
      if (data.anomalyScoresByInstance) {
        anomaliesByInstance.set(data.anomalyScoresByInstance);
      }
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
  window.aegis!.onTokenCosts((data) => tokenCosts.set(Array.isArray(data) ? data : []));

  // Fetch initial data
  window.aegis!.getStats().then((data) => stats.set(data));
  window.aegis!.getResourceUsage().then((data) => resourceUsage.set(data));
  window.aegis!.getFalsePositives().then((data) => falsePositives.set(data || []));
}
// No third branch: a production build with no preload bridge wires nothing and seeds
// nothing. The stores stay empty and `liveDataUnavailable` is true — the UI says the
// monitor is not running rather than filling the screen with fabricated agents, which is
// what this branch used to do.
