import { describe, expect, it } from 'vitest';
import {
  admitAuditPage,
  advanceAuditPage,
  emptyAuditPage,
  type AuditRequest,
} from '../../frontend/observatory/runtime/audit-read-state';

const first = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const second = '44444444-5555-4555-8555-666666666666';
const stamp = '2026-10-27T10:00:00.000Z';
const request = (reset: boolean): AuditRequest => ({
  reset,
  before: '2026-10-28T00:00:00.000Z',
  boundaryOffset: 0,
  requestedType: '',
});
const file = (lookup: unknown, extra: Record<string, unknown> = {}) => ({
  type: 'file-access',
  timestamp: stamp,
  path: 'X:/fixture/a.md',
  auditLookupId: lookup,
  ...extra,
});

describe('audit live-observation lookup admission', () => {
  it('accepts a validated IPC locator and hides its transport field', () => {
    const [row] = admitAuditPage([file(first)]);
    expect(row.eventId).toBe(first);
    expect(row).not.toHaveProperty('auditLookupId');
    expect(JSON.stringify(row)).not.toContain('auditLookupId');
  });

  it.each([
    undefined,
    null,
    4,
    '00000000-0000-0000-0000-000000000000',
    '11111111-2222-4222-8222-33333333333z',
    first.toUpperCase(),
  ])('rejects an invalid or missing lookup and strips a forged eventId', (invalid) => {
    const [row] = admitAuditPage([file(invalid, { eventId: first })]);
    expect(row).not.toHaveProperty('eventId');
    expect(row).not.toHaveProperty('auditLookupId');
  });

  it('maps both recognized audit file types but leaves unrelated events unchanged', () => {
    const [config, network] = admitAuditPage([
      file(first, { type: 'config-access' }),
      { type: 'network-connection', eventId: 'network-existing', details: {} },
    ]);
    expect(config.eventId).toBe(first);
    expect(network.eventId).toBe('network-existing');
  });

  it('refuses all duplicates across loaded pages, including a third occurrence', () => {
    let page = advanceAuditPage(
      emptyAuditPage(stamp),
      admitAuditPage([file(first)]),
      request(true),
    );
    expect(page.rows[0].eventId).toBe(first);
    page = advanceAuditPage(page, admitAuditPage([file(first)]), request(false));
    expect(page.rows.every((row) => !Object.hasOwn(row, 'eventId'))).toBe(true);
    page = advanceAuditPage(page, admitAuditPage([file(first)]), request(false));
    expect(page.rows.every((row) => !Object.hasOwn(row, 'eventId'))).toBe(true);
    expect(JSON.stringify(page.rows)).not.toContain(first);
  });

  it('keeps distinct observations independent and permits a new unique reset', () => {
    let page = advanceAuditPage(
      emptyAuditPage(stamp),
      admitAuditPage([file(first)]),
      request(true),
    );
    page = advanceAuditPage(page, admitAuditPage([file(second)]), request(false));
    expect(page.rows.map((row) => row.eventId)).toEqual([second, first]);
    page = advanceAuditPage(page, admitAuditPage([file(first)]), request(false));
    expect(page.rows[0]).not.toHaveProperty('eventId');
    expect(page.rows[1].eventId).toBe(second);
    expect(page.rows[2]).not.toHaveProperty('eventId');
    page = advanceAuditPage(page, admitAuditPage([file(first)]), request(true));
    expect(page.rows[0].eventId).toBe(first);
  });
});
