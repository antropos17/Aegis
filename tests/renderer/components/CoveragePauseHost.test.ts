import { afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import CoveragePanel from '../../../frontend/observatory/components/CoveragePanel.svelte';
import {
  connectHost,
  type Host,
  type RecordData,
  type Telemetry,
} from '../../../frontend/observatory/runtime/host';
import { coverageFixture } from '../coverage-fixture';

afterEach(() => vi.useRealTimers());

it('shows only confirmed pause and current admitted coverage across resume, replay and loss', async () => {
  vi.useFakeTimers();
  const initial = coverageFixture();
  (initial.stats.appHealth as Record<string, unknown>).watchPlan = { projectState: 'observed' };
  let producer: RecordData = { ...initial.stats, monitoringPopulationRevision: '1' };
  let response: () => Promise<unknown> = async () => producer;
  const callbacks = new Map<string, (value: unknown) => void>();
  const host = new Proxy({} as Host, {
    get: (_, key) => {
      if (String(key).startsWith('on'))
        return (callback: (value: unknown) => void) => {
          callbacks.set(String(key), callback);
          return () => callbacks.delete(String(key));
        };
      if (key === 'getStats') return () => response();
      if (key === 'getFalsePositives') return async () => [];
      return async () => ({});
    },
  });
  let current: Telemetry = initial;
  const view = render(CoveragePanel, {
    telemetry: current,
    navigate: vi.fn(),
    openSensorDetails: vi.fn(),
  });
  const dispose = connectHost(host, (value) => {
    current = value;
  });
  const show = async () => {
    await vi.advanceTimersByTimeAsync(0);
    await view.rerender({ telemetry: current });
    await tick();
  };
  const project = screen.getByRole('region', { name: 'Project changes' });
  const scan = (stats = producer, populationCurrent = true) =>
    callbacks.get('onScanBatch')?.({ ...initial, stats, populationCurrent });
  try {
    await show();
    scan();
    await show();
    expect(project).toHaveTextContent('Observed');
    producer = {
      ...producer,
      monitoringGeneration: '1',
      monitoringPaused: true,
      monitoringPopulationReady: false,
    };
    callbacks.get('onStatsUpdate')?.(producer);
    await vi.advanceTimersByTimeAsync(2000);
    await show();
    expect(project).toHaveTextContent('Paused');
    expect(project).toHaveTextContent('Current project change coverage is unknown.');
    let resolveLate: (value: unknown) => void = () => {};
    response = () =>
      new Promise((resolve) => {
        resolveLate = resolve;
      });
    await vi.advanceTimersByTimeAsync(25000);
    await show();
    expect(project).not.toHaveTextContent('Paused');
    resolveLate(producer);
    await show();
    expect(project).not.toHaveTextContent('Paused');
    producer = {
      ...producer,
      monitoringGeneration: '2',
      monitoringPaused: false,
      monitoringPopulationReady: false,
    };
    response = async () => producer;
    callbacks.get('onStatsUpdate')?.(producer);
    await vi.advanceTimersByTimeAsync(2000);
    await show();
    expect(project).toHaveTextContent('Unknown');
    callbacks.get('onScanBatch')?.({ agents: [] });
    expect(current.stale).toBe(true);
    producer = { ...producer, monitoringPopulationRevision: '2', monitoringPopulationReady: true };
    scan();
    await vi.advanceTimersByTimeAsync(2000);
    await show();
    expect(project).toHaveTextContent('Observed');
    producer = { ...producer, monitoringPopulationRevision: '3' };
    scan();
    await show();
    expect(project).toHaveTextContent('Observed');
    scan({ ...producer, monitoringPopulationRevision: '2' });
    await show();
    expect(project).toHaveTextContent('Observed');
    producer = { ...producer, monitoringGeneration: '4' };
    await vi.advanceTimersByTimeAsync(20000);
    await show();
    expect(project).toHaveTextContent('Unknown');
    scan({ ...producer, monitoringGeneration: '2', monitoringPopulationRevision: '4' });
    await show();
    expect(project).toHaveTextContent('Unknown');
  } finally {
    dispose();
  }
});

it.each([
  ['expired age', { monitoringPopulationAgeMs: 30000 }],
  ['negative age', { monitoringPopulationAgeMs: -1 }],
  ['invalid age', { monitoringPopulationAgeMs: NaN }],
  ['unready witness', { monitoringPopulationReady: false }],
  ['invalid monitoring state', { monitoringPaused: null }],
  ['missing observation gap', { observationGap: {} }],
  ['unknown observation gap', { observationGap: { state: 'PRIVATE_UNKNOWN' } }],
  [
    'missing identity health',
    { appHealth: { populationReliable: true, watchPlan: { projectState: 'observed' } } },
  ],
])('keeps project coverage unknown for %s', async (_label, override) => {
  vi.useFakeTimers();
  const initial = coverageFixture();
  (initial.stats.appHealth as Record<string, unknown>).watchPlan = { projectState: 'observed' };
  const stats = { ...initial.stats, ...override, monitoringPopulationRevision: '1' };
  const callbacks = new Map<string, (value: unknown) => void>();
  const host = new Proxy({} as Host, {
    get: (_, key) => {
      if (String(key).startsWith('on'))
        return (callback: (value: unknown) => void) => {
          callbacks.set(String(key), callback);
          return () => callbacks.delete(String(key));
        };
      if (key === 'getStats') return async () => stats;
      if (key === 'getFalsePositives') return async () => [];
      return async () => ({});
    },
  });
  let current: Telemetry = initial;
  const view = render(CoveragePanel, {
    telemetry: current,
    navigate: vi.fn(),
    openSensorDetails: vi.fn(),
  });
  const dispose = connectHost(host, (value) => {
    current = value;
  });
  try {
    await vi.advanceTimersByTimeAsync(0);
    callbacks.get('onScanBatch')?.({ ...initial, stats, populationCurrent: true });
    await vi.advanceTimersByTimeAsync(0);
    await view.rerender({ telemetry: current });
    expect(screen.getByRole('region', { name: 'Project changes' })).toHaveTextContent('Unknown');
  } finally {
    dispose();
  }
});

it('includes the whole live request duration in the producer scan age bound', async () => {
  vi.useFakeTimers();
  const initial = coverageFixture();
  (initial.stats.appHealth as Record<string, unknown>).watchPlan = { projectState: 'observed' };
  const stats = {
    ...initial.stats,
    monitoringPopulationRevision: '1',
    monitoringPopulationAgeMs: 29000,
  };
  const callbacks = new Map<string, (value: unknown) => void>();
  let slow = false;
  const host = new Proxy({} as Host, {
    get: (_, key) => {
      if (String(key).startsWith('on'))
        return (callback: (value: unknown) => void) => {
          callbacks.set(String(key), callback);
          return () => callbacks.delete(String(key));
        };
      if (key === 'getStats')
        return () =>
          slow
            ? new Promise((resolve) => setTimeout(() => resolve(stats), 2000))
            : Promise.resolve(stats);
      if (key === 'getFalsePositives') return async () => [];
      return async () => ({});
    },
  });
  let current: Telemetry = initial;
  const view = render(CoveragePanel, {
    telemetry: current,
    navigate: vi.fn(),
    openSensorDetails: vi.fn(),
  });
  const dispose = connectHost(host, (value) => {
    current = value;
  });
  try {
    await vi.advanceTimersByTimeAsync(0);
    slow = true;
    callbacks.get('onScanBatch')?.({ ...initial, stats, populationCurrent: true });
    await vi.advanceTimersByTimeAsync(2000);
    await view.rerender({ telemetry: current });
    expect(screen.getByRole('region', { name: 'Project changes' })).toHaveTextContent('Unknown');
  } finally {
    dispose();
  }
});
