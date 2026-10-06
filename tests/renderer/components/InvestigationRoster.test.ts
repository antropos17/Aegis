import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import InvestigationRoster from '../../../frontend/observatory/components/InvestigationRoster.svelte';
import { emptyTelemetry, type Telemetry } from '../../../frontend/observatory/runtime/host';

function state(workers: Array<{ agent: string; pid: number; instanceId: string }>): Telemetry {
  return {
    ...emptyTelemetry(),
    ready: true,
    stale: false,
    agents: workers.map((worker) => ({
      ...worker,
      process: 'agent.exe',
      instanceIdSource: 'os',
      cwd: null,
    })) as unknown as Telemetry['agents'],
  };
}
const codex = { agent: 'Codex', pid: 42, instanceId: '42:old' };
const claude = { agent: 'Claude Code', pid: 52, instanceId: '52:old' };

it('selects a product scope explicitly and clears both fields for All agents', async () => {
  const change = vi.fn();
  render(InvestigationRoster, {
    telemetry: state([codex, { ...codex, pid: 43, instanceId: '43:old' }, claude]),
    scope: { agent: 'Codex', instanceId: codex.instanceId },
    change,
  });
  const selected = screen.getByRole('button', { name: 'Codex' });
  expect(selected).toHaveAttribute('aria-pressed', 'true');
  expect(within(selected).getByText(/2 worker processes/)).toBeVisible();
  const next = screen.getByRole('button', { name: 'Claude Code' });
  next.focus();
  expect(next).toHaveFocus();
  await fireEvent.click(next);
  expect(change).toHaveBeenNthCalledWith(1, { agent: 'Claude Code', instanceId: '' });
  await fireEvent.click(screen.getByRole('button', { name: 'All agents' }));
  expect(change).toHaveBeenNthCalledWith(2, { agent: '', instanceId: '' });
  expect(change).toHaveBeenCalledTimes(2);
});

it('distinguishes an unavailable initial population from a reliable empty observation', async () => {
  const mounted = render(InvestigationRoster, {
    telemetry: emptyTelemetry(),
    scope: { agent: '', instanceId: '' },
    change: vi.fn(),
  });
  expect(screen.getByText('Waiting for reliable agent observations.')).toBeVisible();
  expect(screen.queryByText('No observed agents.')).toBeNull();
  await mounted.rerender({ telemetry: state([]) });
  expect(screen.getByText('No observed agents.')).toBeVisible();
  expect(screen.queryByText('Waiting for reliable agent observations.')).toBeNull();
});

