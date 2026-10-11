import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import FalsePositiveToggle from '../../../frontend/observatory/components/FalsePositiveToggle.svelte';
import type { FalsePositiveEntry } from '../../../src/shared/types';

it.each([false, true])(
  'keeps main control focus and blocks duplicate writes (readback failure: %s)',
  async (failReadback) => {
    let saved: FalsePositiveEntry[] = [];
    let finishWrite!: () => void;
    let written = false;
    const write = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const host = {
      getFalsePositives: vi.fn(async () => {
        if (written && failReadback) throw new Error('offline');
        return saved.slice();
      }),
      addFalsePositive: vi.fn(async (entry: FalsePositiveEntry) => {
        await write;
        saved = [entry];
        written = true;
        return { success: true };
      }),
    };
    const refresh = vi.fn(async () => {});
    render(FalsePositiveToggle, {
      props: {
        host,
        target: { agentName: 'Claude', file: 'X:/fixture/.env', pattern: '^X:/fixture/\\.env$' },
        refreshFalsePositives: refresh,
      },
    });
    const control = screen.getByRole('button', { name: 'Mute false alarm' });
    await waitFor(() => expect(control).toBeEnabled());
    await act(() => control.focus());
    await fireEvent.click(control);
    await waitFor(() => expect(host.addFalsePositive).toHaveBeenCalledTimes(1));
    expect(control).toHaveAttribute('aria-disabled', 'true');
    expect(control).toHaveAttribute('aria-busy', 'true');
    expect(control).toBeEnabled();
    expect(control).toHaveFocus();
    await fireEvent.click(control);
    expect(host.addFalsePositive).toHaveBeenCalledTimes(1);
    finishWrite();
    if (failReadback) {
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Retry status' })).toHaveFocus(),
      );
      expect(control).toBeDisabled();
      expect(refresh).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(control).toHaveAccessibleName('Re-enable alerts'));
      expect(control).toBeEnabled();
      expect(control).toHaveFocus();
      expect(refresh).toHaveBeenCalledTimes(1);
    }
  },
);

it.each([false, true])(
  'settles owned main focus after queued verification (final read fails: %s)',
  async (finalReadFails) => {
    let finishWrite!: () => void;
    let finishRead!: () => void;
    const write = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const queuedRead = new Promise<void>((resolve) => {
      finishRead = resolve;
    });
    const entry = { agentName: 'Claude', pattern: '^X:/fixture/\\.env$', timestamp: 1 };
    let reads = 0;
    const host = {
      getFalsePositives: vi.fn(async () => {
        reads++;
        if (reads === 3) throw new Error('write readback offline');
        if (reads === 4) {
          await queuedRead;
          if (finalReadFails) throw new Error('queued verification offline');
          return [entry];
        }
        return [];
      }),
      addFalsePositive: vi.fn(async () => {
        await write;
        return { success: true };
      }),
    };
    const mounted = render(FalsePositiveToggle, {
      props: {
        host,
        target: { agentName: 'Claude', file: 'X:/fixture/.env', pattern: entry.pattern },
        refreshFalsePositives: vi.fn(async () => {}),
      },
    });
    const control = screen.getByRole('button', { name: 'Mute false alarm' });
    await waitFor(() => expect(control).toBeEnabled());
    await act(() => control.focus());
    await fireEvent.click(control);
    await waitFor(() => expect(host.addFalsePositive).toHaveBeenCalledTimes(1));
    await mounted.rerender({ statusRevision: 1 });
    finishWrite();
    await waitFor(() => expect(reads).toBe(4));
    expect(control).toBeEnabled();
    expect(control).toHaveAttribute('aria-busy', 'true');
    expect(control).toHaveFocus();
    await fireEvent.click(control);
    expect(host.addFalsePositive).toHaveBeenCalledTimes(1);
    finishRead();
    if (finalReadFails) {
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Retry status' })).toHaveFocus(),
      );
      expect(control).toBeDisabled();
    } else {
      await waitFor(() => expect(control).toHaveAccessibleName('Re-enable alerts'));
      expect(control).toHaveFocus();
      expect(control).toBeEnabled();
    }
  },
);
