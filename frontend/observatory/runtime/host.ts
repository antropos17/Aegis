import { mergeResourceDelivery } from './resource-observations';
import type {
  DetectedAgent,
  FileEvent,
  NetworkConnection,
  FalsePositiveEntry,
} from '../../../src/shared/types';
import { enrichAgents } from '../../../src/renderer/lib/utils/enrich-agents';
import {
  appendWithRetention,
  fileEventRetain,
  EVENTS_CAPACITY,
} from '../../../src/renderer/lib/stores/events-retention';

export type RecordData = Record<string, unknown>;
export type Host = Record<string, (...args: never[]) => unknown>;
export type HostConnection = (() => void) & {
  refreshFalsePositives: () => Promise<void>;
  applySettings: (settings: unknown) => void;
};
export interface Telemetry {
  agents: DetectedAgent[];
  events: FileEvent[];
  network: NetworkConnection[];
  stats: RecordData;
  resources: RecordData[];
  tokens: RecordData[];
  resourcesAt: number | null;
  tokensAt: number | null;
  ownAt: number | null;
  networkAt: number | null;
  statsAt: number | null;
  scanCounters: { files: number; sensitive: number; evicted: number } | null;
  own: RecordData;
  anomalies: Record<string, number>;
  falsePositives: FalsePositiveEntry[];
  ready: boolean;
  stale: boolean;
  scanning: boolean;
  lastScan: number | null;
  evicted: number;
  retainedEvicted: number;
  error: string;
}

