import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import Reports from '../../../frontend/observatory/components/Reports.svelte';
import { emptyTelemetry, type Telemetry } from '../../../frontend/observatory/runtime/host';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const telemetry = (): Telemetry => ({ ...emptyTelemetry(), ready: true });
const row = (id = 1, type = 'file-access') => ({
  timestamp: '2026-09-30T12:00:00.000Z',
  eventId: id,
  type,
  file: `X:/fixture/history-${id}.md`,
  agent: 'Codex',
  action: 'read',
});

it('keeps historical totals unknown during seeding while admitting live queue observations', async () => {
  const host = {
    getAuditEntriesBefore: async () => [],
    getAuditStats: vi
      .fn()
      .mockResolvedValueOnce({
        historyReadState: 'building',
        storageReadState: 'ready',
        persistedEntries: 999,
        totalEntries: 1000,
        bufferDepth: 7,
        droppedEntries: 3,
        totalSize: 2048,
        currentSize: 2048,
      })
      .mockResolvedValueOnce({
        historyReadState: 'ready',
        storageReadState: 'ready',
        persistedEntries: 2345,
        totalEntries: 2355,
        bufferDepth: 7,
        droppedEntries: 3,
        totalSize: 2048,
        currentSize: 2048,
      }),
  };
  render(Reports, {
    host,
    telemetry: telemetry(),
    audit: true,
    inspect: vi.fn(),
    navigate: vi.fn(),
  });
  await screen.findByText('0 audit entries loaded');
  expect(screen.getByRole('region', { name: 'Delivery' })).toBeVisible();
  const persisted = screen.getByText('persisted entries').parentElement!;
  expect(within(persisted).getByText('—')).toBeVisible();
  expect(screen.getByText('Historical audit counters are still loading.')).toBeVisible();
  expect(screen.getByText('7', { selector: 'strong' })).toBeVisible();
  expect(screen.getByText('3', { selector: 'strong' })).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'Refresh delivery counters' }));
  expect(await screen.findByText('2345', { selector: 'strong' })).toBeVisible();
  expect(screen.queryByText('Historical audit counters are still loading.')).toBeNull();
});

it('admits a valid history page while delivery counters are still pending', async () => {
  const stats = deferred<unknown>();
  const host = {
    getAuditStats: () => stats.promise,
    getAuditEntriesBefore: async () => [row()],
  };
  render(Reports, {
    host,
    telemetry: telemetry(),
    audit: true,
    inspect: vi.fn(),
    navigate: vi.fn(),
  });
  try {
    expect(await screen.findByText('1 audit entries loaded')).toBeVisible();
    expect(screen.getByText(row().file)).toBeVisible();
  } finally {
    stats.resolve({ persistedEntries: 1 });
  }
});

