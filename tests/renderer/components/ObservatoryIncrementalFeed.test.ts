import { act, fireEvent, render, screen, within } from '@testing-library/svelte';
import { expect, it, vi } from 'vitest';
import ObservationTable from '../../../frontend/observatory/components/ObservationTable.svelte';
import ObservationHistory from '../../../frontend/observatory/components/ObservationHistory.svelte';
import Events from '../../../frontend/observatory/components/Events.svelte';
import { emptyTelemetry, type RecordData } from '../../../frontend/observatory/runtime/host';

const state = () => ({ ...emptyTelemetry(), ready: true, stale: false });
const event = (id: number): RecordData => ({
  eventId: 'event-' + id,
  file: '/fixture/file-' + id + '.txt',
  timestamp: 1000 + id,
  action: 'modified',
});

it('keeps the expanded history control focused with a truthful final-boundary label', async () => {
  const mounted = render(ObservationHistory, {
    rows: Array.from({ length: 35 }, (_, i) => event(i)),
    navigate: vi.fn(async () => {}),
  });
  const more = within(mounted.container).getByRole('button', { name: 'Show 15 more' });
  await act(() => more.focus());
  await fireEvent.click(more);
  expect(more).toHaveFocus();
  expect(more).toHaveAttribute('aria-disabled', 'true');
  expect(more).toHaveAccessibleName('All matching retained activity shown');
  expect(within(mounted.container).getAllByRole('button')).toHaveLength(36);
});

it('keeps all loaded older records mounted and the incremental control focused at the boundary', async () => {
  const mounted = render(ObservationTable, {
    rows: Array.from({ length: 65 }, (_, i) => event(i)),
    telemetry: state(),
    inspect: vi.fn(),
    grouping: 'none',
  });
  const older = within(
    mounted.container.querySelector('[data-feed-older]') as HTMLElement,
  ).getByRole('button', { name: 'Show older activity' });
  const table = within(mounted.container).getByRole('table') as HTMLTableElement;
  await act(() => older.focus());
  await fireEvent.click(older);
  expect(table.tBodies[0].rows).toHaveLength(60);
  expect(older).toHaveFocus();
  await fireEvent.click(older);
  expect(table.tBodies[0].rows).toHaveLength(65);
  expect(older).toHaveFocus();
  expect(older).toHaveAttribute('aria-disabled', 'true');
  await fireEvent.click(older);
  expect(older).toHaveFocus();
});

it('holds the original focused observation through arrivals and eviction until Show latest is chosen', async () => {
  const original = event(1);
  const inspect = vi.fn();
  const props = {
    rows: [original, event(2)],
    telemetry: state(),
    inspect,
    grouping: 'none' as const,
  };
  const mounted = render(ObservationTable, props);
  const originalButton = screen.getByRole('button', { name: 'Open 1 observations for file-1.txt' });
  await act(() => originalButton.focus());
  await mounted.rerender({ ...props, rows: [event(2), event(3)] });
  expect(originalButton).toHaveFocus();
  expect(originalButton).toHaveAccessibleName('Open 1 observations for file-1.txt');
  expect(screen.queryByText('file-3.txt')).toBeNull();
  await fireEvent.click(originalButton);
  expect(inspect).toHaveBeenLastCalledWith('Observation', original);
  const latest = screen.getByRole('button', { name: 'Show latest' });
  expect(latest).toHaveAttribute('aria-disabled', 'false');
  await act(() => latest.focus());
  await fireEvent.click(latest);
  expect(latest).toHaveFocus();
  expect(screen.queryByText('file-1.txt')).toBeNull();
  expect(screen.getByText('file-3.txt')).toBeInTheDocument();
  await mounted.rerender({ ...props, rows: [event(3), event(4)] });
  expect(latest).toHaveFocus();
  expect(screen.getByText('file-4.txt')).toBeInTheDocument();
});

it('does not recycle an unfocused network observation when a cloned snapshot is reordered', async () => {
  const connection = (port: number): RecordData => ({
    instanceId: '42:100',
    agent: 'Codex',
    remoteIp: '192.0.2.1',
    remotePort: port,
    localIp: '127.0.0.1',
    localPort: 8000 + port,
    state: 'ESTABLISHED',
  });
  const props = {
    rows: [connection(443), connection(80)],
    telemetry: state(),
    inspect: vi.fn(),
    grouping: 'none' as const,
  };
  const mounted = render(ObservationTable, props);
  const original = screen.getByRole('button', { name: 'Open 1 observations for 192.0.2.1:443' });
  await mounted.rerender({ ...props, rows: [connection(80), connection(443)] });
  expect(screen.getByRole('button', { name: 'Open 1 observations for 192.0.2.1:443' })).toBe(
    original,
  );
  await act(() => original.focus());
  await mounted.rerender({ ...props, rows: [connection(80)] });
  expect(original).toHaveFocus();
  await fireEvent.click(original);
  expect(props.inspect.mock.calls.at(-1)?.[1]).toMatchObject({ remotePort: 443 });
});

