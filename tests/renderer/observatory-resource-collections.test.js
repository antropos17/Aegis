import { expect, it } from 'vitest';
import { emptyTelemetry } from '../../frontend/observatory/runtime/host';
import {
  mergeResourceDelivery,
  observeResourceCollection,
} from '../../frontend/observatory/runtime/resource-observations';
import {
  createStatisticsHistory,
  observeStatistics,
} from '../../frontend/observatory/runtime/statistics-history';

const row = (id, sequence, at, cpu = 1) => ({
  instanceId: id,
  pid: Number(id),
  cpu,
  memMb: 10,
  collectionSequence: sequence,
  collectionStartedAt: at - 100,
  collectedAt: at,
});
const state = (at, resources) => ({
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  resourcesAt: at,
  agents: [
    { instanceId: '1', pid: 1 },
    { instanceId: '2', pid: 2 },
  ],
  resources,
});
const cpu = (history) => history.samples.filter((sample) => Object.hasOwn(sample.values, 'cpu'));

it('plots collection completion and does not turn cache replays into new measurements', () => {
  const first = state(1000, [row('1', 1, 900, 2), row('2', 1, 900, 3)]);
  let history = observeStatistics(createStatisticsHistory(), first);
  expect(cpu(history)).toMatchObject([{ at: 900, values: { cpu: 5 } }]);
  history = observeStatistics(history, { ...first, resourcesAt: 2000 });
  expect(cpu(history)).toHaveLength(1);
  expect(history.clocks.resources).toBe(2000);
});

it('shows the actual collection span when a new batch includes cached members', () => {
  let history = observeStatistics(
    createStatisticsHistory(),
    state(1000, [row('1', 1, 900, 2), row('2', 1, 900, 3)]),
  );
  history = observeStatistics(history, state(2000, [row('1', 1, 900, 2), row('2', 2, 1900, 8)]));
  expect(cpu(history).at(-1)).toMatchObject({
    at: 1900,
    values: { cpu: 10 },
    coverage: { cpu: { measured: 2, total: 2 } },
    resourceCollection: { oldest: 900, newest: 1900 },
  });
});

it('never lets an earlier query replace a newer row or remove a newly collected instance', () => {
  const newer = [row('1', 2, 900, 20), row('2', 2, 900, 30)];
  const late = [row('1', 1, 1500, 999)];
  const accepted = mergeResourceDelivery(newer, late);
  expect(accepted).toEqual(newer);
  let history = observeStatistics(createStatisticsHistory(), state(1000, newer));
  history = observeStatistics(history, state(2000, accepted));
  expect(cpu(history)).toHaveLength(1);
  expect(cpu(history)[0].values.cpu).toBe(50);
});

it('uses sequence rather than completion order or equal millisecond clocks', () => {
  const first = row('1', 1, 900, 1);
  const second = row('1', 2, 900, 2);
  expect(mergeResourceDelivery([second], [first])).toEqual([second]);
  let history = observeStatistics(createStatisticsHistory(), state(1000, [first]));
  history = observeStatistics(history, state(1100, [second]));
  expect(cpu(history)).toHaveLength(1);
  expect(cpu(history)[0].values.cpu).toBe(2);
  expect(observeResourceCollection(state(1200, [first]), history.resourceSequences).at).toBeNull();
});

it('does not use a reused PID to inherit another instance collection sequence', () => {
  const prior = row('old', 20, 900);
  const current = { ...row('new', 21, 1900, 4), pid: prior.pid };
  expect(mergeResourceDelivery([prior], [current])).toEqual([current]);
});

it('keeps missing measurements and malformed provenance unavailable', () => {
  const history = observeStatistics(
    createStatisticsHistory(),
    state(2000, [
      { ...row('1', 1, 1900), cpu: null },
      { ...row('2', 1, 1900, 999), collectionSequence: NaN },
    ]),
  );
  expect(cpu(history)[0]).toMatchObject({
    at: 1900,
    values: { cpu: null },
    coverage: { cpu: { measured: 0, total: 2 } },
  });
  const invalid = observeResourceCollection(
    state(2000, [{ ...row('1', 1, 1900), collectedAt: NaN }]),
    {},
  );
  expect(invalid.at).toBe(2000);
  expect(invalid.rows).toEqual([]);
});

it('does not resolve duplicate identities by silently selecting one row', () => {
  const a = row('1', 1, 900, 2);
  const history = observeStatistics(createStatisticsHistory(), state(1000, [a, a]));
  expect(cpu(history)[0].values.cpu).toBeNull();
});

