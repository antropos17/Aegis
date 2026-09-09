import { expect, it } from 'vitest';
import { emptyTelemetry } from '../../frontend/observatory/runtime/host';
import {
  completeStatisticsTotal,
  statisticsValue,
} from '../../frontend/observatory/runtime/statistics-metrics';
import {
  createStatisticsHistory,
  observeStatistics,
  statisticsRate,
  statisticsPaths,
  STATISTICS_HISTORY_LIMIT,
} from '../../frontend/observatory/runtime/statistics-history';

const agent = (pid) => ({
  pid,
  agent: 'Codex',
  process: 'codex.exe',
  instanceId: pid + ':live',
  instanceIdSource: 'os',
});
const state = (at = 1000, extra = {}) => ({
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  lastScan: at,
  resourcesAt: at,
  agents: [agent(1), agent(2)],
  resources: [
    { instanceId: '1:live', cpu: 0, memMb: 10 },
    { instanceId: '2:live', cpu: 20, memMb: 30 },
  ],
  tokens: [
    { instanceId: '1:live', totalTokens: 100, inputTokens: 60, outputTokens: 40, costUsd: 0 },
    { instanceId: '2:live', totalTokens: 200, inputTokens: 120, outputTokens: 80, costUsd: 0.2 },
  ],
  stats: {
    monitoringStarted: 1,
    totalSensitive: 2,
    appHealth: { sensors: { byId: { network: { state: 'HEALTHY' } } } },
  },
  own: { memMB: 60, heapMB: 20, cpuUser: 1000, cpuSystem: 1000 },
  ...extra,
});
const last = (h) => h.samples.at(-1).values;

