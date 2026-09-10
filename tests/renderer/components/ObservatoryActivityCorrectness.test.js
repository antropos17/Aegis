import { afterEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import ActivityChart from '../../../frontend/observatory/components/ActivityChart.svelte';
import Timeline from '../../../frontend/observatory/components/Timeline.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';
import { activityBins } from '../../../frontend/observatory/runtime/activity';
const now = Date.UTC(2026, 8, 10, 12, 0, 0);
const event = (timestamp, extra = {}) => ({
  timestamp,
  agent: 'Codex',
  instanceId: '1:live',
  file: 'X:/project/file.ts',
  ...extra,
});
const renderChart = (props) => render(ActivityChart, { props });
function clock() {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(now);
}
const total = (container) => container.querySelector('.chart-reading strong').textContent;
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('advances an idle live histogram so expired retained events leave the chosen period', async () => {
  clock();
  const mounted = renderChart({
    events: [event(now - 290000)],
    observedAt: now,
    inspect: vi.fn(),
  });
  await fireEvent.click(screen.getByRole('button', { name: '5 min', exact: true }));
  expect(total(mounted.container)).toBe('1');
  const last = () =>
    within(screen.getByRole('group', { name: 'File activity histogram' }))
      .getAllByRole('button')
      .at(-1)
      .getAttribute('aria-label');
  const initial = last();
  await vi.advanceTimersByTimeAsync(11000);
  await tick();
  expect(total(mounted.container)).toBe('0');
  expect(last()).not.toBe(initial);
  mounted.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('freezes paused and stale windows, then resumes at the current clock', async () => {
  clock();
  const mounted = renderChart({
    events: [event(now - 290000)],
    observedAt: now,
    paused: true,
    inspect: vi.fn(),
  });
  await fireEvent.click(screen.getByRole('button', { name: '5 min', exact: true }));
  await vi.advanceTimersByTimeAsync(20000);
  await tick();
  expect(total(mounted.container)).toBe('1');
  expect(screen.getByText(/View paused/)).toBeInTheDocument();
  await mounted.rerender({ paused: false, stale: true });
  await vi.advanceTimersByTimeAsync(20000);
  await tick();
  expect(total(mounted.container)).toBe('1');
  expect(screen.getByText(/Observation unavailable/)).toBeInTheDocument();
  await mounted.rerender({ stale: false });
  await tick();
  expect(total(mounted.container)).toBe('0');
});

it('does not let a future or malformed event or scan timestamp move the time axis', () => {
  clock();
  const mounted = renderChart({
    events: [event(now), event(now + 86400000), event(NaN)],
    observedAt: now + 86400000,
    inspect: vi.fn(),
  });
  expect(total(mounted.container)).toBe('1');
  const buttons = within(
    screen.getByRole('group', { name: 'File activity histogram' }),
  ).getAllByRole('button');
  expect(buttons.at(-1)).toHaveAccessibleName(/1 observations$/);
  expect(mounted.container.textContent).not.toContain('Invalid Date');
});

it('keeps bucket membership and scale exact when inspecting boundaries and clears obsolete hover on period changes', async () => {
  clock();
  const bounds = activityBins([], now + 1, 15 * 60000);
  const rows = [event(bounds[5].start), ...Array.from({ length: 7 }, () => event(bounds[5].end))];
  const inspect = vi.fn();
  const mounted = renderChart({ events: rows, observedAt: now, inspect });
  const buttons = within(
    screen.getByRole('group', { name: 'File activity histogram' }),
  ).getAllByRole('button');
  await fireEvent.click(buttons[5]);
  expect(inspect.mock.calls[0][1].observations).toEqual([rows[0]]);
  await fireEvent.click(buttons[6]);
  expect(inspect.mock.calls[1][1].observations).toEqual(rows.slice(1));
  expect(screen.getByText('Scale 0–10 / interval')).toBeInTheDocument();
  await fireEvent.pointerEnter(buttons[6]);
  expect(mounted.container.querySelector('.chart-readout')).toHaveTextContent('7 observations');
  await fireEvent.pointerLeave(screen.getByRole('group', { name: 'File activity histogram' }));
  expect(mounted.container.querySelector('.chart-readout')).toHaveTextContent('Select an interval');
  await fireEvent.pointerEnter(buttons[6]);
  await fireEvent.click(screen.getByRole('button', { name: '5 min', exact: true }));
  expect(mounted.container.querySelector('.chart-readout')).toHaveTextContent('Select an interval');
  buttons[0].focus();
  await fireEvent.keyDown(buttons[0], { key: 'End' });
  expect(buttons.at(-1)).toHaveFocus();
});

it('advances and freezes timeline lanes independently of pushes while keeping future observations out', async () => {
  clock();
  const telemetry = {
    ...emptyTelemetry(),
    stale: false,
    ready: true,
    lastScan: now,
    agents: [{ agent: 'Codex', process: 'codex.exe', pid: 1, instanceId: '1:live' }],
    events: [event(now - 290000), event(now + 86400000)],
  };
  const mounted = render(Timeline, { telemetry, paused: true, inspect: vi.fn() });
  await fireEvent.change(screen.getByLabelText('Range'), { target: { value: '5' } });
  expect(screen.getByRole('button', { name: 'Codex: 1 events' })).toBeInTheDocument();
  await vi.advanceTimersByTimeAsync(20000);
  await tick();
  expect(screen.getByRole('button', { name: 'Codex: 1 events' })).toBeInTheDocument();
  await mounted.rerender({ paused: false });
  await tick();
  expect(screen.queryByRole('button', { name: /Codex: .* events/ })).toBeNull();
  mounted.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('holds hovered and keyboard-selected interval boundaries until inspection ends', async () => {
  clock();
  const bounds = activityBins([], now + 1, 15 * 60000);
  const rows = [event(bounds[5].start + 500)];
  const inspect = vi.fn();
  const mounted = renderChart({ events: rows, observedAt: now, inspect });
  const plot = screen.getByRole('group', { name: 'File activity histogram' });
  const buttons = within(plot).getAllByRole('button');
  await fireEvent.pointerEnter(buttons[5]);
  const initial = buttons[5].getAttribute('aria-label');
  await vi.advanceTimersByTimeAsync(2000);
  await tick();
  expect(buttons[5]).toHaveAccessibleName(initial);
  await fireEvent.click(buttons[5]);
  expect(inspect).toHaveBeenLastCalledWith(
    'Activity interval',
    expect.objectContaining({
      from: new Date(bounds[5].start).toISOString(),
      to: new Date(bounds[5].end).toISOString(),
      count: 1,
      observations: rows,
    }),
  );
  await fireEvent.pointerLeave(plot);
  await tick();
  expect(buttons[5].getAttribute('aria-label')).not.toBe(initial);
  buttons[6].focus();
  await tick();
  const keyboard = buttons[6].getAttribute('aria-label');
  await vi.advanceTimersByTimeAsync(2000);
  await tick();
  expect(buttons[6]).toHaveAccessibleName(keyboard);
  buttons[6].blur();
  await tick();
  expect(buttons[6].getAttribute('aria-label')).not.toBe(keyboard);
  mounted.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps an explicit agent filter when its retained events disappear', async () => {
  clock();
  const mounted = renderChart({ events: [event(now)], observedAt: now, inspect: vi.fn() });
  await fireEvent.change(screen.getByLabelText('Chart agent'), { target: { value: 'Codex' } });
  await mounted.rerender({ events: [event(now, { agent: 'Claude Code' })] });
  expect(screen.getByLabelText('Chart agent')).toHaveValue('Codex');
  expect(screen.getByRole('option', { name: /Codex.*no retained events/ })).toBeInTheDocument();
  expect(total(mounted.container)).toBe('0');
  await fireEvent.change(screen.getByLabelText('Chart agent'), { target: { value: '' } });
  expect(total(mounted.container)).toBe('1');
});
