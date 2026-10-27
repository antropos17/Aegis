import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectHost } from '../../frontend/observatory/runtime/host';

const healthy = {
  monitoringPaused: false,
  monitoringGeneration: '0',
  appHealth: { populationReliable: true, identityDegraded: false },
  observationGap: { state: 'NONE' },
};
let dispose;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  dispose?.();
  vi.useRealTimers();
});

function connect() {
  const listeners = {};
  const host = {
    getStats: async () => healthy,
    getResourceUsage: async () => ({}),
    getFalsePositives: async () => [],
  };
  for (const name of [
    'onScanBatch',
    'onStatsUpdate',
    'onFileAccess',
    'onNetworkUpdate',
    'onScanStatus',
    'onAgentResourceUsage',
    'onTokenCosts',
  ]) {
    host[name] = (callback) => {
      listeners[name] = callback;
      return () => {};
    };
  }
  let current;
  dispose = connectHost(host, (value) => {
    current = value;
  });
  return {
    listeners,
    get current() {
      return current;
    },
  };
}

it('keeps a warmup observation fresh across the real startup gap, then expires missing delivery', async () => {
  const run = connect();
  run.listeners.onScanBatch({
    stats: { ...healthy, scanCadence: { maxProcessGapMs: 40000 } },
    agents: [],
  });
  await vi.advanceTimersByTimeAsync(35000);
  expect(run.current.stale).toBe(false);
  // Steady timers can start before the next population arrives. A stats-only
  // update must not shorten the schedule attached to the last reliable batch.
  run.listeners.onStatsUpdate({ ...healthy, scanCadence: { maxProcessGapMs: 10000 } });
  await vi.advanceTimersByTimeAsync(14000);
  expect(run.current.stale).toBe(false);
  await vi.advanceTimersByTimeAsync(2000);
  expect(run.current.stale).toBe(true);
  run.listeners.onStatsUpdate(healthy);
  expect(run.current.stale).toBe(true);
  run.listeners.onScanBatch({
    stats: { ...healthy, scanCadence: { maxProcessGapMs: 10000 } },
    agents: [],
  });
  expect(run.current.stale).toBe(false);
  await vi.advanceTimersByTimeAsync(31000);
  expect(run.current.stale).toBe(true);
});

it('does not let the planned cadence conceal a failed observation or pause', () => {
  const run = connect();
  run.listeners.onScanBatch({
    stats: { ...healthy, scanCadence: { maxProcessGapMs: 40000 } },
    agents: [],
  });
  run.listeners.onStatsUpdate({ appHealth: { populationReliable: false } });
  expect(run.current.stale).toBe(true);
  run.listeners.onScanBatch({ stats: { ...healthy, monitoringPaused: true }, agents: [] });
  expect(run.current.stale).toBe(true);
});

it.each([null, undefined, '40000', NaN, Infinity, 0, -1])(
  'ignores invalid cadence %s',
  async (maxProcessGapMs) => {
    const run = connect();
    run.listeners.onScanBatch({
      stats: { ...healthy, scanCadence: { maxProcessGapMs } },
      agents: [],
    });
    await vi.advanceTimersByTimeAsync(31000);
    expect(run.current.stale).toBe(true);
  },
);

it('revokes a confirmed pause on a stalled or rejected live read and ignores late replies', async () => {
  const listeners = {};
  let current;
  let getStats = () => Promise.resolve({ ...healthy, monitoringPaused: true });
  const host = {
    getStats: () => getStats(),
    getResourceUsage: async () => ({}),
    getFalsePositives: async () => [],
  };
  for (const name of [
    'onScanBatch',
    'onStatsUpdate',
    'onFileAccess',
    'onNetworkUpdate',
    'onScanStatus',
    'onAgentResourceUsage',
    'onTokenCosts',
  ])
    host[name] = (callback) => {
      listeners[name] = callback;
      return () => {};
    };
  dispose = connectHost(host, (value) => {
    current = value;
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(current.monitoringPauseConfirmed).toBe(true);
  let resolve;
  getStats = () =>
    new Promise((done) => {
      resolve = done;
    });
  await vi.advanceTimersByTimeAsync(25000);
  expect(current.monitoringPauseConfirmed).toBe(false);
  resolve({ ...healthy, monitoringPaused: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(current.monitoringPauseConfirmed).toBe(false);
  getStats = () => Promise.resolve({ ...healthy, monitoringPaused: true });
  await vi.advanceTimersByTimeAsync(15000);
  expect(current.monitoringPauseConfirmed).toBe(true);
  let reject;
  getStats = () =>
    new Promise((_, fail) => {
      reject = fail;
    });
  await vi.advanceTimersByTimeAsync(20000);
  listeners.onStatsUpdate({ ...healthy, monitoringPaused: true });
  reject(new Error('PRIVATE_FAILURE'));
  await vi.advanceTimersByTimeAsync(0);
  expect(current.monitoringPauseConfirmed).toBe(false);
});

it('moves a pending ordinary refresh forward when monitoring changes', async () => {
  const listeners = {};
  let producer = { ...healthy, monitoringPaused: false };
  const calls = [];
  const host = {
    getStats: async () => {
      calls.push(performance.now());
      return producer;
    },
    getResourceUsage: async () => ({}),
    getFalsePositives: async () => [],
  };
  for (const name of [
    'onScanBatch',
    'onStatsUpdate',
    'onFileAccess',
    'onNetworkUpdate',
    'onScanStatus',
    'onAgentResourceUsage',
    'onTokenCosts',
  ])
    host[name] = (callback) => {
      listeners[name] = callback;
      return () => {};
    };
  dispose = connectHost(host, () => {});
  await vi.advanceTimersByTimeAsync(19000);
  producer = { ...healthy, monitoringPaused: true, monitoringGeneration: '1' };
  listeners.onStatsUpdate(producer);
  await vi.advanceTimersByTimeAsync(1500);
  expect(calls).toHaveLength(2); // seed and immediate transition confirmation
  producer = { ...healthy, monitoringPaused: false, monitoringGeneration: '2' };
  listeners.onStatsUpdate(producer);
  producer = { ...healthy, monitoringPaused: true, monitoringGeneration: '3' };
  listeners.onStatsUpdate(producer);
  await vi.advanceTimersByTimeAsync(500);
  expect(calls).toHaveLength(3);
  expect(calls[2] - calls[1]).toBe(2000);
});
