import { mergeResourceDelivery } from './resource-observations';
import { falsePositivePopulation } from './false-positive-population';
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
  tokenCollection: RecordData[];
  resourcesAt: number | null;
  tokensAt: number | null;
  ownAt: number | null;
  networkAt: number | null;
  networkCurrent: boolean;
  statsAt: number | null;
  monitoringPauseConfirmed: boolean;
  projectCoverageCurrent: boolean;
  projectCoverageGeneration: string | null;
  projectCoverageState: string | null;
  scanCounters: { files: number; sensitive: number; evicted: number } | null;
  own: RecordData;
  anomalies: Record<string, number>;
  falsePositives: FalsePositiveEntry[];
  falsePositiveReadState: 'pending' | 'ready' | 'unavailable';
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
/** Check the network sensor, including explicitly marked preview data.
 * @param stats Host statistics @returns Whether network observation is healthy @since 0.16.0
 */
export function networkSensorHealthy(stats: RecordData): boolean {
  const byId = record(record(record(stats.appHealth).sensors).byId);
  const state = record(byId.network).state;
  return (
    state === 'HEALTHY' ||
    ((state === undefined || state === 'SIMULATED') && record(byId.preview).state === 'SIMULATED')
  );
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
    tokenCollection: [],
    resourcesAt: null,
    tokensAt: null,
    ownAt: null,
    networkAt: null,
    networkCurrent: false,
    statsAt: null,
    monitoringPauseConfirmed: false,
    projectCoverageCurrent: false,
    projectCoverageGeneration: null,
    projectCoverageState: null,
    scanCounters: null,
    own: {},
    anomalies: {},
    falsePositives: [],
    falsePositiveReadState: 'pending',
    ready: false,
    stale: true,
    scanning: false,
    lastScan: null,
    evicted: 0,
    retainedEvicted: 0,
    error: '',
  };
}
// Snapshot keys are weak: a closed view does not retain earlier observations or assessments.
type Assessment = Pick<
  Telemetry,
  'agents' | 'events' | 'anomalies' | 'network' | 'falsePositives'
> & {
  rows: ReturnType<typeof enrichAgents>;
};
const assessments = new WeakMap<Telemetry, Assessment>();
/** Share one assessment across consumers of an immutable telemetry snapshot.
 * A new delivery recomputes time decay; a held snapshot keeps its captured assessment.
 * @param state Telemetry snapshot @returns Shared enriched instances @since 0.14.1
 */