it('retains receipt-time compatibility for older hosts and explicit preview fixtures', () => {
  const legacy = state(2000, [{ instanceId: '1', cpu: 0, memMb: 0 }]);
  const history = observeStatistics(createStatisticsHistory(), legacy);
  expect(cpu(history)[0]).toMatchObject({
    at: 2000,
    values: { cpu: 0 },
    coverage: { cpu: { measured: 1, total: 2 } },
  });
  expect(cpu(history)[0].resourceCollection).toBeUndefined();
});

it('records a newer collection even when both deliveries share the same receipt millisecond', () => {
  let history = observeStatistics(createStatisticsHistory(), state(1000, [row('1', 1, 900, 1)]));
  history = observeStatistics(history, state(1000, [row('1', 2, 950, 5)]));
  expect(cpu(history).at(-1)).toMatchObject({ at: 950, values: { cpu: 5 } });
  expect(history.resourceSequences['1']).toBe(2);
});

it('records unmeasurable identity coverage when a collection contains only unstamped processes', () => {
  const unknown = {
    ...state(2000, [{ ...row('1', 1, 1900, 999), instanceId: null }]),
    agents: [{ pid: 1, instanceId: null }],
  };
  let history = observeStatistics(createStatisticsHistory(), unknown);
  expect(cpu(history)[0]).toMatchObject({
    at: 1900,
    values: { cpu: null, memory: null },
    coverage: { cpu: { measured: 0, total: 1 } },
  });
  history = observeStatistics(history, { ...unknown, resourcesAt: 2500 });
  expect(cpu(history)).toHaveLength(1);
});

it('never re-stamps a valid cached subtotal when a neighboring row has malformed provenance', () => {
  const mixed = state(2000, [row('1', 1, 1900, 3), { ...row('2', 1, 1900), collectedAt: NaN }]);
  let history = observeStatistics(createStatisticsHistory(), mixed);
  expect(cpu(history)[0].values.cpu).toBe(3);
  history = observeStatistics(history, { ...mixed, resourcesAt: 2400 });
  expect(cpu(history).at(-1).values.cpu).toBeNull();
  expect(cpu(history).filter((sample) => sample.values.cpu !== null)).toHaveLength(1);
});

it('restarts the timeline after a backward clock change without retaining future source frames', () => {
  const first = { ...state(600000, [row('1', 1, 599900, 1)]), ownAt: 600000, own: { memMB: 20 } };
  let history = observeStatistics(createStatisticsHistory(), first, undefined, 600000);
  history = observeStatistics(
    history,
    { ...first, resourcesAt: 1000, resources: [row('1', 2, 900, 7)] },
    undefined,
    1000,
  );
  expect(cpu(history)).toMatchObject([{ at: 900, values: { cpu: 7 } }]);
  expect(history.samples.every((sample) => sample.at <= 1000)).toBe(true);
  history = observeStatistics(
    history,
    {
      ...first,
      resourcesAt: 1000,
      resources: [row('1', 2, 900, 7)],
      ownAt: 2000,
      own: { memMB: 30 },
    },
    undefined,
    2000,
  );
  expect(
    history.samples.findLast((sample) => Object.hasOwn(sample.values, 'ownMemory')),
  ).toMatchObject({ at: 2000, values: { ownMemory: 30, ownCpu: null } });
});

it('does not resurrect unchanged pre-reset telemetry before its next actual delivery', () => {
  const first = state(600000, [row('1', 1, 599900, 1)]);
  let history = observeStatistics(createStatisticsHistory(), first, undefined, 600000);
  history = observeStatistics(history, first, undefined, 1000);
  expect(history.samples).toEqual([]);
  history = observeStatistics(history, state(2000, [row('1', 2, 1900, 5)]), undefined, 2000);
  expect(cpu(history)).toMatchObject([{ at: 1900, values: { cpu: 5 } }]);
});

it('retains ignored source clocks through a second rollback before those sources deliver again', () => {
  const first = { ...state(600000, [row('1', 1, 599900, 1)]), ownAt: 600000, own: { memMB: 20 } };
  let history = observeStatistics(createStatisticsHistory(), first, undefined, 600000);
  history = observeStatistics(
    history,
    {
      ...first,
      resourcesAt: 1000,
      resources: [row('1', 2, 900, 7)],
    },
    undefined,
    1000,
  );
  history = observeStatistics(
    history,
    {
      ...first,
      resourcesAt: 500,
      resources: [row('1', 3, 400, 9)],
    },
    undefined,
    500,
  );
  expect(cpu(history)).toMatchObject([{ at: 400, values: { cpu: 9 } }]);
  expect(history.samples.every((sample) => sample.at <= 500)).toBe(true);
  expect(history.ignoredClocks.own).toBe(600000);
});
