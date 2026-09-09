import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import Details from '../../../frontend/observatory/components/Details.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';
const live = {
  agent: 'Claude Code',
  process: 'claude.exe',
  pid: 42,
  instanceId: '42:old',
  instanceIdSource: 'os',
  cwd: 'X:/test',
};
const state = () => ({ ...emptyTelemetry(), ready: true, stale: false, agents: [live] });
it('enables controls for enriched rows and dispatches the canonical live identity', async () => {
  const host = { suspendProcess: vi.fn(async () => ({ success: true })) };
  const props = {
    host,
    telemetry: state(),
    request: {
      title: 'Claude Code',
      row: { name: 'Claude Code', process: 'claude.exe', instanceId: '42:old', pid: 42 },
    },
    close: vi.fn(),
    refreshFalsePositives: vi.fn(),
  };
  render(Details, props);
  const suspend = await screen.findByRole('button', { name: 'Suspend', exact: true });
  expect(suspend).toBeEnabled();
  await fireEvent.click(suspend);
  await waitFor(() =>
    expect(host.suspendProcess).toHaveBeenCalledWith({ pid: 42, instanceId: '42:old' }),
  );
});
it('refuses a stop confirmation after that PID has been reused', async () => {
  const host = { killProcess: vi.fn(async () => ({ success: true })) };
  const props = {
    host,
    telemetry: state(),
    request: { title: 'Claude Code', row: live },
    close: vi.fn(),
    refreshFalsePositives: vi.fn(),
  };
  const mounted = render(Details, props);
  await fireEvent.click(await screen.findByRole('button', { name: 'Stop…' }));
  expect(screen.getByRole('button', { name: 'Confirm stop' })).toBeInTheDocument();
  await mounted.rerender({
    telemetry: { ...state(), agents: [{ ...live, instanceId: '42:new' }] },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Confirm stop' }));
  expect(await screen.findByText(/no longer reliably observed/)).toBeInTheDocument();
  expect(host.killProcess).not.toHaveBeenCalled();
});
