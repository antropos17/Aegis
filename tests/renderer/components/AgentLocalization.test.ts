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
