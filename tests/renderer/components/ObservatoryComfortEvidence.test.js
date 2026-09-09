import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import Events from '../../../frontend/observatory/components/Events.svelte';
import Reports from '../../../frontend/observatory/components/Reports.svelte';
import EntityLinks from '../../../frontend/observatory/components/EntityLinks.svelte';
import ObservationHistory from '../../../frontend/observatory/components/ObservationHistory.svelte';
import ObservationTable from '../../../frontend/observatory/components/ObservationTable.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

const telemetry = () => ({ ...emptyTelemetry(), ready: true, stale: false });
const noop = () => {};
const observation = (i, overrides = {}) => ({
  file: 'X:/skills/review-' + i + '/SKILL.md',
  agent: 'Codex',
  pid: i,
  instanceId: i + ':live',
  timestamp: 1700000000000 + i,
  action: 'read',
  ...overrides,
});

it('applies audit type immediately and searches loaded pages without dropping records', async () => {
  const all = [observation(1, { type: 'file-access' }), observation(2, { type: 'config-access' })];
  const host = {
    getAuditStats: vi.fn(async () => ({ persistedEntries: 2 })),
    getAuditEntriesBefore: vi.fn(async (_before, _limit, types) =>
      types ? all.filter((row) => types.includes(row.type)) : all,
    ),
  };
  render(Reports, { host, telemetry: telemetry(), audit: true, inspect: vi.fn(), navigate: noop });
  await screen.findByText('2 audit entries loaded');
  await fireEvent.input(screen.getByLabelText('Search audit entries'), {
    target: { value: 'review-2' },
  });
  expect(within(screen.getByRole('table')).queryByText(all[0].file)).toBeNull();
  expect(screen.getByText(all[1].file)).toBeInTheDocument();
  expect(screen.getByText('2 audit entries loaded')).toBeInTheDocument();
  await fireEvent.input(screen.getByLabelText('Search audit entries'), { target: { value: '' } });
  await fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'config-access' } });
  await screen.findByText('1 audit entries loaded');
  expect(host.getAuditEntriesBefore.mock.calls[1][2]).toEqual(['config-access']);
  expect(screen.queryByText(all[0].file)).toBeNull();
});

