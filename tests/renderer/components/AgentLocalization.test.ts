import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import Agents from '../../../frontend/observatory/components/Agents.svelte';
import AgentWorkspace from '../../../frontend/observatory/components/AgentWorkspace.svelte';
import AgentProcesses from '../../../frontend/observatory/components/AgentProcesses.svelte';
import { emptyTelemetry, type Telemetry } from '../../../frontend/observatory/runtime/host';
import { language } from '../../../frontend/observatory/runtime/i18n';

const state = () => ({
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  agents: Array.from({ length: 6 }, (_, index) => ({
    agent: 'Codex',
    process: 'codex.exe',
    pid: index + 11,
    instanceId: `worker:${index}`,
    instanceIdSource: 'os',
  })) as unknown as Telemetry['agents'],
  network: [{ instanceId: 'worker:0', verdict: 'flagged' }] as Telemetry['network'],
});

afterEach(() => language.set('en'));

it('localizes risk text and action names in the agent table and workspace', async () => {
  language.set('pt');
  const telemetry = state();
  const inspect = vi.fn();
  const mounted = render(Agents, { telemetry, inspect, openStatistics: vi.fn() });
  const risk = screen.getByRole('button', { name: 'Explicar o risco de Codex' });
  expect(risk).toHaveTextContent('Verificações de destinos');
  expect(screen.getByRole('button', { name: 'Estatísticas de Codex' })).toBeVisible();
  await fireEvent.click(risk);
  expect(inspect).toHaveBeenCalledOnce();
  mounted.unmount();

  render(AgentWorkspace, {
    telemetry,
    liveTelemetry: telemetry,
    host: null,
    scope: { agent: 'Codex', instanceId: '' },
    change: vi.fn(),
    inspect: vi.fn(),
    navigate: vi.fn(),
  });
  const riskRegion = screen.getByRole('region', { name: 'Risco observado' });
  expect(within(riskRegion).getByText('Verificações de destinos')).toBeVisible();
});

it('localizes the process expansion control and preserves its actions', async () => {
  language.set('pt');
  render(AgentProcesses, {
    telemetry: state(),
    scope: { agent: 'Codex', instanceId: '' },
    change: vi.fn(),
  });
  expect(screen.queryByRole('button', { name: 'PID 16' })).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Mostrar todos os 6 processos' }));
  expect(screen.getByRole('button', { name: 'PID 16' })).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'Mostrar menos processos' }));
  expect(screen.queryByRole('button', { name: 'PID 16' })).toBeNull();
});


// Worker selection is controlled by the parent scope. Exercise the real rendered
// buttons with synthetic telemetry, then reflect the parent's change via rerender.
const worker = (pid: number, instanceId: string | null, instanceIdSource = 'os') => ({
  agent: 'Codex',
  process: 'codex.exe',
  pid,
  instanceId,
  instanceIdSource,
});

const workerTelemetry = (agents: ReturnType<typeof worker>[]) => ({
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  agents: agents as unknown as Telemetry['agents'],
});

const groupScope = { agent: 'Codex', instanceId: '' };

it('exposes group scope with no selected worker and keeps each native PID button available', () => {
  const change = vi.fn();
  const view = render(AgentProcesses, {
    telemetry: workerTelemetry([worker(101, '101:first'), worker(102, '102:first')]),
    scope: groupScope,
    change,
  });

  const first = screen.getByRole('button', { name: 'PID 101' });
  const second = screen.getByRole('button', { name: 'PID 102' });
  expect(first).toBeEnabled();
  expect(second).toBeEnabled();
  expect(first.tagName).toBe('BUTTON');
  expect(first).toHaveAttribute('aria-pressed', 'false');
  expect(second).toHaveAttribute('aria-pressed', 'false');
  expect(view.container.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: 'All processes' })).not.toBeInTheDocument();
  expect(change).not.toHaveBeenCalled();
});

