import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import Reports from '../../../frontend/observatory/components/Reports.svelte';
import DetailSummary from '../../../frontend/observatory/components/DetailSummary.svelte';
import { emptyTelemetry, type RecordData } from '../../../frontend/observatory/runtime/host';
import {
  evidenceFields,
  informationFields,
} from '../../../frontend/observatory/runtime/detail-fields';
import {
  admitAuditPage,
  advanceAuditPage,
  emptyAuditPage,
} from '../../../frontend/observatory/runtime/audit-read-state';

const token = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const row = (name: string, selected = false) => ({
  timestamp: '2026-10-27T12:00:00.000Z',
  type: 'file-access',
  path: `X:/fixture/${name}.md`,
  agent: 'Claude Code',
  action: 'read',
  ...(selected ? { auditLookupId: token } : {}),
});

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
