import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { expect, it, vi } from 'vitest';
import InvestigationHeader from '../../../frontend/observatory/components/InvestigationHeader.svelte';
import {
  emptyTelemetry,
  type Host,
  type Telemetry,
} from '../../../frontend/observatory/runtime/host';

const worker = {
  agent: 'Codex',
  name: 'Codex',
  process: 'codex.exe',
  pid: 42,
  instanceId: '42:original',
  instanceIdSource: 'os',
  generationWitness: 'original-generation',
  generationWitnessSource: 'createTime100ns',
  cwd: 'X:/first-project',
};
const second = {
  ...worker,
  pid: 84,
  instanceId: '84:second',
  generationWitness: 'second-generation',
  process: 'codex-worker.exe',
  cwd: 'X:/second-project',
};
function state(): Telemetry {
  return {
    ...emptyTelemetry(),
    ready: true,
    stale: false,
    agents: [worker, second] as unknown as Telemetry['agents'],
    resources: [
      { instanceId: worker.instanceId, cpu: 0, memMb: 0 },
      { instanceId: second.instanceId, cpu: 2, memMb: 40 },
    ],
    events: [
      {
        eventId: 'sensitive-second',
        file: 'X:/second-project/.env',
        action: 'read',
        sensitive: true,
        timestamp: Date.now(),
        instanceId: second.instanceId,
        pid: second.pid,
        agent: 'Codex',
      },
    ] as unknown as Telemetry['events'],
  };
}
function input(instanceId = '') {
  const telemetry = state();
  const host = {
    suspendProcess: vi.fn(async () => ({ success: true })),
    resumeProcess: vi.fn(async () => ({ success: true })),
    killProcess: vi.fn(async () => ({ success: true })),
  };
  return {
    telemetry,
    liveTelemetry: telemetry,
    host: host as unknown as Host,
    scope: { agent: 'Codex', instanceId },
    change: vi.fn(),
    inspect: vi.fn(),
    calls: host,
  };
}

it('qualifies the highest process risk and requires an explicit worker choice before any process action', async () => {
  const props = input();
  render(InvestigationHeader, props);
  const header = within(screen.getByRole('region', { name: 'Agent investigation' }));
  expect(header.getByText('Highest process score')).toBeVisible();
  expect(
    within(header.getByRole('region', { name: 'Observed risk and process controls' })).getByText(
      'Sensitive file activity',
    ),
  ).toBeVisible();
  expect(header.queryByRole('button', { name: 'Pause process' })).toBeNull();
  expect(header.queryByRole('button', { name: 'Resume process' })).toBeNull();
  expect(header.queryByRole('button', { name: 'Stop…' })).toBeNull();
  await fireEvent.click(header.getByRole('button', { name: 'Select assessed process' }));
  expect(props.change).toHaveBeenCalledExactlyOnceWith({
    agent: 'Codex',
    instanceId: second.instanceId,
  });
  expect(props.calls.suspendProcess).not.toHaveBeenCalled();
  expect(props.calls.resumeProcess).not.toHaveBeenCalled();
  expect(props.calls.killProcess).not.toHaveBeenCalled();
});

it('uses a local native selector with exact IDs and distinguishable PID, project and process labels', async () => {
  const props = input();
  render(InvestigationHeader, props);
  const select = screen.getByRole('combobox', { name: 'Worker process' });
  const choices = within(select);
  expect(choices.getByRole('option', { name: /PID 42.*first-project.*codex\.exe/ })).toHaveValue(
    worker.instanceId,
  );
  expect(
    choices.getByRole('option', { name: /PID 84.*second-project.*codex-worker\.exe/ }),
  ).toHaveValue(second.instanceId);
  await fireEvent.change(select, { target: { value: worker.instanceId } });
  expect(props.change).toHaveBeenCalledExactlyOnceWith({
    agent: 'Codex',
    instanceId: worker.instanceId,
  });
  expect(props.calls.suspendProcess).not.toHaveBeenCalled();
});

