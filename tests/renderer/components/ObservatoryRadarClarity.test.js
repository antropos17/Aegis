import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import Radar from '../../../frontend/observatory/components/Radar.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

const process = (pid, agent = 'ChatGPT Desktop') => ({
  agent,
  process: 'agent.exe',
  pid,
  instanceId: `${pid}:live`,
  instanceIdSource: 'os',
});
it('shows one roster entry and compact marker per agent while grouping many processes', async () => {
  const inspect = vi.fn();
  const state = {
    ...emptyTelemetry(),
    ready: true,
    stale: false,
    agents: [
      ...Array.from({ length: 11 }, (_, i) => process(i + 1)),
      process(20, 'OpenAI Codex CLI'),
    ],
    resources: Array.from({ length: 11 }, (_, i) => ({
      instanceId: `${i + 1}:live`,
      cpu: 1,
      memMb: 20,
    })),
  };
  const mounted = render(Radar, { telemetry: state, selected: null, inspect });
  expect(mounted.container.querySelectorAll('.radar-agent-card')).toHaveLength(2);
  expect(mounted.container.querySelectorAll('.radar-blip')).toHaveLength(2);
  expect(mounted.container.querySelector('.radar-stage')).not.toHaveTextContent('ChatGPT Desktop');
  expect(screen.getAllByText('ChatGPT Desktop', { exact: true })).toHaveLength(1);
  await fireEvent.click(
    within(screen.getByLabelText('Observed agents')).getByRole('button', {
      name: /ChatGPT Desktop/,
    }),
  );
  expect(screen.getByText('11.0%')).toBeInTheDocument();
  // jsdom exposes descendants of closed details to role queries; browser QA checks visibility.
  expect(mounted.container.querySelector('.process-options').open).toBe(false);
  await fireEvent.click(screen.getByRole('button', { name: 'Open agent', exact: true }));
  expect(inspect).toHaveBeenCalledWith('ChatGPT Desktop', {
    agentGroupKey: 'ChatGPT Desktop',
    name: 'ChatGPT Desktop',
  });
  await fireEvent.click(screen.getByText(/Individual processes/));
  await fireEvent.change(screen.getByLabelText('Selected process'), {
    target: { value: '11:live' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Process', exact: true }));
  expect(inspect.mock.calls.at(-1)[1].instanceId).toBe('11:live');
  await mounted.rerender({ telemetry: { ...state, agents: [...state.agents, process(30)] } });
  expect(mounted.container.querySelectorAll('.radar-agent-card')).toHaveLength(2);
  expect(screen.queryByText('11.0%')).toBeNull();
});

it('opens metadata for an unstamped agent without inventing a process identity', async () => {
  const inspect = vi.fn();
  render(Radar, {
    telemetry: {
      ...emptyTelemetry(),
      ready: true,
      stale: false,
      agents: [{ ...process(0), instanceId: null }],
    },
    selected: null,
    inspect,
  });
  await fireEvent.click(screen.getByRole('button', { name: /Select ChatGPT Desktop,/ }));
  expect(inspect.mock.calls[0][1]).toEqual({
    agentGroupKey: 'ChatGPT Desktop',
    name: 'ChatGPT Desktop',
  });
});
