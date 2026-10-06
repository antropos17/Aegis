import { act, fireEvent, render, screen, within } from '@testing-library/svelte';
import { expect, it, vi } from 'vitest';
import Events from '../../../frontend/observatory/components/Events.svelte';
import Reports from '../../../frontend/observatory/components/Reports.svelte';
import { emptyTelemetry, type RecordData } from '../../../frontend/observatory/runtime/host';

const event = (id: number): RecordData => ({
  eventId: 'admission-' + id,
  file: '/fixture/file-' + id + '.txt',
  action: 'modified',
  timestamp: 1000 + id,
});
const state = (events: RecordData[], stale = false) => ({
  ...emptyTelemetry(),
  ready: true,
  stale,
  events: events as unknown as ReturnType<typeof emptyTelemetry>['events'],
});

it('explicitly resumes reviewed activity without losing its loaded limit, focused control or original evidence', async () => {
  const rows = Array.from({ length: 65 }, (_, id) => event(id));
  const inspect = vi.fn();
  const props = { telemetry: state(rows), inspect };
  const mounted = render(Events, props);
  await fireEvent.change(screen.getByLabelText('Grouping'), {
    target: { value: 'none' },
  });
  const table = within(mounted.container).getByRole('table') as HTMLTableElement;
  const older = within(
    mounted.container.querySelector('[data-feed-older]') as HTMLElement,
  ).getByRole('button', { name: 'Show older activity' });
  await fireEvent.click(older);
  const originalRow = within(table).getByText('file-10.txt').closest('tr') as HTMLElement;
  const original = within(originalRow).getByRole('button', {
    name: 'Open 1 observations for file-10.txt',
  });
  await act(() => original.focus());
  const controls = within(mounted.container.querySelector('.filter-actions') as HTMLElement);
  const pause = controls.getByRole('button', { name: 'Pause view' });
  await act(() => pause.focus());
  await fireEvent.click(pause);
  const delivered = [...rows, event(65)];
  await mounted.rerender({ ...props, telemetry: state(delivered) });
  expect(screen.queryByText('file-65.txt')).toBeNull();
  const resume = controls.getByRole('button', { name: 'Resume live view' });
  await act(() => resume.focus());
  await fireEvent.click(resume);
  expect(resume).toHaveFocus();
  expect(screen.getByLabelText('Grouping')).toHaveValue('none');
  expect(table.tBodies[0].rows).toHaveLength(60);
  expect(screen.getByText('file-65.txt')).toBeInTheDocument();
  expect(
    within(originalRow).getByRole('button', {
      name: 'Open 1 observations for file-10.txt',
    }),
  ).toBe(original);
  expect(table.contains(originalRow)).toBe(true);
});

it('admits stale captured rows only on explicit Resume and holds later stale and hidden deliveries', async () => {
  const props = { telemetry: state([event(1)]), inspect: vi.fn() };
  const mounted = render(Events, props);
  const controls = within(mounted.container.querySelector('.filter-actions') as HTMLElement);
  const retained = [event(1), event(66)];
  await mounted.rerender({ ...props, telemetry: state(retained, true) });
  expect(screen.queryByText('file-66.txt')).toBeNull();
  await fireEvent.click(controls.getByRole('button', { name: 'Pause view' }));
  const resume = controls.getByRole('button', { name: 'Resume live view' });
  await act(() => resume.focus());
  await fireEvent.click(resume);
  expect(screen.getByText('file-66.txt')).toBeInTheDocument();
  expect(resume).toHaveFocus();
  await mounted.rerender({
    ...props,
    telemetry: state([...retained, event(67)], true),
  });
  expect(screen.queryByText('file-67.txt')).toBeNull();
  await mounted.rerender({
    ...props,
    telemetry: state([...retained, event(68)]),
    visible: false,
  });
  expect(screen.queryByText('file-68.txt')).toBeNull();
  await mounted.rerender({
    ...props,
    telemetry: state([...retained, event(68)]),
    visible: true,
  });
  expect(screen.queryByText('file-68.txt')).toBeNull();
});

it('admits a workspace Resume while preserving its captured source and later reading protection', async () => {
  const props = {
    telemetry: state([event(1)]),
    inspect: vi.fn(),
    showPause: false,
  };
  const mounted = render(Events, props);
  await act(() =>
    screen.getByRole('button', { name: 'Open 1 observations for file-1.txt' }).focus(),
  );
  await mounted.rerender({ ...props, viewPaused: true });
  await mounted.rerender({
    ...props,
    viewPaused: true,
    telemetry: state([event(1), event(2)]),
  });
  expect(screen.queryByText('file-2.txt')).toBeNull();
  const outside = document.createElement('button');
  document.body.append(outside);
  try {
    await act(() => outside.focus());
    await mounted.rerender({
      ...props,
      viewPaused: false,
      telemetry: state([event(1), event(2)]),
    });
    expect(outside).toHaveFocus();
    expect(screen.getByText('file-2.txt')).toBeInTheDocument();
  } finally {
    outside.remove();
  }
});

it('admits a successfully loaded older audit page during a process outage without moving focus or scrolling', async () => {
  const first = Array.from({ length: 100 }, (_, id) => ({
    eventId: 'audit-' + id,
    timestamp: '2026-09-30T12:00:00.000Z',
    type: 'file-access',
    file: 'X:/fixture/ties.md',
    agent: 'Codex',
    action: 'read',
  }));
  let finish!: (_rows: RecordData[]) => void;
  const pending = new Promise<RecordData[]>((resolve) => {
    finish = resolve;
  });
  const telemetry = emptyTelemetry();
  const inspect = vi.fn();
  const host = {
    getAuditStats: vi.fn(async () => ({})),
    getAuditEntriesBefore: vi.fn().mockResolvedValueOnce(first).mockReturnValueOnce(pending),
  };
  const mounted = render(Reports, {
    host,
    telemetry,
    audit: true,
    inspect,
    navigate: vi.fn(),
  });
  await screen.findByText('100 audit entries loaded');
  await act(() => screen.getByRole('button', { name: /Open 100 observations/ }).focus());
  const surface = mounted.container.querySelector('.observation-table') as HTMLElement;
  const scroll = vi.fn();
  surface.scrollIntoView = scroll;
  await fireEvent.click(screen.getByRole('button', { name: 'Load older entries' }));
  const search = screen.getByLabelText('Search audit entries');
  await act(() => search.focus());
  finish([{ ...first[0], eventId: 'audit-100' }]);
  await screen.findByText('101 audit entries loaded');
  expect(search).toHaveFocus();
  expect(scroll).not.toHaveBeenCalled();
  expect(telemetry.stale).toBe(true);
  expect(telemetry.ready).toBe(false);
  await fireEvent.click(screen.getByRole('button', { name: /Open 101 observations/ }));
  const observations = inspect.mock.calls.at(-1)?.[1].observations as RecordData[];
  expect(new Set(observations.map((entry) => entry.eventId)).size).toBe(101);
});
