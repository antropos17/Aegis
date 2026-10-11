import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Radar from '../../../frontend/observatory/components/Radar.svelte';
import { emptyTelemetry, type Telemetry } from '../../../frontend/observatory/runtime/host';
import type { DetectedAgent } from '../../../src/shared/types';

it('restores the focused marker after hover ends and keeps Escape dismissed until fresh activation', async () => {
  const telemetry: Telemetry = {
    ...emptyTelemetry(),
    ready: true,
    stale: false,
    agents: ['Agent A', 'Agent B'].map((agent, index): DetectedAgent => ({
      agent,
      process: 'agent.exe',
      pid: index + 1,
      instanceId: `${index + 1}:mixed`,
      instanceIdSource: 'os',
      status: 'running',
      category: 'cli-tool',
    })),
  };
  const mounted = render(Radar, { telemetry, selected: null, inspect: vi.fn() });
  const a = screen.getByRole('button', { name: /Select Agent A,/ });
  const b = screen.getByRole('button', { name: /Select Agent B,/ });
  await fireEvent.focus(a);
  await fireEvent.mouseEnter(b);
  expect(screen.getByRole('tooltip')).toHaveTextContent('Agent B');
  await fireEvent.mouseLeave(b);
  expect(screen.getByRole('tooltip')).toHaveTextContent('Agent A');
  expect(a).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id);
  await fireEvent.mouseEnter(a);
  await fireEvent.mouseLeave(a);
  expect(screen.getByRole('tooltip')).toHaveTextContent('Agent A');
  await fireEvent.mouseEnter(b);
  await fireEvent.keyDown(window, { key: 'Escape' });
  await fireEvent.mouseLeave(b);
  await mounted.rerender({ telemetry: { ...telemetry, stale: true } });
  expect(screen.queryByRole('tooltip')).toBeNull();
  await fireEvent.mouseEnter(b);
  await fireEvent.mouseLeave(b);
  expect(screen.getByRole('tooltip')).toHaveTextContent('Agent A');
  await fireEvent.blur(a);
  expect(screen.queryByRole('tooltip')).toBeNull();
});

it('shows current marker details on keyboard focus and hover and dismisses obsolete details', async () => {
  const agents = Array.from({ length: 5 }, (_, index): DetectedAgent => ({
    agent: `Agent ${index + 1}`,
    process: 'agent.exe',
    pid: index + 1,
    instanceId: `${index + 1}:now`,
    instanceIdSource: 'os',
    status: 'running',
    category: 'cli-tool',
  }));
  const telemetry: Telemetry = { ...emptyTelemetry(), ready: true, stale: false, agents };
  const mounted = render(Radar, { telemetry, selected: null, inspect: vi.fn() });
  const marker = () => screen.getByRole('button', { name: /Select Agent 1,/ });
  await fireEvent.focus(marker());
  expect(screen.getByRole('tooltip')).toHaveTextContent('Agent 1 · 1 processes · risk 0/100');
  const description = marker().getAttribute('aria-describedby');
  expect(screen.getByRole('tooltip')).toHaveAttribute('id', description);
  await mounted.rerender({
    telemetry: {
      ...telemetry,
      events: [
        {
          ...agents[0],
          instanceId: agents[0].instanceId ?? null,
          timestamp: Date.now(),
          file: 'X:/fixture/key',
          sensitive: true,
          reason: 'SSH',
          parentEditor: null,
          cwd: null,
          selfAccess: false,
          action: 'accessed',
        },
      ],
    },
  });
  expect(screen.getByRole('tooltip')).toHaveTextContent('risk 10/100');
  await fireEvent.keyDown(marker(), { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).toBeNull();
  await fireEvent.mouseEnter(marker());
  expect(screen.getByRole('tooltip')).toBeVisible();
  await fireEvent.mouseLeave(marker());
  expect(screen.getByRole('tooltip')).toBeVisible();
  await fireEvent.blur(marker());
  expect(screen.queryByRole('tooltip')).toBeNull();
  await fireEvent.focus(marker());
  await fireEvent.blur(marker());
  expect(screen.queryByRole('tooltip')).toBeNull();
  await fireEvent.focus(marker());
  await mounted.rerender({ telemetry: { ...telemetry, agents: agents.slice(1) } });
  expect(screen.queryByRole('tooltip')).toBeNull();
  await mounted.rerender({ telemetry });
  expect(screen.queryByRole('tooltip')).toBeNull();
  await fireEvent.mouseEnter(marker());
  await fireEvent.click(screen.getByRole('button', { name: 'Next radar agents' }));
  expect(screen.queryByRole('tooltip')).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Previous radar agents' }));
  expect(screen.queryByRole('tooltip')).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Next radar agents' }));
  const lastMarker = screen.getByRole('button', { name: /Select Agent 5,/ });
  await fireEvent.mouseEnter(lastMarker);
  await fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).toBeNull();
  await fireEvent.mouseEnter(lastMarker);
  await mounted.rerender({ telemetry: { ...telemetry, agents: agents.slice(4) } });
  expect(screen.queryByRole('tooltip')).toBeNull();
});
