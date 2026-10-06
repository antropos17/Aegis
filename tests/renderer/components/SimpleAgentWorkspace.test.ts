import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import AgentWorkspace from '../../../frontend/observatory/components/AgentWorkspace.svelte';
import {
  emptyTelemetry,
  type Telemetry,
  type Host,
} from '../../../frontend/observatory/runtime/host';

const worker = {
  agent: 'Codex',
  process: 'codex.exe',
  pid: 42,
  instanceId: '42:old',
  instanceIdSource: 'os',
  generationWitness: 'observed-generation',
  generationWitnessSource: 'createTime100ns',
  cwd: 'X:/project',
};
function state(): Telemetry {
  return {
    ...emptyTelemetry(),
    ready: true,
    stale: false,
    agents: [worker] as unknown as Telemetry['agents'],
    events: Array.from({ length: 6 }, (_, index) => ({
      ...worker,
      eventId: 'file-event-' + index,
      file: '/project/change-' + index + '.txt',
      action: 'modified',
      timestamp: Date.now() + index,
      sensitive: index === 0,
      reason: index === 0 ? 'Sensitive project file' : '',
      attribution: { status: 'confirmed', evidence: [] },
    })) as unknown as Telemetry['events'],
  };
}
function props(telemetry = state(), instanceId = '') {
  return {
    telemetry,
    liveTelemetry: telemetry,
    host: null as Host | null,
    scope: { agent: 'Codex', instanceId },
    change: vi.fn(),
    inspect: vi.fn(),
    navigate: vi.fn(),
    advanced: false,
  };
}

it('puts retained activity and risk together without requiring agent section tabs', async () => {
  render(AgentWorkspace, props());
  expect(screen.queryByRole('tablist', { name: 'Agent sections' })).not.toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Observed risk' })).toBeVisible();
  const activity = within(screen.getByRole('region', { name: 'Agent activity' }));
  expect(await activity.findByRole('searchbox', { name: 'Search events' })).toBeVisible();
  expect(await activity.findByText('change-5.txt')).toBeVisible();
  expect(await activity.findByText('change-0.txt')).toBeVisible();
  expect(screen.getByText('Choose a worker process to pause, resume or stop.')).toBeVisible();
});

it('shows process actions directly for an explicitly selected identity', async () => {
  const suspendProcess = vi.fn(async () => ({ success: true }));
  const resumeProcess = vi.fn(async () => ({ success: true }));
  render(AgentWorkspace, {
    ...props(state(), worker.instanceId),
    host: { suspendProcess, resumeProcess } as unknown as Host,
  });
  const pause = await screen.findByRole('button', { name: 'Pause process' });
  expect(pause).toBeEnabled();
  await fireEvent.click(pause);
  await waitFor(() =>
    expect(suspendProcess).toHaveBeenCalledWith({
      pid: 42,
      instanceId: '42:old',
      generationWitness: 'observed-generation',
      generationWitnessSource: 'createTime100ns',
    }),
  );
  await fireEvent.click(screen.getByRole('button', { name: 'Resume process' }));
  await waitFor(() => expect(resumeProcess).toHaveBeenCalledTimes(1));
});

it('keeps departed evidence and never substitutes a reused PID as the control target', async () => {
  const initial = state();
  const suspendProcess = vi.fn(async () => ({ success: true }));
  const mounted = render(AgentWorkspace, {
    ...props(initial, worker.instanceId),
    host: { suspendProcess } as unknown as Host,
  });
  expect(await screen.findByRole('button', { name: 'Pause process' })).toBeEnabled();
  const replacement = {
    ...initial,
    agents: [
      { ...worker, instanceId: '42:new', generationWitness: 'new-generation' },
    ] as unknown as Telemetry['agents'],
  };
  await mounted.rerender({ telemetry: replacement, liveTelemetry: replacement });
  expect(screen.queryByRole('button', { name: 'Pause process' })).not.toBeInTheDocument();
  expect(screen.getByText(/This selection is no longer observed/)).toBeVisible();
  expect(screen.getByText('change-5.txt')).toBeVisible();
  expect(suspendProcess).not.toHaveBeenCalled();
});

it('opens the interface preference through its dedicated navigation action', async () => {
  const openInterfaceSettings = vi.fn();
  const input = props();
  render(AgentWorkspace, { ...input, openInterfaceSettings });
  await fireEvent.click(screen.getByRole('button', { name: 'More tools in Advanced mode' }));
  expect(openInterfaceSettings).toHaveBeenCalledOnce();
  expect(input.navigate).not.toHaveBeenCalled();
});
