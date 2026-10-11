import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import Reports from '../../../frontend/observatory/components/Reports.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const rows = (start: number, count = 100) =>
  Array.from({ length: count }, (_, index) => ({
    timestamp: '2026-10-10T12:00:00.000Z',
    eventId: start + index,
    type: 'file-access',
    file: `X:/fixture/history-${start + index}.md`,
    agent: 'Codex',
    action: 'read',
  }));

function fixture() {
  const history = deferred<unknown>();
  const stats = deferred<unknown>();
  const host = {
    getAuditEntriesBefore: vi
      .fn()
      .mockResolvedValueOnce(rows(1))
      .mockReturnValueOnce(history.promise)
      .mockResolvedValue([]),
    getAuditStats: vi
      .fn()
      .mockResolvedValueOnce({})
      .mockReturnValueOnce(stats.promise)
      .mockResolvedValue({}),
  };
  const mounted = render(Reports, {
    host,
    telemetry: { ...emptyTelemetry(), ready: true },
    audit: true,
    inspect: vi.fn(),
    navigate: vi.fn(),
  });
  return { host, history, stats, mounted };
}

it.each(['Refresh', 'Load older entries'])(
  'keeps focused %s through both pending reads, blocks duplicates and admits a final page',
  async (label) => {
    const { host, history, stats } = fixture();
    await screen.findByText('100 audit entries loaded');
    const button = screen.getByRole('button', { name: label });
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'false'));
    button.focus();
    await fireEvent.click(button);
    expect(button).toHaveFocus();
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await fireEvent.click(button);
    await fireEvent.click(
      screen.getByRole('button', {
        name: label === 'Refresh' ? 'Load older entries' : 'Refresh',
      }),
    );
    expect(host.getAuditEntriesBefore).toHaveBeenCalledTimes(2);
    expect(host.getAuditStats).toHaveBeenCalledTimes(2);

    await act(() => history.resolve(rows(101, 1)));
    await screen.findByText(
      label === 'Refresh' ? '1 audit entries loaded' : '101 audit entries loaded',
    );
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await fireEvent.click(button);
    expect(host.getAuditEntriesBefore).toHaveBeenCalledTimes(2);
    await act(() => stats.resolve({}));
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'false'));
    expect(screen.getByRole('button', { name: label })).toBe(button);
    expect(button).toHaveFocus();
    const older = screen.getByRole('button', { name: 'Load older entries' });
    expect(older).toHaveAttribute('aria-disabled', 'true');
    await fireEvent.click(older);
    expect(host.getAuditEntriesBefore).toHaveBeenCalledTimes(2);
    if (label === 'Refresh') {
      expect(button).toHaveAttribute('aria-disabled', 'false');
      await fireEvent.click(button);
      expect(host.getAuditEntriesBefore).toHaveBeenCalledTimes(3);
    }
  },
);

it.each(['Refresh', 'Load older entries'])(
  'keeps %s focused after failure and respects focus moved before recovery',
  async (label) => {
    const { host, history, stats } = fixture();
    await screen.findByText('100 audit entries loaded');
    const button = screen.getByRole('button', { name: label });
    button.focus();
    await fireEvent.click(button);
    await act(() => {
      history.reject(new Error('Fixture unavailable'));
      stats.resolve({});
    });
    await screen.findByRole('alert');
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'false'));
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-disabled', 'false');
    const recovery = deferred<unknown>();
    host.getAuditEntriesBefore.mockReturnValueOnce(recovery.promise);
    const retry = screen.getByRole('button', { name: 'Retry history' });
    retry.focus();
    await fireEvent.click(retry);
    const search = screen.getByLabelText('Search audit entries');
    search.focus();
    await act(() => recovery.resolve([]));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry history' })).toBeNull());
    expect(search).toHaveFocus();
  },
);

it.each(['Refresh', 'Load older entries'])(
  'does not move focus after %s completes in an unmounted panel',
  async (label) => {
    const { history, stats, mounted } = fixture();
    await screen.findByText('100 audit entries loaded');
    const button = screen.getByRole('button', { name: label });
    button.focus();
    await fireEvent.click(button);
    mounted.unmount();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      await act(() => {
        history.resolve(rows(101, 1));
        stats.resolve({});
      });
      expect(outside).toHaveFocus();
      expect(focus).not.toHaveBeenCalled();
      expect(button.isConnected).toBe(false);
    } finally {
      focus.mockRestore();
      outside.remove();
    }
  },
);
