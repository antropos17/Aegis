import { expect, it } from 'vitest';
import { scopeStatistics } from '../../frontend/observatory/runtime/statistics-scope';
import { emptyTelemetry } from '../../frontend/observatory/runtime/host';
import {
  createStatisticsHistory,
  observeStatistics,
} from '../../frontend/observatory/runtime/statistics-history';
const state = () => ({
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  lastScan: 1000,
  resourcesAt: 1000,
  tokensAt: 1000,
  networkAt: 1000,
  agents: [
    { agent: 'Codex', pid: 1, instanceId: '1:new' },
    { agent: 'Codex', pid: 2, instanceId: '2:new' },
    { agent: 'Claude', pid: 3, instanceId: '3:new' },
    { agent: 'Codex', pid: 4 },
  ],
  resources: [
    { instanceId: '1:new', cpu: 10, memMb: 100 },
    { instanceId: '2:new', cpu: 20, memMb: 200 },
    { instanceId: '3:new', cpu: 70, memMb: 700 },
    { instanceId: '1:old', pid: 1, cpu: 999, memMb: 999 },
  ],
  tokens: [
    { instanceId: '1:new', totalTokens: 50 },
    { instanceId: '3:new', totalTokens: 999 },
  ],
  network: [{ instanceId: '1:new' }, { instanceId: '3:new' }, { pid: 1 }],
  events: [
    { instanceId: '1:new', file: 'a', timestamp: 1000 },
    { instanceId: '1:new', file: 'b', timestamp: 1000, attribution: { status: 'unattributed' } },
    { instanceId: '1:new', file: 'c', timestamp: 1000, selfAccess: true },
    { instanceId: '3:new', file: 'd', timestamp: 1000 },
  ],
  scanCounters: { files: 999, sensitive: 50, evicted: 10 },
});
it('filters by stamped identity, excludes other agents and keeps missing identity coverage', () => {
  const scoped = scopeStatistics(state(), { agent: 'Codex', instanceId: '' });
  expect(scoped.agents).toHaveLength(3);
  expect(scoped.resources.map((row) => row.cpu)).toEqual([10, 20]);
  expect(scoped.tokens.map((row) => row.totalTokens)).toEqual([50]);
  expect(scoped.network).toHaveLength(1);
  expect(scoped.events.map((row) => row.file)).toEqual(['a']);
  const history = observeStatistics(createStatisticsHistory(), scoped);
  expect(history.samples[0].values.cpu).toBe(30);
  expect(history.samples[0].coverage.cpu).toEqual({ measured: 2, total: 3 });
});
it('never includes a replacement process with a recycled PID', () => {
  const scoped = scopeStatistics(state(), { agent: 'Codex', instanceId: '1:old' });
  expect(scoped.agents).toEqual([]);
  expect(scoped.resources).toEqual([]);
  expect(scoped.stale).toBe(true);
});
it('selects one process without turning global counters into per-agent rates', () => {
  const scope = { agent: 'Codex', instanceId: '1:new' };
  const first = scopeStatistics(state(), scope);
  let history = observeStatistics(createStatisticsHistory(), first);
  const second = scopeStatistics(
    { ...state(), lastScan: 2000, scanCounters: { files: 2000, sensitive: 100, evicted: 20 } },
    scope,
  );
  history = observeStatistics(history, second);
  expect(history.samples[0].values.cpu).toBe(10);
  expect(history.samples.at(-1).values.fileRate).toBeNull();
  expect(history.samples.at(-1).values.sensitiveRate).toBeNull();
  expect(scopeStatistics(state(), { agent: '', instanceId: '' }).scanCounters.files).toBe(999);
});
