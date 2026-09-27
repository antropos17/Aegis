import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import type { FileEvent } from '../../../src/shared/types';
import Notifications from '../../../frontend/observatory/components/Notifications.svelte';
import AgentWorkspace from '../../../frontend/observatory/components/AgentWorkspace.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';
import {
  alertBasename,
  alertControlTarget,
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

it('orders a mixed delivery by recorded observation time', () => {
  const tracker = createSensitiveAlertTracker();
  const delivery = tracker.ingest([event(3), event(1), event(2)]);
  expect(delivery.items.map((item) => item.event.timestamp)).toEqual([3, 2, 1]);
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
