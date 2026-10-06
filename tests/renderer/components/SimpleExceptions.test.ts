import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import Details from '../../../frontend/observatory/components/Details.svelte';
import Notifications from '../../../frontend/observatory/components/Notifications.svelte';
import { emptyTelemetry, type Host } from '../../../frontend/observatory/runtime/host';
import type { FalsePositiveEntry, FileEvent } from '../../../src/shared/types';

const file = 'C:/work/.env';
const pattern = '^C:/work/\\.env$';
const exact: FalsePositiveEntry = { agentName: 'Claude', pattern, timestamp: 1 };
const other: FalsePositiveEntry = { agentName: 'Codex', pattern, timestamp: 2 };
const observed = (timestamp: number, overrides: Partial<FileEvent> = {}): FileEvent => ({
  agent: 'Claude',
  pid: 42,
  instanceId: '42:start',
  parentEditor: null,
  cwd: 'C:/work',
  file,
  sensitive: true,
  selfAccess: false,
  reason: 'Sensitive path',
  action: 'accessed',
  timestamp,
  category: 'ai',
  attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
  ...overrides,
});
const state = () => ({
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  falsePositiveReadState: 'ready' as const,
});
function details(host: Host, refreshFalsePositives = vi.fn(async () => {}), row = observed(1)) {
  return render(Details, {
    host,
    telemetry: state(),
    request: { title: '.env', row: { ...row } },
    close: vi.fn(),
    refreshFalsePositives,
  });
}

it('simple-exceptions: suppresses only fresh matching banners while retaining Alerts and evidence', async () => {
  const initial = { ...state(), falsePositives: [exact] };
  const onInspect = vi.fn();
  const mounted = render(Notifications, { telemetry: initial, onInspect });
  const muted = observed(1);
  await mounted.rerender({ telemetry: { ...initial, events: [muted] }, onInspect });
  expect(screen.queryByText('Sensitive file observed: .env')).toBeNull();
  expect(muted.sensitive).toBe(true);
  await fireEvent.click(screen.getByRole('button', { name: /Sensitive activity review/ }));
  const review = screen.getByRole('dialog', { name: 'Sensitive activity review' });
  expect(within(review).getByRole('button', { name: 'Open evidence' })).toBeInTheDocument();
  expect(within(review).getByText('1 need review')).toBeInTheDocument();
  await fireEvent.keyDown(review, { key: 'Escape' });
  const restored = observed(2);
  await mounted.rerender({
    telemetry: { ...initial, falsePositives: [], events: [muted, restored] },
    onInspect,
  });
  expect(screen.getByText('Sensitive file observed: .env')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /2 need review/ })).toBeInTheDocument();
});

it.each([
  { label: 'other path', row: observed(2, { file: 'C:/work/other.env' }) },
  { label: 'other owner', row: observed(2, { agent: 'Codex' }) },
  {
    label: 'unknown owner with a stale name',
    row: observed(2, { attribution: { status: 'unattributed', evidence: [] } }),
  },
  {
    label: 'legacy unknown owner with a stale name',
    row: { ...observed(2), attribution: 'unattributed' } as unknown as FileEvent,
  },
])('simple-exceptions: preserves banners for $label', async ({ row }) => {
  const initial = { ...state(), falsePositives: [exact] };
  const mounted = render(Notifications, { telemetry: initial });
  await mounted.rerender({ telemetry: { ...initial, events: [row] } });
  expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument();
});

