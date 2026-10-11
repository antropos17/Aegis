import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import FalsePositiveToggle from '../../../frontend/observatory/components/FalsePositiveToggle.svelte';

it.each(['success', 'failure', 'user moved focus', 'unmounted', 'path limit'] as const)(
  'preserves Retry focus ownership during recovery: %s',
  async (outcome) => {
    let finishRead!: (entries: []) => void;
    let failRead!: (error: Error) => void;
    const recovery = new Promise<[]>((resolve, reject) => {
      finishRead = resolve;
      failRead = reject;
    });
    const host = {
      getFalsePositives: vi
        .fn()
        .mockRejectedValueOnce(new Error('Fixture unavailable'))
        .mockImplementationOnce(() => recovery),
    };
    const refresh = vi.fn(async () => {});
    const view = render(FalsePositiveToggle, {
      props: {
        host,
        target: {
          agentName: 'Claude',
          file: 'X:/fixture/.env',
          pattern: outcome === 'path limit' ? 'x'.repeat(257) : '^X:/fixture/\\.env$',
        },
        refreshFalsePositives: refresh,
      },
    });
    const retry = await screen.findByRole('button', { name: 'Retry status' });
    await act(() => retry.focus());
    await fireEvent.click(retry);
    await waitFor(() => expect(host.getFalsePositives).toHaveBeenCalledTimes(2));
    expect(retry).toHaveFocus();
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    await fireEvent.click(retry);
    expect(host.getFalsePositives).toHaveBeenCalledTimes(2);
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    try {
      if (outcome === 'user moved focus' || outcome === 'unmounted')
        await act(() => elsewhere.focus());
      if (outcome === 'unmounted') view.unmount();
      await act(async () => {
        if (outcome === 'failure') failRead(new Error('Recovery unavailable'));
        else finishRead([]);
        await recovery.catch(() => {});
      });
      if (outcome === 'unmounted') {
        expect(elsewhere).toHaveFocus();
        expect(retry.isConnected).toBe(false);
      } else if (outcome === 'failure') {
        expect(await screen.findByRole('alert')).toHaveTextContent('Recovery unavailable');
        expect(screen.getByRole('button', { name: 'Retry status' })).toBe(retry);
        expect(retry).toHaveFocus();
        expect(retry).toHaveAttribute('aria-disabled', 'false');
        expect(refresh).not.toHaveBeenCalled();
      } else if (outcome === 'path limit') {
        await waitFor(() =>
          expect(screen.queryByRole('button', { name: 'Retry status' })).toBeNull(),
        );
        expect(screen.getByRole('button', { name: 'Mute false alarm' })).toBeDisabled();
        expect(screen.getByRole('status')).toHaveTextContent(
          'This exact path exceeds the saved exception limit.',
        );
        expect(screen.getByRole('status')).toHaveFocus();
        expect(refresh).toHaveBeenCalledTimes(1);
      } else {
        const control = screen.getByRole('button', { name: 'Mute false alarm' });
        await waitFor(() => expect(control).toBeEnabled());
        expect(refresh).toHaveBeenCalledTimes(1);
        await waitFor(() =>
          expect(screen.queryByRole('button', { name: 'Retry status' })).toBeNull(),
        );
        expect(outcome === 'success' ? control : elsewhere).toHaveFocus();
      }
    } finally {
      elsewhere.remove();
    }
  },
);
