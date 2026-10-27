import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectHost, type Host, type Telemetry } from '../../frontend/observatory/runtime/host';

const stats = (revision: number, age = 0) => ({
  monitoringPaused: false,
  monitoringGeneration: '0',
  monitoringPopulationRevision: String(revision),
  monitoringPopulationReady: true,
  monitoringPopulationAgeMs: age,
  observationGap: { state: 'NONE' },
  appHealth: {
    populationReliable: true,
    identityDegraded: false,
    watchPlan: { projectState: 'observed' },
  },
});

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const connections: (() => void)[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const dispose of connections.splice(0)) dispose();
  vi.useRealTimers();
});

function connect() {
  const listeners = new Map<string, (value: unknown) => void>();
  let getStats: () => Promise<unknown> = async () => stats(0);
  const host: Record<string, (...args: never[]) => unknown> = {
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
  ]) {
    host[name] = ((callback: (value: unknown) => void) => {
      listeners.set(name, callback);
      return () => listeners.delete(name);
    }) as Host[string];
  }
  let current!: Telemetry;
  let publications = 0;
  const dispose = connectHost(host, (value) => {
    current = value;
    publications++;
  });
  connections.push(dispose);
  return {
    dispose,
    setStats: (fn: () => Promise<unknown>) => {
      getStats = fn;
    },
    scan: (revision: number) =>
      listeners.get('onScanBatch')?.({
        populationCurrent: true,
        stats: stats(revision),
        agents: [],
      }),
    get current() {
      return current;
    },
    get publications() {
      return publications;
    },
  };
}

it('rejects a superseded confirmation and confirms the newer admitted scan', async () => {
  const run = connect();
  await vi.advanceTimersByTimeAsync(0);
  const pending = deferred();
  run.setStats(() => pending.promise);
  run.scan(1);
  run.scan(2);
  pending.resolve(stats(1));
  run.setStats(async () => stats(2));
  await vi.advanceTimersByTimeAsync(0);
  expect(run.current.projectCoverageCurrent).toBe(false);
  await vi.advanceTimersByTimeAsync(2000);
  expect(run.current.projectCoverageCurrent).toBe(true);
  expect(run.current.projectCoverageState).toBe('observed');
});

it('ignores an old connection response after disposal while a replacement confirms independently', async () => {
  const old = connect();
  await vi.advanceTimersByTimeAsync(0);
  const pending = deferred();
  old.setStats(() => pending.promise);
  old.scan(1);
  old.dispose();
  const before = old.publications;
  const replacement = connect();
  await vi.advanceTimersByTimeAsync(0);
  replacement.setStats(async () => stats(1));
  replacement.scan(1);
  await vi.advanceTimersByTimeAsync(0);
  expect(replacement.current.projectCoverageCurrent).toBe(true);
  pending.resolve(stats(1));
  await vi.advanceTimersByTimeAsync(0);
  expect(old.publications).toBe(before);
  expect(replacement.current.projectCoverageCurrent).toBe(true);
});

it('subtracts producer age and the full request time and does not extend proof on an unchanged scan', async () => {
  const run = connect();
  await vi.advanceTimersByTimeAsync(0);
  const pending = deferred();
  run.setStats(() => pending.promise);
  run.scan(1);
  await vi.advanceTimersByTimeAsync(4000);
  pending.resolve(stats(1, 10000));
  run.setStats(() => new Promise(() => {}));
  await vi.advanceTimersByTimeAsync(0);
  expect(run.current.projectCoverageCurrent).toBe(true);
  // A 30-second limit less 10 seconds producer age and 4 seconds full RTT
  // expires at t=20s; the following scan must not restart that proof.
  await vi.advanceTimersByTimeAsync(10000);
  run.scan(2);
  expect(run.current.projectCoverageCurrent).toBe(true);
  await vi.advanceTimersByTimeAsync(5999);
  expect(run.current.projectCoverageCurrent).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(run.current.projectCoverageCurrent).toBe(false);
});