it('retains a departed selected product and never retargets a reused PID', async () => {
  const change = vi.fn();
  const scope = { agent: 'Codex', instanceId: codex.instanceId };
  const mounted = render(InvestigationRoster, { telemetry: state([codex, claude]), scope, change });
  const selected = screen.getByRole('button', { name: 'Codex' });
  selected.focus();
  await mounted.rerender({
    telemetry: state([{ ...claude, pid: codex.pid, instanceId: '42:new' }]),
  });
  expect(screen.getByRole('button', { name: 'Codex' })).toBe(selected);
  expect(selected).toHaveFocus();
  expect(selected).toHaveAttribute('aria-pressed', 'true');
  expect(within(selected).getByText('Not currently observed')).toBeVisible();
  expect(within(selected).getByText('Risk unavailable')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Claude Code' })).toHaveAttribute('aria-pressed', 'false');
  expect(change).not.toHaveBeenCalled();
  await mounted.rerender({ telemetry: state([{ ...codex, instanceId: '42:new' }]) });
  expect(scope).toEqual({ agent: 'Codex', instanceId: '42:old' });
  expect(change).not.toHaveBeenCalled();
});

it('filters product names without clearing scope or hiding a departed selected product', async () => {
  const change = vi.fn();
  const mounted = render(InvestigationRoster, {
    telemetry: state([codex, claude]),
    scope: { agent: 'Codex', instanceId: codex.instanceId },
    change,
  });
  await fireEvent.input(screen.getByRole('searchbox', { name: 'Search agents' }), {
    target: { value: 'claude' },
  });
  expect(screen.queryByRole('button', { name: 'Codex' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Claude Code' })).toBeVisible();
  expect(change).not.toHaveBeenCalled();
  await mounted.rerender({ telemetry: state([claude]) });
  expect(screen.getByRole('button', { name: 'Codex' })).toHaveAttribute('aria-pressed', 'true');
  expect(change).not.toHaveBeenCalled();
});

it('appends new products without reordering existing choices or moving keyboard focus', async () => {
  const mounted = render(InvestigationRoster, {
    telemetry: state([codex, claude]),
    scope: { agent: '', instanceId: '' },
    change: vi.fn(),
  });
  const order = screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'));
  const focused = screen.getByRole('button', { name: 'Codex' });
  focused.focus();
  await mounted.rerender({
    telemetry: state([{ agent: 'Amber', pid: 9, instanceId: '9:new' }, claude, codex]),
  });
  expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
    ...order,
    'Amber',
  ]);
  expect(focused).toHaveFocus();
});

it('qualifies risk from a retained population and leaves missing identity risk unavailable', async () => {
  const mounted = render(InvestigationRoster, {
    telemetry: { ...state([codex]), stale: true },
    scope: { agent: '', instanceId: '' },
    change: vi.fn(),
  });
  expect(screen.getByText(/Retained highest risk/)).toBeVisible();
  expect(screen.getByText(/Last snapshot/)).toBeVisible();
  await mounted.rerender({ telemetry: state([{ ...codex, instanceId: '42:u' }]) });
  expect(screen.getByText('Risk unavailable')).toBeVisible();
});

it('compact product selection clears process scope without changing the desktop search draft', async () => {
  const change = vi.fn();
  const mounted = render(InvestigationRoster, {
    telemetry: state([codex, claude]),
    scope: { agent: 'Codex', instanceId: codex.instanceId },
    change,
  });
  const search = screen.getByRole('searchbox', { name: 'Search agents' });
  await fireEvent.input(search, { target: { value: 'claude' } });
  const selector = screen.getByLabelText('Agent / context');
  expect(selector).toHaveValue('Codex');
  expect(within(selector).getByRole('option', { name: 'Codex', hidden: true })).toBeInTheDocument();
  await fireEvent.change(selector, { target: { value: 'Claude Code' } });
  expect(change).toHaveBeenNthCalledWith(1, { agent: 'Claude Code', instanceId: '' });
  await mounted.rerender({ scope: { agent: 'Claude Code', instanceId: '' } });
  expect(search).toHaveValue('claude');
  await fireEvent.change(selector, { target: { value: '' } });
  expect(change).toHaveBeenNthCalledWith(2, { agent: '', instanceId: '' });
  expect(search).toHaveValue('claude');
  expect(change).toHaveBeenCalledTimes(2);
});

it('compact selector retains a departed product and its position across PID reuse', async () => {
  const change = vi.fn();
  const scope = { agent: 'Codex', instanceId: codex.instanceId };
  const mounted = render(InvestigationRoster, { telemetry: state([codex, claude]), scope, change });
  const selector = screen.getByLabelText('Agent / context');
  const names = () => Array.from((selector as HTMLSelectElement).options, (option) => option.value);
  const originalOrder = names();
  await mounted.rerender({
    telemetry: state([
      { ...claude, pid: codex.pid, instanceId: '42:new' },
      { agent: 'Amber', pid: 9, instanceId: '9:new' },
    ]),
  });
  expect(selector).toHaveValue('Codex');
  expect(names()).toEqual([...originalOrder, 'Amber']);
  expect(
    within(selector).getByRole('option', { name: 'Codex · Not currently observed', hidden: true }),
  ).toBeInTheDocument();
  expect(scope).toEqual({ agent: 'Codex', instanceId: '42:old' });
  expect(change).not.toHaveBeenCalled();
});
