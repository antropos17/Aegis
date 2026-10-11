import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/svelte';
import Notifications from '../../../frontend/observatory/components/Notifications.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';
import { addToast, clearAllToasts } from '../../../src/renderer/lib/stores/toast';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  clearAllToasts();
  vi.useRealTimers();
});

const trigger = () => screen.getByRole('button', { name: /^Sensitive activity review/ });

it('returns focus to Alerts after keyboard dismissal of an ordinary toast', async () => {
  render(Notifications, { telemetry: emptyTelemetry() });
  await act(() => addToast('Ordinary fixture warning', 'warning', 0));
  const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
  await act(() => dismiss.focus());
  expect(dismiss).toHaveFocus();
  await fireEvent.click(dismiss);
  expect(screen.queryByText('Ordinary fixture warning')).toBeNull();
  expect(trigger()).toHaveFocus();
});

it('returns focus to Alerts after a focused ordinary toast expires', async () => {
  render(Notifications, { telemetry: emptyTelemetry() });
  await act(() => addToast('Timer fixture warning', 'warning', 5000));
  const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
  await act(() => dismiss.focus());
  expect(dismiss).toHaveFocus();
  await act(() => vi.advanceTimersByTime(5000));
  expect(dismiss).not.toBeInTheDocument();
  expect(trigger()).toHaveFocus();
});

it('returns focus to Alerts when the stack evicts the focused toast', async () => {
  render(Notifications, { telemetry: emptyTelemetry() });
  await act(() => addToast('Oldest warning', 'warning', 0));
  const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
  await act(() => dismiss.focus());
  await act(() => {
    for (let index = 0; index < 3; index++) addToast(`New warning ${index}`, 'warning', 0);
  });
  expect(screen.queryByText('Oldest warning')).toBeNull();
  expect(trigger()).toHaveFocus();
});

it('preserves focus outside an expiring toast', async () => {
  render(Notifications, { telemetry: emptyTelemetry() });
  await act(() => addToast('Background warning', 'warning', 5000));
  const outside = document.createElement('button');
  document.body.append(outside);
  try {
    outside.focus();
    await act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByText('Background warning')).toBeNull();
    expect(outside).toHaveFocus();
  } finally {
    outside.remove();
  }
});