it('simple-exceptions: confirms mute and removes only the exact entry from the latest saved population', async () => {
  let saved: FalsePositiveEntry[] = [];
  const host = {
    getFalsePositives: vi.fn(async () => saved.slice()),
    addFalsePositive: vi.fn(async (entry: FalsePositiveEntry) => {
      saved.push(entry);
      return { success: true };
    }),
    saveSettings: vi.fn(async (patch: { falsePositivePatterns: FalsePositiveEntry[] }) => {
      saved = patch.falsePositivePatterns;
      return { success: true };
    }),
  } as unknown as Host;
  const initial = state();
  let events: FileEvent[] = [];
  const banners = render(Notifications, { telemetry: initial });
  const refresh = vi.fn(async () => {
    await banners.rerender({ telemetry: { ...initial, events, falsePositives: saved.slice() } });
  });
  details(host, refresh);
  const mute = await screen.findByRole('button', { name: 'Mute false alarm' });
  await waitFor(() => expect(mute).toBeEnabled());
  await fireEvent.click(mute);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Re-enable alerts' })).toBeEnabled(),
  );
  expect(host.addFalsePositive).toHaveBeenCalledWith(
    expect.objectContaining({ agentName: 'Claude', pattern }),
  );
  events = [observed(10)];
  await refresh();
  expect(screen.queryByText('Sensitive file observed: .env')).toBeNull();
  expect(screen.getByRole('button', { name: /1 need review/ })).toBeInTheDocument();
  saved.push(other, { agentName: 'Claude', pattern: '^C:/other/', timestamp: 3 });
  await fireEvent.click(screen.getByRole('button', { name: 'Re-enable alerts' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Mute false alarm' })).toBeEnabled(),
  );
  expect(saved).toEqual([other, { agentName: 'Claude', pattern: '^C:/other/', timestamp: 3 }]);
  expect(host.saveSettings).toHaveBeenCalledWith({ falsePositivePatterns: saved }, { patch: true });
  events = [...events, observed(11)];
  await refresh();
  expect(screen.getByText('Sensitive file observed: .env')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /2 need review/ })).toBeInTheDocument();
  expect(refresh).toHaveBeenCalledTimes(4);
});

it('simple-exceptions: failed undo retains the confirmed exception and leaves re-enable retryable', async () => {
  const saved = [exact, other];
  const host = {
    getFalsePositives: vi.fn(async () => saved.slice()),
    saveSettings: vi.fn(async () => ({ success: false, error: 'undo unavailable' })),
  } as unknown as Host;
  details(host);
  const undo = await screen.findByRole('button', { name: 'Re-enable alerts' });
  await waitFor(() => expect(undo).toBeEnabled());
  await fireEvent.click(undo);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('undo unavailable'));
  expect(undo).toBeEnabled();
  expect(saved).toEqual([exact, other]);
  expect(screen.queryByRole('button', { name: 'Retry status' })).toBeNull();
});

it('simple-exceptions: keeps failed writes retryable and readback recovery read-only', async () => {
  let saved: FalsePositiveEntry[] = [];
  let unreadable = false;
  const add = vi
    .fn()
    .mockResolvedValueOnce({ success: false, error: 'disk unavailable' })
    .mockImplementation(async (entry: FalsePositiveEntry) => {
      saved = [entry];
      unreadable = true;
      return { success: true };
    });
  const host = {
    getFalsePositives: vi.fn(async () => {
      if (unreadable) throw new Error('read unavailable');
      return saved.slice();
    }),
    addFalsePositive: add,
  } as unknown as Host;
  details(host);
  const mute = await screen.findByRole('button', { name: 'Mute false alarm' });
  await waitFor(() => expect(mute).toBeEnabled());
  await fireEvent.click(mute);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('disk unavailable'));
  expect(mute).toBeEnabled();
  await fireEvent.click(mute);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Retry status' })).toBeInTheDocument(),
  );
  expect(screen.queryByRole('button', { name: 'Re-enable alerts' })).toBeNull();
  unreadable = false;
  await fireEvent.click(screen.getByRole('button', { name: 'Retry status' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Re-enable alerts' })).toBeEnabled(),
  );
  expect(add).toHaveBeenCalledTimes(2);
});

it('simple-exceptions: does not offer a saved exception for an unattributed stale label or a basename summary', async () => {
  const host = { getFalsePositives: vi.fn(async () => []) } as unknown as Host;
  const mounted = details(
    host,
    vi.fn(async () => {}),
    observed(1, { attribution: { status: 'unattributed', evidence: [] } }),
  );
  expect(screen.queryByRole('button', { name: 'Mute false alarm' })).toBeNull();
  await mounted.rerender({
    host,
    telemetry: state(),
    request: { title: '.env', row: { ...observed(2, { file: '.env' }) } },
    close: vi.fn(),
    refreshFalsePositives: vi.fn(async () => {}),
  });
  expect(screen.queryByRole('button', { name: 'Mute false alarm' })).toBeNull();
  expect(host.getFalsePositives).not.toHaveBeenCalled();
});
