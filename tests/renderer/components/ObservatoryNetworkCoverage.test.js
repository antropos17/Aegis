import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/svelte';
import App from '../../../frontend/observatory/App.svelte';
import Events from '../../../frontend/observatory/components/Events.svelte';
import MonitoringSummary from '../../../frontend/observatory/components/MonitoringSummary.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

const state = (networkState, networkAt = null, network = []) => ({
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  lastScan: 1000,
  networkAt,
  network,
  stats: { appHealth: { sensors: { byId: { network: { state: networkState } } } } },
});

it('keeps network counts unavailable until a healthy delivery and labels retained rows after sensor failure', async () => {
  const inspect = vi.fn();
  const initial = state('HEALTHY');
  const events = render(Events, { telemetry: initial, network: true, showPause: false, inspect });
  const summary = render(MonitoringSummary, {
    telemetry: initial,
    recentCount: 0,
    inspect,
  });
  const status = events.container.querySelector('.evidence-status');
  const connections = within(summary.container).getByRole('button', { name: /Connections/ });
  expect(status).toHaveTextContent('Network observation unavailable');
  expect(status).not.toHaveTextContent('Live view');
  expect(within(events.container).queryByRole('table')).toBeNull();
  expect(
    within(events.container).getByText(
      'No current network snapshot. Check sensor health in Statistics.',
    ),
  ).toBeInTheDocument();
  expect(connections.querySelector('strong')).toHaveTextContent('—');

  const starting = state('STARTING', 2000);
  await events.rerender({ telemetry: starting });
  await summary.rerender({ telemetry: starting });
  expect(status).toHaveTextContent('Network observation unavailable');
  expect(within(events.container).queryByRole('table')).toBeNull();
  expect(connections.querySelector('strong')).toHaveTextContent('—');

  const retained = state('FAILED', 2000, [{ remoteIp: '192.0.2.1', remotePort: 443 }]);
  await events.rerender({ telemetry: retained });
  await summary.rerender({ telemetry: retained });
  expect(status).toHaveTextContent('1 of 1 connections · Retained network snapshot');
  expect(within(events.container).getByRole('table')).toHaveTextContent('192.0.2.1:443');
  expect(connections.querySelector('strong')).toHaveTextContent('1');
  expect(connections).toHaveTextContent('Retained network snapshot');

  const deliveredEmpty = state('HEALTHY', 3000);
  await events.rerender({ telemetry: deliveredEmpty });
  await summary.rerender({ telemetry: deliveredEmpty });
  expect(status).toHaveTextContent('0 of 0 connections · Latest connection snapshot');
  expect(within(events.container).getByRole('table')).toBeInTheDocument();
  expect(connections.querySelector('strong')).toHaveTextContent('0');
  expect(connections).toHaveTextContent('0 unverified endpoints');
});

it('uses network coverage for the Network heading while other page headings keep process status', async () => {
  const listeners = {};
  const host = {
    getStats: async () => ({}),
    getResourceUsage: async () => ({}),
    getFalsePositives: async () => [],
    getSettings: async () => ({}),
    getAppVersion: async () => 'test',
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
      return () => delete listeners[name];
    };
  }
  const mounted = render(App, { host });
  const scan = async (networkState) =>
    act(() =>
      listeners.onScanBatch({
        agents: [],
        stats: {
          appHealth: {
            state: 'HEALTHY',
            populationReliable: true,
            sensors: { byId: { network: { state: networkState } } },
          },
        },
      }),
    );
  await scan('FAILED');
  await fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', {
      name: 'Network',
    }),
  );
  const badge = mounted.container.querySelector('.page-head .live-badge');
  expect(badge).toHaveTextContent('Network observation unavailable');
  expect(badge).not.toHaveTextContent('Live');
  await scan('STARTING');
  expect(badge).toHaveTextContent('Network observation unavailable');
  await act(() => listeners.onNetworkUpdate([]));
  await scan('HEALTHY');
  expect(badge).toHaveTextContent('Latest connection snapshot');
  await fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', {
      name: 'Events',
    }),
  );
  expect(badge).toHaveTextContent('Live');
});