it('opens requested report sections without running exports and preserves their failure feedback', async () => {
  const host = { exportLog: vi.fn(async () => ({ success: false })) };
  const mounted = render(Reports, { host, telemetry: telemetry(), inspect: noop, navigate: noop });
  expect(screen.queryByRole('button', { name: 'JSON activity log', exact: true })).toBeNull();
  await mounted.rerender({ sectionRequest: { id: 'export', revision: 1 } });
  expect(screen.getByRole('tab', { name: 'Export', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(host.exportLog).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByRole('button', { name: 'JSON activity log', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('cancelled');
  await fireEvent.click(screen.getByRole('tab', { name: 'Session summary', exact: true }));
  await fireEvent.click(screen.getByRole('tab', { name: 'Export', exact: true }));
  expect(screen.getByRole('alert')).toHaveTextContent('cancelled');
});

it('keeps audit entries and filters when opening delivery diagnostics', async () => {
  const row = observation(3, { type: 'file-access' });
  const host = {
    getAuditStats: async () => ({ persistedEntries: 1, droppedEntries: 0 }),
    getAuditEntriesBefore: vi.fn(async () => [row]),
  };
  const mounted = render(Reports, {
    host,
    telemetry: telemetry(),
    audit: true,
    inspect: noop,
    navigate: noop,
  });
  await screen.findByText('1 audit entries loaded');
  await fireEvent.input(screen.getByLabelText('Search audit entries'), {
    target: { value: 'review-3' },
  });
  await mounted.rerender({ sectionRequest: { id: 'delivery', revision: 1 } });
  expect(screen.getByRole('heading', { name: 'Audit delivery details' })).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
  await fireEvent.click(screen.getByRole('tab', { name: 'Entries', exact: true }));
  expect(screen.getByLabelText('Search audit entries')).toHaveValue('review-3');
  expect(screen.getByText(row.file)).toBeInTheDocument();
  expect(host.getAuditEntriesBefore).toHaveBeenCalledOnce();
});

it('filters record history and exposes exactly the remaining records', async () => {
  const rows = Array.from({ length: 23 }, (_, i) => observation(i));
  const navigate = vi.fn(async () => {});
  render(ObservationHistory, { rows, navigate });
  expect(screen.getByRole('button', { name: 'Show 3 more', exact: true })).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: 'Show 3 more', exact: true }));
  expect(screen.getAllByRole('button')).toHaveLength(23);
  await fireEvent.input(screen.getByLabelText('Find a record'), {
    target: { value: 'review-22/' },
  });
  expect(screen.getAllByRole('button')).toHaveLength(1);
  await fireEvent.click(screen.getByRole('button'));
  expect(navigate).toHaveBeenCalledWith('Observation', rows[22]);
});

it('searches grouped process activity without attributing unrelated records to the process', async () => {
  const agent = { agent: 'Codex', process: 'codex.exe', pid: 10, instanceId: '10:live' };
  const own = observation(10),
    unrelated = observation(11);
  render(EntityLinks, {
    row: agent,
    telemetry: { ...telemetry(), agents: [agent], events: [own, unrelated] },
    navigate: vi.fn(),
    section: 'activity',
  });
  expect(screen.getByText(own.file)).toBeInTheDocument();
  expect(screen.queryByText(unrelated.file)).toBeNull();
  await fireEvent.input(screen.getByLabelText('Find activity'), { target: { value: 'review-11' } });
  expect(screen.getByText('No resources match this search.')).toBeInTheDocument();
});

it('returns keyboard focus to the first record when changing a long evidence page', async () => {
  const rows = Array.from({ length: 31 }, (_, i) => observation(i));
  const { container } = render(ObservationTable, { rows, telemetry: telemetry(), inspect: noop });
  await fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
  await waitFor(() => expect(container.querySelector('.observation-open')).toHaveFocus());
  expect(container.querySelectorAll('.observation-group')).toHaveLength(1);
  await fireEvent.click(screen.getByRole('button', { name: 'Previous', exact: true }));
  await waitFor(() => expect(container.querySelector('.observation-open')).toHaveFocus());
  expect(container.querySelectorAll('.observation-group')).toHaveLength(30);
});

it('retains loaded audit records and reports a failed refresh without success feedback', async () => {
  const row = observation(8, { type: 'file-access' });
  const host = {
    getAuditStats: async () => ({ persistedEntries: 1 }),
    getAuditEntriesBefore: vi
      .fn()
      .mockResolvedValueOnce([row])
      .mockRejectedValueOnce(new Error('Audit temporarily unavailable')),
  };
  render(Reports, { host, telemetry: telemetry(), audit: true, inspect: noop, navigate: noop });
  await screen.findByText('1 audit entries loaded');
  await fireEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true }));
  await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
  expect(screen.getByText(row.file)).toBeInTheDocument();
  expect(screen.queryByText('Completed')).toBeNull();
});

it('keeps advanced event filters active when their panel is collapsed and resets them together', async () => {
  const rows = [observation(1, { sensitive: true }), observation(2)];
  render(Events, { telemetry: { ...telemetry(), events: rows }, inspect: noop, showPause: false });
  expect(screen.queryByRole('combobox', { name: 'Event kind' })).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Filters', exact: true }));
  await fireEvent.change(screen.getByRole('combobox', { name: 'Event kind' }), {
    target: { value: 'sensitive' },
  });
  expect(screen.getByText(rows[0].file)).toBeInTheDocument();
  expect(screen.queryByText(rows[1].file)).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: /Filters Active/ }));
  expect(screen.queryByRole('combobox', { name: 'Event kind' })).toBeNull();
  expect(screen.getByText('Filters active')).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
  expect(screen.getByText(rows[1].file)).toBeInTheDocument();
});

it('shows the workspace pause state when local pause controls are omitted', async () => {
  const mounted = render(Events, {
    telemetry: { ...telemetry(), events: [observation(1)] },
    inspect: noop,
    showPause: false,
    viewPaused: true,
  });
  expect(screen.getByText(/Paused snapshot/)).toBeInTheDocument();
  expect(screen.queryByText(/Live view/)).toBeNull();
  await mounted.rerender({ viewPaused: false });
  expect(screen.getByText(/Live view/)).toBeInTheDocument();
});
