import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { FileEvent } from '../../../src/shared/types';
import Notifications from '../../../frontend/observatory/components/Notifications.svelte';
import AgentWorkspace from '../../../frontend/observatory/components/AgentWorkspace.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';
import {
  alertBasename,
  alertControlTarget,
  createSensitiveAlertTracker,
  parseJournalAlerts,
} from '../../../frontend/observatory/runtime/sensitive-alerts';
import type { Host } from '../../../frontend/observatory/runtime/host';

function event(id: number, overrides: Partial<FileEvent> = {}): FileEvent {
  return {
    agent: 'Claude',
    pid: 42,
    instanceId: '42:start',
    parentEditor: null,
    cwd: 'C:/work',
    file: `C:/work/.env-${id}`,
    sensitive: true,
    selfAccess: false,
    reason: 'Sensitive path',
    action: 'accessed',
    timestamp: id,
    category: 'ai',
    attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
    ...overrides,
  };
}

it('seeds existing observations quietly, then tracks only new sensitive rows with bounded review state', () => {
  const tracker = createSensitiveAlertTracker(2);
  const first = event(1);
  const second = event(2, { sensitive: false });
  expect(tracker.ingest([first, second]).fresh).toEqual([]);
  const third = event(3);
  const newDelivery = tracker.ingest([first, second, third]);
  expect(newDelivery.fresh).toHaveLength(1);
  expect(newDelivery.items.map((item) => item.event.file)).toEqual([third.file, first.file]);
  expect(tracker.ingest([first, second, third]).fresh).toEqual([]);
  const reviewed = tracker.setReviewed(newDelivery.items[0].id, true);
  expect(reviewed[0].reviewed).toBe(true);
  const fourth = event(4);
  const overflowing = tracker.ingest([first, second, third, fourth]);
  expect(overflowing.items).toHaveLength(2);
  expect(overflowing.evicted).toBe(1);
  expect(overflowing.items[1].reviewed).toBe(true);
  expect(alertBasename('C:\\work\\.env')).toBe('.env');
});

it('orders a mixed delivery by recorded observation time', () => {
  const tracker = createSensitiveAlertTracker();
  const delivery = tracker.ingest([event(3), event(1), event(2)]);
  expect(delivery.items.map((item) => item.event.timestamp)).toEqual([3, 2, 1]);
});

it('merges a late journal seed by UUID, keeps a new same-path event open, and preserves arrival capacity', () => {
  const oldId = '00000000-0000-4000-8000-000000000001';
  const newId = '00000000-0000-4000-8000-000000000002';
  const tracker = createSensitiveAlertTracker(1);
  const old = event(100, { eventId: oldId, file: 'C:/private/.env' });
  tracker.ingest([old]);
  tracker.setReviewed(oldId, true, true);
  const staleSeed = [
    {
      eventId: oldId,
      timestamp: 100,
      basename: '.env',
      action: 'accessed' as const,
      agent: 'Claude',
      attribution: 'confirmed' as const,
      reviewed: false,
    },
  ];
  expect(tracker.mergeJournal(staleSeed)[0].reviewed).toBe(true);
  const newerArrival = event(1, { eventId: newId, file: old.file });
  const delivery = tracker.ingest([old, newerArrival]);
  expect(delivery.items).toHaveLength(1);
  expect(delivery.items[0]).toMatchObject({ id: newId, reviewed: false });
  expect(tracker.mergeJournal(staleSeed)[0].id).toBe(newId);
  expect(parseJournalAlerts([{ ...staleSeed[0], basename: 'C:/private/.env' }])).toEqual([]);
  expect(parseJournalAlerts([{ ...staleSeed[0], action: 'execute' }])).toEqual([]);
});

it('drops review overrides when an alert leaves the bounded list', () => {
  const oldId = '00000000-0000-4000-8000-000000000011';
  const newId = '00000000-0000-4000-8000-000000000012';
  const tracker = createSensitiveAlertTracker(1);
  tracker.ingest([event(1, { eventId: oldId })]);
  tracker.setReviewed(oldId, true, true);
  expect(tracker.ingest([event(2, { eventId: newId })]).items[0].id).toBe(newId);
  expect(tracker.ingest([event(3, { eventId: oldId })]).items[0]).toMatchObject({
    id: oldId,
    reviewed: false,
  });
  expect(
    tracker.mergeJournal([
      {
        eventId: oldId,
        timestamp: 1,
        basename: '.env-1',
        action: 'accessed',
        agent: 'Claude',
        attribution: 'confirmed',
        reviewed: false,
      },
    ])[0].reviewed,
  ).toBe(false);
});

it('keeps a legacy event ID session-only', () => {
  const tracker = createSensitiveAlertTracker();
  const delivery = tracker.ingest([event(1, { eventId: 'legacy-path-derived-id' })]);
  expect(delivery.items[0].id).toMatch(/^session-\d+$/);
  expect(delivery.items[0].savedReview).toBe(false);
});

