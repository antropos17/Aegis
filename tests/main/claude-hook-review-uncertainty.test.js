import { describe, expect, it } from 'vitest';
import { fixture, selection } from './claude-hook-review-fixture';

describe('owner review retained mutation uncertainty', () => {
  it.each([
    ['install', 'throw', 'WRITE_UNCERTAIN'],
    ['install', 'readback', 'READBACK_FAILED'],
    ['removal', 'throw', 'WRITE_UNCERTAIN'],
    ['removal', 'readback', 'READBACK_FAILED'],
  ])('preserves %s %s outcome through later cancellation and release', async (kind, mode, code) => {
    const f = fixture();
    const install = await f.review.prepareInstall(f.owner, selection);
    let prepared = install;
    if (kind === 'removal') {
      expect((await f.review.confirm(f.owner, install.planId, true)).code).toBe('INSTALLED');
      prepared = await f.review.prepareRemoval(f.owner);
    }
    f.state.mode = mode;
    const outcome = await f.review.confirm(f.owner, prepared.planId, true);
    expect(outcome).toEqual({ ok: false, code, presence: 'Unknown' });
    const writes = f.state.writes;
    const backups = f.state.backups.length;

    expect(f.review.cancel(f.owner)).toEqual(outcome);
    expect(f.review.status()).toEqual(outcome);
    expect((await f.review.confirm(f.owner, prepared.planId, true)).code).toBe('INVALID_APPROVAL');
    expect((await f.review.prepareInstall(f.owner, selection)).code).toBe('RETAINED_UNKNOWN');
    expect(f.review.status()).toEqual(outcome);
    expect((await f.review.prepareRemoval(f.owner)).code).toBe('RETAINED_UNKNOWN');
    expect(f.review.status()).toEqual(outcome);
    expect((await f.review.prepareInstall(f.owner, {})).code).toBe('INVALID_SELECTION');
    expect(f.review.status()).toEqual(outcome);
    expect(f.review.cancel(f.owner)).toEqual(outcome);
    expect(f.review.release(f.owner)).toEqual(outcome);
    expect(f.review.status()).toEqual(outcome);
    expect((await f.review.prepareInstall(f.owner, selection)).code).toBe('RELEASED');
    expect((await f.review.prepareRemoval(f.owner)).code).toBe('RELEASED');
    expect((await f.review.confirm(f.owner, prepared.planId, true)).code).toBe('RELEASED');
    expect(f.review.cancel(f.owner).code).toBe('RELEASED');
    expect(f.review.release(f.owner).code).toBe('RELEASED');
    expect(f.review.status()).toEqual(outcome);
    expect(f.state.writes).toBe(writes);
    expect(f.state.backups).toHaveLength(backups);
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(Object.keys(outcome).sort()).toEqual(['code', 'ok', 'presence']);
  });

  it.each(['throw', 'readback'])('preserves %s outcome on direct release', async (mode) => {
    const f = fixture();
    const prepared = await f.review.prepareInstall(f.owner, selection);
    f.state.mode = mode;
    const outcome = await f.review.confirm(f.owner, prepared.planId, true);

    expect(f.review.release({})).toEqual({
      ok: false,
      code: 'INVALID_OWNER',
      presence: 'Unknown',
    });
    expect(f.review.release(f.owner)).toEqual(outcome);
    expect(f.review.status()).toEqual(outcome);
    expect((await f.review.prepareRemoval(f.owner)).code).toBe('RELEASED');
    expect(f.state.writes).toBe(1);
  });
});