it('shows failed initial history as unknown with fixed feedback and a read-only retry', async () => {
  const host = {
    getAuditStats: async () => ({ persistedEntries: 1 }),
    getAuditEntriesBefore: vi.fn(async () => {
      throw new Error('PRIVATE_PATH_SENTINEL X:/fixture/private');
    }),
  };
  render(Reports, {
    host,
    telemetry: telemetry(),
    audit: true,
    inspect: vi.fn(),
    navigate: vi.fn(),
  });
  expect(await screen.findByRole('alert')).not.toHaveTextContent('PRIVATE_PATH_SENTINEL');
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByText('0 audit entries loaded')).toBeNull();
  expect(screen.getByRole('button', { name: 'Load older entries' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Retry history' })).toBeVisible();
});

it.each([
  { reply: null },
  { reply: [null] },
  { reply: { success: false } },
  { reply: 'denied' },
  { reply: Array(1) },
])(
  'rejects a malformed history population and distinguishes successful empty retry: $reply',
  async ({ reply }) => {
    const host = {
      getAuditStats: async () => ({}),
      getAuditEntriesBefore: vi
        .fn<() => Promise<unknown>>()
        .mockResolvedValueOnce(reply)
        .mockResolvedValueOnce([]),
    };
    render(Reports, {
      host,
      telemetry: telemetry(),
      audit: true,
      inspect: vi.fn(),
      navigate: vi.fn(),
    });
    await screen.findByRole('alert');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('0 audit entries loaded')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry history' }));
    expect(await screen.findByText('No entries in this history page.')).toBeVisible();
    expect(screen.getByText('0 audit entries loaded')).toBeVisible();
  },
);

it('admits counters while a history failure is pending and keeps sizes unknown when storage is unavailable', async () => {
  const pending = deferred<unknown>();
  const host = {
    getAuditStats: async () => ({
      storageReadState: 'unavailable',
      persistedEntries: 4,
      totalSize: 1024,
      currentSize: 1024,
    }),
    getAuditEntriesBefore: () => pending.promise,
  };
  render(Reports, {
    host,
    telemetry: telemetry(),
    audit: true,
    inspect: vi.fn(),
    navigate: vi.fn(),
  });
  expect(screen.getByRole('region', { name: 'Delivery' })).toBeVisible();
  const delivery = screen.getByRole('region', { name: 'Delivery' });
  expect(await within(delivery).findByText('4', { selector: 'strong' })).toBeVisible();
  expect(within(delivery).queryByText('1.0 KB')).toBeNull();
  expect(within(delivery).queryByText('Current size')).toBeNull();
  pending.reject(new Error('PRIVATE_PATH_SENTINEL'));
  expect(screen.getByRole('region', { name: 'Entries' })).toBeVisible();
  expect(await screen.findByRole('alert')).not.toHaveTextContent('PRIVATE_PATH_SENTINEL');
  expect(screen.queryByRole('table')).toBeNull();
});

it('retries the exact failed older boundary and returns every tied record once', async () => {
  const first = Array.from({ length: 100 }, (_, id) => ({
    ...row(id),
    file: 'X:/fixture/ties.md',
  }));
  const host = {
    getAuditStats: async () => ({}),
    getAuditEntriesBefore: vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error('PRIVATE_PATH_SENTINEL'))
      .mockResolvedValueOnce([{ ...row(100), file: 'X:/fixture/ties.md' }]),
  };
  const inspect = vi.fn();
  render(Reports, { host, telemetry: telemetry(), audit: true, inspect, navigate: vi.fn() });
  await screen.findByText('100 audit entries loaded');
  await fireEvent.click(screen.getByRole('button', { name: 'Load older entries' }));
  await screen.findByRole('alert');
  expect(screen.getByText('100 audit entries loaded')).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'Retry history' }));
  await screen.findByText('101 audit entries loaded');
  expect(host.getAuditEntriesBefore.mock.calls[1]).toEqual([
    first[0].timestamp,
    100,
    undefined,
    100,
  ]);
  expect(host.getAuditEntriesBefore.mock.calls[2]).toEqual(
    host.getAuditEntriesBefore.mock.calls[1],
  );
  await fireEvent.click(screen.getByRole('button', { name: /Open 101 observations/ }));
  const observations = inspect.mock.calls[0][1].observations as { eventId: number }[];
  expect(new Set(observations.map((entry) => entry.eventId)).size).toBe(101);
});

