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
  expect(screen.getByRole('region', { name: 'Individual processes' })).toBeVisible();
  expect(screen.getByLabelText('Selected process')).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'Open agent', exact: true }));
  expect(inspect).toHaveBeenCalledWith('ChatGPT Desktop', {
    agentGroupKey: 'ChatGPT Desktop',
    name: 'ChatGPT Desktop',
  });
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
  expect(inspect).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByRole('button', { name: 'Open agent', exact: true }));
  expect(inspect.mock.calls[0][1]).toEqual({
    agentGroupKey: 'ChatGPT Desktop',
    name: 'ChatGPT Desktop',
  });
});

it.each(['previous', 'expand'])(
  'reconciles a contracted radar page before %s while preserving telemetry-driven selection',
  async (nextAction) => {
    const state = {
      ...emptyTelemetry(),
      ready: true,
      stale: false,
      agents: Array.from({ length: 17 }, (_, i) => process(i + 1, `Agent ${i + 1}`)),
    };
    const mounted = render(Radar, { telemetry: state, selected: null, inspect: vi.fn() });
    const pager = () => mounted.container.querySelector('.radar-pages');
    for (let i = 0; i < 4; i += 1) {
      await fireEvent.click(screen.getByRole('button', { name: 'Next radar agents' }));
    }
    expect(pager()).toHaveTextContent('5/5');

    await mounted.rerender({ telemetry: { ...state, agents: state.agents.slice(0, 8) } });
    expect(pager()).toHaveTextContent('2/2');
    expect(screen.getByRole('button', { name: 'Next radar agents' })).toBeDisabled();
    expect(mounted.container.querySelectorAll('.radar-agent-card')).toHaveLength(4);
    await fireEvent.click(mounted.container.querySelector('.radar-blip'));
    const focusedMarker = mounted.container.querySelector('.radar-blip[aria-pressed="true"]');
    expect(focusedMarker).not.toBeNull();

    // A telemetry update must retain focus; only explicit page navigation clears it.
    await mounted.rerender({ telemetry: { ...state, agents: state.agents.slice(0, 8) } });
    expect(focusedMarker).toHaveAttribute('aria-pressed', 'true');
    if (nextAction === 'previous') {
      await fireEvent.click(screen.getByRole('button', { name: 'Previous radar agents' }));
      expect(pager()).toHaveTextContent('1/2');
      expect(screen.getByRole('button', { name: 'Previous radar agents' })).toBeDisabled();
      expect(mounted.container.querySelector('.radar-blip[aria-pressed="true"]')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Clear agent focus' })).toBeNull();
    } else {
      await mounted.rerender({ telemetry: state });
      expect(pager()).toHaveTextContent('2/5');
      expect(focusedMarker).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Next radar agents' })).toBeEnabled();
    }
  },
);
