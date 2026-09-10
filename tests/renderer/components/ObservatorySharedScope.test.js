import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import Statistics from '../../../frontend/observatory/components/Statistics.svelte';
import Events from '../../../frontend/observatory/components/Events.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';
const state = () => ({
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  lastScan: Date.now(),
  resourcesAt: Date.now(),
  agents: [
    { agent: 'Codex', pid: 1, instanceId: '1:new', process: 'codex' },
    { agent: 'Claude', pid: 2, instanceId: '2:new', process: 'claude' },
  ],
  resources: [
    { instanceId: '1:new', cpu: 10, memMb: 100 },
    { instanceId: '2:new', cpu: 70, memMb: 700 },
  ],
});
it('follows shared statistics scope without resetting the selected section or exposing duplicate selectors', async () => {
  const { container, rerender } = render(Statistics, {
    telemetry: state(),
    inspect: vi.fn(),
    scope: { agent: 'Codex', instanceId: '' },
  });
  const current = () => container.querySelector('.monitor-detail .current');
  await waitFor(() => expect(current()).toHaveTextContent('10'));
  expect(screen.queryByLabelText('Statistics agent')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Statistics process')).not.toBeInTheDocument();
  await fireEvent.click(screen.getByRole('tab', { name: 'Tokens', exact: true }));
  await rerender({
    scope: { agent: 'Claude', instanceId: '2:new' },
    scopeRequest: { agent: 'Codex', revision: 1 },
  });
  expect(screen.getByRole('tab', { name: 'Tokens', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await fireEvent.click(screen.getByRole('tab', { name: 'Performance', exact: true }));
  await waitFor(() => expect(current()).toHaveTextContent('70'));
  await rerender({ scope: { agent: 'Claude', instanceId: '2:departed' } });
  expect(screen.getByText(/Selection no longer observed/)).toBeInTheDocument();
  expect(current()).not.toHaveTextContent('70');
  await fireEvent.click(screen.getByRole('tab', { name: 'Sensors', exact: true }));
  await rerender({ scope: { agent: 'Codex', instanceId: '' } });
  expect(screen.getByRole('tab', { name: 'Sensors', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByText(/AEGIS main process/)).toBeInTheDocument();
});
it('keeps paused event snapshots reusable across shared scope changes and retains departed process evidence', async () => {
  const event = (agent, instanceId, file) => ({
    agent,
    instanceId,
    file,
    timestamp: Date.now(),
    action: 'read',
    attribution: { status: 'confirmed' },
  });
  const telemetry = {
    ...state(),
    events: [
      event('Codex', '1:departed', '/old-codex.txt'),
      event('Claude', '2:new', '/claude.txt'),
    ],
  };
  const { rerender } = render(Events, {
    telemetry,
    inspect: vi.fn(),
    scope: { agent: 'Codex', instanceId: '1:departed' },
  });
  expect(screen.getByText('old-codex.txt')).toBeInTheDocument();
  expect(screen.queryByText('claude.txt')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Event agent')).not.toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: 'Pause view', exact: true }));
  await rerender({
    telemetry: { ...telemetry, events: [] },
    scope: { agent: 'Claude', instanceId: '' },
  });
  expect(screen.getByText('claude.txt')).toBeInTheDocument();
  expect(screen.queryByText('old-codex.txt')).not.toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
  expect(screen.getByText('claude.txt')).toBeInTheDocument();
  expect(screen.queryByLabelText('Event agent')).not.toBeInTheDocument();
});
it('applies the same exact scope to the network view', () => {
  const telemetry = {
    ...state(),
    network: [
      { agent: 'Codex', instanceId: '1:departed', remoteIp: '192.0.2.1', remotePort: 443 },
      { agent: 'Codex', instanceId: '1:new', remoteIp: '192.0.2.2', remotePort: 443 },
    ],
  };
  render(Events, {
    telemetry,
    inspect: vi.fn(),
    network: true,
    scope: { agent: 'Codex', instanceId: '1:departed' },
  });
  expect(screen.getByText('192.0.2.1:443')).toBeInTheDocument();
  expect(screen.queryByText('192.0.2.2:443')).not.toBeInTheDocument();
});
