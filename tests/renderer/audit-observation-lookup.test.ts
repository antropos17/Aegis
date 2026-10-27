import { describe, expect, it } from 'vitest';
import {
  admitAuditPage as admitWireAuditPage,
  advanceAuditPage,
  emptyAuditPage,
  type AuditRequest,
} from '../../frontend/observatory/runtime/audit-read-state';

const custody = { epoch: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', revision: 1 };
const admitAuditPage = (value: unknown) => admitWireAuditPage(value, custody);
const first = 'audit:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const second = 'audit:44444444-5555-4555-8555-666666666666';
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
  auditCustodyRevision: custody,
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
    'audit:00000000-0000-0000-0000-000000000000',
    'audit:11111111-2222-4222-8222-33333333333z',
    first.slice('audit:'.length),
    first.toUpperCase(),
  ])('rejects an invalid or missing lookup and strips a forged eventId', (invalid) => {
    const [row] = admitAuditPage([file(invalid, { eventId: first })]);
    expect(row).not.toHaveProperty('eventId');
    expect(row).not.toHaveProperty('auditLookupId');
  });

  it('maps only recognized file types and strips forged lookup fields from a network row', () => {
    const [config, network] = admitAuditPage([
      file(first, { type: 'config-access' }),
      {
        type: 'network-connection',
        eventId: first,
        auditLookupId: first,
        path: 'X:/fixture/unrelated.md',
        details: { remoteIp: '192.0.2.1', remotePort: 443 },
      },
    ]);
    expect(config.eventId).toBe(first);
    expect(network).not.toHaveProperty('eventId');
    expect(network).not.toHaveProperty('auditLookupId');
    expect(network).toMatchObject({ remoteIp: '192.0.2.1', remotePort: 443 });
  });

  it.each(['agent-enter', 'pipeline-loss', 'unknown-type'])(
    'strips forged lookup fields from other audit type %s',
    (type) => {
      const [row] = admitAuditPage([{ type, eventId: first, auditLookupId: first }]);
      expect(row).not.toHaveProperty('eventId');
      expect(row).not.toHaveProperty('auditLookupId');
    },
  );

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

  it('revokes an earlier main-issued locator from an explicit later-page revocation', () => {
    let page = advanceAuditPage(
      emptyAuditPage(stamp),
      admitAuditPage([file(first)]),
      request(true),
    );
    expect(page.rows[0].eventId).toBe(first);
    const previouslySelected = page.rows[0];
    const revoked = admitAuditPage([file(undefined, { auditRevokedLookupId: first })]);
    expect(revoked[0]).not.toHaveProperty('eventId');
    expect(revoked[0]).not.toHaveProperty('auditRevokedLookupId');
    page = advanceAuditPage(page, revoked, request(false));
    expect(previouslySelected).not.toHaveProperty('eventId');
    expect(page.rows.every((row) => !Object.hasOwn(row, 'eventId'))).toBe(true);
    expect(JSON.stringify(page.rows)).not.toContain(first);
  });

  it('revokes an already selected locator when a refreshed page contains its revocation', () => {
    let page = advanceAuditPage(
      emptyAuditPage(stamp),
      admitAuditPage([file(first)]),
      request(true),
    );
    const previouslySelected = page.rows[0];
    page = advanceAuditPage(
      page,
      admitAuditPage([file(undefined, { auditRevokedLookupId: first })]),
      request(true),
    );
    expect(previouslySelected).not.toHaveProperty('eventId');
    expect(page.rows[0]).not.toHaveProperty('auditRevokedLookupId');
    expect(JSON.stringify(page.rows)).not.toContain(first);
  });

  it('keeps a selected locator when refresh returns the same still-unique observation', () => {
    let page = advanceAuditPage(
      emptyAuditPage(stamp),
      admitAuditPage([file(first)]),
      request(true),
    );
    const previouslySelected = page.rows[0];
    page = advanceAuditPage(page, admitAuditPage([file(first)]), request(true));
    expect(previouslySelected.eventId).toBe(first);
    expect(page.rows[0].eventId).toBe(first);
  });

  it.each([
    { type: 'network-connection', revoked: first },
    { type: 'file-access', revoked: first.slice('audit:'.length) },
    { type: 'file-access', revoked: 'audit:not-a-uuid' },
  ])('ignores unsupported revocation markers for $type', ({ type, revoked }) => {
    let page = advanceAuditPage(
      emptyAuditPage(stamp),
      admitAuditPage([file(first)]),
      request(true),
    );
    page = advanceAuditPage(
      page,
      admitAuditPage([{ type, timestamp: stamp, auditRevokedLookupId: revoked }]),
      request(false),
    );
    expect(page.rows[1].eventId).toBe(first);
    expect(page.rows[0]).not.toHaveProperty('auditRevokedLookupId');
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


describe('custody revision admission', () => {
  it('rejects stale, malformed, missing and different-epoch page revisions', () => {
    for (const revision of [null, {}, { ...custody, revision: 0 },
      { ...custody, revision: 2 }, { epoch: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', revision: 1 }]) {
      const [result] = admitWireAuditPage([file(first, { auditCustodyRevision: revision })], custody);
      expect(result).not.toHaveProperty('eventId');
      expect(result).not.toHaveProperty('auditCustodyRevision');
    }
    expect(admitWireAuditPage([file(first)], null)[0]).not.toHaveProperty('eventId');
    expect(admitWireAuditPage([file(first)], custody)[0].eventId).toBe(first);
  });
});
