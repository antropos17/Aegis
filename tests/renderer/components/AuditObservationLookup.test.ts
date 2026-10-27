import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import App from '../../../frontend/observatory/App.svelte';
import Reports from '../../../frontend/observatory/components/Reports.svelte';
import DetailSummary from '../../../frontend/observatory/components/DetailSummary.svelte';
import { emptyTelemetry, type RecordData } from '../../../frontend/observatory/runtime/host';
import {
  evidenceFields,
  informationFields,
} from '../../../frontend/observatory/runtime/detail-fields';
import {
  admitAuditPage as admitWireAuditPage,
  advanceAuditPage,
  emptyAuditPage,
} from '../../../frontend/observatory/runtime/audit-read-state';

const custody = { epoch: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', revision: 1 };
const admitAuditPage = (value: unknown) => admitWireAuditPage(value, custody);
const token = 'audit:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const row = (name: string, selected = false) => ({
  timestamp: '2026-10-27T12:00:00.000Z',
  type: 'file-access',
  path: `X:/fixture/${name}.md`,
  agent: 'Claude Code',
  action: 'read',
  ...(selected ? { auditLookupId: token, auditCustodyRevision: custody } : {}),
});
const revokedRow = (name: string) => ({ ...row(name), auditRevokedLookupId: token });

it('revokes duplicate audit locators across reactive pages, including a third occurrence', async () => {
  const host = {
    getAuditEntriesBefore: vi
      .fn()
      .mockResolvedValueOnce([
        row('first', true),
        ...Array.from({ length: 99 }, (_, i) => row(`a-${i}`)),
      ])
      .mockResolvedValueOnce([
        row('second', true),
        ...Array.from({ length: 99 }, (_, i) => row(`b-${i}`)),
      ])
      .mockResolvedValueOnce([row('third', true)]),
    onAuditCustodyRevision: () => () => {},
    getAuditCustodyRevision: async () => custody,
    getAuditStats: vi.fn(async () => ({})),
  };
  const inspect = vi.fn();
  const { container } = render(Reports, {
    host,
    telemetry: { ...emptyTelemetry(), ready: true },
    audit: true,
    inspect,
    navigate: vi.fn(),
  });
  await screen.findByText('100 audit entries loaded');
  await fireEvent.change(screen.getByRole('combobox', { name: 'Audit grouping' }), {
    target: { value: 'none' },
  });
  const search = screen.getByRole('searchbox', { name: 'Search audit entries' });
  await fireEvent.input(search, { target: { value: 'first.md' } });
  const openFirst = () => screen.getByText('X:/fixture/first.md').closest('button')!;
  await fireEvent.click(openFirst());
  expect((inspect.mock.calls.at(-1)?.[1] as RecordData).eventId).toBe(token);
  expect(
    JSON.stringify(informationFields(evidenceFields(inspect.mock.calls.at(-1)?.[1] as RecordData))),
  ).not.toContain(token);

  const older = screen.getByRole('button', { name: 'Load older entries' });
  await waitFor(() => expect(older).toHaveAttribute('aria-disabled', 'false'));
  await fireEvent.click(older);
  await screen.findByText('200 audit entries loaded');
  await fireEvent.click(openFirst());
  expect(inspect.mock.calls.at(-1)?.[1]).not.toHaveProperty('eventId');

  await waitFor(() => expect(older).toHaveAttribute('aria-disabled', 'false'));
  await fireEvent.click(older);
  await screen.findByText('201 audit entries loaded');
  await fireEvent.click(openFirst());
  expect(inspect.mock.calls.at(-1)?.[1]).not.toHaveProperty('eventId');
  await fireEvent.input(search, { target: { value: 'third.md' } });
  await fireEvent.click(screen.getByText('X:/fixture/third.md').closest('button')!);
  expect(inspect.mock.calls.at(-1)?.[1]).not.toHaveProperty('eventId');
  expect(container.textContent).not.toContain(token);
});