it('preserves the applied filter and local controls, then admits the captured failed Type retry', async () => {
  const first = Array.from({ length: 100 }, (_, id) => ({
    ...row(id),
    file: 'X:/fixture/ties.md',
  }));
  const host = {
    getAuditStats: async () => ({}),
    getAuditEntriesBefore: vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error('PRIVATE_PATH_SENTINEL'))
      .mockResolvedValueOnce([{ ...row(101, 'config-access'), file: 'X:/fixture/ties.md' }]),
  };
  render(Reports, {
    host,
    telemetry: telemetry(),
    audit: true,
    inspect: vi.fn(),
    navigate: vi.fn(),
  });
  await screen.findByText('100 audit entries loaded');
  await fireEvent.input(screen.getByLabelText('Search audit entries'), {
    target: { value: 'ties' },
  });
  await fireEvent.change(screen.getByLabelText('Audit grouping'), { target: { value: 'agent' } });
  await fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'config-access' } });
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Type')).toHaveValue('');
  expect(screen.getByText('100 audit entries loaded')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Load older entries' })).not.toBeDisabled();
  await fireEvent.click(screen.getByRole('button', { name: 'Retry history' }));
  await screen.findByText('1 audit entries loaded');
  expect(screen.getByLabelText('Type')).toHaveValue('config-access');
  expect(screen.getByLabelText('Search audit entries')).toHaveValue('ties');
  expect(screen.getByLabelText('Audit grouping')).toHaveValue('agent');
  expect(host.getAuditEntriesBefore.mock.calls[2]).toEqual(
    host.getAuditEntriesBefore.mock.calls[1],
  );
});

it('retains delivery counters after RPC failure but does not present old byte sizes as current', async () => {
  const pending = deferred<unknown>();
  const host = {
    getAuditStats: vi
      .fn()
      .mockResolvedValueOnce({
        storageReadState: 'ready',
        persistedEntries: 2,
        totalSize: 1024,
        currentSize: 1024,
      })
      .mockRejectedValueOnce(new Error('PRIVATE_PATH_SENTINEL'))
      .mockReturnValueOnce(pending.promise),
    getAuditEntriesBefore: vi.fn(async () => []),
  };
  render(Reports, {
    host,
    telemetry: telemetry(),
    audit: true,
    inspect: vi.fn(),
    navigate: vi.fn(),
  });
  await screen.findByText('No entries in this history page.');
  expect(screen.getByRole('region', { name: 'Delivery' })).toBeVisible();
  expect(await screen.findByText('1.0 KB')).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'Refresh delivery counters' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Showing last loaded values');
  expect(screen.getByText('2', { selector: 'strong' })).toBeVisible();
  expect(screen.queryByText('1.0 KB')).toBeNull();
  expect(screen.queryByText('Current size')).toBeNull();
  expect(screen.getByRole('alert')).not.toHaveTextContent('PRIVATE_PATH_SENTINEL');
  expect(host.getAuditEntriesBefore).toHaveBeenCalledOnce();
  await fireEvent.click(screen.getByRole('button', { name: 'Refresh delivery counters' }));
  try {
    expect(screen.getByText('2', { selector: 'strong' })).toBeVisible();
    expect(screen.queryByText('1.0 KB')).toBeNull();
    expect(screen.queryByText('Current size')).toBeNull();
    expect(screen.queryByText('ready', { exact: true })).toBeNull();
  } finally {
    pending.resolve({
      storageReadState: 'ready',
      persistedEntries: 3,
      totalSize: 0,
      currentSize: 0,
    });
  }
  expect(await screen.findByText('0.0 KB')).toBeVisible();
  expect(screen.getByText('3', { selector: 'strong' })).toBeVisible();
});

it.each([
  { storage: 'uninitialized', expected: ['—', '—', '—', '—'] },
  { storage: 'unavailable', expected: ['0', '0', '0', '—'] },
  { storage: 'ready', expected: ['0', '0', '0', '1.0 KB'] },
])(
  'distinguishes default counters from supplied measurements in $storage storage',
  async ({ storage, expected }) => {
    const host = {
      getAuditStats: async () => ({
        storageReadState: storage,
        persistedEntries: 0,
        bufferDepth: 0,
        droppedEntries: 0,
        totalSize: 1024,
        currentSize: 1024,
      }),
      getAuditEntriesBefore: async () => [],
    };
    render(Reports, {
      host,
      telemetry: telemetry(),
      audit: true,
      inspect: vi.fn(),
      navigate: vi.fn(),
    });
    await screen.findByText('No entries in this history page.');
    expect(screen.getByRole('region', { name: 'Delivery' })).toBeVisible();
    const delivery = screen.getByRole('region', { name: 'Delivery' });
    expect(
      [...delivery.querySelectorAll('.inline-stats strong')].map((node) =>
        node.textContent?.trim(),
      ),
    ).toEqual(expected);
    if (storage !== 'ready') expect(within(delivery).queryByText('Current size')).toBeNull();
  },
);

