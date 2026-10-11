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
const file = (pid, name) => ({
  agent: name,
  pid,
  instanceId: `${pid}:now`,
  file: 'X:/shared',
  attribution: { status: 'confirmed' },
});
const state = {
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  agents: [agent(1, 'Codex'), agent(2, 'Cursor')],
  events: [file(1, 'Codex'), file(2, 'Cursor')],
};

it('explains the recorded shared file and preserves marker selection', async () => {
  const mounted = render(Radar, { telemetry: state, selected: null, inspect: vi.fn() });
  expect(
    screen.getByRole('img', { name: 'Codex ↔ Cursor: 1 shared recorded files' }),
  ).toBeVisible();
  expect(mounted.container.querySelectorAll('.radar-connections line')).toHaveLength(1);
  const marker = screen.getByRole('button', { name: /Select Codex,/ });
  await fireEvent.click(marker);
  expect(marker).toHaveAttribute('aria-pressed', 'true');
  expect(
    screen.getByText(
      'Lines show shared recorded file observations. They do not establish agent communication.',
    ),
  ).toBeVisible();
});

it('keeps connections on the displayed paused snapshot and hides them in Files', async () => {
  const mounted = render(Radar, {
    telemetry: state,
    liveTelemetry: { ...state, events: [] },
    paused: true,
    selected: null,
    inspect: vi.fn(),
  });
  const graphic = screen.getByRole('img', { name: /shared recorded files/ });
  expect(graphic).toBeVisible();
  expect(screen.getByText('Paused snapshot')).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'Files', exact: true }));
  expect(graphic).not.toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'Radar', exact: true }));
  expect(graphic).toBeVisible();
  await mounted.rerender({ telemetry: { ...state, events: [] }, paused: false });
  expect(screen.queryByRole('img', { name: /shared recorded files/ })).toBeNull();
});

it('draws only pairs whose two markers are on the current page', async () => {
  const agents = ['A', 'B', 'C', 'D', 'E', 'F'].map((name, i) => agent(i + 1, name));
  const telemetry = { ...state, agents, events: agents.map((a) => file(a.pid, a.agent)) };
  const mounted = render(Radar, { telemetry, selected: null, inspect: vi.fn() });
  expect(mounted.container.querySelectorAll('.radar-connections line')).toHaveLength(6);
  expect(screen.getByRole('img', { name: /shared recorded files/ })).not.toHaveAttribute(
    'aria-label',
    expect.stringContaining('E ↔ F'),
  );
  await fireEvent.click(screen.getByRole('button', { name: 'Next radar agents' }));
  expect(mounted.container.querySelectorAll('.radar-connections line')).toHaveLength(1);
  expect(screen.getByRole('img', { name: /E ↔ F/ })).toBeVisible();
  expect(screen.queryByRole('button', { name: /Select A,/ })).toBeNull();
});
