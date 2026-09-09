import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import ResourceUsage from '../../../frontend/observatory/components/ResourceUsage.svelte';
import { emptyTelemetry, instances } from '../../../frontend/observatory/runtime/host';
import { radarGroups } from '../../../frontend/observatory/runtime/radar';
import { measuredGroupResource } from '../../../frontend/observatory/runtime/resources';

const agent = (pid, name = 'Codex', identity = pid + ':current') => ({
  agent: name,
  pid,
  process: 'agent.exe',
  instanceId: identity,
  instanceIdSource: 'os',
});
const state = () => ({
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  resourcesAt: 10000,
  agents: [agent(1), agent(2), agent(3), agent(4, 'Codex', null), agent(10, 'Cursor')],
  resources: [
    { instanceId: '1:current', cpu: 5, memMb: 100 },
    { instanceId: '2:current', memMb: 200 },
    { instanceId: '10:current', cpu: 0, memMb: 600 },
    { instanceId: '3:retired', pid: 3, cpu: 99, memMb: 999 },
    { instanceId: null, pid: 4, cpu: 99, memMb: 999 },
  ],
});
const codex = (s) => radarGroups(instances(s)).find((group) => group.name === 'Codex');

it('keeps measured group subtotals with per-field coverage and excludes reused PIDs and unkeyed rows', () => {
  const s = state();
  expect(measuredGroupResource(codex(s), s, 'cpu')).toMatchObject({
    value: 5,
    measured: 1,
    total: 4,
  });
  expect(measuredGroupResource(codex(s), s, 'memMb')).toMatchObject({
    value: 300,
    measured: 2,
    total: 4,
  });
});

it('rejects ambiguous, negative and non-finite rows without erasing another measured process', () => {
  const s = state();
  s.resources.push({ instanceId: '1:current', cpu: 20, memMb: 20 });
  expect(measuredGroupResource(codex(s), s, 'memMb')).toMatchObject({
    value: 200,
    measured: 1,
    total: 4,
  });
  expect(measuredGroupResource(codex(s), s, 'cpu').value).toBeNull();
  s.resources.push({ instanceId: '3:current', cpu: -4, memMb: Infinity });
  expect(measuredGroupResource(codex(s), s, 'cpu').value).toBeNull();
  expect(measuredGroupResource(codex(s), s, 'memMb').value).toBe(200);
});

it('counts a duplicated stamped member once and rejects measurements for a retired group identity', () => {
  const s = state();
  s.agents.push(agent(1));
  expect(measuredGroupResource(codex(s), s, 'cpu')).toMatchObject({
    value: 5,
    measured: 1,
    total: 4,
  });
  const oldGroup = codex(s);
  s.agents = [agent(1, 'Codex', '1:replacement')];
  expect(measuredGroupResource(oldGroup, s, 'cpu').value).toBeNull();
});

it('shows partial CPU and memory bars at their actual scales and keeps measured zero distinct from unavailable', async () => {
  const inspect = vi.fn();
  render(ResourceUsage, { telemetry: state(), inspect });
  const row = screen.getByRole('button', { name: /Codex/ });
  expect(within(row).getByText('5.0%')).toBeInTheDocument();
  expect(row).toHaveTextContent('1/4 processes measured · partial');
  expect(row.querySelector('.usage-track')).toHaveClass('partial');
  expect(row.querySelector('.usage-track > span').style.transform).toBe('scaleX(0.05)');
  const cursor = screen.getByRole('button', { name: /Cursor/ });
  expect(within(cursor).getByText('0.0%')).toBeInTheDocument();
  expect(cursor.querySelector('.usage-track')).not.toHaveClass('unavailable');
  await fireEvent.click(screen.getByRole('button', { name: 'RAM', exact: true }));
  expect(within(row).getByText('300.0 MB')).toBeInTheDocument();
  expect(row).toHaveTextContent('2/4 processes measured · partial');
  expect(row.querySelector('.usage-track > span').style.transform).toBe('scaleX(0.5)');
  expect(cursor.querySelector('.usage-track > span').style.transform).toBe('scaleX(1)');
  await fireEvent.click(row);
  expect(inspect).toHaveBeenCalledWith('Codex', { agentGroupKey: 'Codex', name: 'Codex' });
});

it('does not render a current numeric reading during an outage or before a reliable population', async () => {
  const s = state();
  const { rerender } = render(ResourceUsage, { telemetry: s, inspect: vi.fn() });
  await rerender({ telemetry: { ...s, stale: true } });
  expect(screen.queryByText('5.0%')).toBeNull();
  const row = screen.getByRole('button', { name: /Codex/ });
  expect(row).toHaveTextContent('Readings paused');
  expect(row.querySelector('.usage-track')).toHaveClass('unavailable');
  expect(within(row).getByText('—')).toBeInTheDocument();
  await rerender({ telemetry: { ...s, ready: false } });
  expect(within(row).getByText('—')).toBeInTheDocument();
});

it('normalizes fractional MB totals against the actual largest subtotal and keeps all-zero scales finite', async () => {
  const s = {
    ...state(),
    resources: [
      { instanceId: '1:current', memMb: 0.25 },
      { instanceId: '10:current', memMb: 0.5 },
    ],
  };
  const { rerender } = render(ResourceUsage, { telemetry: s, inspect: vi.fn() });
  await fireEvent.click(screen.getByRole('button', { name: 'RAM', exact: true }));
  const codexRow = screen.getByRole('button', { name: /Codex/ });
  const cursorRow = screen.getByRole('button', { name: /Cursor/ });
  expect(codexRow.querySelector('.usage-track > span').style.transform).toBe('scaleX(0.5)');
  expect(cursorRow.querySelector('.usage-track > span').style.transform).toBe('scaleX(1)');
  await rerender({
    telemetry: { ...s, resources: s.resources.map((row) => ({ ...row, memMb: 0 })) },
  });
  expect(codexRow.querySelector('.usage-track > span').style.transform).toBe('scaleX(0)');
  expect(cursorRow.querySelector('.usage-track > span').style.transform).toBe('scaleX(0)');
});
