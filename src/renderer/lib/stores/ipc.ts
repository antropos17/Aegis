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

/**
 * AEGIS's OWN main-process load, exactly as `getResourceUsage()` builds it
 * (src/main/main.js) — `process.memoryUsage()` / `process.cpuUsage()`. It says
 * nothing about the monitored agents.
 *
 * `cpuUser` / `cpuSystem` are CUMULATIVE microseconds since process start, not a
 * percentage: a reader has to difference two samples over elapsed time to get a
 * rate. That is what FooterMiniCharts does, and it is why the shape must not be
 * "cleaned up" into a percentage here — the delta needs the running totals.
 */
interface MonitorResourceUsage {
  /** Resident set size of the main process, MB. */
  readonly memMB: number;
  /** V8 `heapUsed` of the main process, MB. */
  readonly heapMB: number;
  /** Cumulative user CPU time since process start, microseconds. */
  readonly cpuUser: number;
  /** Cumulative system CPU time since process start, microseconds. */
  readonly cpuSystem: number;
}

/** Payload shape for the scan-batch IPC push channel */
interface ScanBatchData {
  readonly agents?: DetectedAgent[];
  readonly stats?: Record<string, unknown>;
  /** AEGIS's own load — see {@link MonitorResourceUsage}. Not the agents'. */
  readonly resourceUsage?: MonitorResourceUsage;
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

/**
 * One monitored agent's sampled load, pushed on the `agent-resource-usage` channel.
 * Mirrors `AgentResourceRecord` in the main process (resource-monitor.js).
 *
 * `instanceId` is the KEY and `pid` is display only — the OS reissues pids, so joining
 * on one can attribute a dead process's load to whatever wears its number next.
 *
 * Two different nulls, and they must not be conflated:
 * - `instanceId: null` — the sample could not be attributed to a keyed instance. Such
 *   a record keeps its own pid and stays individually distinguishable
 *   ({@link unattributedAgentResource}); it is never folded into a shared bucket.
 * - `cpu` / `memMb` / `gpu` null — the process WAS the subject of a sample and the
 *   figure could not be read (exited, denied, unparseable, or no nvidia-smi for gpu).
 *   That is "not measured", which is categorically different from a measured zero and
 *   must never be rendered as one.
 */
interface AgentResourceRecord {
  readonly instanceId: string | null;
  readonly pid: number;
  /** 0–100 % of the whole machine, or null when not sampled. */
  readonly cpu: number | null;
  /** Resident memory in MB, or null when not sampled. */
  readonly memMb: number | null;
  /** GPU memory, or null when nvidia-smi is absent — never a fabricated 0. */
  readonly gpu: { readonly memMb: number } | null;
}

/** Minimal type for the window.aegis IPC bridge exposed by preload.js */
interface AegisIpcBridge {
  onScanBatch(cb: (data: ScanBatchData) => void): void;
  onFileAccess(cb: (data: FileEvent | FileEvent[]) => void): void;
  onStatsUpdate(cb: (data: Record<string, unknown>) => void): void;
  onNetworkUpdate(cb: (data: NetworkConnection[]) => void): void;
  onScanStatus(cb: (data: ScanStatusData) => void): void;
  onTokenCosts(cb: (data: TokenCostRecord[]) => void): void;
  onAgentResourceUsage(cb: (data: AgentResourceRecord[]) => void): void;
  getStats(): Promise<Record<string, unknown>>;
  getAuditStats(): Promise<AuditStats>;
  getResourceUsage(): Promise<MonitorResourceUsage>;
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
/**
 * AEGIS's OWN process load — the figures the footer draws (HEAP, and CPU/MEM via
 * FooterMiniCharts). Filled from `scan-batch.resourceUsage` and the
 * `get-resource-usage` seed, both of which originate in `getResourceUsage()`
 * (src/main/main.js). `null` until the first payload lands.
 *
 * The name is deliberately NOT `resourceUsage` any more, and deliberately does not
 * match the wire: the IPC field stays `resourceUsage` and the invoke channel stays
 * `get-resource-usage`, because those names already mean "the app's own" on the main
 * side and renaming them would churn their tests for nothing. The asymmetry is the
 * price of making the RENDERER side unambiguous — a store called `resourceUsage`
 * sitting next to a channel then called `resource-usage` that carries the MONITORED
 * AGENTS' load is exactly how that channel went a release and a half with a bridge
 * method and no subscriber. That channel is now `agent-resource-usage` and lands in
 * {@link agentResourceUsage}; the two are no longer one rename away from each other.
 */
export const monitorResourceUsage: Writable<MonitorResourceUsage | null> = writable(null);
export const falsePositives: Writable<FalsePositiveEntry[]> = writable([]);
export const scanActive: Writable<boolean> = writable(false);

/** Per process-instance token + cost records, refreshed each scan via the `token-costs` push. */
export const tokenCosts: Writable<TokenCostRecord[]> = writable([]);

/**
 * The MONITORED AGENTS' load, exactly as `agent-resource-usage` delivered it — raw and
 * unindexed. Replaced (not merged) on every push, so a record cannot outlive the
 * instance it describes.
 *
 * An ARRAY rather than a keyed object, and that is the point: keying here would need a
 * single slot for every record whose `instanceId` is null, and all but the last would
 * vanish. Read {@link agentResourceByInstance} to look one up and
 * {@link unattributedAgentResource} for the ones that have no key.
 */
export const agentResourceUsage: Writable<AgentResourceRecord[]> = writable([]);

/**
 * Instance-keyed index over {@link agentResourceUsage} — the lookup a per-agent view
 * should use. Records with no `instanceId` are ABSENT here by construction; they are not
 * given a placeholder key, because a placeholder is a bucket and a bucket is how two
 * unrelated processes end up sharing a number.
 *
 * A missing key means "no sample for this instance", which the UI must render as absent
 * rather than as zero.
 */
export const agentResourceByInstance: Readable<Map<string, AgentResourceRecord>> = derived(
  agentResourceUsage,
  ($records) => {
    const byInstance = new Map<string, AgentResourceRecord>();
    for (const record of $records) {
      if (typeof record.instanceId === 'string' && record.instanceId !== '') {
        byInstance.set(record.instanceId, record);
      }
    }
    return byInstance;
  },
);

/**
 * Samples that arrived without an instance key, each keeping its own pid and staying
 * individually distinguishable. Kept as its own list so that "we sampled a process we
 * could not identify" stays visible instead of being silently dropped by the index
 * above — an unattributed measurement is data, not an error.
 */
export const unattributedAgentResource: Readable<AgentResourceRecord[]> = derived(
  agentResourceUsage,
  ($records) => $records.filter((record) => record.instanceId === null),
);

/**
 * True once the first scan batch has arrived from the main process. Monotonic
 * (only ever flips false→true). Lets the UI distinguish "first scan hasn't
 * landed yet" (show skeletons) from "scan ran and found zero agents" (show an
 * empty state) instead of latching on agent count, which left quiet machines
 * stuck on skeletons forever.
 */
export const firstScanDone: Writable<boolean> = writable(false);

/**
 * Canonical `instanceId` of the agent to highlight/scroll in AgentPanel
 * (Timeline dot click, stats row click). Auto-clears after scroll-into-view.
 * Never a pid — pid reuse must not transfer focus (IDENTITY-RECON §6 step 8).
 */
export const focusedAgentInstanceId: Writable<string | null> = writable(null);

/**
 * Canonical `instanceId` of the currently selected (expanded) agent card.
 * Persistent across the session — Command Palette kill/suspend resolve the live
 * agent by this key, then use that record's pid for the process action.
 * Distinct from {@link focusedAgentInstanceId}.
 */
export const selectedAgentInstanceId: Writable<string | null> = writable(null);

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
    const cleanupDemo = startDemoMode({
      agents,
      events,
      stats,
      network,
      anomalies,
      monitorResourceUsage,
    });
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
      if (data.resourceUsage) monitorResourceUsage.set(data.resourceUsage);
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
  // Replace, never merge: a record kept past its push would keep drawing a number for an
  // instance the monitor has stopped reporting.
  window.aegis!.onAgentResourceUsage((data) =>
    agentResourceUsage.set(Array.isArray(data) ? data : []),
  );

  // Fetch initial data
  window.aegis!.getStats().then((data) => stats.set(data));
  window.aegis!.getResourceUsage().then((data) => monitorResourceUsage.set(data));
  window.aegis!.getFalsePositives().then((data) => falsePositives.set(data || []));
}
// No third branch: a production build with no preload bridge wires nothing and seeds
// nothing. The stores stay empty and `liveDataUnavailable` is true — the UI says the
// monitor is not running rather than filling the screen with fabricated agents, which is
// what this branch used to do.