it('requires complete exact identity coverage and ignores unrelated resource rows', () => {
  const s = state();
  expect(
    completeStatisticsTotal(s, [...s.resources, { instanceId: 'gone', cpu: 999 }], 'cpu'),
  ).toBe(20);
  expect(completeStatisticsTotal(s, s.resources.slice(0, 1), 'cpu')).toBeNull();
  expect(completeStatisticsTotal(s, [...s.resources, s.resources[0]], 'cpu')).toBeNull();
  expect(
    completeStatisticsTotal(
      { ...s, agents: [agent(1), { ...agent(2), instanceId: null }] },
      s.resources,
      'cpu',
    ),
  ).toBeNull();
  expect(completeStatisticsTotal({ ...s, stale: true }, s.resources, 'cpu')).toBeNull();
});
it('rejects missing, negative and nonfinite totals while preserving real zero', () => {
  const s = state();
  for (const value of [null, undefined, NaN, Infinity, -1, '20']) {
    expect(
      completeStatisticsTotal(s, [{ ...s.resources[0], cpu: value }, s.resources[1]], 'cpu'),
    ).toBeNull();
  }
  expect(
    completeStatisticsTotal(
      s,
      s.resources.map((r) => ({ ...r, cpu: 0 })),
      'cpu',
    ),
  ).toBe(0);
  expect(statisticsValue(null, '%')).toBe('—');
  expect(statisticsValue(0, '%')).toBe('0 %');
});
it('keeps bounded histories and does not append for a frozen or repeated display snapshot', () => {
  let h = createStatisticsHistory();
  const s = state();
  h = observeStatistics(h, s);
  expect(observeStatistics(h, s)).toBe(h);
  expect(observeStatistics(h, { ...s, events: [{ timestamp: 500 }] })).toBe(h);
  for (let i = 2; i < 300; i++) h = observeStatistics(h, state(i * 1000));
  expect(h.samples).toHaveLength(STATISTICS_HISTORY_LIMIT);
  expect(h.samples[0].at).toBe(180000);
  expect(last(h).memory).toBe(40);
});
it('freezes outages and inserts a visual gap without fabricating recovery rates', () => {
  let h = observeStatistics(createStatisticsHistory(), state());
  h = observeStatistics(h, state(2000, { stale: true }));
  expect(h.samples).toHaveLength(1);
  h = observeStatistics(h, state(3000));
  expect(h.samples).toHaveLength(3);
  expect(h.samples[1].values).toEqual({});
  expect(last(h).fileRate).toBeNull();
  expect(last(h).tokenRate).toBeNull();
  expect(last(h).ownCpu).toBeNull();
});
it('counts delivered events across retention eviction and normalizes sensitive rates', () => {
  let h = observeStatistics(
    createStatisticsHistory(),
    state(1000, { events: [{ sensitive: true }, {}], evicted: 5 }),
  );
  h = observeStatistics(
    h,
    state(3000, {
      events: [{ sensitive: true }, { sensitive: true }],
      evicted: 7,
      stats: { ...state().stats, totalSensitive: 3 },
    }),
  );
  expect(last(h).fileRate).toBe(60);
  expect(last(h).sensitiveRate).toBe(30);
});
it('breaks rates on monitoring restart and reset instead of drawing negative activity', () => {
  let h = observeStatistics(
    createStatisticsHistory(),
    state(1000, { evicted: 5, retainedEvicted: 1 }),
  );
  h = observeStatistics(h, state(3000, { stats: { ...state().stats, totalSensitive: 1 } }));
  expect(last(h).fileRate).toBeNull();
  expect(last(h).sensitiveRate).toBeNull();
  h = observeStatistics(h, state(4000, { stats: { ...state().stats, monitoringStarted: 4000 } }));
  expect(last(h).tokenRate).toBeNull();
  expect(h.samples.at(-2).values).toEqual({});
});
it('invalidates token rates for a changed population or an individual counter reset hidden by other growth', () => {
  const first = state();
  let next = state(2000, {
    tokens: first.tokens.map((t, i) => ({ ...t, totalTokens: i ? 400 : 50 })),
  });
  let h = observeStatistics(observeStatistics(createStatisticsHistory(), first), next);
  expect(last(h).tokens).toBe(450);
  expect(last(h).tokenRate).toBeNull();
  next = state(3000, { agents: [agent(1)] });
  h = observeStatistics(h, next);
  expect(last(h).tokens).toBe(100);
  expect(last(h).tokenRate).toBeNull();
});
it('computes log counter growth and AEGIS CPU using real elapsed timestamps', () => {
  const first = state();
  const next = state(3000, {
    tokens: first.tokens.map((t) => ({ ...t, totalTokens: t.totalTokens + 10 })),
    own: { memMB: 70, heapMB: 25, cpuUser: 201000, cpuSystem: 1000 },
  });
  const h = observeStatistics(observeStatistics(createStatisticsHistory(), first), next);
  expect(last(h).tokenRate).toBe(600);
  expect(last(h).ownCpu).toBe(10);
  expect(last(h).ownMemory).toBe(70);
});
it('leaves stale resources unavailable and distinguishes missing or failed network coverage from healthy empty', () => {
  expect(
    last(observeStatistics(createStatisticsHistory(), state(40000, { resourcesAt: 1000 }))).cpu,
  ).toBeNull();
  expect(last(observeStatistics(createStatisticsHistory(), state())).connections).toBe(0);
  expect(
    last(observeStatistics(createStatisticsHistory(), state(1000, { stats: {} }))).connections,
  ).toBeNull();
  const s = state();
  s.stats.appHealth.sensors.byId.network.state = 'FAILED';
  s.network = [{ remoteIp: '192.0.2.1' }];
  expect(last(observeStatistics(createStatisticsHistory(), s)).connections).toBeNull();
});
it('rate calculations reject invalid intervals and overflowing arithmetic', () => {
  expect(statisticsRate(1, 3, 2000)).toBe(60);
  for (const interval of [0, -1, Infinity, NaN]) expect(statisticsRate(1, 3, interval)).toBeNull();
  expect(statisticsRate(3, 1, 1000)).toBeNull();
  expect(statisticsRate(0, Number.MAX_VALUE, 1)).toBeNull();
});
it('keeps graph gaps and actual time spacing, without linking unavailable points', () => {
  const paths = statisticsPaths(
    [
      { at: 0, values: { cpu: 0 } },
      { at: 1000, values: { cpu: 20 } },
      { at: 2000, values: {} },
      { at: 4000, values: { cpu: 40 } },
    ],
    'cpu',
    100,
  );
  expect(paths).toHaveLength(2);
  expect(paths[0]).toContain('151.00');
  expect(paths[1]).toBe('M 598.00 96.40');
  expect(statisticsPaths([{ at: 1, values: { cpu: Infinity } }], 'cpu', 100)).toEqual([]);
});

it('counts new sensitive delivery when both backend and renderer ring occupancy stay constant', () => {
  const initial = state(1000, {
    events: [{ sensitive: true }],
    retainedEvicted: 8,
    stats: { ...state().stats, totalSensitive: 100 },
  });
  const next = state(3000, {
    events: [{ sensitive: true }],
    retainedEvicted: 10,
    stats: { ...state().stats, totalSensitive: 100 },
  });
  const h = observeStatistics(observeStatistics(createStatisticsHistory(), initial), next);
  expect(last(h).sensitiveRate).toBe(60);
});