it('accepts a changed filter explicitly while retaining the focused filter and resetting the loaded limit', async () => {
  const props = {
    rows: Array.from({ length: 65 }, (_, i) => event(i)),
    telemetry: state(),
    inspect: vi.fn(),
    resetKey: 'all',
  };
  const mounted = render(ObservationTable, props);
  await fireEvent.click(screen.getByRole('button', { name: 'Show older activity' }));
  const outside = document.createElement('input');
  document.body.append(outside);
  try {
    await act(() => outside.focus());
    await mounted.rerender({ ...props, rows: [event(64)], resetKey: 'filtered' });
    expect(outside).toHaveFocus();
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
  } finally {
    outside.remove();
  }
});

it('keeps hidden feed deliveries pending and restores the accepted reading snapshot on return', async () => {
  const props = { rows: [event(1)], telemetry: state(), inspect: vi.fn() };
  const mounted = render(ObservationTable, props);
  await mounted.rerender({ ...props, rows: [event(2)], visible: false });
  await mounted.rerender({ ...props, rows: [event(2)], visible: true });
  expect(screen.getByText('file-1.txt')).toBeInTheDocument();
  expect(screen.queryByText('file-2.txt')).toBeNull();
  expect(screen.getByRole('button', { name: 'Show latest' })).toHaveAttribute(
    'aria-disabled',
    'false',
  );
});

it('combines files and connections in the simple layout without inventing connection times', async () => {
  const telemetry = {
    ...state(),
    events: [event(1)] as unknown as ReturnType<typeof state>['events'],
    networkAt: Date.now(),
    network: [
      { agent: 'Codex', instanceId: '42:100', remoteIp: '192.0.2.9', remotePort: 443 },
    ] as ReturnType<typeof state>['network'],
  };
  render(Events, {
    telemetry,
    inspect: vi.fn(),
    combined: true,
    advanced: false,
    showPause: false,
  });
  expect(screen.getByText('file-1.txt')).toBeInTheDocument();
  expect(screen.queryByLabelText('Grouping')).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Connections' }));
  expect(screen.getByText('192.0.2.9:443')).toBeInTheDocument();
  expect(screen.getByText(/Latest connection snapshot/)).toBeInTheDocument();
  expect(screen.queryByText('file-1.txt')).toBeNull();
  expect(screen.queryByText(/connection started|connection ended/i)).toBeNull();
});

it('limits Filesystem changes to recorded write actions and preserves inferred source and exact evidence', async () => {
  const changed = {
    ...event(1),
    agent: 'Codex',
    instanceId: '42:100',
    attribution: { status: 'inferred', evidence: ['cwd-containment'] },
  };
  const events = [
    changed,
    ...['created', 'deleted', 'holding', 'accessed', 'read'].map((action, i) => ({
      ...event(i + 2),
      action,
    })),
  ];
  const inspect = vi.fn();
  render(Events, {
    telemetry: { ...state(), events: events as unknown as ReturnType<typeof state>['events'] },
    inspect,
    combined: true,
    advanced: false,
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Filesystem changes' }));
  expect(screen.getByLabelText('Search events')).toBeInTheDocument();
  expect(screen.getByText('file-1.txt')).toBeInTheDocument();
  expect(screen.getByText('file-2.txt')).toBeInTheDocument();
  expect(screen.getByText('file-3.txt')).toBeInTheDocument();
  for (const id of [4, 5, 6]) expect(screen.queryByText('file-' + id + '.txt')).toBeNull();
  expect(screen.getAllByText('Indirect match').length).toBeGreaterThan(0);
  await fireEvent.click(screen.getByRole('button', { name: 'Open 1 observations for file-1.txt' }));
  expect(inspect).toHaveBeenLastCalledWith('Observation', changed);
});

it('preserves a focused network reading snapshot through an empty unavailable delivery', async () => {
  const connection = {
    agent: 'Codex',
    instanceId: '42:100',
    remoteIp: '192.0.2.9',
    remotePort: 443,
  };
  const telemetry = {
    ...state(),
    networkAt: Date.now(),
    network: [connection] as ReturnType<typeof state>['network'],
  };
  const inspect = vi.fn();
  const props = { telemetry, inspect, network: true };
  const mounted = render(Events, props);
  const original = screen.getByRole('button', { name: 'Open 1 observations for 192.0.2.9:443' });
  await act(() => original.focus());
  await mounted.rerender({ ...props, telemetry: { ...telemetry, stale: true, network: [] } });
  expect(original).toHaveFocus();
  expect(screen.getByText('192.0.2.9:443')).toBeInTheDocument();
  expect(screen.getByText(/No current network snapshot/)).toBeInTheDocument();
  expect(screen.getAllByText(/Retained network snapshot/).length).toBeGreaterThan(0);
  await fireEvent.click(original);
  expect(inspect).toHaveBeenLastCalledWith('Observation', connection);
});