export function instances(state: Telemetry) {
  const { agents, events, anomalies, network, falsePositives } = state;
  let cached = assessments.get(state);
  if (
    !cached ||
    cached.agents !== agents ||
    cached.events !== events ||
    cached.anomalies !== anomalies ||
    cached.network !== network ||
    cached.falsePositives !== falsePositives
  ) {
    cached = {
      agents,
      events,
      anomalies,
      network,
      falsePositives,
      rows: enrichAgents(agents, events, anomalies, network, falsePositives),
    };
    assessments.set(state, cached);
  }
  return cached.rows;
}
type ActionableAgent = DetectedAgent & {
  instanceId: string;
  generationWitness: string;
  generationWitnessSource: NonNullable<DetectedAgent['generationWitnessSource']>;
};
/** Re-resolve a process immediately before dispatch, including after confirmation. @param state Latest telemetry @param id Stamped identity @returns Live process @since 0.14.1 */
export function actionTarget(state: Telemetry, id: string): ActionableAgent {
  const agent = state.agents.find((a) => a.instanceId === id);
  if (
    state.stale ||
    !agent ||
    !Number.isInteger(agent.pid) ||
    agent.pid <= 0 ||
    agent.instanceIdSource !== 'os' ||
    agent.discoveryObservation?.stale ||
    typeof agent.generationWitness !== 'string' ||
    !agent.generationWitness ||
    typeof agent.generationWitnessSource !== 'string' ||
    !['sequence', 'createTime100ns', 'linuxStartTicks'].includes(agent.generationWitnessSource)
  ) {
    throw new Error('This process instance is no longer reliably observed. Wait for a fresh scan.');
  }
  return agent as ActionableAgent;
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
  let lastBatchMaxGapMs = 0;
  const freshnessLimit = (): number => Math.max(staleAfterMs, lastBatchMaxGapMs + 10000);
  const applySettings = (settings: unknown): void => {
    const interval = measured(record(settings).scanIntervalSec);
    if (!alive || interval === null || interval <= 0) return;
    revisions.set('settings', (revisions.get('settings') ?? 0) + 1);
    staleAfterMs = Math.max(30000, interval * 2000 + 10000);
  };
  const update = (patch: Partial<Telemetry>) => {
    if (alive) {
      const next = { ...state, ...patch };
      if (
        (!state.stale && next.stale) ||
        (networkSensorHealthy(state.stats) && !networkSensorHealthy(next.stats))
      )
        next.networkCurrent = false;
      state = next;
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
  const projectHealthCurrent = (stats: RecordData): boolean => {
    const health = record(stats.appHealth);
    return (
      stats.monitoringPaused === false &&
      health.populationReliable === true &&
      health.identityDegraded === false &&
      record(stats.observationGap).state === 'NONE'
    );
  };
  let pauseRevision = 0;
  let pauseRequestPending = false;
  let lastPauseRequestAt: number | null = null;
  let pauseConfirmedUntil = 0;
  let pauseConfirmedAt = 0;
  let pauseConfirmedGeneration: string | null = null;
  let pauseDeadline: ReturnType<typeof setTimeout> | null = null;
  let pauseTrailing: ReturnType<typeof setTimeout> | null = null;
  let pauseTrailingAt = 0;
  const generation = (stats: RecordData): string | null =>
    typeof stats.monitoringGeneration === 'string' &&
    /^(0|[1-9][0-9]{0,39})$/.test(stats.monitoringGeneration)
      ? stats.monitoringGeneration
      : null;
  let newestGeneration: string | null = null;
  let newestPopulationRevision: string | null = null;
  let projectConfirmedUntil = 0;
  let projectConfirmedAt = 0;
  let coverageCandidate: { generation: string; revision: string; received: number } | null = null;
  const populationRevision = (stats: RecordData): string | null =>
    typeof stats.monitoringPopulationRevision === 'string' &&
    /^(0|[1-9][0-9]{0,39})$/.test(stats.monitoringPopulationRevision)
      ? stats.monitoringPopulationRevision
      : null;
  const projectProofFresh = (): boolean => {
    const now = performance.now();
    return projectConfirmedUntil > 0 && now >= projectConfirmedAt && now < projectConfirmedUntil;
  };
  const projectState = (stats: RecordData): string | null => {
    const value = record(record(stats.appHealth).watchPlan).projectState;
    return typeof value === 'string' &&
      ['observed', 'not-observed', 'starting', 'unavailable', 'unknown'].includes(value)
      ? value
      : null;
  };
  const generationIsOlder = (value: string): boolean =>
    newestGeneration !== null &&
    (value.length < newestGeneration.length ||
      (value.length === newestGeneration.length && value < newestGeneration));
  const observeGeneration = (value: string | null): boolean => {
    if (value === null || generationIsOlder(value)) return false;
    newestGeneration = value;
    return true;
  };
  const applyStats = (value: unknown): boolean => {
    const stats = record(value);
    pauseRevision++;
    const statsGeneration = generation(stats);
    if (statsGeneration !== null && generationIsOlder(statsGeneration)) return false;
    observeGeneration(statsGeneration);
    if (stats.monitoringPaused !== true || generation(stats) !== pauseConfirmedGeneration)
      pauseConfirmedUntil = 0;
    update({
      stats,
      monitoringPauseConfirmed:
        stats.monitoringPaused === true &&
        generation(stats) !== null &&
        generation(stats) === pauseConfirmedGeneration &&
        state.monitoringPauseConfirmed,
      projectCoverageCurrent:
        projectHealthCurrent(stats) &&
        generation(stats) !== null &&
        generation(stats) === state.projectCoverageGeneration &&
        stats.monitoringPopulationReady === true &&
        projectProofFresh() &&
        projectState(stats) !== null &&
        projectState(stats) === state.projectCoverageState &&
        state.projectCoverageCurrent,
      statsAt: Date.now(),
      stale:
        state.stale ||
        healthStale(stats) ||
        (state.lastScan !== null && Date.now() - state.lastScan > freshnessLimit()),
    });
    return true;
  };
  // get-stats is evaluated by main for each request. Limit the request lifetime and
  // retain at most one outstanding invocation even if the bridge stops responding.
  const confirmPause = (urgent = false): void => {
    if (!alive || pauseRequestPending) return;
    const started = performance.now();
    const minimum = urgent ? 2000 : 20000;
    if (
      lastPauseRequestAt !== null &&
      started >= lastPauseRequestAt &&
      started - lastPauseRequestAt < minimum
    ) {
      const deadline = lastPauseRequestAt + minimum;
      if (pauseTrailing === null || deadline < pauseTrailingAt) {
        if (pauseTrailing !== null) clearTimeout(pauseTrailing);
        pauseTrailingAt = deadline;
        pauseTrailing = setTimeout(() => {
          pauseTrailing = null;
          pauseTrailingAt = 0;
          confirmPause(urgent);
        }, deadline - started);
      }
      return;
    }
    if (lastPauseRequestAt !== null && started < lastPauseRequestAt) {
      update({ monitoringPauseConfirmed: false, projectCoverageCurrent: false });
      return;
    }
    lastPauseRequestAt = started;
    pauseRequestPending = true;
    const revision = pauseRevision;
    let expired = false;
    pauseDeadline = setTimeout(() => {
      expired = true;
      pauseConfirmedUntil = 0;
      update({ monitoringPauseConfirmed: false, projectCoverageCurrent: false });
    }, 5000);
    invoke(host, 'getStats')
      .then((value) => {
        if (!alive || expired) return;
        const elapsed = performance.now() - started;
        if (elapsed < 0 || elapsed >= 5000) {
          pauseConfirmedUntil = 0;
          update({ monitoringPauseConfirmed: false, projectCoverageCurrent: false });
          return;
        }
        if (revision !== pauseRevision) {
          update({ monitoringPauseConfirmed: false, projectCoverageCurrent: false });
          return;
        }
        const fresh = record(value);
        const paused = fresh.monitoringPaused;
        const liveHealth = record(fresh.appHealth);
        const liveGap = record(fresh.observationGap).state;
        if (
          typeof paused !== 'boolean' ||
          !observeGeneration(generation(fresh)) ||
          typeof liveHealth.populationReliable !== 'boolean' ||
          typeof liveHealth.identityDegraded !== 'boolean' ||
          typeof liveGap !== 'string' ||
          !['NONE', 'SUSPENDED', 'RESUMED'].includes(liveGap)
        ) {
          pauseConfirmedUntil = 0;
          update({ monitoringPauseConfirmed: false, projectCoverageCurrent: false });
          return;
        }
        const age = fresh.monitoringPopulationAgeMs;
        const validAge = typeof age === 'number' && Number.isFinite(age) && age >= 0;
        const budget = validAge ? freshnessLimit() - age - elapsed : 0;
        const stateFromMain = projectState(fresh);
        projectConfirmedAt = performance.now();
        projectConfirmedUntil = budget > 0 ? projectConfirmedAt + Math.min(30000, budget) : 0;
        pauseConfirmedAt = started;
        pauseConfirmedUntil = paused ? started + 30000 : 0;
        pauseConfirmedGeneration = paused ? generation(fresh) : null;
        update({
          monitoringPauseConfirmed: paused,
          stale: paused || state.stale || state.stats.monitoringPaused === true,
          projectCoverageCurrent:
            !paused &&
            projectHealthCurrent(fresh) &&
            fresh.monitoringPopulationReady === true &&
            coverageCandidate !== null &&
            generation(fresh) === coverageCandidate.generation &&
            populationRevision(fresh) === coverageCandidate.revision &&
            stateFromMain !== null &&
            projectProofFresh(),
          projectCoverageState: stateFromMain,
          stats: { ...state.stats, monitoringPaused: paused },
        });
      })
      .catch(() => {
        if (alive) {
          pauseConfirmedUntil = 0;
          update({ monitoringPauseConfirmed: false, projectCoverageCurrent: false });
        }
      })
      .finally(() => {
        if (pauseDeadline !== null) clearTimeout(pauseDeadline);
        pauseDeadline = null;
        pauseRequestPending = false;
        if (alive && revision !== pauseRevision) confirmPause(true);
      });
  };
  const refreshFalsePositives = async (): Promise<void> => {
    const ticket = (revisions.get('fp') ?? 0) + 1;
    revisions.set('fp', ticket);
    update({ falsePositiveReadState: 'pending' });
    try {
      const value = falsePositivePopulation(await invoke(host, 'getFalsePositives'));
      if (ticket === revisions.get('fp'))
        update({ falsePositives: value, falsePositiveReadState: 'ready' });
    } catch (error) {
      if (ticket === revisions.get('fp')) update({ falsePositiveReadState: 'unavailable' });
      throw error;
    }
  };
  publish(state);
  if (!host) {
    update({
      error: 'Desktop bridge unavailable. Monitoring data cannot be loaded.',
      falsePositiveReadState: 'unavailable',
    });
    return Object.assign(
      () => {
        alive = false;
      },
      { refreshFalsePositives, applySettings },
    );
  }
  subscribe('onScanBatch', (value) => {
    const batch = record(value);
    const previouslyCurrent = state.projectCoverageCurrent && projectProofFresh();
    const previousGeneration = state.projectCoverageGeneration;
    const incomingStats = record(batch.stats);
    const incomingRevision = populationRevision(incomingStats);
    if (
      batch.populationCurrent === true &&
      incomingRevision !== null &&
      newestPopulationRevision !== null &&
      (incomingRevision.length < newestPopulationRevision.length ||
        (incomingRevision.length === newestPopulationRevision.length &&
          incomingRevision <= newestPopulationRevision))
    )
      return;
    // A stats push and a scan batch supersede the same seed request.
    revisions.set('onStatsUpdate', (revisions.get('onStatsUpdate') ?? 0) + 1);
    if (batch.stats) {
      if (!applyStats(batch.stats)) return;
      if (record(batch.stats).monitoringPaused === true) confirmPause(true);
    }
    const batchStats = record(batch.stats);
    const reliable = !healthStale(batchStats);
    if (!batch.stats || !Object.keys(batchStats).length) {
      pauseConfirmedUntil = 0;
      pauseRevision++;
      update({ stale: true, monitoringPauseConfirmed: false, projectCoverageCurrent: false });
    }
    const patch: Partial<Telemetry> = {};
    if (!Array.isArray(batch.agents) || !reliable) coverageCandidate = null;
    if (Array.isArray(batch.agents) && reliable) {
      // Only a reliable population can bind a new schedule to its receipt time.
      // Warmup and the transition to steady polling have longer planned gaps.
      const gap = measured(record(record(batch.stats).scanCadence).maxProcessGapMs);
      lastBatchMaxGapMs = gap !== null && gap > 0 ? gap : 0;
      patch.agents = batch.agents as DetectedAgent[];
      patch.ready = true;
      patch.stale = false;
      patch.projectCoverageGeneration = generation(batchStats);
      const revision = populationRevision(batchStats);
      coverageCandidate =
        batch.populationCurrent === true &&
        batchStats.monitoringPopulationReady === true &&
        projectHealthCurrent(batchStats) &&
        patch.projectCoverageGeneration !== null &&
        revision !== null
          ? { generation: patch.projectCoverageGeneration, revision, received: performance.now() }
          : null;
      if (coverageCandidate) newestPopulationRevision = coverageCandidate.revision;
      patch.projectCoverageCurrent =
        previouslyCurrent &&
        coverageCandidate !== null &&
        coverageCandidate.generation === previousGeneration &&
        projectState(batchStats) !== null &&
        projectState(batchStats) === state.projectCoverageState;
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
    if (coverageCandidate !== null && reliable && !patch.projectCoverageCurrent) confirmPause(true);
  });
  subscribe('onStatsUpdate', (value) => {
    const previousPause = state.stats.monitoringPaused;
    applyStats(value);
    if (record(value).monitoringPaused !== previousPause) confirmPause(true);
  });
  subscribe('onFileAccess', (value) => {
    const incoming = (Array.isArray(value) ? value : [value]) as FileEvent[];
    const result = appendWithRetention(state.events, incoming, EVENTS_CAPACITY, fileEventRetain);
    update({
      events: result.next,
      evicted: state.evicted + result.evicted,
      retainedEvicted: state.retainedEvicted + result.retainedEvicted,
    });
  });
  subscribe('onNetworkUpdate', (value) => {
    if (!Array.isArray(value)) return;
    update({
      network: value as NetworkConnection[],
      networkAt: Date.now(),
      networkCurrent: state.stats.monitoringPaused !== true,
    });
  });
  subscribe('onScanStatus', (value) => update({ scanning: record(value).scanning === true }));
  subscribe('onAgentResourceUsage', (value) =>
    update({
      resources: mergeResourceDelivery(state.resources, records(value)),
      resourcesAt: Date.now(),
    }),
  );
  subscribe('onTokenCosts', (value) => {
    const delivery = record(value);
    update({
      tokens: records(Array.isArray(value) ? value : delivery.records),
      tokenCollection: records(delivery.collection),
      tokensAt: Date.now(),
    });
  });
  const seed = (
    method: string,
    revision: string,
    apply: (value: unknown) => void,
    rejected?: () => void,
  ) => {
    const before = revisions.get(revision) ?? 0;
    invoke(host, method)
      .then((value) => {
        if (alive && (revisions.get(revision) ?? 0) === before) apply(value);
      })
      .catch((error: unknown) => {
        if (alive && (revisions.get(revision) ?? 0) === before) {
          rejected?.();
          fail(error);
        }
      });
  };
  seed('getStats', 'onStatsUpdate', (value) => {
    applyStats(value);
    if (record(value).monitoringPaused === true) confirmPause(true);
  });
  seed('getResourceUsage', 'own', (value) => update({ own: record(value), ownAt: Date.now() }));
  seed(
    'getFalsePositives',
    'fp',
    (value) =>
      update({ falsePositives: falsePositivePopulation(value), falsePositiveReadState: 'ready' }),
    () => update({ falsePositiveReadState: 'unavailable' }),
  );
  if (host.getSettings) seed('getSettings', 'settings', applySettings);
  const watchdog = setInterval(() => {
    if (state.projectCoverageCurrent && !projectProofFresh())
      update({ projectCoverageCurrent: false });
    if (
      state.monitoringPauseConfirmed &&
      (performance.now() < pauseConfirmedAt || performance.now() >= pauseConfirmedUntil)
    ) {
      pauseConfirmedUntil = 0;
      update({ monitoringPauseConfirmed: false, projectCoverageCurrent: false });
    }
    if (state.lastScan !== null && !state.stale && Date.now() - state.lastScan > freshnessLimit()) {
      update({
        stale: true,
        statsAt: Date.now(),
        error: 'No fresh process snapshot has arrived. Last observations are retained.',
      });
    }
  }, 1000);
  const pausePoll = setInterval(confirmPause, 20000);
  return Object.assign(
    () => {
      alive = false;
      clearInterval(watchdog);
      clearInterval(pausePoll);
      if (pauseDeadline !== null) clearTimeout(pauseDeadline);
      if (pauseTrailing !== null) clearTimeout(pauseTrailing);
      for (const cleanup of cleanups) cleanup();
    },
    { refreshFalsePositives, applySettings },
  );
}