it('keeps an assessed group process unselected when its current live identity is unavailable', async () => {
  const props = input();
  render(InvestigationHeader, { ...props, liveTelemetry: { ...props.liveTelemetry, stale: true } });
  const select = screen.getByRole('button', { name: 'Select assessed process' });
  expect(select).toBeDisabled();
  await fireEvent.click(select);
  expect(props.change).not.toHaveBeenCalled();
  expect(props.calls.suspendProcess).not.toHaveBeenCalled();
});

it('places exact-process actions beside risk and uses current live witnesses even while the displayed view is paused', async () => {
  const props = input(worker.instanceId);
  render(InvestigationHeader, { ...props, paused: true });
  const section = within(
    screen.getByRole('region', { name: 'Observed risk and process controls' }),
  );
  expect(screen.getByText('View paused')).toBeVisible();
  const pause = section.getByRole('button', { name: 'Pause process' });
  const resume = section.getByRole('button', { name: 'Resume process' });
  expect(pause).toBeEnabled();
  expect(resume).toBeEnabled();
  expect(section.getByRole('button', { name: 'Stop…' })).toBeEnabled();
  await fireEvent.click(pause);
  await waitFor(() =>
    expect(props.calls.suspendProcess).toHaveBeenCalledExactlyOnceWith({
      pid: worker.pid,
      instanceId: worker.instanceId,
      generationWitness: worker.generationWitness,
      generationWitnessSource: worker.generationWitnessSource,
    }),
  );
  await fireEvent.click(resume);
  await waitFor(() => expect(props.calls.resumeProcess).toHaveBeenCalledOnce());
});

it.each(['stale', 'departed', 'reused PID', 'missing witness', 'retained discovery'])(
  'keeps the selected identity and refuses controls after %s live observation',
  async (condition) => {
    const props = input(worker.instanceId);
    const mounted = render(InvestigationHeader, props);
    const next: Telemetry = {
      ...props.liveTelemetry,
      stale: condition === 'stale',
      agents:
        condition === 'departed'
          ? []
          : condition === 'reused PID'
            ? ([{ ...worker, instanceId: '42:replacement' }] as unknown as Telemetry['agents'])
            : condition === 'missing witness'
              ? ([{ ...worker, generationWitness: null }] as unknown as Telemetry['agents'])
              : condition === 'retained discovery'
                ? ([
                    { ...worker, discoveryObservation: { stale: true } },
                  ] as unknown as Telemetry['agents'])
                : props.liveTelemetry.agents,
    };
    await mounted.rerender({ liveTelemetry: next });
    const pause = screen.getByRole('button', { name: 'Pause process' });
    expect(pause).toBeDisabled();
    await fireEvent.click(pause);
    expect(screen.getByRole('combobox', { name: 'Worker process' })).toHaveValue(worker.instanceId);
    expect(props.change).not.toHaveBeenCalled();
    expect(props.calls.suspendProcess).not.toHaveBeenCalled();
    if (condition === 'retained discovery')
      expect(screen.getByText('Last reliable observation')).toBeVisible();
  },
);

it('retains a missing worker choice through a fresh replacement population without selecting its reused PID', async () => {
  const props = input(worker.instanceId);
  const mounted = render(InvestigationHeader, props);
  const replacement = {
    ...props.telemetry,
    agents: [
      { ...worker, instanceId: '42:replacement', cwd: 'X:/replacement' },
    ] as unknown as Telemetry['agents'],
  };
  await mounted.rerender({ telemetry: replacement, liveTelemetry: replacement });
  const select = screen.getByRole('combobox', { name: 'Worker process' });
  expect(select).toHaveValue(worker.instanceId);
  expect(
    within(select).getByRole('option', { name: /Not currently observed.*PID 42.*first-project/ }),
  ).toHaveValue(worker.instanceId);
  expect(screen.getByRole('button', { name: 'Pause process' })).toBeDisabled();
  expect(props.change).not.toHaveBeenCalled();
});

