import { instances, measured, record, type Telemetry } from './host';
import { radarGroups } from './radar';
import { cpuPercent } from './resources';
import { completeStatisticsTotal } from './statistics-metrics';

export interface StatisticsSample {
  at: number;
  values: Record<string, number | null>;
}
export interface StatisticsHistory {
  samples: StatisticsSample[];
  previous: Telemetry | null;
  ownAt: number | null;
  ownCpu: number | null;
  interrupted: boolean;
}
export const STATISTICS_HISTORY_LIMIT = 120;
/** Create an isolated bounded history; no background timer or subscription is required.
 * @returns Empty history @since 0.14.1
 */
export function createStatisticsHistory(): StatisticsHistory {
  return { samples: [], previous: null, ownAt: null, ownCpu: null, interrupted: false };
}
/** Derive a monotonic counter rate; missing/reset counters are not zero activity.
 * @param before Previous counter @param after New counter @param elapsed Elapsed milliseconds
 * @returns Per-minute rate or unavailable @since 0.14.1
 */
export function statisticsRate(before: unknown, after: unknown, elapsed: number): number | null {
  const a = measured(before),
    b = measured(after);
  const value =
    a === null || b === null || a < 0 || b < a || elapsed <= 0 || !Number.isFinite(elapsed)
      ? null
      : ((b - a) * 60000) / elapsed;
  return value !== null && Number.isFinite(value) ? value : null;
}
/** Append one observed scan/resource revision and leave identical or paused snapshots unchanged.
 * @param history Previous local history @param state Displayed telemetry
 * @returns Next bounded history @since 0.14.1
 */
export function observeStatistics(history: StatisticsHistory, state: Telemetry): StatisticsHistory {
  if (state.stale || !state.ready)
    return history.interrupted ? history : { ...history, interrupted: true };
  const at = Math.max(state.lastScan ?? 0, state.resourcesAt ?? 0);
  const last = history.samples.at(-1);
  if (!at || (last && at <= last.at)) return history;
  const previous = history.previous;
  const elapsed = last ? at - last.at : 0;
  const continuous =
    !!previous &&
    !history.interrupted &&
    elapsed > 0 &&
    elapsed <= 30000 &&
    previous.stats.monitoringStarted === state.stats.monitoringStarted;
  const resourceFresh = state.resourcesAt !== null && at - state.resourcesAt <= 30000;
  const agents = instances(state);
  const networkHealth = record(record(record(record(state.stats.appHealth).sensors).byId).network);
  const ownChanged = !previous || state.own !== previous.own;
  const ownAt = ownChanged ? state.lastScan : history.ownAt;
  const ownCpu = ownChanged
    ? continuous && history.ownAt && ownAt && previous
      ? cpuPercent(previous.own, state.own, ownAt - history.ownAt)
      : null
    : history.ownCpu;
  const samePopulation =
    !!previous &&
    previous.agents.length === state.agents.length &&
    state.agents.every(
      (a) => a.instanceId && previous.agents.some((p) => p.instanceId === a.instanceId),
    );
  const tokens = completeStatisticsTotal(state, state.tokens, 'totalTokens');
  const tokenCountersContinuous =
    samePopulation &&
    previous &&
    state.agents.every((agent) => {
      const old = previous.tokens.find((t) => t.instanceId === agent.instanceId);
      const current = state.tokens.find((t) => t.instanceId === agent.instanceId);
      return statisticsRate(old?.totalTokens, current?.totalTokens, elapsed) !== null;
    });
  const values: StatisticsSample['values'] = {
    cpu: resourceFresh ? completeStatisticsTotal(state, state.resources, 'cpu') : null,
    memory: resourceFresh ? completeStatisticsTotal(state, state.resources, 'memMb') : null,
    processes: state.agents.length,
    products: radarGroups(agents).length,
    connections:
      networkHealth.state && networkHealth.state !== 'HEALTHY'
        ? null
        : state.network.length || networkHealth.state === 'HEALTHY'
          ? state.network.length
          : null,
    fileRate:
      continuous && previous
        ? statisticsRate(
            previous.events.length + previous.evicted,
            state.events.length + state.evicted,
            elapsed,
          )
        : null,
    sensitiveRate:
      continuous && previous
        ? statisticsRate(
            previous.events.filter((event) => event.sensitive === true).length +
              previous.retainedEvicted,
            state.events.filter((event) => event.sensitive === true).length + state.retainedEvicted,
            elapsed,
          )
        : null,
    risk: agents.length ? Math.max(...agents.map((a) => a.riskScore)) : null,
    tokens,
    input: completeStatisticsTotal(state, state.tokens, 'inputTokens'),
    output: completeStatisticsTotal(state, state.tokens, 'outputTokens'),
    tokenRate:
      continuous && tokenCountersContinuous && previous
        ? statisticsRate(
            completeStatisticsTotal(previous, previous.tokens, 'totalTokens'),
            tokens,
            elapsed,
          )
        : null,
    cost: completeStatisticsTotal(state, state.tokens, 'costUsd'),
    ownCpu,
    ownMemory: measured(state.own.memMB),
    ownHeap: measured(state.own.heapMB),
    evictions: state.evicted,
  };
  const gap: StatisticsSample[] =
    last && (!continuous || elapsed > 30000) ? [{ at: at - 1, values: {} }] : [];
  return {
    samples: [...history.samples, ...gap, { at, values }].slice(-STATISTICS_HISTORY_LIMIT),
    previous: state,
    ownAt,
    ownCpu,
    interrupted: false,
  };
}
/** Split graph paths at unavailable samples and preserve actual elapsed spacing.
 * @param samples Timeline @param key Metric @param maximum Vertical scale
 * @returns SVG line paths @since 0.14.1
 */
export function statisticsPaths(
  samples: StatisticsSample[],
  key: string,
  maximum: number,
): string[] {
  if (!samples.length || !Number.isFinite(maximum) || maximum <= 0) return [];
  const start = samples[0].at,
    span = Math.max(1, samples.at(-1)!.at - start);
  const paths: string[] = [];
  let path = '';
  for (const sample of samples) {
    const value = measured(sample.values[key]);
    if (value === null || value < 0) {
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