it('uses only the custody locator in Audit Details and does not render it as metadata', async () => {
  const page = advanceAuditPage(
    emptyAuditPage('2026-10-28T00:00:00.000Z'),
    admitAuditPage([row('selected', true)]),
    { reset: true, before: '2026-10-28T00:00:00.000Z', boundaryOffset: 0, requestedType: '' },
  );
  const explainToolContext = vi.fn(async () => ({
    success: true,
    toolContext: { strength: 'unattributed', reasons: [], candidates: [] },
  }));
  const { container } = render(DetailSummary, {
    row: page.rows[0],
    telemetry: { ...emptyTelemetry(), ready: true },
    host: { explainToolContext },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Explain from local history' }));
  await waitFor(() => expect(explainToolContext).toHaveBeenCalledExactlyOnceWith(token));
  expect(container.textContent).not.toContain(token);
});

it('keeps legacy Audit Details unavailable despite a forged eventId', () => {
  const [legacy] = admitAuditPage([{ ...row('legacy'), eventId: token }]);
  const explainToolContext = vi.fn();
  const { container } = render(DetailSummary, {
    row: legacy,
    telemetry: { ...emptyTelemetry(), ready: true },
    host: { explainToolContext },
  });
  expect(screen.queryByRole('button', { name: 'Explain from local history' })).toBeNull();
  expect(
    screen.getByText(
      'Live tool correlation is unavailable. This section displays recorded metadata.',
    ),
  ).toBeVisible();
  expect(explainToolContext).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain(token);
});

it('does not explain a forged network audit row even when it contains a file path', () => {
  const [network] = admitAuditPage([
    {
      ...row('network'),
      type: 'network-connection',
      eventId: token,
      auditLookupId: token,
      details: { remoteIp: '192.0.2.1', remotePort: 443 },
    },
  ]);
  const explainToolContext = vi.fn();
  const { container } = render(DetailSummary, {
    row: network,
    telemetry: { ...emptyTelemetry(), ready: true },
    host: { explainToolContext },
  });
  expect(screen.queryByRole('button', { name: 'Explain from local history' })).toBeNull();
  expect(
    screen.getByText(
      'Live tool correlation is unavailable. This section displays recorded metadata.',
    ),
  ).toBeVisible();
  expect(explainToolContext).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain(token);
});

it('revokes a previously opened audit Details selection when deferred pagination reveals a duplicate', async () => {
  let release!: (rows: RecordData[]) => void;
  const pending = new Promise<RecordData[]>((resolve) => {
    release = resolve;
  });
  const explainToolContext = vi.fn(async () => ({
    success: true,
    availability: 'unavailable',
    toolContext: { strength: 'unattributed', reasons: [], candidates: [] },
  }));
  const host = {
    getStats: async () => ({}),
    getResourceUsage: async () => ({}),
    getFalsePositives: async () => [],
    getSettings: async () => ({}),
    getAppVersion: async () => 'test',
    onAuditCustodyRevision: () => () => {},
    getAuditCustodyRevision: async () => custody,
    getAuditStats: async () => ({}),
    getAuditEntriesBefore: vi
      .fn()
      .mockResolvedValueOnce([
        row('first', true),
        ...Array.from({ length: 99 }, (_, i) => row(`page-one-${i}`)),
      ])
      .mockReturnValueOnce(pending),
    explainToolContext,
  };
  localStorage.setItem('aegis-advanced-mode', 'true');
  try {
    const { container } = render(App, { host });
    await fireEvent.click(screen.getByRole('button', { name: /^Audit$/ }));
    await screen.findByText('100 audit entries loaded');
    await fireEvent.change(screen.getByRole('combobox', { name: 'Audit grouping' }), {
      target: { value: 'none' },
    });
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search audit entries' }), {
      target: { value: 'first.md' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Load older entries' }));
    expect(host.getAuditEntriesBefore).toHaveBeenCalledTimes(2);
    await fireEvent.click(screen.getByText('X:/fixture/first.md').closest('button')!);
    const details = await screen.findByRole('dialog');
    expect(
      within(details).getByRole('button', { name: 'Explain from local history' }),
    ).toBeVisible();
    await act(() => release([revokedRow('second')]));
    await screen.findByText('101 audit entries loaded');
    const explain = within(details).queryByRole('button', { name: 'Explain from local history' });
    if (explain) await fireEvent.click(explain);
    expect(explainToolContext).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain(token);
  } finally {
    localStorage.removeItem('aegis-advanced-mode');
  }
}, 15_000);

it('discards an in-flight explanation when a duplicate appears in a later audit page', async () => {
  let releasePage!: (rows: RecordData[]) => void;
  const pendingPage = new Promise<RecordData[]>((resolve) => {
    releasePage = resolve;
  });
  let releaseExplanation!: (result: RecordData) => void;
  const explainToolContext = vi.fn(
    () =>
      new Promise<RecordData>((resolve) => {
        releaseExplanation = resolve;
      }),
  );
  const host = {
    getStats: async () => ({}),
    getResourceUsage: async () => ({}),
    getFalsePositives: async () => [],
    getSettings: async () => ({}),
    getAppVersion: async () => 'test',
    onAuditCustodyRevision: () => () => {},
    getAuditCustodyRevision: async () => custody,
    getAuditStats: async () => ({}),
    getAuditEntriesBefore: vi
      .fn()
      .mockResolvedValueOnce([
        row('first', true),
        ...Array.from({ length: 99 }, (_, i) => row(`page-one-${i}`)),
      ])
      .mockReturnValueOnce(pendingPage),
    explainToolContext,
  };
  localStorage.setItem('aegis-advanced-mode', 'true');
  try {
    const { container } = render(App, { host });
    await fireEvent.click(screen.getByRole('button', { name: /^Audit$/ }));
    await screen.findByText('100 audit entries loaded');
    await fireEvent.change(screen.getByRole('combobox', { name: 'Audit grouping' }), {
      target: { value: 'none' },
    });
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search audit entries' }), {
      target: { value: 'first.md' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Load older entries' }));
    await fireEvent.click(screen.getByText('X:/fixture/first.md').closest('button')!);
    const details = await screen.findByRole('dialog');
    await fireEvent.click(
      within(details).getByRole('button', { name: 'Explain from local history' }),
    );
    expect(explainToolContext).toHaveBeenCalledExactlyOnceWith(token);
    await act(() => releasePage([revokedRow('second')]));
    await screen.findByText('101 audit entries loaded');
    await act(() =>
      releaseExplanation({
        success: true,
        availability: 'available',
        toolContext: {
          schemaVersion: 1,
          relation: 'preceded-by',
          strength: 'confirmed',
          reasons: ['exact-binding-object-and-interval'],
          candidateCount: 1,
          candidatesTruncated: false,
          ambiguous: false,
          objectMatch: 'matched',
          sessionBinding: 'confirmed',
          candidates: [
            {
              source: 'claude-code',
              sessionRef: 'a'.repeat(64),
              callRef: 'b'.repeat(64),
              toolName: 'Read',
              argsDigest: 'c'.repeat(64),
              objectDigest: 'd'.repeat(64),
              argsShape: { operation: 'read', objectKind: 'path' },
              startMs: 1000,
              endMs: 2000,
              deltaMs: 250,
              strength: 'confirmed',
              reasons: [],
            },
          ],
        },
      }),
    );
    expect(within(details).queryByText('Claude Code · Read')).toBeNull();
    expect(
      within(details).queryByRole('button', { name: 'Explain from local history' }),
    ).toBeNull();
    expect(container.textContent).not.toContain(token);
  } finally {
    localStorage.removeItem('aegis-advanced-mode');
  }
}, 15_000);

it('revokes a captured Simple-mode audit selection when a later page reveals a duplicate', async () => {
  let releasePage!: (rows: RecordData[]) => void;
  const pendingPage = new Promise<RecordData[]>((resolve) => {
    releasePage = resolve;
  });
  const explainToolContext = vi.fn(async () => ({
    success: true,
    availability: 'unavailable',
    toolContext: { strength: 'unattributed', reasons: [], candidates: [] },
  }));
  const host = {
    getStats: async () => ({}),
    getResourceUsage: async () => ({}),
    getFalsePositives: async () => [],
    getSettings: async () => ({}),
    getAppVersion: async () => 'test',
    onAuditCustodyRevision: () => () => {},
    getAuditCustodyRevision: async () => custody,
    getAuditStats: async () => ({}),
    getAuditEntriesBefore: vi
      .fn()
      .mockResolvedValueOnce([
        row('first', true),
        ...Array.from({ length: 99 }, (_, i) => row(`page-one-${i}`)),
      ])
      .mockReturnValueOnce(pendingPage),
    explainToolContext,
  };
  localStorage.setItem('aegis-advanced-mode', 'false');
  try {
    const { container } = render(App, { host });
    await fireEvent.click(screen.getByRole('button', { name: /Commands/ }));
    const search = screen.getByRole('combobox', { name: 'Find a workspace or action' });
    await fireEvent.input(search, { target: { value: 'audit' } });
    await fireEvent.click(screen.getByRole('option', { name: 'Audit · Advanced · Investigate' }));
    await screen.findByText('100 audit entries loaded');
    await fireEvent.change(screen.getByRole('combobox', { name: 'Audit grouping' }), {
      target: { value: 'none' },
    });
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search audit entries' }), {
      target: { value: 'first.md' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Load older entries' }));
    await fireEvent.click(screen.getByText('X:/fixture/first.md').closest('button')!);
    const evidence = await screen.findByRole('region', { name: 'Selected evidence' });
    await act(() => releasePage([revokedRow('second')]));
    await screen.findByText('101 audit entries loaded');
    await fireEvent.click(within(evidence).getByRole('button', { name: 'Full details' }));
    const details = await screen.findByRole('dialog');
    const explain = within(details).queryByRole('button', { name: 'Explain from local history' });
    if (explain) await fireEvent.click(explain);
    expect(explainToolContext).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain(token);
  } finally {
    localStorage.removeItem('aegis-advanced-mode');
  }
}, 15_000);

it.each([
  { mode: 'advanced', action: 'Load older entries', loaded: '101 audit entries loaded' },
  { mode: 'simple', action: 'Load older entries', loaded: '101 audit entries loaded' },
  { mode: 'advanced', action: 'Refresh', loaded: '1 audit entries loaded' },
  { mode: 'simple', action: 'Refresh', loaded: '1 audit entries loaded' },
] as const)(
  'removes a completed $mode explanation when $action revokes its locator',
  async ({ mode, action, loaded }) => {
    let releasePage!: (rows: RecordData[]) => void;
    const pendingPage = new Promise<RecordData[]>((resolve) => {
      releasePage = resolve;
    });
    const explainToolContext = vi.fn(async () => ({
      success: true,
      availability: 'available',
      toolContext: {
        schemaVersion: 1,
        relation: 'preceded-by',
        strength: 'confirmed',
        reasons: ['exact-binding-object-and-interval'],
        candidateCount: 1,
        candidatesTruncated: false,
        ambiguous: false,
        objectMatch: 'matched',
        sessionBinding: 'confirmed',
        candidates: [{
          source: 'claude-code',
          sessionRef: 'a'.repeat(64),
          callRef: 'b'.repeat(64),
          toolName: 'Read',
          argsDigest: 'c'.repeat(64),
          objectDigest: 'd'.repeat(64),
          argsShape: { operation: 'read', objectKind: 'path' },
          startMs: 1000,
          endMs: 2000,
          deltaMs: 250,
          strength: 'confirmed',
          reasons: [],
        }],
      },
    }));
    const host = {
      getStats: async () => ({}),
      getResourceUsage: async () => ({}),
      getFalsePositives: async () => [],
      getSettings: async () => ({}),
      getAppVersion: async () => 'test',
      onAuditCustodyRevision: () => () => {},
    getAuditCustodyRevision: async () => custody,
    getAuditStats: async () => ({}),
      getAuditEntriesBefore: vi
        .fn()
        .mockResolvedValueOnce([
          row('first', true),
          ...Array.from({ length: 99 }, (_, i) => row(`page-one-${i}`)),
        ])
        .mockReturnValueOnce(pendingPage),
      explainToolContext,
    };
    localStorage.setItem('aegis-advanced-mode', mode === 'advanced' ? 'true' : 'false');
    try {
      const { container } = render(App, { host });
      if (mode === 'advanced') {
        await fireEvent.click(screen.getByRole('button', { name: /^Audit$/ }));
      } else {
        await fireEvent.click(screen.getByRole('button', { name: /Commands/ }));
        const search = screen.getByRole('combobox', { name: 'Find a workspace or action' });
        await fireEvent.input(search, { target: { value: 'audit' } });
        await fireEvent.click(screen.getByRole('option', { name: 'Audit · Advanced · Investigate' }));
      }
      await screen.findByText('100 audit entries loaded');
      await fireEvent.change(screen.getByRole('combobox', { name: 'Audit grouping' }), {
        target: { value: 'none' },
      });
      await fireEvent.input(screen.getByRole('searchbox', { name: 'Search audit entries' }), {
        target: { value: 'first.md' },
      });
      await fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${action}$`) }));
      await fireEvent.click(screen.getByText('X:/fixture/first.md').closest('button')!);
      if (mode === 'simple') {
        const evidence = await screen.findByRole('region', { name: 'Selected evidence' });
        await fireEvent.click(within(evidence).getByRole('button', { name: 'Full details' }));
      }
      const details = await screen.findByRole('dialog');
      await fireEvent.click(within(details).getByRole('button', { name: 'Explain from local history' }));
      expect(await within(details).findByText('Claude Code · Read')).toBeVisible();
      expect(explainToolContext).toHaveBeenCalledExactlyOnceWith(token);
      await act(() => releasePage([revokedRow('second')]));
      await screen.findByText(loaded);
      await waitFor(() => expect(within(details).queryByText('Claude Code · Read')).toBeNull());
      expect(within(details).queryByRole('button', { name: 'Explain from local history' })).toBeNull();
      expect(container.textContent).not.toContain(token);
    } finally {
      localStorage.removeItem('aegis-advanced-mode');
    }
  },
  15_000,
);


it('subscribes before catchup, ignores stale catchup and rejects stale pages and pushes', async () => {
  let push!: (value: unknown) => void;
  let catchup!: (value: unknown) => void;
  let reply!: (value: RecordData[]) => void;
  const pendingCatchup = new Promise((resolve) => { catchup = resolve; });
  const pendingPage = new Promise<RecordData[]>((resolve) => { reply = resolve; });
  const unsub = vi.fn();
  const inspect = vi.fn();
  const newer = { ...custody, revision: 2 };
  const host = {
    onAuditCustodyRevision: (cb: (value: unknown) => void) => { push = cb; return unsub; },
    getAuditCustodyRevision: () => pendingCatchup,
    getAuditEntriesBefore: vi.fn(() => pendingPage),
    getAuditStats: async () => ({}),
  };
  const view = render(Reports, { host, telemetry: { ...emptyTelemetry(), ready: true }, audit: true, inspect, navigate: vi.fn() });
  expect(push).toBeTypeOf('function');
  await act(() => push(newer));
  await act(() => catchup(custody));
  await act(() => push(custody));
  await act(() => reply([
    { ...row('fresh', true), auditCustodyRevision: newer },
    row('stale', true),
  ]));
  await screen.findByText('2 audit entries loaded');
  await fireEvent.change(screen.getByRole('combobox', { name: 'Audit grouping' }), { target: { value: 'none' } });
  await fireEvent.click(screen.getByText('X:/fixture/fresh.md').closest('button')!);
  expect(inspect.mock.calls.at(-1)?.[1].eventId).toBe(token);
  await fireEvent.click(screen.getByText('X:/fixture/stale.md').closest('button')!);
  expect(inspect.mock.calls.at(-1)?.[1]).not.toHaveProperty('eventId');
  expect(view.container.textContent).not.toContain(custody.epoch);
  view.unmount();
  expect(unsub).toHaveBeenCalledOnce();
  push(newer);
});

it.each(['missing subscription', 'malformed subscription', 'malformed catchup', 'epoch mismatch'])(
  'fails closed for %s', async (condition) => {
    let push: ((value: unknown) => void) | undefined;
    const host = {
      onAuditCustodyRevision: condition === 'missing subscription' ? undefined : (cb: (value: unknown) => void) => {
        push = cb;
        if (condition === 'epoch mismatch') cb({ ...custody, revision: 2 });
        return condition === 'malformed subscription' ? null : () => {};
      },
      getAuditCustodyRevision: async () => condition === 'malformed catchup' ? { epoch: 'bad', revision: 1 } :
        condition === 'epoch mismatch' ? { epoch: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', revision: 3 } : custody,
      getAuditEntriesBefore: async () => [row('closed', true)],
      getAuditStats: async () => ({}),
    };
    const inspect = vi.fn();
    const view = render(Reports, { host: host as never, telemetry: { ...emptyTelemetry(), ready: true }, audit: true, inspect, navigate: vi.fn() });
    await screen.findByText('1 audit entries loaded');
    await fireEvent.change(screen.getByRole('combobox', { name: 'Audit grouping' }), { target: { value: 'none' } });
    await fireEvent.click(screen.getByText('X:/fixture/closed.md').closest('button')!);
    expect(inspect.mock.calls.at(-1)?.[1]).not.toHaveProperty('eventId');
    expect(view.container.textContent).not.toContain(custody.epoch);
    view.unmount();
    push?.(custody);
  },
);

it.each([
  { mode: 'advanced', delivery: 'push' }, { mode: 'simple', delivery: 'push' },
  { mode: 'advanced', delivery: 'poll' }, { mode: 'simple', delivery: 'poll' },
] as const)(
  'revokes a completed $mode Details explanation on custody $delivery', async ({ mode, delivery }) => {
    let currentRevision = custody;
    let push!: (value: unknown) => void;
    const result = {
      success: true, availability: 'available', toolContext: {
        schemaVersion: 1, relation: 'preceded-by', strength: 'confirmed',
        reasons: ['exact-binding-object-and-interval'], candidateCount: 1, candidatesTruncated: false,
        ambiguous: false, objectMatch: 'matched', sessionBinding: 'confirmed', candidates: [{
          source: 'claude-code', sessionRef: 'a'.repeat(64), callRef: 'b'.repeat(64), toolName: 'Read',
          argsDigest: 'c'.repeat(64), objectDigest: 'd'.repeat(64),
          argsShape: { operation: 'read', objectKind: 'path' }, startMs: 1000, endMs: 2000,
          deltaMs: 250, strength: 'confirmed', reasons: [],
        }],
      },
    };
    const host = {
      getStats: async () => ({}), getResourceUsage: async () => ({}), getFalsePositives: async () => [],
      getSettings: async () => ({}), getAppVersion: async () => 'test',
      onAuditCustodyRevision: (cb: (value: unknown) => void) => { push = cb; return () => {}; },
      getAuditCustodyRevision: vi.fn(async () => currentRevision), getAuditStats: async () => ({}),
      getAuditEntriesBefore: async () => [row('selected', true)],
      explainToolContext: vi.fn(async () => result),
    };
    localStorage.setItem('aegis-advanced-mode', mode === 'advanced' ? 'true' : 'false');
    try {
      const view = render(App, { host });
      if (mode === 'advanced') await fireEvent.click(screen.getByRole('button', { name: /^Audit$/ }));
      else {
        await fireEvent.click(screen.getByRole('button', { name: /Commands/ }));
        await fireEvent.input(screen.getByRole('combobox', { name: 'Find a workspace or action' }), { target: { value: 'audit' } });
        await fireEvent.click(screen.getByRole('option', { name: 'Audit \u00b7 Advanced \u00b7 Investigate' }));
      }
      await screen.findByText('1 audit entries loaded');
      await fireEvent.change(screen.getByRole('combobox', { name: 'Audit grouping' }), { target: { value: 'none' } });
      await fireEvent.click(screen.getByText('X:/fixture/selected.md').closest('button')!);
      if (mode === 'simple') {
        const evidence = await screen.findByRole('region', { name: 'Selected evidence' });
        await fireEvent.click(within(evidence).getByRole('button', { name: 'Full details' }));
      }
      const details = await screen.findByRole('dialog');
      await fireEvent.click(within(details).getByRole('button', { name: 'Explain from local history' }));
      expect(await within(details).findByText('Claude Code \u00b7 Read')).toBeVisible();
      currentRevision = { ...custody, revision: 2 };
      if (delivery === 'push') await act(() => push(currentRevision));
      else await waitFor(() => expect(host.getAuditCustodyRevision.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 2500 });
      await waitFor(() => expect(within(details).queryByText('Claude Code \u00b7 Read')).toBeNull(), { timeout: 2500 });
      expect(within(details).queryByRole('button', { name: 'Explain from local history' })).toBeNull();
      expect(view.container.textContent).not.toContain(token);
      expect(view.container.textContent).not.toContain(custody.epoch);
    } finally { localStorage.removeItem('aegis-advanced-mode'); }
  }, 15_000,
);


it('catches a missed push by polling, times out a hung single flight, and stops on cleanup', async () => {
  const newer = { ...custody, revision: 2 };
  const getter = vi.fn().mockResolvedValueOnce(custody).mockResolvedValueOnce(newer)
    .mockImplementation(() => new Promise(() => {}));
  const host = {
    onAuditCustodyRevision: () => () => {},
    getAuditCustodyRevision: getter,
    getAuditEntriesBefore: vi.fn().mockResolvedValueOnce([row('one', true)])
      .mockResolvedValueOnce([{ ...row('two', true), auditCustodyRevision: newer }]),
    getAuditStats: async () => ({}),
  };
  const inspect = vi.fn();
  const view = render(Reports, { host, telemetry: { ...emptyTelemetry(), ready: true }, audit: true, inspect, navigate: vi.fn() });
  await screen.findByText('1 audit entries loaded');
  await fireEvent.change(screen.getByRole('combobox', { name: 'Audit grouping' }), { target: { value: 'none' } });
  await fireEvent.click(screen.getByText('X:/fixture/one.md').closest('button')!);
  const selected = inspect.mock.calls.at(-1)?.[1] as RecordData;
  expect(selected.eventId).toBe(token);
  await waitFor(() => expect(selected).not.toHaveProperty('eventId'), { timeout: 2500 });
  await fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText('X:/fixture/two.md');
  await fireEvent.click(screen.getByText('X:/fixture/two.md').closest('button')!);
  const nextSelected = inspect.mock.calls.at(-1)?.[1] as RecordData;
  expect(nextSelected.eventId).toBe(token);
  await waitFor(() => expect(nextSelected).not.toHaveProperty('eventId'), { timeout: 4500 });
  expect(getter).toHaveBeenCalledTimes(3);
  view.unmount();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  expect(getter).toHaveBeenCalledTimes(3);
}, 10_000);

it('discards a pending Details response after an independent custody push', async () => {
  let push!: (value: unknown) => void;
  let release!: (value: RecordData) => void;
  const host = {
    getStats: async () => ({}), getResourceUsage: async () => ({}), getFalsePositives: async () => [],
    getSettings: async () => ({}), getAppVersion: async () => 'test',
    onAuditCustodyRevision: (cb: (value: unknown) => void) => { push = cb; return () => {}; },
    getAuditCustodyRevision: async () => custody, getAuditStats: async () => ({}),
    getAuditEntriesBefore: async () => [row('pending', true)],
    explainToolContext: vi.fn(() => new Promise<RecordData>((resolve) => { release = resolve; })),
  };
  localStorage.setItem('aegis-advanced-mode', 'true');
  try {
    render(App, { host });
    await fireEvent.click(screen.getByRole('button', { name: /^Audit$/ }));
    await screen.findByText('1 audit entries loaded');
    await fireEvent.change(screen.getByRole('combobox', { name: 'Audit grouping' }), { target: { value: 'none' } });
    await fireEvent.click(screen.getByText('X:/fixture/pending.md').closest('button')!);
    const details = await screen.findByRole('dialog');
    await fireEvent.click(within(details).getByRole('button', { name: 'Explain from local history' }));
    await act(() => push({ ...custody, revision: 2 }));
    await act(() => release({ success: true, availability: 'available', toolContext: { strength: 'confirmed', candidates: [{ toolName: 'Read' }] } }));
    expect(within(details).queryByRole('button', { name: 'Explain from local history' })).toBeNull();
    expect(within(details).queryByText('Claude Code \u00b7 Read')).toBeNull();
  } finally { localStorage.removeItem('aegis-advanced-mode'); }
}, 15_000);


it('recovers on poll and refresh when first page is newer than the catchup', async () => {
  const newer = { ...custody, revision: 2 };
  const getter = vi.fn().mockResolvedValueOnce(custody).mockResolvedValue(newer);
  const host = {
    onAuditCustodyRevision: () => () => {}, getAuditCustodyRevision: getter,
    getAuditEntriesBefore: vi.fn(async () => [{ ...row('newer', true), auditCustodyRevision: newer }]),
    getAuditStats: async () => ({}),
  };
  const inspect = vi.fn();
  render(Reports, { host, telemetry: { ...emptyTelemetry(), ready: true }, audit: true, inspect, navigate: vi.fn() });
  await screen.findByText('1 audit entries loaded');
  await fireEvent.change(screen.getByRole('combobox', { name: 'Audit grouping' }), { target: { value: 'none' } });
  await fireEvent.click(screen.getByText('X:/fixture/newer.md').closest('button')!);
  expect(inspect.mock.calls.at(-1)?.[1]).not.toHaveProperty('eventId');
  await waitFor(() => expect(getter).toHaveBeenCalledTimes(2), { timeout: 2500 });
  await fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(host.getAuditEntriesBefore).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAttribute('aria-busy', 'false'));
  await fireEvent.click(screen.getByText('X:/fixture/newer.md').closest('button')!);
  expect(inspect.mock.calls.at(-1)?.[1].eventId).toBe(token);
}, 5000);


it('admits an early App history page after the initial custody catchup completes', async () => {
  let release!: (value: unknown) => void;
  const catchup = new Promise((resolve) => { release = resolve; });
  const host = {
    getStats: async () => ({}), getResourceUsage: async () => ({}), getFalsePositives: async () => [],
    getSettings: async () => ({}), getAppVersion: async () => 'test',
    onAuditCustodyRevision: () => () => {}, getAuditCustodyRevision: () => catchup,
    getAuditStats: async () => ({}),
    getAuditEntriesBefore: vi.fn(async () => [row('early', true)]),
    explainToolContext: vi.fn(async () => ({ success: true, availability: 'unavailable' })),
  };
  localStorage.setItem('aegis-advanced-mode', 'true');
  try {
    render(App, { host });
    await fireEvent.click(screen.getByRole('button', { name: /^Audit$/ }));
    await waitFor(() => expect(host.getAuditEntriesBefore).toHaveBeenCalledOnce());
    expect(screen.queryByText('1 audit entries loaded')).toBeNull();
    await act(() => release(custody));
    await screen.findByText('1 audit entries loaded');
    await fireEvent.change(screen.getByRole('combobox', { name: 'Audit grouping' }), { target: { value: 'none' } });
    await fireEvent.click(screen.getByText('X:/fixture/early.md').closest('button')!);
    const details = await screen.findByRole('dialog');
    await fireEvent.click(within(details).getByRole('button', { name: 'Explain from local history' }));
    expect(host.explainToolContext).toHaveBeenCalledExactlyOnceWith(token);
  } finally { localStorage.removeItem('aegis-advanced-mode'); }
}, 5000);

it('shows readable history without a locator if the initial custody catchup times out', async () => {
  const host = {
    onAuditCustodyRevision: () => () => {},
    getAuditCustodyRevision: () => new Promise(() => {}),
    getAuditStats: async () => ({}),
    getAuditEntriesBefore: async () => [row('timeout', true)],
  };
  const inspect = vi.fn();
  render(Reports, { host, telemetry: { ...emptyTelemetry(), ready: true }, audit: true, inspect, navigate: vi.fn() });
  await screen.findByText('1 audit entries loaded', {}, { timeout: 3500 });
  await fireEvent.change(screen.getByRole('combobox', { name: 'Audit grouping' }), { target: { value: 'none' } });
  await fireEvent.click(screen.getByText('X:/fixture/timeout.md').closest('button')!);
  expect(inspect.mock.calls.at(-1)?.[1]).not.toHaveProperty('eventId');
}, 5000);
