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

it('uses shared all-agent scope with attribution filtering and ignores it for a selected agent', async () => {
  const telemetry = {
    ...state(),
    events: [
      {
        agent: 'Codex',
        instanceId: '1:new',
        file: '/codex.txt',
        timestamp: Date.now(),
        action: 'read',
        attribution: { status: 'confirmed' },
      },
      {
        agent: '',
        instanceId: null,
        file: '/unattributed.txt',
        timestamp: Date.now(),
        action: 'change',
        attribution: { status: 'unattributed' },
      },
    ],
  };
  const { rerender } = render(Events, {
    telemetry,
    inspect: vi.fn(),
    scope: { agent: '', instanceId: '' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Filters', exact: true }));
  expect(screen.queryByLabelText('Event agent')).not.toBeInTheDocument();
  expect(screen.getByText('codex.txt')).toBeInTheDocument();
  expect(screen.getByText('unattributed.txt')).toBeInTheDocument();
  const attribution = screen.getByRole('combobox', { name: 'Attribution', exact: true });
  expect([...attribution.options].map((option) => option.value)).toEqual(['all', 'unattributed']);
  await fireEvent.change(attribution, { target: { value: 'unattributed' } });
  expect(screen.queryByText('codex.txt')).not.toBeInTheDocument();
  expect(screen.getByText('unattributed.txt')).toBeInTheDocument();
  await rerender({ scope: { agent: 'Codex', instanceId: '' } });
  expect(screen.queryByRole('combobox', { name: 'Attribution' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Event agent')).not.toBeInTheDocument();
  expect(screen.getByText('codex.txt')).toBeInTheDocument();
  expect(screen.queryByText('unattributed.txt')).not.toBeInTheDocument();
  expect(screen.queryByText('Filters active')).not.toBeInTheDocument();
  await rerender({ scope: { agent: '', instanceId: '' } });
  expect(screen.getByRole('combobox', { name: 'Attribution' })).toHaveValue('unattributed');
  await fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
  expect(screen.getByRole('combobox', { name: 'Attribution' })).toHaveValue('all');
  expect(screen.getByText('codex.txt')).toBeInTheDocument();
  expect(screen.getByText('unattributed.txt')).toBeInTheDocument();
});

it('preserves the standalone agent filter when Events has no external scope', async () => {
  const telemetry = {
    ...state(),
    events: [
      { agent: 'Codex', instanceId: '1:new', file: '/codex.txt', timestamp: Date.now() },
      { agent: 'Claude', instanceId: '2:new', file: '/claude.txt', timestamp: Date.now() },
    ],
  };
  render(Events, { telemetry, inspect: vi.fn() });
  await fireEvent.click(screen.getByRole('button', { name: 'Filters', exact: true }));
  await fireEvent.change(screen.getByLabelText('Event agent'), { target: { value: 'Codex' } });
  expect(screen.getByText('codex.txt')).toBeInTheDocument();
  expect(screen.queryByText('claude.txt')).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Attribution' })).not.toBeInTheDocument();
});
