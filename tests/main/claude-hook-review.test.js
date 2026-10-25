import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  configPath,
  createOwnedHookReview,
  fixture,
  installed,
  original,
  selection,
} from './claude-hook-review-fixture';

const triple = (result) => expect(Object.keys(result).sort()).toEqual(['code', 'ok', 'presence']);

describe('private hook owner review admission', () => {
  it('installs exact independent bytes then restores original bytes through the same writer', async () => {
    const f = fixture();
    const prepared = await f.review.prepareInstall(f.owner, selection);
    expect(prepared.code).toBe('REVIEW_REQUIRED');
    expect(prepared.planId).toMatch(/^[0-9a-f-]{36}$/);
    expect(prepared.expiresAtMs).toBe(120);
    expect(Object.keys(prepared).sort()).toEqual([
      'code',
      'expiresAtMs',
      'ok',
      'planId',
      'presence',
      'review',
    ]);
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.review)).toBe(true);
    expect(Object.isFrozen(prepared.review.edits[0])).toBe(true);
    expect(f.state.writes).toBe(0);
    const result = await f.review.confirm(f.owner, prepared.planId, true);
    expect(result).toEqual({ ok: true, code: 'INSTALLED', presence: 'Configured' });
    expect(f.state.bytes.toString()).toBe(installed);
    const removal = await f.review.prepareRemoval(f.owner);
    expect(removal.review.mode).toBe('exact-rollback');
    expect(await f.review.confirm(f.owner, removal.planId, true)).toEqual({
      ok: true,
      code: 'REMOVED',
      presence: 'Unknown',
    });
    expect(f.state.bytes.toString()).toBe(original);
    expect(f.state.backups[0].bytes.toString()).toBe(original);
    expect(f.state.backups[1].bytes.toString()).toBe(installed);
  });

  it('rejects copied, numeric and serialized owners without destroying the real review', async () => {
    const f = fixture();
    const prepared = await f.review.prepareInstall(f.owner, selection);
    for (const caller of [{ ...f.owner }, 1, JSON.stringify(f.owner), null]) {
      for (const result of [
        await f.review.prepareInstall(caller, selection),
        await f.review.prepareRemoval(caller),
        await f.review.confirm(caller, prepared.planId, true),
        f.review.cancel(caller),
        f.review.release(caller),
      ])
        expect(result).toEqual({ ok: false, code: 'INVALID_OWNER', presence: 'Unknown' });
    }
    expect((await f.review.confirm(f.owner, prepared.planId, true)).code).toBe('INSTALLED');
  });

  it('isolates foreign IDs and replacement/replay while requiring literal true', async () => {
    const f = fixture();
    const other = fixture();
    const first = await f.review.prepareInstall(f.owner, selection);
    const foreign = await other.review.prepareInstall(other.owner, selection);
    const latest = await f.review.prepareInstall(f.owner, selection);
    expect(first.planId).not.toBe(latest.planId);
    for (const id of [first.planId, foreign.planId, { ...latest }, JSON.stringify(latest)])
      expect((await f.review.confirm(f.owner, id, true)).code).toBe('INVALID_APPROVAL');
    for (const confirmed of [false, 1, 'true', new Boolean(true)])
      expect((await f.review.confirm(f.owner, latest.planId, confirmed)).code).toBe(
        'INVALID_APPROVAL',
      );
    expect(f.state.writes).toBe(0);
    expect((await f.review.confirm(f.owner, latest.planId, true)).code).toBe('INSTALLED');
    expect((await f.review.confirm(f.owner, latest.planId, true)).code).toBe('INVALID_APPROVAL');
    expect(f.state.writes).toBe(1);
  });

  it.each([119, 120, 121])('checks exact admission boundary at %s milliseconds', async (time) => {
    const f = fixture();
    const prepared = await f.review.prepareInstall(f.owner, selection);
    f.state.time = time;
    expect((await f.review.confirm(f.owner, prepared.planId, true)).code).toBe(
      time < 120 ? 'INSTALLED' : 'EXPIRED',
    );
    expect(f.state.writes).toBe(time < 120 ? 1 : 0);
  });

  it.each([99, NaN, Infinity, -1])(
    'fails closed permanently for invalid/backward clock %s',
    async (time) => {
      const f = fixture();
      const prepared = await f.review.prepareInstall(f.owner, selection);
      f.state.time = time;
      expect((await f.review.confirm(f.owner, prepared.planId, true)).code).toBe('CLOCK_INVALID');
      f.state.time = 110;
      expect((await f.review.prepareInstall(f.owner, selection)).code).toBe('CLOCK_INVALID');
      expect(f.state.writes).toBe(0);
    },
  );

  it('revokes on cancel and permanently releases future admission', async () => {
    const f = fixture();
    const prepared = await f.review.prepareInstall(f.owner, selection);
    expect(f.review.cancel(f.owner).code).toBe('CANCELLED');
    expect((await f.review.confirm(f.owner, prepared.planId, true)).code).toBe('INVALID_APPROVAL');
    const next = await f.review.prepareInstall(f.owner, selection);
    expect(f.review.release(f.owner).code).toBe('RELEASED');
    expect((await f.review.confirm(f.owner, next.planId, true)).code).toBe('RELEASED');
    expect((await f.review.prepareRemoval(f.owner)).code).toBe('RELEASED');
    expect((await f.review.prepareInstall(f.owner, selection)).code).toBe('RELEASED');
    expect(f.state.writes).toBe(0);
  });

  it.each(['cancel', 'expire'])(
    'retains install ownership after %s of removal review',
    async (mode) => {
      const f = fixture();
      const prepared = await f.review.prepareInstall(f.owner, selection);
      await f.review.confirm(f.owner, prepared.planId, true);
      const removal = await f.review.prepareRemoval(f.owner);
      if (mode === 'cancel') f.review.cancel(f.owner);
      else f.state.time = removal.expiresAtMs;
      expect((await f.review.confirm(f.owner, removal.planId, true)).code).toBe(
        mode === 'cancel' ? 'INVALID_APPROVAL' : 'EXPIRED',
      );
      expect(f.state.bytes.toString()).toBe(installed);
      const fresh = await f.review.prepareRemoval(f.owner);
      expect(fresh.planId).not.toBe(removal.planId);
      expect((await f.review.confirm(f.owner, fresh.planId, true)).code).toBe('REMOVED');
      expect(f.state.bytes.toString()).toBe(original);
    },
  );

  it('keeps private canaries, IDs, hashes and expiry out of all ordinary statuses', async () => {
    const f = fixture();
    const prepared = await f.review.prepareInstall(f.owner, selection);
    const digest = createHash('sha256').update(original).digest('hex');
    const results = [
      f.review.status(),
      await f.review.confirm({}, prepared.planId, true),
      await f.review.confirm(f.owner, 'wrong', true),
      f.review.cancel(f.owner),
    ];
    for (const result of results) {
      triple(result);
      for (const value of [
        configPath,
        selection.command,
        'config-canary',
        'identity-canary',
        digest,
        prepared.planId,
        'expiresAtMs',
        'manifest',
      ])
        expect(JSON.stringify(result)).not.toContain(value);
    }
    expect(Object.isFrozen(f.review.status())).toBe(true);
  });

  it('requires explicit bounded plain options without evaluating accessors', () => {
    let reads = 0;
    const getter = Object.defineProperty({}, 'owner', {
      get() {
        reads += 1;
        return {};
      },
    });
    for (const options of [
      undefined,
      {},
      getter,
      { ...fixture().io },
      ...[0, 300001, Infinity, 1.5].map((lifetimeMs) => ({
        owner: {},
        configPath,
        io: fixture().io,
        lifetimeMs,
      })),
    ])
      expect(createOwnedHookReview(options)).toEqual({
        ok: false,
        code: 'INVALID_CAPABILITY',
        presence: 'Unknown',
      });
    expect(reads).toBe(0);
    expect(fixture({ lifetimeMs: 1 }).review.ok).toBe(true);
    expect(fixture({ lifetimeMs: 300000 }).review.ok).toBe(true);
    expect(fixture({ now: undefined }).review.code).toBe('INVALID_CAPABILITY');
  });

  it('accepts the real provider shape with close/status extras and preserves method receiver', async () => {
    const f = fixture();
    let extraCalls = 0;
    const io = {
      ...f.io,
      close() {
        extraCalls += 1;
      },
      status() {
        extraCalls += 1;
      },
    };
    const read = io.readTarget;
    io.readTarget = function () {
      expect(this).toBe(io);
      return read();
    };
    const review = createOwnedHookReview({ owner: f.owner, configPath, io, lifetimeMs: 300000 });
    expect((await review.prepareInstall(f.owner, selection)).code).toBe('REVIEW_REQUIRED');
    review.release(f.owner);
    expect(extraCalls).toBe(0);
  });
});