it('exposes exactly one selected worker after click and returns to group scope via All processes', async () => {
  const change = vi.fn();
  const view = render(AgentProcesses, {
    telemetry: workerTelemetry([
      worker(101, '101:first'),
      worker(102, '102:first'),
      worker(103, '103:first'),
    ]),
    scope: groupScope,
    change,
  });

  await fireEvent.click(screen.getByRole('button', { name: 'PID 102' }));
  expect(change).toHaveBeenCalledExactlyOnceWith({ agent: 'Codex', instanceId: '102:first' });
  // Until the parent accepts the change, the component retains the old scope.
  expect(screen.getByRole('button', { name: 'PID 102' })).toHaveAttribute('aria-pressed', 'false');

  await view.rerender({ scope: { agent: 'Codex', instanceId: '102:first' } });
  const selected = screen.getByRole('button', { name: 'PID 102' });
  expect(selected).toHaveAttribute('aria-pressed', 'true');
  expect(selected.closest('tr')).toHaveClass('chosen');
  expect(screen.getByRole('button', { name: 'PID 101' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('button', { name: 'PID 103' })).toHaveAttribute('aria-pressed', 'false');
  expect(view.container.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1);

  await fireEvent.click(screen.getByRole('button', { name: 'All processes' }));
  expect(change).toHaveBeenLastCalledWith(groupScope);
  await view.rerender({ scope: groupScope });
  expect(view.container.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(0);
  expect(view.container.querySelectorAll('tr.chosen')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: 'All processes' })).not.toBeInTheDocument();
});

it.each([
  ['Enter', 'Enter'],
  ['Space', ' '],
])('preserves native button %s activation and focus', async (_name, key) => {
  const change = vi.fn();
  const view = render(AgentProcesses, {
    telemetry: workerTelemetry([worker(101, '101:first')]),
    scope: groupScope,
    change,
  });
  const button = screen.getByRole('button', { name: 'PID 101' });
  expect(button.tagName).toBe('BUTTON');
  expect(button).not.toHaveAttribute('role');
  button.focus();
  expect(button).toHaveFocus();

  // jsdom does not synthesize the browser's click from Enter/Space, so emit
  // that native activation click after the keyboard event, not a custom handler.
  await fireEvent.keyDown(button, { key });
  await fireEvent.click(button);
  await fireEvent.keyUp(button, { key });
  expect(change).toHaveBeenCalledExactlyOnceWith({ agent: 'Codex', instanceId: '101:first' });
  await view.rerender({ scope: { agent: 'Codex', instanceId: '101:first' } });
  expect(screen.getByRole('button', { name: 'PID 101' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'PID 101' })).toHaveFocus();
});

it('never marks or activates workers without an OS-qualified instance identity', async () => {
  const change = vi.fn();
  const view = render(AgentProcesses, {
    telemetry: workerTelemetry([
      worker(101, '101:observed'),
      worker(102, null),
      worker(103, '103:u'),
      worker(104, '104:synthetic', 'synthetic'),
      worker(105, '105:unknown', 'unknown'),
    ]),
    scope: groupScope,
    change,
  });

  for (const pid of [102, 103, 104, 105]) {
    const button = screen.getByRole('button', { name: `PID ${pid}` });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-pressed', 'false');
    // Use the native click method: firing a synthetic event on a disabled
    // button can bypass the browser's disabled-activation protection.
    button.click();
  }
  expect(change).not.toHaveBeenCalled();
  expect(view.container.querySelectorAll('tr.chosen')).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'PID 101' })).toBeEnabled();
});

it('does not transfer selected state to a replacement worker that reuses the PID', async () => {
  const change = vi.fn();
  const view = render(AgentProcesses, {
    telemetry: workerTelemetry([worker(101, '101:old')]),
    scope: { agent: 'Codex', instanceId: '101:old' },
    change,
  });
  expect(screen.getByRole('button', { name: 'PID 101' })).toHaveAttribute('aria-pressed', 'true');
  expect(view.container.querySelectorAll('tr.chosen')).toHaveLength(1);

  // A fresh OS observation with the same PID is a different instance.
  await view.rerender({ telemetry: workerTelemetry([worker(101, '101:new')]) });
  const replacement = screen.getByRole('button', { name: 'PID 101' });
  expect(replacement).toHaveAttribute('aria-pressed', 'false');
  expect(replacement).toBeEnabled();
  expect(view.container.querySelectorAll('tr.chosen')).toHaveLength(0);
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'All processes' })).toBeVisible();

  await fireEvent.click(replacement);
  expect(change).toHaveBeenCalledExactlyOnceWith({ agent: 'Codex', instanceId: '101:new' });
  await view.rerender({ scope: { agent: 'Codex', instanceId: '101:new' } });
  expect(screen.getByRole('button', { name: 'PID 101' })).toHaveAttribute('aria-pressed', 'true');
  expect(view.container.querySelectorAll('tr.chosen')).toHaveLength(1);
});

it('keeps a replacement with missing identity disabled, even when its PID matches', async () => {
  const change = vi.fn();
  const view = render(AgentProcesses, {
    telemetry: workerTelemetry([worker(101, '101:old')]),
    scope: { agent: 'Codex', instanceId: '101:old' },
    change,
  });

  await view.rerender({ telemetry: workerTelemetry([worker(101, null)]) });
  const replacement = screen.getByRole('button', { name: 'PID 101' });
  expect(replacement).toBeDisabled();
  expect(replacement).toHaveAttribute('aria-pressed', 'false');
  expect(view.container.querySelectorAll('tr.chosen')).toHaveLength(0);
  replacement.click();
  expect(change).not.toHaveBeenCalled();
});
