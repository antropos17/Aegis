import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import type { FileEvent } from '../../../src/shared/types';
import Notifications from '../../../frontend/observatory/components/Notifications.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';
import {
  alertBasename,
  createSensitiveAlertTracker,
} from '../../../frontend/observatory/runtime/sensitive-alerts';

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
