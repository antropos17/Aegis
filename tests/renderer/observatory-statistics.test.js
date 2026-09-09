import { expect, it } from 'vitest';
import { emptyTelemetry } from '../../frontend/observatory/runtime/host';
import {
  measuredStatisticsTotal,
  statisticsValue,
} from '../../frontend/observatory/runtime/statistics-metrics';
import {
  createStatisticsHistory,
  observeStatistics,
  statisticsRate,
  statisticsPaths,
  STATISTICS_HISTORY_LIMIT,
  STATISTICS_HISTORY_MS,
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
  tokensAt: at,
  ownAt: at,
  networkAt: at,
  statsAt: at,
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
    appHealth: { sensors: { byId: { network: { state: 'HEALTHY' } } } },
  },
  own: { memMB: 60, heapMB: 20, cpuUser: 1000, cpuSystem: 1000 },
  ...extra,
});
const latest = (history, id) =>
  history.samples.findLast((sample) => Object.hasOwn(sample.values, id));

it('shows measured partial subtotals without matching by PID or counting departed identities', () => {
  const s = state();
  const rows = [s.resources[1], { instanceId: 'departed', cpu: 999 }];
  expect(measuredStatisticsTotal(s, rows, 'cpu')).toMatchObject({
    value: 20,
    measured: 1,
    total: 2,
  });
  expect(
    measuredStatisticsTotal(s, [{ ...s.resources[1], instanceId: 'other:birth', pid: 2 }], 'cpu'),
  ).toMatchObject({ value: null, measured: 0, total: 2 });
  expect(measuredStatisticsTotal(s, [s.resources[1], s.resources[1]], 'cpu').value).toBeNull();
});
it('deduplicates current stamped identities while preserving unmeasurable synthetic coverage', () => {
  const s = state(1000, { agents: [agent(1), agent(1), { ...agent(0), instanceId: null }] });
  expect(measuredStatisticsTotal(s, s.resources, 'memMb')).toMatchObject({
    value: 10,
    measured: 1,
    total: 2,
  });
});
it('distinguishes reliable zero population from unknown population or unmeasured load', () => {
  const s = state(1000, { agents: [] });
  expect(measuredStatisticsTotal(s, [], 'cpu')).toMatchObject({ value: 0, total: 0, measured: 0 });
  expect(measuredStatisticsTotal({ ...s, stale: true }, [], 'cpu').value).toBeNull();
  expect(measuredStatisticsTotal({ ...s, ready: false }, [], 'cpu').value).toBeNull();
  expect(measuredStatisticsTotal(state(), [], 'cpu').value).toBeNull();
  expect(statisticsValue(0, '%')).toBe('0 %');
  expect(statisticsValue(null, '%')).toBe('—');
});
it('excludes invalid measurements rather than discarding other measured processes', () => {
  const s = state();
  for (const cpu of [null, undefined, NaN, Infinity, -1, '20']) {
    expect(
      measuredStatisticsTotal(s, [{ ...s.resources[0], cpu }, s.resources[1]], 'cpu'),
    ).toMatchObject({ value: 20, measured: 1, total: 2 });
  }
});
it('isolates scan, token and resource ordering so a 20ms resource reply cannot spike rates', () => {
  const first = state();
  let h = observeStatistics(createStatisticsHistory(), first);
  const scan = { ...first, lastScan: 11000, ownAt: 11000, statsAt: 11000, events: [{}, {}, {}] };
  h = observeStatistics(h, scan);
  expect(h.samples.at(-1).values).not.toHaveProperty('cpu');
  expect(h.samples.at(-1).values).not.toHaveProperty('tokenRate');
  expect(latest(h, 'fileRate').values.fileRate).toBe(18);
  const tokens = {
    ...scan,
    tokensAt: 11020,
    tokens: first.tokens.map((t) => ({ ...t, totalTokens: t.totalTokens + 150 })),
  };
  h = observeStatistics(h, tokens);
  expect(latest(h, 'tokenRate').values.tokenRate).toBeCloseTo((300 * 60000) / 10020);
  expect(h.samples.at(-1).values).not.toHaveProperty('fileRate');
  const resources = { ...tokens, resourcesAt: 11040 };
  h = observeStatistics(h, resources);
  expect(h.samples.at(-1).values).toEqual({ cpu: 20, memory: 40 });
  expect(latest(h, 'tokenRate').at).toBe(11020);
  expect(latest(h, 'fileRate').at).toBe(11000);
  expect(observeStatistics(h, resources)).toBe(h);
});
it('samples delivered sensitive counters between scans even when both ring occupancies stay constant', () => {
  const first = state(1000, {
    events: [{ sensitive: true }],
    retainedEvicted: 8,
    stats: { ...state().stats, totalSensitive: 100 },
  });
  let h = observeStatistics(createStatisticsHistory(), first);
  const delivery = { ...first, retainedEvicted: 10, evicted: 2 };
  expect(observeStatistics(h, delivery)).toBe(h);
  h = observeStatistics(h, { ...delivery, lastScan: 3000, statsAt: 3000 });
  expect(latest(h, 'sensitiveRate').values.sensitiveRate).toBe(60);
  expect(latest(h, 'fileRate').values.fileRate).toBe(60);
});
it('uses the token source clock even if resources arrive before the token reply', () => {
  const first = state();
  let h = observeStatistics(createStatisticsHistory(), first);
  const resources = { ...first, lastScan: 11000, resourcesAt: 11005 };
  h = observeStatistics(h, resources);
  const tokens = {
    ...resources,
    tokensAt: 15000,
    tokens: first.tokens.map((t) => ({ ...t, totalTokens: t.totalTokens + 70 })),
  };
  h = observeStatistics(h, tokens);
  expect(latest(h, 'tokenRate').values.tokenRate).toBe(600);
  expect(latest(h, 'cpu').at).toBe(11005);
});
it('keeps partial token measurements visible when other agents have unsupported logs', () => {
  const s = state(1000, { tokens: [state().tokens[0]] });
  const h = observeStatistics(createStatisticsHistory(), s);
  expect(latest(h, 'tokens').values.tokens).toBe(100);
  expect(latest(h, 'tokens').coverage.tokens).toMatchObject({ measured: 1, total: 2 });
});
it('interrupts token rates when measured identities change or one counter resets behind another increase', () => {
  const first = state();
  let h = observeStatistics(createStatisticsHistory(), first);
  h = observeStatistics(h, {
    ...first,
    tokensAt: 2000,
    tokens: first.tokens.map((t, i) => ({ ...t, totalTokens: i ? 400 : 50 })),
  });
  expect(latest(h, 'tokens').values.tokens).toBe(450);
  expect(latest(h, 'tokenRate').values.tokenRate).toBeNull();
  h = observeStatistics(h, { ...first, tokensAt: 3000, tokens: [first.tokens[0]] });
  expect(latest(h, 'tokens').values.tokens).toBe(100);
  expect(latest(h, 'tokenRate').values.tokenRate).toBeNull();
});
it('uses AEGIS own receipt clock, without manufacturing CPU points on resource replies', () => {
  const first = state();
  let h = observeStatistics(createStatisticsHistory(), first);
  h = observeStatistics(h, { ...first, resourcesAt: 2000 });
  expect(h.samples.at(-1).values).not.toHaveProperty('ownCpu');
  h = observeStatistics(h, {
    ...first,
    resourcesAt: 2000,
    ownAt: 3000,
    own: { ...first.own, cpuUser: 201000 },
  });
  expect(latest(h, 'ownCpu').values.ownCpu).toBe(10);
});
it('permits configured long scan intervals rather than inserting a fabricated 30-second gap', () => {
  let h = observeStatistics(createStatisticsHistory(), state());
  h = observeStatistics(h, state(61000, { events: [{}] }));
  expect(latest(h, 'fileRate').values.fileRate).toBe(1);
  expect(h.samples.map((s) => s.at)).toEqual([1000, 61000]);
});
it('records outage at its received time and resets scan/token rates on recovery', () => {
  let h = observeStatistics(createStatisticsHistory(), state());
  h = observeStatistics(h, { ...state(), stale: true, statsAt: 2000 });
  expect(h.samples.map((s) => s.at)).toEqual([1000, 2000]);
  expect(latest(h, 'cpu').values.cpu).toBeNull();
  h = observeStatistics(h, state(3000));
  expect(latest(h, 'fileRate').values.fileRate).toBeNull();
  expect(latest(h, 'tokenRate').values.tokenRate).toBeNull();
});
it('bounds by elapsed five minutes and a hard frame limit, merging simultaneous source frames', () => {
  let h = observeStatistics(createStatisticsHistory(), state());
  expect(h.samples).toHaveLength(1);
  for (let i = 1; i <= 1100; i++) h = observeStatistics(h, state(1000 + i * 200));
  expect(h.samples).toHaveLength(STATISTICS_HISTORY_LIMIT);
  h = observeStatistics(h, state(700000));
  expect(h.samples.every((s) => s.at >= 700000 - STATISTICS_HISTORY_MS)).toBe(true);
  expect(h.samples).toHaveLength(1);
});
it('treats network delivery as a distinct source and never infers a missing snapshot from healthy stats', () => {
  const first = state(1000, { networkAt: null });
  let h = observeStatistics(createStatisticsHistory(), first);
  expect(latest(h, 'connections')).toBeUndefined();
  h = observeStatistics(h, { ...first, networkAt: 2000 });
  expect(latest(h, 'connections').values.connections).toBe(0);
  h = observeStatistics(h, {
    ...first,
    networkAt: 3000,
    stats: { appHealth: { sensors: { byId: { network: { state: 'FAILED' } } } } },
    network: [{}],
  });
  expect(latest(h, 'connections').values.connections).toBeNull();
});
it('rate arithmetic rejects resets, invalid intervals and overflow', () => {
  expect(statisticsRate(1, 3, 2000)).toBe(60);
  for (const interval of [0, -1, Infinity, NaN]) expect(statisticsRate(1, 3, interval)).toBeNull();
  expect(statisticsRate(3, 1, 1000)).toBeNull();
  expect(statisticsRate(0, Number.MAX_VALUE, 1)).toBeNull();
});
it('ignores unrelated sparse frames while preserving explicit graph gaps', () => {
  const paths = statisticsPaths(
    [
      { at: 0, values: { cpu: 0 } },
      { at: 1000, values: { memory: 20 } },
      { at: 2000, values: { cpu: null } },
      { at: 4000, values: { cpu: 40 } },
    ],
    'cpu',
    100,
  );
  expect(paths).toEqual(['M 2.00 158.00', 'M 598.00 96.40']);
});