it('keeps the same history Retry control while pending, blocks duplicate attempts and preserves moved focus', async () => {
  const pending = deferred<unknown>();
  const host = {
    getAuditStats: async () => ({}),
    getAuditEntriesBefore: vi
      .fn()
      .mockRejectedValueOnce(new Error('PRIVATE_PATH_SENTINEL'))
      .mockReturnValueOnce(pending.promise),
  };
  render(Reports, {
    host,
    telemetry: telemetry(),
    audit: true,
    inspect: vi.fn(),
    navigate: vi.fn(),
  });
  const retry = await screen.findByRole('button', { name: 'Retry history' });
  expect(document.activeElement).toBe(document.body);
  retry.focus();
  await fireEvent.click(retry);
  expect(screen.getByRole('button', { name: 'Retry history' })).toBe(retry);
  expect(retry).toHaveAttribute('aria-disabled', 'true');
  expect(document.activeElement).toBe(retry);
  await fireEvent.click(retry);
  expect(host.getAuditEntriesBefore).toHaveBeenCalledTimes(2);
  const search = screen.getByLabelText('Search audit entries');
  search.focus();
  pending.resolve([row()]);
  await screen.findByText('1 audit entries loaded');
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry history' })).toBeNull());
  expect(document.activeElement).toBe(search);
});

it('retries delivery alone with a stable control and leaves the accepted history untouched', async () => {
  const pending = deferred<unknown>();
  const host = {
    getAuditStats: vi
      .fn()
      .mockRejectedValueOnce(new Error('PRIVATE_PATH_SENTINEL'))
      .mockReturnValueOnce(pending.promise),
    getAuditEntriesBefore: vi.fn(async () => [row()]),
  };
  render(Reports, {
    host,
    telemetry: telemetry(),
    audit: true,
    inspect: vi.fn(),
    navigate: vi.fn(),
  });
  await screen.findByText('1 audit entries loaded');
  expect(screen.getByRole('region', { name: 'Delivery' })).toBeVisible();
  await screen.findByRole('alert');
  const retry = screen.getByRole('button', { name: 'Refresh delivery counters' });
  retry.focus();
  await fireEvent.click(retry);
  expect(screen.getByRole('button', { name: 'Refresh delivery counters' })).toBe(retry);
  expect(document.activeElement).toBe(retry);
  await fireEvent.click(retry);
  expect(host.getAuditStats).toHaveBeenCalledTimes(2);
  pending.resolve({ persistedEntries: 3, storageReadState: 'ready', totalSize: 0, currentSize: 0 });
  expect(await screen.findByText('3', { selector: 'strong' })).toBeVisible();
  expect(document.activeElement).toBe(retry);
  expect(host.getAuditEntriesBefore).toHaveBeenCalledOnce();
  expect(screen.getByRole('region', { name: 'Entries' })).toBeVisible();
  expect(screen.getByText(row().file)).toBeVisible();
});

it.each([{ reject: true }, { reject: false }])(
  'handles deferred replies after unmount without displaying errors: $reject',
  async ({ reject }) => {
    const page = deferred<unknown>(),
      stats = deferred<unknown>();
    const mounted = render(Reports, {
      host: { getAuditStats: () => stats.promise, getAuditEntriesBefore: () => page.promise },
      telemetry: telemetry(),
      audit: true,
      inspect: vi.fn(),
      navigate: vi.fn(),
    });
    mounted.unmount();
    if (reject) {
      page.reject(new Error('PRIVATE_PATH_SENTINEL'));
      stats.reject(new Error('PRIVATE_PATH_SENTINEL'));
    } else {
      page.resolve([row()]);
      stats.resolve({ persistedEntries: 1 });
    }
    await Promise.allSettled([page.promise, stats.promise]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(row().file)).toBeNull();
  },
);
