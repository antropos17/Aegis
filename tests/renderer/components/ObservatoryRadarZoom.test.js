import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Radar from '../../../frontend/observatory/components/Radar.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

const agent = (pid, name) => ({
  agent: name,
  process: 'agent.exe',
  pid,
  instanceId: `${pid}:now`,
  instanceIdSource: 'os',
});
const agents = [agent(1, 'Codex'), agent(2, 'Cursor')];
const state = {
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  agents,
  events: agents.map((a) => ({ ...a, file: 'X:/shared', attribution: { status: 'confirmed' } })),
};

it('bounds zoom without moving risk coordinates or clearing selected shared-file owners', async () => {
  const mounted = render(Radar, { telemetry: state, selected: null, inspect: vi.fn() });
  const marker = screen.getByRole('button', { name: /Select Codex,/ });
  const line = mounted.container.querySelector('.radar-connections line');
  const coordinates = line.outerHTML;
  await fireEvent.click(marker);
  expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Reset zoom' })).toBeDisabled();
  for (let i = 0; i < 4; i++)
    await fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  expect(screen.getByLabelText('Radar zoom')).toHaveTextContent('200%');
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
  expect(marker).toHaveAttribute('aria-pressed', 'true');
  expect(line.outerHTML).toBe(coordinates);
  expect(screen.getByRole('img', { name: /Codex ↔ Cursor/ })).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
  expect(screen.getByLabelText('Radar zoom')).toHaveTextContent('175%');
  await fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }));
  expect(screen.getByLabelText('Radar zoom')).toHaveTextContent('100%');
  expect(marker).toHaveAttribute('aria-pressed', 'true');
});

it('retains zoom through held/stale scans and page contraction without restoring an obsolete page', async () => {
  const population = {
    ...state,
    agents: Array.from({ length: 17 }, (_, i) => agent(i + 1, `Agent ${i + 1}`)),
  };
  const mounted = render(Radar, { telemetry: population, selected: null, inspect: vi.fn() });
  await fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  for (let i = 0; i < 4; i++)
    await fireEvent.click(screen.getByRole('button', { name: 'Next radar agents' }));
  await mounted.rerender({ paused: true, liveTelemetry: state });
  expect(screen.getByText('Paused snapshot')).toBeVisible();
  expect(screen.getByLabelText('Radar zoom')).toHaveTextContent('125%');
  await mounted.rerender({
    telemetry: { ...population, stale: true, agents: population.agents.slice(0, 8) },
  });
  expect(screen.getByText('Last reliable snapshot')).toBeVisible();
  expect(mounted.container.querySelector('.radar-pages')).toHaveTextContent('2/2');
  await mounted.rerender({ telemetry: population, paused: false, liveTelemetry: undefined });
  expect(mounted.container.querySelector('.radar-pages')).toHaveTextContent('2/5');
  expect(screen.getByLabelText('Radar zoom')).toHaveTextContent('125%');
});

it('clears focus from blank viewport content while preserving marker and zoom-control clicks', async () => {
  const mounted = render(Radar, { telemetry: state, selected: null, inspect: vi.fn() });
  const codex = screen.getByRole('button', { name: /Select Codex,/ });
  const cursor = screen.getByRole('button', { name: /Select Cursor,/ });
  await fireEvent.click(codex);
  await fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  expect(codex).toHaveAttribute('aria-pressed', 'true');
  await fireEvent.click(cursor.querySelector('.blip-dot'));
  expect(cursor).toHaveAttribute('aria-pressed', 'true');
  expect(codex).toHaveAttribute('aria-pressed', 'false');
  await fireEvent.click(mounted.container.querySelector('.radar-canvas'));
  expect(cursor).toHaveAttribute('aria-pressed', 'false');
  expect(screen.queryByRole('button', { name: 'Clear agent focus' })).toBeNull();
  await fireEvent.click(codex);
  await fireEvent.click(screen.getByRole('region', { name: 'Radar viewport' }));
  expect(codex).toHaveAttribute('aria-pressed', 'false');
});