it('manual pause records its real action time without erasing a prior valid sample', () => {
  const first = state();
  let h = observeStatistics(createStatisticsHistory(), first);
  h = observeStatistics(h, { ...first, stale: true }, 2500);
  expect(h.samples[0].values.cpu).toBe(20);
  expect(h.samples.map((sample) => sample.at)).toEqual([1000, 2500]);
  expect(latest(h, 'ownCpu').values.ownCpu).toBeNull();
  h = observeStatistics(h, state(5000));
  expect(latest(h, 'fileRate').values.fileRate).toBeNull();
  expect(latest(h, 'tokenRate').values.tokenRate).toBeNull();
  expect(latest(h, 'ownCpu').values.ownCpu).toBeNull();
});

it('does not overwrite a measured frame when a health boundary has the same millisecond timestamp', () => {
  const first = state();
  let h = observeStatistics(createStatisticsHistory(), first);
  h = observeStatistics(h, { ...first, stale: true, statsAt: 1000 });
  expect(h.samples).toHaveLength(2);
  expect(h.samples[0].values.cpu).toBe(20);
  expect(h.samples[1].values.cpu).toBeNull();
  expect(h.samples.map((s) => s.at)).toEqual([1000, 1000]);
});

it('uses the scan-captured delivery counter when later file pushes are coalesced before rendering', () => {
  let h = observeStatistics(
    createStatisticsHistory(),
    state(1000, { scanCounters: { files: 0, sensitive: 0, evicted: 0 } }),
  );
  h = observeStatistics(
    h,
    state(11000, {
      events: [{ sensitive: true }, { sensitive: true }, {}],
      scanCounters: { files: 1, sensitive: 1, evicted: 0 },
    }),
  );
  expect(latest(h, 'fileRate').values.fileRate).toBe(6);
  expect(latest(h, 'sensitiveRate').values.sensitiveRate).toBe(6);
});
