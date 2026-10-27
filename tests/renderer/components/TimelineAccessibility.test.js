import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import Timeline from '../../../frontend/observatory/components/Timeline.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

const now = Date.UTC(2026, 8, 10, 12);
const rows = [now - 700000, now - 200000].map((timestamp) => ({
  timestamp,
  agent: 'Codex',
  instanceId: '1:live',
  file: 'X:/project/file.ts',
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('names equal-count intervals with their time windows and preserves modified navigation keys', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  const inspect = vi.fn();
  render(Timeline, {
    telemetry: {
      ...emptyTelemetry(),
      ready: true,
      stale: false,
      agents: [{ agent: 'Codex', process: 'codex.exe', pid: 1, instanceId: '1:live' }],
      events: rows,
    },
    paused: true,
    inspect,
  });
  const buttons = within(screen.getByRole('group', { name: 'Codex events' })).getAllByRole(
    'button',
  );
  expect(buttons).toHaveLength(2);

  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const start = now + 1 - 15 * 60000;
  const step = 75000;
  const first = [start + 2 * step, start + 3 * step];
  const second = [start + 9 * step, start + 10 * step];
  expect(buttons[0]).toHaveAccessibleName(
    `Codex: 1 events, ${formatter.format(first[0])}–${formatter.format(first[1])}`,
  );
  expect(buttons[1]).toHaveAccessibleName(
    `Codex: 1 events, ${formatter.format(second[0])}–${formatter.format(second[1])}`,
  );
  await fireEvent.click(buttons[0]);
  await fireEvent.click(buttons[1]);
  expect(inspect.mock.calls[0][1]).toMatchObject({
    from: new Date(first[0]).toISOString(),
    to: new Date(first[1]).toISOString(),
    observations: [rows[0]],
  });
  expect(inspect.mock.calls[1][1]).toMatchObject({
    from: new Date(second[0]).toISOString(),
    to: new Date(second[1]).toISOString(),
    observations: [rows[1]],
  });

  buttons[0].focus();
  await fireEvent.keyDown(buttons[0], { key: 'ArrowRight' });
  expect(buttons[1]).toHaveFocus();
  for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      bubbles: true,
      cancelable: true,
      [modifier]: true,
    });
    buttons[1].dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(buttons[1]).toHaveFocus();
  }
});
