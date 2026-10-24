import { describe, expect, it } from 'vitest';
import { deferred, fixture, installed, original, selection } from './claude-hook-review-fixture';

describe('owner review asynchronous lifecycle', () => {
  it('snapshots selection before a deferred read or injected clock can mutate it', async () => {
    const f = fixture();
    const hold = deferred();
    const selected = { ...selection };
    f.state.beforeRead = () => hold.promise;
    f.state.clock = () => {
      selected.command = 'clock-mutation-canary';
      return f.state.time;
    };
    const pending = f.review.prepareInstall(f.owner, selected);
    selected.command = 'late-mutation-canary';
    hold.resolve();
    const prepared = await pending;
    expect(prepared.review.manifest).toContain(selection.command);
    expect((await f.review.confirm(f.owner, prepared.planId, true)).code).toBe('INSTALLED');
    expect(f.state.bytes.toString()).toBe(installed);
  });

  it('rejects accessor/inherited/extra selections without invoking their getter and revokes old ID', async () => {
    const f = fixture();
    let getters = 0;
    const previous = await f.review.prepareInstall(f.owner, selection);
    const accessor = { ...selection };
    Object.defineProperty(accessor, 'command', {
      get() {
        getters += 1;
        return selection.command;
      },
    });
    for (const selected of [
      accessor,
      Object.create(selection),
      { ...selection, configPath: 'other' },
    ])
      expect((await f.review.prepareInstall(f.owner, selected)).code).toBe('INVALID_SELECTION');
    expect(getters).toBe(0);
    expect((await f.review.confirm(f.owner, previous.planId, true)).code).toBe('INVALID_APPROVAL');
    expect(f.state.writes).toBe(0);
  });

  it.each(['cancel', 'release', 'expire'])(
    'suppresses late prepare after %s and keeps its slot occupied',
    async (mode) => {
      const f = fixture();
      const hold = deferred();
      f.state.beforeRead = () => hold.promise;
      const pending = f.review.prepareInstall(f.owner, selection);
      if (mode === 'cancel') f.review.cancel(f.owner);
      if (mode === 'release') f.review.release(f.owner);
      if (mode === 'expire') f.state.time = 120;
      const blockedCode = mode === 'release' ? 'RELEASED' : 'BUSY';
      expect((await f.review.prepareInstall(f.owner, selection)).code).toBe(blockedCode);
      expect((await f.review.prepareRemoval(f.owner)).code).toBe(blockedCode);
      expect((await f.review.confirm(f.owner, 'unknown', true)).code).toBe(blockedCode);
      hold.resolve();
      const outcome = await pending;
      expect(outcome.code).toBe(
        mode === 'cancel' ? 'CANCELLED' : mode === 'release' ? 'RELEASED' : 'EXPIRED',
      );
      expect(outcome).not.toHaveProperty('review');
      expect(f.state.writes).toBe(0);
      if (mode !== 'release')
        expect((await f.review.prepareInstall(f.owner, selection)).code).toBe('REVIEW_REQUIRED');
    },
  );

  it('checks the post-await clock and status lazily without background timers', async () => {
    const f = fixture();
    const hold = deferred();
    f.state.beforeRead = () => hold.promise;
    const pending = f.review.prepareInstall(f.owner, selection);
    f.state.time = 99;
    hold.resolve();
    expect((await pending).code).toBe('CLOCK_INVALID');
    const other = fixture();
    const prepared = await other.review.prepareInstall(other.owner, selection);
    other.state.time = prepared.expiresAtMs;
    expect(other.review.status()).toEqual({ ok: false, code: 'EXPIRED', presence: 'Unknown' });
    expect((await other.review.confirm(other.owner, prepared.planId, true)).code).toBe(
      'INVALID_APPROVAL',
    );
  });

  it('reserves the slot before reentrant clock and IO callbacks and suppresses revoked clock work', async () => {
    const f = fixture();
    const reentries = [];
    f.state.clock = () => {
      reentries.push(
        f.review.prepareInstall(f.owner, selection),
        f.review.prepareRemoval(f.owner),
        f.review.confirm(f.owner, 'unknown', true),
      );
      expect(f.review.status().code).toBe('BUSY');
      return f.state.time;
    };
    f.state.beforeRead = async () => {
      expect((await f.review.prepareInstall(f.owner, selection)).code).toBe('BUSY');
    };
    const prepared = await f.review.prepareInstall(f.owner, selection);
    for (const result of await Promise.all(reentries)) expect(result.code).toBe('BUSY');
    expect(prepared.code).toBe('REVIEW_REQUIRED');
    f.state.clock = () => {
      f.review.cancel(f.owner);
      return f.state.time;
    };
    expect((await f.review.confirm(f.owner, prepared.planId, true)).code).toBe('CANCELLED');
    expect(f.state.writes).toBe(0);
    f.state.clock = () => {
      f.review.release(f.owner);
      return f.state.time;
    };
    expect((await f.review.prepareInstall(f.owner, selection)).code).toBe('RELEASED');
  });

  it('consumes ID synchronously and rejects duplicate confirm while apply is unresolved', async () => {
    const f = fixture();
    const prepared = await f.review.prepareInstall(f.owner, selection);
    const hold = deferred();
    const entered = deferred();
    f.state.beforeWrite = () => {
      entered.resolve();
      return hold.promise;
    };
    const applying = f.review.confirm(f.owner, prepared.planId, true);
    expect((await f.review.confirm(f.owner, prepared.planId, true)).code).toBe('BUSY');
    await entered.promise;
    expect((await f.review.prepareRemoval(f.owner)).code).toBe('BUSY');
    hold.resolve();
    expect((await applying).code).toBe('INSTALLED');
    expect((await f.review.confirm(f.owner, prepared.planId, true)).code).toBe('INVALID_APPROVAL');
    expect(f.state.writes).toBe(1);
  });

  it.each(['written', 'throw', 'readback'])(
    'preserves actual %s outcome through cancel, expiry and release during apply',
    async (mode) => {
      const f = fixture();
      const prepared = await f.review.prepareInstall(f.owner, selection);
      const hold = deferred();
      const entered = deferred();
      f.state.beforeWrite = () => {
        entered.resolve();
        return hold.promise;
      };
      f.state.mode = mode;
      const applying = f.review.confirm(f.owner, prepared.planId, true);
      await entered.promise;
      f.state.time = 500;
      f.state.clock = () => {
        throw Error('clock-after-admission-canary');
      };
      expect(f.review.cancel(f.owner).code).toBe('APPLY_IN_PROGRESS');
      expect(f.review.release(f.owner).code).toBe('APPLY_IN_PROGRESS');
      expect(f.review.status().code).toBe('APPLY_IN_PROGRESS');
      hold.resolve();
      const actual = await applying;
      expect(actual.code).toBe(
        mode === 'written' ? 'INSTALLED' : mode === 'throw' ? 'WRITE_UNCERTAIN' : 'READBACK_FAILED',
      );
      expect(f.review.status()).toEqual(actual);
      f.review.release(f.owner);
      expect(f.review.status()).toEqual(actual);
      expect((await f.review.prepareInstall(f.owner, selection)).code).toBe('RELEASED');
      expect(f.state.writes).toBe(1);
    },
  );

  it('preserves admitted successful removal even when owner release and expiry occur before completion', async () => {
    const f = fixture();
    const install = await f.review.prepareInstall(f.owner, selection);
    await f.review.confirm(f.owner, install.planId, true);
    const removal = await f.review.prepareRemoval(f.owner);
    f.state.beforeWrite = async () => {
      f.state.time = 500;
      expect(f.review.release(f.owner).code).toBe('APPLY_IN_PROGRESS');
    };
    expect((await f.review.confirm(f.owner, removal.planId, true)).code).toBe('REMOVED');
    expect(f.state.bytes.toString()).toBe(original);
    expect(f.review.status().code).toBe('REMOVED');
  });

  it('retains uncertain writer lock and eight-backup bound across fresh IDs', async () => {
    const uncertain = fixture();
    const prepared = await uncertain.review.prepareInstall(uncertain.owner, selection);
    uncertain.state.mode = 'throw';
    expect((await uncertain.review.confirm(uncertain.owner, prepared.planId, true)).code).toBe(
      'WRITE_UNCERTAIN',
    );
    uncertain.review.cancel(uncertain.owner);
    expect((await uncertain.review.prepareInstall(uncertain.owner, selection)).code).toBe(
      'RETAINED_UNKNOWN',
    );
    expect((await uncertain.review.prepareRemoval(uncertain.owner)).code).toBe('RETAINED_UNKNOWN');
    expect(uncertain.state.writes).toBe(1);
    const bounded = fixture();
    bounded.state.retainFailure = true;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const plan = await bounded.review.prepareInstall(bounded.owner, selection);
      expect((await bounded.review.confirm(bounded.owner, plan.planId, true)).code).toBe(
        'BACKUP_FAILED',
      );
    }
    const final = await bounded.review.prepareInstall(bounded.owner, selection);
    expect((await bounded.review.confirm(bounded.owner, final.planId, true)).code).toBe(
      'RETENTION_LIMIT',
    );
    expect(bounded.state.backups).toHaveLength(8);
    expect(bounded.state.writes).toBe(0);
  });

  it('never evaluates a thrown diagnostic accessor or includes private exception contents', async () => {
    const f = fixture();
    let accessed = false;
    f.state.beforeRead = () => {
      throw Object.defineProperty({}, 'message', {
        get() {
          accessed = true;
          return 'exception-canary';
        },
      });
    };
    expect(await f.review.prepareInstall(f.owner, selection)).toEqual({
      ok: false,
      code: 'TARGET_READ_FAILED',
      presence: 'Unknown',
    });
    expect(accessed).toBe(false);
    expect(JSON.stringify(f.review.status())).not.toContain('exception-canary');
  });
});