/** Narrow an IPC object without inventing absent fields. @param value Wire value @returns Object @since 0.14.1 */
export function record(value: unknown): RecordData {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordData)
    : {};
}
/** Read a finite measurement; absent is never zero. @param value Wire value @returns Measurement @since 0.14.1 */
export function measured(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
/** Read records from an IPC array. @param value Wire value @returns Records @since 0.14.1 */
export function records(value: unknown): RecordData[] {
  return Array.isArray(value) ? value.map(record) : [];
}
/** Invoke an available host capability. @param host Preload @param method Capability @param args Payload @returns Wire result @since 0.14.1 */
export async function invoke(
  host: Host | null,
  method: string,
  ...args: unknown[]
): Promise<unknown> {
  if (!host || typeof host[method] !== 'function')
    throw new Error(`${method} is unavailable in this runtime`);
  return Reflect.apply(host[method], host, args);
}
/** Require a confirmed command result. @param value Host reply @returns Reply @since 0.14.1 */
export function confirmed(value: unknown): RecordData {
  const result = record(value);
  if (result.success !== true)
    throw new Error(
      typeof result.error === 'string' ? result.error : 'Operation cancelled or not completed',
    );
  return result;
}
/** Construct an empty, explicitly unobserved state. @returns Telemetry @since 0.14.1 */
export function emptyTelemetry(): Telemetry {
  return {
    agents: [],
    events: [],
    network: [],
    stats: {},
    resources: [],
    tokens: [],
    resourcesAt: null,
    tokensAt: null,
    ownAt: null,
    networkAt: null,
    statsAt: null,
    scanCounters: null,
    own: {},
    anomalies: {},
    falsePositives: [],
    ready: false,
    stale: true,
    scanning: false,
    lastScan: null,
    evicted: 0,
    retainedEvicted: 0,
    error: '',
  };
}
/** Share the existing exposure computation. @param state Telemetry @returns Enriched instances @since 0.14.1 */
export function instances(state: Telemetry) {
  return enrichAgents(
    state.agents,
    state.events,
    state.anomalies,
    state.network,
    state.falsePositives,
  );
}
/** Re-resolve a process immediately before dispatch, including after confirmation. @param state Latest telemetry @param id Stamped identity @returns Live process @since 0.14.1 */
export function actionTarget(state: Telemetry, id: string) {
  const agent = state.agents.find((a) => a.instanceId === id);
  if (
    state.stale ||
    !agent ||
    !Number.isInteger(agent.pid) ||
    agent.pid <= 0 ||
    agent.instanceIdSource !== 'os' ||
    agent.discoveryObservation?.stale
  ) {
    throw new Error('This process instance is no longer reliably observed. Wait for a fresh scan.');
  }
  return agent;
}
/** Subscribe once; protect newer pushes from seed replies and dispose every listener.
 * @param host Preload bridge @param publish State consumer @returns Teardown @since 0.14.1
 */
export function connectHost(
  host: Host | null,
  publish: (state: Telemetry) => void,
): HostConnection {
  let state = emptyTelemetry();
  let alive = true;
  const cleanups: (() => void)[] = [];
  const revisions = new Map<string, number>();
  let staleAfterMs = 30000;
  const applySettings = (settings: unknown): void => {
    const interval = measured(record(settings).scanIntervalSec);
    if (!alive || interval === null || interval <= 0) return;
    revisions.set('settings', (revisions.get('settings') ?? 0) + 1);
    staleAfterMs = Math.max(30000, interval * 2000 + 10000);
  };
  const update = (patch: Partial<Telemetry>) => {
    if (alive) {
      state = { ...state, ...patch };
      publish(state);
    }
  };
  const fail = (error: unknown) =>
    update({ error: error instanceof Error ? error.message : String(error) });
  const subscribe = (method: string, cb: (data: unknown) => void) => {
    if (typeof host?.[method] !== 'function') {
      fail(new Error(`Missing capability: ${method}`));
      return;
    }
    const cleanup = Reflect.apply(host[method], host, [
      (data: unknown) => {
        if (!alive) return;
        revisions.set(method, (revisions.get(method) ?? 0) + 1);
        cb(data);
      },
    ]);
    if (typeof cleanup === 'function') cleanups.push(cleanup as () => void);
  };
  const healthStale = (stats: RecordData) => {
    const health = record(stats.appHealth);
    const gap = record(stats.observationGap);
    return (
      health.populationReliable !== true ||
      health.identityDegraded === true ||
      stats.monitoringPaused === true ||
      gap.state === 'SUSPENDED' ||
      gap.state === 'RESUMED'
    );
  };
  const applyStats = (value: unknown) => {
    const stats = record(value);
    update({
      stats,
      statsAt: Date.now(),
      stale:
        healthStale(stats) ||
        (state.lastScan !== null && Date.now() - state.lastScan > staleAfterMs),
    });
  };
  const refreshFalsePositives = async (): Promise<void> => {
    const ticket = (revisions.get('fp') ?? 0) + 1;
    revisions.set('fp', ticket);
    const value = await invoke(host, 'getFalsePositives');
    if (ticket === revisions.get('fp'))
      update({ falsePositives: Array.isArray(value) ? (value as FalsePositiveEntry[]) : [] });
  };
  publish(state);
  if (!host) {
    update({ error: 'Desktop bridge unavailable. Monitoring data cannot be loaded.' });
    return Object.assign(
      () => {
        alive = false;
      },
      { refreshFalsePositives, applySettings },
    );
  }
  subscribe('onScanBatch', (value) => {
    const batch = record(value);
    // A stats push and a scan batch supersede the same seed request.
    revisions.set('onStatsUpdate', (revisions.get('onStatsUpdate') ?? 0) + 1);
    if (batch.stats) applyStats(batch.stats);
    const reliable = !healthStale(state.stats);
    const patch: Partial<Telemetry> = {};
    if (Array.isArray(batch.agents) && reliable) {
      patch.agents = batch.agents as DetectedAgent[];
      patch.ready = true;
      patch.stale = false;
      patch.lastScan = Date.now();
      patch.scanCounters = {
        files: state.events.length + state.evicted,
        sensitive:
          state.events.filter((event) => event.sensitive === true).length + state.retainedEvicted,
        evicted: state.evicted,
      };
      patch.error = '';
    }
    if (batch.resourceUsage) {
      patch.own = record(batch.resourceUsage);
      patch.ownAt = Date.now();
      revisions.set('own', (revisions.get('own') ?? 0) + 1);
    }
    if (batch.anomalyScoresByInstance && reliable)
      patch.anomalies = record(batch.anomalyScoresByInstance) as Record<string, number>;
    update(patch);
  });
  subscribe('onStatsUpdate', applyStats);
  subscribe('onFileAccess', (value) => {
    const incoming = (Array.isArray(value) ? value : [value]) as FileEvent[];
    const result = appendWithRetention(state.events, incoming, EVENTS_CAPACITY, fileEventRetain);
    update({
      events: result.next,
      evicted: state.evicted + result.evicted,
      retainedEvicted: state.retainedEvicted + result.retainedEvicted,
    });
  });
  subscribe('onNetworkUpdate', (value) =>
    update({
      network: Array.isArray(value) ? (value as NetworkConnection[]) : [],
      networkAt: Date.now(),
    }),
  );
  subscribe('onScanStatus', (value) => update({ scanning: record(value).scanning === true }));
  subscribe('onAgentResourceUsage', (value) =>
    update({
      resources: mergeResourceDelivery(state.resources, records(value)),
      resourcesAt: Date.now(),
    }),
  );
  subscribe('onTokenCosts', (value) => update({ tokens: records(value), tokensAt: Date.now() }));
  const seed = (method: string, revision: string, apply: (value: unknown) => void) => {
    const before = revisions.get(revision) ?? 0;
    invoke(host, method)
      .then((value) => {
        if (alive && (revisions.get(revision) ?? 0) === before) apply(value);
      })
      .catch((error: unknown) => {
        if (alive && (revisions.get(revision) ?? 0) === before) fail(error);
      });
  };
  seed('getStats', 'onStatsUpdate', applyStats);
  seed('getResourceUsage', 'own', (value) => update({ own: record(value), ownAt: Date.now() }));
  seed('getFalsePositives', 'fp', (value) =>
    update({ falsePositives: Array.isArray(value) ? (value as FalsePositiveEntry[]) : [] }),
  );
  if (host.getSettings) seed('getSettings', 'settings', applySettings);
  const watchdog = setInterval(() => {
    if (state.lastScan !== null && !state.stale && Date.now() - state.lastScan > staleAfterMs) {
      update({
        stale: true,
        statsAt: Date.now(),
        error: 'No fresh process snapshot has arrived. Last observations are retained.',
      });
    }
  }, 1000);
  return Object.assign(
    () => {
      alive = false;
      clearInterval(watchdog);
      for (const cleanup of cleanups) cleanup();
    },
    { refreshFalsePositives, applySettings },
  );
}
