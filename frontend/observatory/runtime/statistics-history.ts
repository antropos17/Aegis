import { observeResourceCollection, type CollectionRange } from './resource-observations';
import { instances, record, type Telemetry, type RecordData } from './host';
import { radarGroups } from './radar';
import { cpuPercent } from './resources';
import { measuredStatisticsTotal, type StatisticsCoverage } from './statistics-metrics';

export interface StatisticsSample {
  at: number;
  /** Missing key: no new measurement. Null: observed unavailability. */
  values: Record<string, number | null>;
  coverage?: Record<string, StatisticsCoverage>;
  boundary?: boolean;
  resourceCollection?: CollectionRange;
}
interface ScanBaseline {
  at: number;
  files: number;
  sensitive: number;
  session: unknown;
}
interface TokenBaseline {
  at: number;
  counters: Record<string, number>;
  session: unknown;
}
export interface StatisticsHistory {
  samples: StatisticsSample[];
  clocks: Record<string, number>;
  scan: ScanBaseline | null;
  tokens: TokenBaseline | null;
  own: { at: number; value: RecordData } | null;
  stale: boolean;
  population: string;
  resourceSequences: Record<string, number>;
  resourceUnattributedSequence: number;
  wallClock: number | null;
  ignoredClocks: Record<string, number>;
}
export const STATISTICS_HISTORY_LIMIT = 1000;
export const STATISTICS_HISTORY_MS = 300000;
/** Create source-specific clock state with no timers.
 * @returns Empty history @since 0.14.1
 */
export function createStatisticsHistory(): StatisticsHistory {
  return {
    samples: [],
    clocks: {},
    scan: null,
    tokens: null,
    own: null,
    stale: true,
    population: '',
    resourceSequences: {},
    resourceUnattributedSequence: 0,
    wallClock: null,
    ignoredClocks: {},
  };
}
/** Derive a monotonic counter rate between observations from the same source.
 * @param before Previous counter @param after New counter @param elapsed Milliseconds
 * @returns Per-minute rate or unavailable @since 0.14.1
 */
export function statisticsRate(before: unknown, after: unknown, elapsed: number): number | null {
  if (
    typeof before !== 'number' ||
    typeof after !== 'number' ||
    !Number.isFinite(before) ||
    !Number.isFinite(after) ||
    before < 0 ||
    after < before ||
    elapsed <= 0 ||
    !Number.isFinite(elapsed)
  )
    return null;
  const value = ((after - before) * 60000) / elapsed;
  return Number.isFinite(value) ? value : null;
}
function tokenRate(before: TokenBaseline | null, after: TokenBaseline): number | null {
  const ids = Object.keys(after.counters);
  if (
    !before ||
    before.session !== after.session ||
    !ids.length ||
    ids.length !== Object.keys(before.counters).length
  )
    return null;
  let rate = 0;
  for (const id of ids) {
    const delta = statisticsRate(before.counters[id], after.counters[id], after.at - before.at);
    if (delta === null) return null;
    rate += delta;
  }
  return Number.isFinite(rate) ? rate : null;
}
/** Observe each telemetry source only on its own receipt timestamp.
 * @param history Prior source clocks @param state Displayed telemetry @param interruptionAt Actual user pause time
 * @param observedAt Renderer observation time; a backwards clock change starts new history
 * @returns Sparse five-minute history; no interpolated points @since 0.14.1
 */
