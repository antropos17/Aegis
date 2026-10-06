import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/svelte';
import Notifications from '../../../frontend/observatory/components/Notifications.svelte';
import { emptyTelemetry, type Host } from '../../../frontend/observatory/runtime/host';
import type { FileEvent } from '../../../src/shared/types';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function event(id: number): FileEvent {
  return {
    eventId: '00000000-0000-4000-8000-' + String(id).padStart(12, '0'),
    agent: 'Codex',
    pid: 42,
    instanceId: '42:start',
    parentEditor: null,
    cwd: 'X:/fixture',
    file: 'X:/fixture/.env-' + id,
    sensitive: true,
    selfAccess: false,
    reason: 'Sensitive path',
    action: 'accessed',
    timestamp: id,
    category: 'ai',
    attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
  };
}

async function start(host: Host | null = null) {
  const initial = { ...emptyTelemetry(), ready: true, stale: false };
  const mounted = render(Notifications, { telemetry: initial, host });
  let events: FileEvent[] = [];
  const receive = async (rows: FileEvent[]) => {
    events = [...events, ...rows];
    await mounted.rerender({ telemetry: { ...initial, events } });
  };
  await receive([event(1)]);
  return { ...mounted, receive };
}

const trigger = () => screen.getByRole('button', { name: /^Sensitive activity review/ });
const banner = () => screen.getByRole('status');
const advance = (milliseconds: number) => act(() => vi.advanceTimersByTime(milliseconds));

it('expires an ordinary banner after eight seconds while retaining the unreviewed alert', async () => {
  await start();
  await advance(7999);
  expect(banner()).toHaveTextContent('Sensitive file observed: .env-1');
  await advance(1);
  expect(screen.queryByRole('status')).toBeNull();
  expect(trigger()).toHaveAccessibleName('Sensitive activity review · 1 need review');
});

it('keeps Review and Dismiss available while focused and restarts expiry after focus leaves', async () => {
  await start();
  const review = within(banner()).getByRole('button', { name: 'Review' });
  const dismiss = within(banner()).getByRole('button', { name: 'Dismiss notification' });
  await advance(7000);
  await act(() => review.focus());
  await advance(16000);
  expect(review).toHaveFocus();
  expect(banner()).toBeInTheDocument();
  await act(() => dismiss.focus());
  await advance(8000);
  expect(dismiss).toHaveFocus();
  expect(banner()).toBeInTheDocument();

  await act(() => trigger().focus());
  await advance(7999);
  expect(banner()).toBeInTheDocument();
  await advance(1);
  expect(screen.queryByRole('status')).toBeNull();
  expect(trigger()).toHaveFocus();
});

it('keeps focus across fresh batches and restores Alerts after a focused dismissal without writing review state', async () => {
  const writeReview = vi.fn(async () => ({ success: true }));
  const mounted = await start({ setSensitiveAlertReviewed: writeReview });
  const review = within(banner()).getByRole('button', { name: 'Review' });
  await act(() => review.focus());
  await advance(7000);
  await mounted.receive([event(2)]);
  expect(banner()).toHaveTextContent('Sensitive file observed: .env-2');
  expect(review).toHaveFocus();
  await advance(8000);
  expect(banner()).toBeInTheDocument();
  const dismiss = within(banner()).getByRole('button', { name: 'Dismiss notification' });
  await act(() => dismiss.focus());
  await fireEvent.click(dismiss);
  expect(screen.queryByRole('status')).toBeNull();
  expect(trigger()).toHaveFocus();
  expect(trigger()).toHaveAccessibleName('Sensitive activity review · 2 need review');
  expect(writeReview).not.toHaveBeenCalled();
  await fireEvent.click(trigger());
  const center = screen.getByRole('dialog', { name: 'Sensitive activity review' });
  expect(within(center).getByText('.env-1')).toBeInTheDocument();
  expect(within(center).getByText('.env-2')).toBeInTheDocument();
});

it('does not steal outside focus when a pointer dismissal removes an unfocused banner', async () => {
  await start();
  const outside = document.createElement('button');
  outside.textContent = 'Continue work';
  document.body.append(outside);
  try {
    await act(() => outside.focus());
    await fireEvent.click(within(banner()).getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(outside).toHaveFocus();
    expect(trigger()).toHaveAccessibleName('Sensitive activity review · 1 need review');
  } finally {
    outside.remove();
  }
});

it('returns a focused Dismiss control to Alerts without marking its observation reviewed', async () => {
  const writeReview = vi.fn(async () => ({ success: true }));
  await start({ setSensitiveAlertReviewed: writeReview });
  const dismiss = within(banner()).getByRole('button', { name: 'Dismiss notification' });
  await act(() => dismiss.focus());
  await fireEvent.click(dismiss);
  expect(screen.queryByRole('status')).toBeNull();
  expect(trigger()).toHaveFocus();
  expect(trigger()).toHaveAccessibleName('Sensitive activity review · 1 need review');
  expect(writeReview).not.toHaveBeenCalled();
});

it('preserves Review heading focus and gives later unfocused banners their ordinary expiry', async () => {
  const mounted = await start();
  const review = within(banner()).getByRole('button', { name: 'Review' });
  await act(() => review.focus());
  await fireEvent.click(review);
  const center = screen.getByRole('dialog', { name: 'Sensitive activity review' });
  expect(within(center).getByRole('heading', { name: 'Sensitive activity review' })).toHaveFocus();
  expect(screen.queryByRole('status')).toBeNull();
  await fireEvent.click(within(center).getByRole('button', { name: 'Close alert review' }));
  expect(trigger()).toHaveFocus();
  await mounted.receive([event(2)]);
  expect(banner()).toHaveTextContent('.env-2');
  await advance(8000);
  expect(screen.queryByRole('status')).toBeNull();
  expect(trigger()).toHaveFocus();
});

it('restarts ordinary expiry when an unfocused fresh batch replaces the banner', async () => {
  const mounted = await start();
  await advance(7000);
  await mounted.receive([event(2)]);
  await advance(7999);
  expect(banner()).toHaveTextContent('.env-2');
  await advance(1);
  expect(screen.queryByRole('status')).toBeNull();
  expect(trigger()).toHaveAccessibleName('Sensitive activity review · 2 need review');
});
