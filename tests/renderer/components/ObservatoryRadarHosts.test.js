import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Radar from '../../../frontend/observatory/components/Radar.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

const host = {
  source: 'fresh-process-table',
  pid: 99,
  startTime: 1000,
  generationWitnessSource: 'sequence',
  generationWitness: '42',
  label: 'VS Code',
};
const agents = ['Codex', 'Cursor'].map((agent, index) => ({
  agent,
  process: 'agent.exe',
  pid: index + 1,
  instanceId: `${index + 1}:now`,
  instanceIdSource: 'os',
  observedHostEditor: host,
}));
const state = {
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  agents,
  events: agents.map((a) => ({ ...a, file: 'X:/shared', attribution: { status: 'confirmed' } })),
};

it('preserves selection, geometry, shared-file lines and zoom beside inert host cues', async () => {
  const mounted = render(Radar, { telemetry: state, selected: null, inspect: vi.fn() });
  const marker = screen.getByRole('button', { name: /Select Codex,/ });
  expect(marker).toHaveAccessibleName(/Observed under VS Code · PID 99/);
  expect(marker).toHaveClass('observed-host');
  const coordinates = marker.getAttribute('style');
  const line = mounted.container.querySelector('.radar-connections line').outerHTML;
  const list = screen.getByRole('list', { name: 'Observed editor ancestry' });
  expect(list.querySelector('button')).toBeNull();
  await fireEvent.click(marker);
  for (let i = 0; i < 4; i++)
    await fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  expect(marker).toHaveAttribute('aria-pressed', 'true');
  expect(marker.getAttribute('style')).toBe(coordinates);
  expect(mounted.container.querySelector('.radar-connections line').outerHTML).toBe(line);
  await mounted.rerender({ paused: true, liveTelemetry: { ...state, agents: [] } });
  expect(list).toBeVisible();
  expect(screen.getByText('Paused snapshot')).toBeVisible();
  await mounted.rerender({ telemetry: { ...state, stale: true } });
  expect(list).toBeVisible();
  expect(screen.getByText('Last reliable snapshot')).toBeVisible();
  await mounted.rerender({
    telemetry: {
      ...state,
      stale: false,
      agents: agents.map((a) => ({ ...a, observedHostEditor: undefined })),
    },
  });
  expect(screen.queryByRole('list', { name: 'Observed editor ancestry' })).toBeNull();
  expect(marker).toHaveAttribute('aria-pressed', 'true');
});
