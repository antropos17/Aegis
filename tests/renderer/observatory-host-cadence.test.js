import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectHost } from '../../frontend/observatory/runtime/host';

const healthy = {
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