it('shows restored summaries and keeps review open after a failed durable write', async () => {
  const id = '00000000-0000-4000-8000-000000000003';
  const host = {
    listSensitiveAlerts: vi.fn(async () => ({
      success: true,
      status: 'ready',
      items: [
        {
          eventId: id,
          timestamp: Date.now(),
          basename: '.env',
          action: 'accessed',
          agent: 'Claude',
          attribution: 'confirmed',
          reviewed: false,
        },
      ],
    })),
    setSensitiveAlertReviewed: vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: 'write failed' })
      .mockResolvedValue({ success: true, status: 'ready' }),
  } as unknown as Host;
  render(Notifications, { telemetry: emptyTelemetry(), host });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /1 need review/ })).toBeInTheDocument(),
  );
  await fireEvent.click(screen.getByRole('button', { name: /Sensitive activity review/ }));
  const dialog = screen.getByRole('dialog', { name: 'Sensitive activity review' });
  expect(within(dialog).getByText(/Saved summary/)).toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: 'Open evidence' })).toBeNull();
  await fireEvent.click(within(dialog).getByRole('button', { name: 'Mark reviewed' }));
  await waitFor(() => expect(within(dialog).getByText(/could not be saved/)).toBeInTheDocument());
  expect(within(dialog).getByText('1 need review')).toBeInTheDocument();
  await fireEvent.click(within(dialog).getByRole('button', { name: 'Mark reviewed' }));
  await waitFor(() => expect(within(dialog).getByText('0 need review')).toBeInTheDocument());
});

it('offers process controls only for one live, confirmed, witness-bound identity', async () => {
  const observed = event(5);
  const agent = {
    agent: 'Claude',
    process: 'claude.exe',
    pid: 42,
    status: 'running' as const,
    category: 'ai',
    instanceId: '42:start',
    instanceIdSource: 'os' as const,
    generationWitness: '123',
    generationWitnessSource: 'sequence' as const,
  };
  const telemetry = {
    ...emptyTelemetry(),
    ready: true,
    stale: false,
    agents: [agent],
    events: [observed],
  };
  expect(alertControlTarget(observed, telemetry)).toBe(agent);
  expect(
    alertControlTarget(
      { ...observed, attribution: { status: 'inferred', evidence: [] } },
      telemetry,
    ),
  ).toBeNull();
  expect(alertControlTarget(observed, { ...telemetry, stale: true })).toBeNull();
  expect(alertControlTarget(observed, { ...telemetry, agents: [agent, agent] })).toBeNull();
  const onInspect = vi.fn();
  render(Notifications, { telemetry, onInspect });
  await fireEvent.click(screen.getByRole('button', { name: /Sensitive activity review/ }));
  await fireEvent.click(screen.getByRole('button', { name: 'Open process controls' }));
  expect(onInspect).toHaveBeenCalledWith('Claude', {
    ...agent,
    detailSection: 'process-controls',
  });
  render(AgentWorkspace, {
    telemetry,
    liveTelemetry: telemetry,
    host: null,
    scope: { agent: 'Claude', instanceId: '42:start' },
    change: vi.fn(),
    inspect: vi.fn(),
    navigate: vi.fn(),
    sectionRequest: { id: 'process-controls', revision: 1 },
  });
  expect(screen.getByText('Process attributes and controls').closest('details')).toHaveAttribute(
    'open',
  );
});

it('shows a bottom alert with attribution caveat and offers session review without claiming access denial', async () => {
  const initial = { ...emptyTelemetry(), ready: true, stale: false, events: [] };
  const mounted = render(Notifications, { telemetry: initial });
  const observed = event(1, {
    agent: 'Claude',
    attribution: { status: 'inferred', evidence: ['cwd-containment'] },
    action: 'holding',
  });
  await mounted.rerender({ telemetry: { ...initial, events: [observed] } });
  expect(screen.getByText('Sensitive file observed: .env-1')).toBeInTheDocument();
  expect(screen.getByText('Possible source: Claude')).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: /^Review$/ }));
  const dialog = screen.getByRole('dialog', { name: 'Sensitive activity review' });
  expect(within(dialog).getByText(/does not isolate a file or block access/)).toBeInTheDocument();
  expect(within(dialog).getByText(/Handle present; read not established/)).toBeInTheDocument();
  await fireEvent.click(within(dialog).getByRole('button', { name: 'Mark reviewed' }));
  expect(within(dialog).getByText('0 need review')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Needs review' })).toHaveFocus();
  expect(
    screen.getByRole('button', { name: /Sensitive activity review · 0 need review/ }),
  ).toBeInTheDocument();
  await fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Sensitive activity review' })).toBeNull();
  expect(
    screen.getByRole('button', { name: /Sensitive activity review · 0 need review/ }),
  ).toHaveFocus();
});

it('keeps unknown attribution explicit and does not toast the same delivered row twice', async () => {
  const initial = { ...emptyTelemetry(), ready: true, stale: false, events: [event(1)] };
  const onInspect = vi.fn();
  const mounted = render(Notifications, { telemetry: initial, onInspect });
  expect(screen.queryByText(/Sensitive file observed/)).toBeNull();
  const unknown = event(2, {
    agent: '',
    pid: null,
    instanceId: null,
    attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
  });
  await mounted.rerender({
    telemetry: { ...initial, events: [initial.events[0], unknown] },
    onInspect,
  });
  expect(screen.getByText('Source may be unverified; review the evidence.')).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
  await mounted.rerender({
    telemetry: { ...initial, events: [initial.events[0], unknown] },
    onInspect,
  });
  expect(screen.queryByText(/Sensitive file observed/)).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: /Sensitive activity review/ }));
  const dialog = screen.getByRole('dialog', { name: 'Sensitive activity review' });
  await fireEvent.click(within(dialog).getAllByRole('button', { name: 'Open evidence' })[0]);
  expect(onInspect).toHaveBeenCalledWith('.env-2', unknown);
});