export function observeStatistics(
  history: StatisticsHistory,
  state: Telemetry,
  interruptionAt?: number,
  observedAt = Date.now(),
): StatisticsHistory {
  const wallClock = Number.isFinite(observedAt) ? observedAt : history.wallClock;
  const clockReset =
    wallClock !== null && history.wallClock !== null && wallClock < history.wallClock;
  if (clockReset) {
    history = {
      ...createStatisticsHistory(),
      stale: history.stale,
      ignoredClocks: { ...history.ignoredClocks, ...history.clocks },
      resourceSequences: history.resourceSequences,
      resourceUnattributedSequence: history.resourceUnattributedSequence,
    };
  }
  const next: StatisticsHistory = {
    ...history,
    clocks: { ...history.clocks },
    ignoredClocks: { ...history.ignoredClocks },
    wallClock,
  };
  const frames: StatisticsSample[] = [];
  let changed = clockReset;
  const session = state.stats.monitoringStarted;
  const coverage = ({ measured, total }: StatisticsCoverage): StatisticsCoverage => ({
    measured,
    total,
  });
  const fresh = (source: string, at: number | null | undefined): at is number => {
    if (Object.hasOwn(next.ignoredClocks, source) && next.ignoredClocks[source] === at)
      return false;
    delete next.ignoredClocks[source];
    if (!at || !Number.isFinite(at) || at <= (history.clocks[source] ?? 0)) return false;
    next.clocks[source] = at;
    changed = true;
    return true;
  };
  const emit = (
    at: number,
    values: StatisticsSample['values'],
    coverage?: StatisticsSample['coverage'],
    boundary = false,
  ): void => {
    frames.push({
      at,
      values,
      ...(coverage ? { coverage } : {}),
      ...(boundary ? { boundary } : {}),
    });
  };
  if (state.stale && !history.stale) {
    const at = interruptionAt ?? state.statsAt;
    if (at)
      emit(
        at,
        {
          cpu: null,
          memory: null,
          processes: null,
          products: null,
          risk: null,
          tokens: null,
          input: null,
          output: null,
          cost: null,
          tokenRate: null,
          fileRate: null,
          sensitiveRate: null,
        },
        undefined,
        true,
      );
    if (interruptionAt) {
      emit(
        interruptionAt,
        {
          ownCpu: null,
          ownMemory: null,
          ownHeap: null,
          connections: null,
          evictions: null,
        },
        undefined,
        true,
      );
      next.own = null;
    }
    next.scan = null;
    next.tokens = null;
  }
  next.stale = state.stale;
  if (fresh('scan', state.lastScan) && state.ready && !state.stale) {
    const at = state.lastScan;
    const agents = instances(state);
    const scan: ScanBaseline = {
      at,
      files: state.scanCounters?.files ?? state.events.length + state.evicted,
      sensitive:
        state.scanCounters?.sensitive ??
        state.events.filter((event) => event.sensitive === true).length + state.retainedEvicted,
      session,
    };
    const previous = next.scan?.session === session ? next.scan : null;
    emit(at, {
      processes: state.agents.length,
      products: radarGroups(agents).length,
      risk: agents.length ? Math.max(...agents.map((agent) => agent.riskScore)) : null,
      fileRate: previous ? statisticsRate(previous.files, scan.files, at - previous.at) : null,
      sensitiveRate: previous
        ? statisticsRate(previous.sensitive, scan.sensitive, at - previous.at)
        : null,
      evictions: state.scanCounters?.evicted ?? state.evicted,
    });
    next.scan = scan;
    const population = state.agents
      .map((agent) => agent.instanceId || 'unkeyed:' + agent.pid)
      .sort()
      .join('\n');
    if (history.population && history.population !== population) next.tokens = null;
    next.population = population;
  }
  const observed = observeResourceCollection(
    state,
    history.resourceSequences,
    history.resourceUnattributedSequence,
  );
  if (fresh('resources', state.resourcesAt) || observed.advanced) {
    changed = true;
    next.resourceSequences = observed.sequences;
    next.resourceUnattributedSequence =
      observed.unattributedSequence ?? history.resourceUnattributedSequence;
    if (observed.at !== null) {
      const cpu = measuredStatisticsTotal(state, observed.rows, 'cpu');
      const memory = measuredStatisticsTotal(state, observed.rows, 'memMb');
      frames.push({
        at: observed.at,
        values: { cpu: cpu.value, memory: memory.value },
        coverage: { cpu: coverage(cpu), memory: coverage(memory) },
        ...(observed.collection ? { resourceCollection: observed.collection } : {}),
      });
    }
  }
  if (fresh('tokens', state.tokensAt)) {
    const total = measuredStatisticsTotal(state, state.tokens, 'totalTokens');
    const input = measuredStatisticsTotal(state, state.tokens, 'inputTokens');
    const output = measuredStatisticsTotal(state, state.tokens, 'outputTokens');
    const cost = measuredStatisticsTotal(state, state.tokens, 'costUsd');
    const baseline: TokenBaseline = { at: state.tokensAt, counters: total.counters, session };
    emit(
      state.tokensAt,
      {
        tokens: total.value,
        input: input.value,
        output: output.value,
        cost: cost.value,
        tokenRate: state.stale ? null : tokenRate(next.tokens, baseline),
      },
      {
        tokens: coverage(total),
        input: coverage(input),
        output: coverage(output),
        cost: coverage(cost),
        tokenRate: coverage(total),
      },
    );
    next.tokens = state.stale ? null : baseline;
  }
  if (fresh('own', state.ownAt)) {
    const at = state.ownAt;
    const ownCpu = history.own
      ? cpuPercent(history.own.value, state.own, at - history.own.at)
      : null;
    const measured = (value: unknown): number | null =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
    emit(at, { ownCpu, ownMemory: measured(state.own.memMB), ownHeap: measured(state.own.heapMB) });
    next.own = { at, value: state.own };
  }
  if (fresh('network', state.networkAt)) {
    const network = record(record(record(record(state.stats.appHealth).sensors).byId).network);
    const available = !network.state || network.state === 'HEALTHY';
    emit(state.networkAt, { connections: available ? state.network.length : null });
  }
  if (!frames.length) return changed || next.stale !== history.stale ? next : history;
  const merged: StatisticsSample[] = [];
  for (const sample of [...history.samples, ...frames].sort((a, b) => a.at - b.at)) {
    const prior = merged.at(-1);
    if (prior?.at === sample.at && !!prior.boundary === !!sample.boundary) {
      merged[merged.length - 1] = {
        at: sample.at,
        values: { ...prior.values, ...sample.values },
        coverage: { ...prior.coverage, ...sample.coverage },
        ...(sample.resourceCollection || prior.resourceCollection
          ? { resourceCollection: sample.resourceCollection ?? prior.resourceCollection }
          : {}),
        ...(sample.boundary ? { boundary: true } : {}),
      };
    } else merged.push(sample);
  }
  const latest = merged.at(-1)!.at;
  next.samples = merged
    .filter((sample) => sample.at >= latest - STATISTICS_HISTORY_MS)
    .slice(-STATISTICS_HISTORY_LIMIT);
  return next;
}
/** Split graph paths at explicit unavailable values, ignoring unrelated source frames.
 * @param samples Timeline @param key Metric @param maximum Vertical scale
 * @returns SVG line paths @since 0.14.1
 */
export function statisticsPaths(
  samples: StatisticsSample[],
  key: string,
  maximum: number,
): string[] {
  const measured = samples.filter((sample) => Object.hasOwn(sample.values, key));
  if (!measured.length || !Number.isFinite(maximum) || maximum <= 0) return [];
  const start = measured[0].at,
    span = Math.max(1, measured.at(-1)!.at - start);
  const paths: string[] = [];
  let path = '';
  for (const sample of measured) {
    const value = sample.values[key];
    if (value === null || !Number.isFinite(value) || value < 0) {
      if (path) paths.push(path);
      path = '';
      continue;
    }
    const x = 2 + ((sample.at - start) / span) * 596;
    const y = 158 - Math.min(1, value / maximum) * 154;
    path += (path ? ' L ' : 'M ') + x.toFixed(2) + ' ' + y.toFixed(2);
  }
  if (path) paths.push(path);
  return paths;
}
