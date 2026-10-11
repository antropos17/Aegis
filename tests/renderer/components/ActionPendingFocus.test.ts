import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import Action from '../../../frontend/observatory/components/Action.svelte';
import Settings from '../../../frontend/observatory/components/Settings.svelte';
import type { Host } from '../../../frontend/observatory/runtime/host';

const children = createRawSnippet(() => ({ render: () => '<span>Test action</span>' }));
const nativePendingBlur = (button: HTMLButtonElement) => {
  // jsdom also ignores blur() on disabled controls; enable only for that call.
  button.disabled = false;
  button.blur();
  button.disabled = true;
};
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

it.each(['success', 'failure'])(
  'recovers focused action after pending %s and allows another activation',
  async (outcome) => {
    const operation = deferred();
    const action = vi.fn(() => operation.promise);
    render(Action, { action, children });
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Test action' });
    button.focus();
    await fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    // jsdom does not reproduce Chromium's native disabled-button blur.
    // Reproduce that observed browser transition while testing the recovery contract.
    nativePendingBlur(button);
    expect(document.activeElement).toBe(document.body);
    await fireEvent.click(button);
    expect(action).toHaveBeenCalledOnce();
    if (outcome === 'success') operation.resolve();
    else operation.reject(new Error('Try again'));
    await waitFor(() => expect(button).toBeEnabled());
    await waitFor(() => expect(button).toHaveFocus());
    await fireEvent.click(document.activeElement!);
    expect(action).toHaveBeenCalledTimes(2);
  },
);

it.each(['another control', 'caller disabled', 'unmounted', 'unfocused start'])(
  'does not reclaim focus after %s',
  async (scenario) => {
    const operation = deferred();
    const mounted = render(Action, { action: () => operation.promise, children });
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Test action' });
    if (scenario !== 'unfocused start') button.focus();
    await fireEvent.click(button);
    nativePendingBlur(button);
    const other = document.createElement('input');
    mounted.container.append(other);
    if (scenario === 'another control') other.focus();
    if (scenario === 'caller disabled') await mounted.rerender({ disabled: true });
    if (scenario === 'unmounted') mounted.unmount();
    operation.resolve();
    await waitFor(() => {
      if (scenario === 'unmounted') expect(button.isConnected).toBe(false);
      else expect(button).toHaveAttribute('aria-busy', 'false');
    });
    expect(button).not.toHaveFocus();
    if (scenario === 'another control') expect(other).toHaveFocus();
  },
);

it('keeps the Settings notification Test action ready for another activation', async () => {
  const operation = deferred();
  const testNotification = vi.fn(async () => {
    await operation.promise;
    return { success: true };
  });
  render(Settings, {
    host: {
      getSettings: async () => ({ scanIntervalSec: 10, notificationsEnabled: true }),
      getUpdateStatus: async () => ({}),
      testNotification,
    } as unknown as Host,
    appearance: vi.fn(),
    navigate: vi.fn(),
  });
  await screen.findByText('Settings saved');
  await fireEvent.click(screen.getByRole('button', { name: 'Monitoring' }));
  const button = screen.getByRole<HTMLButtonElement>('button', { name: /^Test$/ });
  button.focus();
  await fireEvent.click(button);
  expect(button).toBeDisabled();
  nativePendingBlur(button);
  operation.resolve();
  await waitFor(() => expect(button).toHaveFocus());
  expect(button).toBeEnabled();
  await fireEvent.click(document.activeElement!);
  expect(testNotification).toHaveBeenCalledTimes(2);
});
