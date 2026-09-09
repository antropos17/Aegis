import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/svelte';
import { emptyTelemetry, instances } from '../../../frontend/observatory/runtime/host';
import {
  radarGroups,
  groupEvidence,
  groupRecord,
} from '../../../frontend/observatory/runtime/radar';
import Agents from '../../../frontend/observatory/components/Agents.svelte';
import ResourceUsage from '../../../frontend/observatory/components/ResourceUsage.svelte';
import Details from '../../../frontend/observatory/components/Details.svelte';
import ActivityChart from '../../../frontend/observatory/components/ActivityChart.svelte';

const agent = (pid, name = 'Claude Code') => ({
  agent: name,
  pid,
  process: 'claude.exe',
  instanceId: `${pid}:live`,
  instanceIdSource: 'os',
  cwd: `X:/project-${pid}`,
});
const state = () => ({
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  agents: [agent(10), agent(20), agent(30, 'Cursor')],
  resources: [
    { instanceId: '10:live', cpu: 2, memMb: 100 },
    { instanceId: '20:live', cpu: 3, memMb: 200 },
  ],
  events: [
    { instanceId: '10:live', agent: 'Claude Code', file: 'X:/shared', timestamp: 100 },
    { instanceId: '20:live', agent: 'Claude Code', file: 'X:/shared', timestamp: 200 },
    { instanceId: null, agent: 'Claude Code', file: 'X:/unknown', timestamp: 300 },
  ],
  tokens: [{ instanceId: '10:live', totalTokens: 50, costUsd: 0.1 }],
});

it('renders one row per product, aggregates complete resources and keeps a PID search at product scope', async () => {
  const inspect = vi.fn();
  const mounted = render(Agents, { telemetry: state(), inspect });
  expect(mounted.container.querySelectorAll('.agent-group-row')).toHaveLength(2);
  const claude = screen.getByRole('button', { name: 'Claude Code', exact: true }).closest('tr');
  expect(within(claude).getByText('5.0%')).toBeInTheDocument();
  expect(within(claude).getByText('300.0 MB')).toBeInTheDocument();
  expect(within(claude).getByRole('button', { name: '2 processes' })).toBeInTheDocument();
  await fireEvent.input(screen.getByLabelText('Search agents'), {
    target: { value: 'project-20' },
  });
  expect(mounted.container.querySelectorAll('.agent-group-row')).toHaveLength(1);
  expect(screen.getByText('5.0%')).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: 'Open', exact: true }));
  expect(inspect).toHaveBeenCalledWith('Claude Code', {
    agentGroupKey: 'Claude Code',
    name: 'Claude Code',
  });
  await mounted.rerender({ telemetry: { ...state(), stale: true } });
  expect(screen.queryByText('5.0%')).toBeNull();
});

it('does not repeat product usage bars or fabricate missing measurements', async () => {
  const inspect = vi.fn();
  const { container } = render(ResourceUsage, { telemetry: state(), inspect });
  expect(container.querySelectorAll('.usage-row')).toHaveLength(2);
  expect(screen.getByText('5.0%')).toBeInTheDocument();
  expect(screen.getByText('—')).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: /Claude Code/ }));
  expect(inspect.mock.calls[0][1]).not.toHaveProperty('instanceId');
});

it('keeps missing-identity observations out of product totals and incomplete tokens unknown', () => {
  const s = state();
  const group = radarGroups(instances(s)).find((g) => g.name === 'Claude Code');
  expect(groupEvidence(group, s)).toMatchObject({
    files: 1,
    latest: 200,
    tokens: null,
    cost: null,
  });
  s.tokens.push({ instanceId: '20:live', totalTokens: 70, costUsd: 0.2 });
  expect(groupEvidence(group, s).tokens).toBe(120);
});

it('opens the group without process controls and resolves a chosen member to its own stamped identity', async () => {
  const host = { suspendProcess: vi.fn(async () => ({ success: true })) };
  const group = radarGroups(instances(state())).find((g) => g.name === 'Claude Code');
  render(Details, {
    host,
    telemetry: state(),
    request: { title: group.name, row: groupRecord(group) },
    close: vi.fn(),
    refreshFalsePositives: vi.fn(),
  });
  await screen.findByText('Agent overview');
  expect(screen.queryByRole('button', { name: 'Suspend', exact: true })).toBeNull();
  await fireEvent.click(screen.getByRole('tab', { name: /Processes/ }));
  await fireEvent.click(screen.getByRole('button', { name: 'Open process PID 20', exact: true }));
  await fireEvent.click(await screen.findByRole('tab', { name: 'Controls', exact: true }));
  await fireEvent.click(await screen.findByRole('button', { name: 'Suspend', exact: true }));
  await waitFor(() =>
    expect(host.suspendProcess).toHaveBeenCalledWith({ pid: 20, instanceId: '20:live' }),
  );
});

it('offers one activity filter for the same product across multiple processes', async () => {
  render(ActivityChart, { props: { events: state().events, observedAt: 1000, inspect: vi.fn() } });
  const select = screen.getByLabelText('Chart agent');
  expect(within(select).getAllByRole('option')).toHaveLength(2);
  await fireEvent.change(select, { target: { value: 'Claude Code' } });
  expect(screen.getByText('3')).toBeInTheDocument();
});