it.each(['witness value', 'witness source'])(
  'refuses a different generation with the same instance ID after a changed %s',
  async (difference) => {
    const props = input(worker.instanceId);
    const replacement = {
      ...worker,
      cwd: 'X:/replacement-generation',
      generationWitness:
        difference === 'witness value' ? 'replacement-generation' : worker.generationWitness,
      generationWitnessSource:
        difference === 'witness source' ? 'sequence' : worker.generationWitnessSource,
    };
    render(InvestigationHeader, {
      ...props,
      paused: true,
      liveTelemetry: {
        ...props.liveTelemetry,
        agents: [replacement] as unknown as Telemetry['agents'],
      },
    });
    const controls = within(
      screen.getByRole('region', { name: 'Observed risk and process controls' }),
    );
    const pause = controls.getByRole('button', { name: 'Pause process' });
    const resume = controls.getByRole('button', { name: 'Resume process' });
    const stop = controls.getByRole('button', { name: 'Stop…' });
    expect(screen.getByRole('combobox', { name: 'Worker process' })).toHaveValue(worker.instanceId);
    expect(screen.getByText('X:/first-project')).toBeVisible();
    expect(pause).toBeDisabled();
    expect(resume).toBeDisabled();
    expect(stop).toBeDisabled();
    await fireEvent.click(pause);
    await fireEvent.click(resume);
    await fireEvent.click(stop);
    expect(controls.queryByRole('button', { name: 'Confirm stop' })).toBeNull();
    expect(props.calls.suspendProcess).not.toHaveBeenCalled();
    expect(props.calls.resumeProcess).not.toHaveBeenCalled();
    expect(props.calls.killProcess).not.toHaveBeenCalled();
    expect(props.change).not.toHaveBeenCalled();
  },
);

it('rechecks a stop confirmation against a changed generation witness', async () => {
  const props = input(worker.instanceId);
  const mounted = render(InvestigationHeader, props);
  await fireEvent.click(screen.getByRole('button', { name: 'Stop…' }));
  expect(props.calls.killProcess).not.toHaveBeenCalled();
  await mounted.rerender({
    liveTelemetry: {
      ...props.liveTelemetry,
      agents: [
        { ...worker, generationWitness: 'replacement-generation' },
      ] as unknown as Telemetry['agents'],
    },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Confirm stop' }));
  expect(await screen.findByText(/no longer reliably observed/)).toBeVisible();
  expect(props.calls.killProcess).not.toHaveBeenCalled();
});

it('keeps action pending and failure feedback in the compact header without hiding the target', async () => {
  const props = input(worker.instanceId);
  let complete!: (_value: { success: boolean; error: string }) => void;
  const pending = new Promise<{ success: boolean; error: string }>((resolve) => {
    complete = resolve;
  });
  props.calls.suspendProcess.mockImplementationOnce(() => pending);
  render(InvestigationHeader, props);
  const pause = screen.getByRole('button', { name: 'Pause process' });
  await fireEvent.click(pause);
  expect(pause).toBeDisabled();
  expect(pause).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByText('Working…')).toBeVisible();
  await act(() => complete({ success: false, error: 'Fixture command refused' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Fixture command refused');
  expect(pause).toBeEnabled();
  expect(screen.getByRole('combobox', { name: 'Worker process' })).toHaveValue(worker.instanceId);
});

it('preserves genuine zero resources and renders unavailable measurements without inventing zero', async () => {
  const props = input(worker.instanceId);
  const mounted = render(InvestigationHeader, props);
  expect(screen.getByText('0 %')).toBeVisible();
  expect(screen.getByText('0 MB')).toBeVisible();
  await mounted.rerender({ telemetry: { ...props.telemetry, resources: [] } });
  expect(screen.queryByText('0 %')).toBeNull();
  expect(screen.queryByText('0 MB')).toBeNull();
  expect(screen.getAllByText('—')).toHaveLength(2);
});

it('keeps the all-agent header concise without an empty risk or process-control card', () => {
  const props = input();
  render(InvestigationHeader, { ...props, scope: { agent: '', instanceId: '' } });
  expect(screen.getByRole('heading', { name: 'All agents' })).toBeVisible();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.queryByRole('region', { name: 'Observed risk and process controls' })).toBeNull();
  expect(screen.queryByText('Current assessment unavailable')).toBeNull();
});
