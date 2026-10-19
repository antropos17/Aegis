import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const { createOwnedHookWriter, IO_CONTRACT } = require('../../src/main/claude-hook-writer');
const { CONTRACT } = require('../../src/main/claude-hook-plan');
const configPath = 'X:/owned-fixture/private-settings.json';
const selection = {
  command: 'fixture-only-command secret-command',
  contract: CONTRACT,
  timeoutSeconds: 5,
};
const original = Buffer.from(
  ' {\r\n "secret":"secret-config", "unicode":"é😀", "hooks":{"PreToolUse":[]}\r\n}\r\n',
);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fixture(bytes = original) {
  const state = {
    bytes: Buffer.from(bytes),
    identity: 'owned-handle-1',
    backups: [],
    events: [],
    writes: 0,
  };
  const io = {
    contract: IO_CONTRACT,
    async readTarget() {
      state.events.push('read-target');
      return { identity: state.identity, bytes: Buffer.from(state.bytes) };
    },
    async retainPrivate(record) {
      state.events.push('retain-private');
      const ref = Object.freeze({ index: state.backups.length });
      state.backups.push({ ref, bytes: Buffer.from(record.bytes), manifest: record.manifest });
      return ref;
    },
    async readPrivate(ref) {
      state.events.push('read-private');
      const record = state.backups.find((item) => item.ref === ref);
      return { bytes: Buffer.from(record.bytes), manifest: record.manifest };
    },
    async compareAndWrite({ identity, beforeBytes, afterBytes }) {
      state.events.push('compare-write');
      if (identity !== state.identity || !state.bytes.equals(beforeBytes)) return 'stale';
      state.writes += 1;
      state.bytes = Buffer.from(afterBytes);
      return 'written';
    },
  };
  const writer = createOwnedHookWriter({ configPath, io });
  return { state, io, writer };
}

async function installed(f = fixture()) {
  const review = await f.writer.prepareInstall(selection);
  expect(review.code).toBe('REVIEW_REQUIRED');
  expect(await f.writer.apply(review.ticket, true)).toEqual({
    ok: true,
    code: 'INSTALLED',
    presence: 'Configured',
  });
  return f;
}

describe('private owned Claude hook writer capability', () => {
  it('requires an explicit contract and every owned IO operation; has no default IO', () => {
    for (const options of [undefined, {}, { configPath, io: {} }]) {
      expect(createOwnedHookWriter(options)).toEqual({
        ok: false,
        code: 'INVALID_CAPABILITY',
        presence: 'Unknown',
      });
    }
    const f = fixture();
    for (const method of ['readTarget', 'retainPrivate', 'readPrivate', 'compareAndWrite']) {
      expect(createOwnedHookWriter({ configPath, io: { ...f.io, [method]: undefined } }).code).toBe(
        'INVALID_CAPABILITY',
      );
    }
    expect(
      createOwnedHookWriter({ configPath, io: { ...f.io, contract: 'unqualified' } }).code,
    ).toBe('INVALID_CAPABILITY');
  });

  it('retains exact bytes and manifest, verifies private readback, then revalidates before writing', async () => {
    const f = fixture();
    const review = await f.writer.prepareInstall(selection);
    expect(review.review.changedFragments[0].file).toBe(configPath);
    expect(f.state.writes).toBe(0);
    expect(await f.writer.apply(review.ticket, true)).toEqual({
      ok: true,
      code: 'INSTALLED',
      presence: 'Configured',
    });
    expect(f.state.backups[0].bytes.equals(original)).toBe(true);
    expect(sha(f.state.backups[0].manifest)).toBe(review.review.manifestSha256);
    expect(f.state.events).toEqual([
      'read-target',
      'retain-private',
      'read-private',
      'read-target',
      'compare-write',
      'read-target',
    ]);
    expect(sha(f.state.bytes)).toBe(review.review.afterSha256);
    expect(f.writer.status()).toEqual({ ok: true, code: 'INSTALLED', presence: 'Configured' });
    expect(Object.keys(review.ticket)).toEqual([]);
  });

  it('binds an approval to the exact private ticket and consumes it only once', async () => {
    const f = fixture();
    const first = await f.writer.prepareInstall(selection);
    const second = await f.writer.prepareInstall(selection);
    expect((await f.writer.apply(first.ticket, true)).code).toBe('INVALID_APPROVAL');
    expect((await f.writer.apply(second.ticket, false)).code).toBe('INVALID_APPROVAL');
    expect((await f.writer.apply({}, true)).code).toBe('INVALID_APPROVAL');
    expect(f.state.writes).toBe(0);
    expect((await f.writer.apply(second.ticket, true)).code).toBe('INSTALLED');
    expect((await f.writer.apply(second.ticket, true)).code).toBe('INVALID_APPROVAL');
  });

  it('keeps a private frozen review from changing the retained plan', async () => {
    const f = fixture();
    const review = await f.writer.prepareInstall(selection);
    expect(Object.isFrozen(review)).toBe(true);
    expect(Object.isFrozen(review.review)).toBe(true);
    expect(Object.isFrozen(review.review.edits[0])).toBe(true);
    expect(() => {
      review.review.edits[0].replacementUtf8 = 'changed';
    }).toThrow();
    expect((await f.writer.apply(review.ticket, true)).code).toBe('INSTALLED');
    expect(JSON.parse(f.state.bytes).hooks.PreToolUse[0].hooks[0].command).toBe(selection.command);
  });

  it.each(['retainPrivate', 'readPrivate'])(
    'refuses a %s failure before any profile write',
    async (method) => {
      const f = fixture();
      const review = await f.writer.prepareInstall(selection);
      f.io[method] = async () => {
        throw Error('secret-config ' + configPath);
      };
      expect((await f.writer.apply(review.ticket, true)).code).toBe('BACKUP_FAILED');
      expect(f.state.writes).toBe(0);
      expect(f.state.bytes.equals(original)).toBe(true);
    },
  );

  it.each(['bytes', 'manifest'])(
    'refuses mismatching backup %s readback before writing',
    async (field) => {
      const f = fixture();
      const review = await f.writer.prepareInstall(selection);
      const read = f.io.readPrivate;
      f.io.readPrivate = async (ref) => ({
        ...(await read(ref)),
        [field]: field === 'bytes' ? Buffer.from('{}') : 'tampered',
      });
      expect((await f.writer.apply(review.ticket, true)).code).toBe('BACKUP_TAMPERED');
      expect(f.state.writes).toBe(0);
    },
  );

  it.each(['bytes', 'identity'])(
    'rejects stale target %s after the approved preview',
    async (field) => {
      const f = fixture();
      const review = await f.writer.prepareInstall(selection);
      f.state[field] =
        field === 'bytes' ? Buffer.from('{"concurrent":true}') : 'replacement-handle';
      expect((await f.writer.apply(review.ticket, true)).code).toBe(
        field === 'bytes' ? 'TARGET_CHANGED' : 'TARGET_IDENTITY_CHANGED',
      );
      expect(f.state.writes).toBe(0);
      expect(f.state.events).not.toContain('compare-write');
    },
  );

  it('requires the provider to compare again at the mutation boundary', async () => {
    const f = fixture();
    const review = await f.writer.prepareInstall(selection);
    const write = f.io.compareAndWrite;
    f.io.compareAndWrite = async (input) => {
      f.state.bytes = Buffer.from('{"concurrent":"at commit"}');
      return write(input);
    };
    expect((await f.writer.apply(review.ticket, true)).code).toBe('TARGET_CHANGED');
    expect(f.state.writes).toBe(0);
    expect(f.state.bytes.toString()).toBe('{"concurrent":"at commit"}');
    expect((await f.writer.prepareRemoval()).code).toBe('NO_OWNED_INSTALL');
  });

  it.each(['throw', 'partial', 'unexpected', 'read-failure', 'identity-after', 'concurrent-after'])(
    'retains unknown state after %s at/after mutation without overwriting',
    async (mode) => {
      const f = fixture();
      const review = await f.writer.prepareInstall(selection);
      const write = f.io.compareAndWrite;
      f.io.compareAndWrite = async (input) => {
        await write(input);
        if (mode === 'throw') throw Error('private failure ' + configPath);
        if (mode === 'partial') f.state.bytes = f.state.bytes.subarray(0, 12);
        if (mode === 'identity-after') f.state.identity = 'substituted-after-write';
        if (mode === 'concurrent-after') f.state.bytes = Buffer.from('{"concurrent":"retain me"}');
        if (mode === 'read-failure')
          f.io.readTarget = async () => {
            throw Error('private read failure');
          };
        return mode === 'unexpected' ? undefined : 'written';
      };
      const outcome = await f.writer.apply(review.ticket, true);
      expect(outcome.code).toBe(
        ['throw', 'unexpected'].includes(mode) ? 'WRITE_UNCERTAIN' : 'READBACK_FAILED',
      );
      expect(outcome.presence).toBe('Unknown');
      const retained = Buffer.from(f.state.bytes);
      expect(f.state.backups).toHaveLength(1);
      expect(f.state.backups[0].bytes.equals(original)).toBe(true);
      expect((await f.writer.prepareRemoval()).code).toBe('RETAINED_UNKNOWN');
      expect((await f.writer.prepareInstall(selection)).code).toBe('RETAINED_UNKNOWN');
      expect(f.state.writes).toBe(1);
      expect(f.state.bytes.equals(retained)).toBe(true);
    },
  );

  it('restores every original byte only after a new exact rollback review', async () => {
    const f = await installed();
    const review = await f.writer.prepareRemoval();
    expect(review.review.mode).toBe('exact-rollback');
    expect(f.state.writes).toBe(1);
    expect((await f.writer.apply(review.ticket, true)).code).toBe('REMOVED');
    expect(f.state.bytes.equals(original)).toBe(true);
    expect(f.state.backups).toHaveLength(2);
    expect((await f.writer.prepareRemoval()).code).toBe('NO_OWNED_INSTALL');
  });

  it('uses targeted removal to preserve concurrent unrelated edits and other hooks', async () => {
    const f = await installed();
    const changed = f.state.bytes.toString().replace('"secret-config"', '"updated-secret"');
    const end = changed.lastIndexOf(']');
    const concurrent =
      changed.slice(0, end) + ',{"matcher":"Read","hooks":[]}' + changed.slice(end);
    f.state.bytes = Buffer.from(concurrent);
    const review = await f.writer.prepareRemoval();
    expect(review.review.mode).toBe('targeted-removal');
    expect((await f.writer.apply(review.ticket, true)).code).toBe('REMOVED');
    expect(f.state.bytes.toString()).toBe(
      original
        .toString()
        .replace('"secret-config"', '"updated-secret"')
        .replace('[]', '[{"matcher":"Read","hooks":[]}]'),
    );
  });

  it('refuses a stale removal review instead of restoring an old whole file', async () => {
    const f = await installed();
    const review = await f.writer.prepareRemoval();
    f.state.bytes = Buffer.from(
      f.state.bytes.toString().replace('secret-config', 'new-private-value'),
    );
    const concurrent = Buffer.from(f.state.bytes);
    expect((await f.writer.apply(review.ticket, true)).code).toBe('TARGET_CHANGED');
    expect(f.state.bytes.equals(concurrent)).toBe(true);
    expect(f.state.writes).toBe(1);
  });

  it.each(['bytes', 'manifest'])(
    'rejects retained installation %s tampering before removal planning',
    async (field) => {
      const f = await installed();
      f.state.backups[0][field] =
        field === 'bytes' ? Buffer.from('{}') : 'tampered private manifest';
      expect((await f.writer.prepareRemoval()).code).toBe('BACKUP_TAMPERED');
      expect(f.state.writes).toBe(1);
    },
  );

  it('checks retained ownership again between removal review and commit', async () => {
    const f = await installed();
    const review = await f.writer.prepareRemoval();
    f.state.backups[0].manifest = 'tampered';
    expect((await f.writer.apply(review.ticket, true)).code).toBe('BACKUP_TAMPERED');
    expect(f.state.writes).toBe(1);
  });

  it.each(['changed', 'duplicate', 'absent', 'moved'])(
    'refuses an %s owned entry without writing',
    async (mode) => {
      const f = await installed();
      const parsed = JSON.parse(f.state.bytes);
      const entries = parsed.hooks.PreToolUse;
      if (mode === 'changed') entries[0].hooks[0].timeout = 7;
      if (mode === 'duplicate') entries.push(entries[0]);
      if (mode === 'absent') entries.length = 0;
      if (mode === 'moved') entries.unshift({ matcher: 'Read', hooks: [] });
      f.state.bytes = Buffer.from(JSON.stringify(parsed));
      expect((await f.writer.prepareRemoval()).code).toBe('OWNED_ENTRY_REFUSED');
      expect(f.state.writes).toBe(1);
    },
  );

  it('leaves an existing equal entry unowned and never creates a backup', async () => {
    const f = await installed();
    const another = fixture(f.state.bytes);
    expect((await another.writer.prepareInstall(selection)).code).toBe('CONFIGURED_UNOWNED');
    expect((await another.writer.prepareRemoval()).code).toBe('NO_OWNED_INSTALL');
    expect(another.state.backups).toEqual([]);
    expect(another.state.writes).toBe(0);
  });

  it('serializes in-flight calls and refuses reentrant mutation', async () => {
    const f = fixture();
    const read = f.io.readTarget;
    let release;
    f.io.readTarget = async () => {
      await new Promise((resolve) => {
        release = resolve;
      });
      return read();
    };
    const pending = f.writer.prepareInstall(selection);
    expect((await f.writer.prepareInstall(selection)).code).toBe('BUSY');
    expect((await f.writer.prepareRemoval()).code).toBe('BUSY');
    expect((await f.writer.apply({}, true)).code).toBe('BUSY');
    release();
    expect((await pending).code).toBe('REVIEW_REQUIRED');
  });

  it('returns only fixed sanitized statuses, including hostile error message accessors', async () => {
    const f = fixture();
    let accessed = false;
    f.io.readTarget = async () => {
      throw Object.defineProperty({}, 'message', {
        get() {
          accessed = true;
          throw Error('secret');
        },
      });
    };
    expect(await f.writer.prepareInstall(selection)).toEqual({
      ok: false,
      code: 'TARGET_READ_FAILED',
      presence: 'Unknown',
    });
    expect(accessed).toBe(false);
    const status = JSON.stringify(f.writer.status());
    for (const privateValue of ['secret', configPath, selection.command, sha(original)])
      expect(status).not.toContain(privateValue);
    expect(Object.keys(f.writer.status()).sort()).toEqual(['code', 'ok', 'presence']);
    expect(f.writer.status()).not.toHaveProperty('blockingVerified');
  });

  it('protects the saved sanitized status from mutation by its caller', async () => {
    const f = fixture();
    f.io.readTarget = async () => {
      throw Error('private');
    };
    const response = await f.writer.prepareInstall(selection);
    expect(Object.isFrozen(response)).toBe(true);
    expect(() => {
      response.code = 'secret-status';
    }).toThrow();
    const copy = f.writer.status();
    copy.code = 'secret-copy';
    expect(f.writer.status().code).toBe('TARGET_READ_FAILED');
  });

  it('limits backup attempts even when a provider retains a record and then throws', async () => {
    const f = fixture();
    let attempts = 0;
    const retain = f.io.retainPrivate;
    f.io.retainPrivate = async (record) => {
      attempts += 1;
      await retain(record);
      throw Error('private write uncertainty');
    };
    for (let index = 0; index < 8; index += 1) {
      const review = await f.writer.prepareInstall(selection);
      expect((await f.writer.apply(review.ticket, true)).code).toBe('BACKUP_FAILED');
    }
    const final = await f.writer.prepareInstall(selection);
    expect((await f.writer.apply(final.ticket, true)).code).toBe('RETENTION_LIMIT');
    expect(attempts).toBe(8);
    expect(f.state.writes).toBe(0);
  });

  it.each([
    undefined,
    { identity: '', bytes: original },
    { identity: 'x', bytes: 'text' },
    { identity: 'x', bytes: Buffer.alloc(262145) },
  ])('rejects an unusable target snapshot without private output', async (value) => {
    const f = fixture();
    f.io.readTarget = async () => value;
    expect(await f.writer.prepareInstall(selection)).toEqual({
      ok: false,
      code: 'TARGET_READ_FAILED',
      presence: 'Unknown',
    });
    expect(f.state.writes).toBe(0);
  });

  it('never lets additional selection fields relabel the capability target', async () => {
    const f = fixture();
    const review = await f.writer.prepareInstall({
      ...selection,
      configPath: 'X:/different/private.json',
      configBytes: Buffer.from('{}'),
    });
    expect(review.review.changedFragments[0].file).toBe(configPath);
    expect(review.review.beforeSha256).toBe(sha(original));
    expect((await f.writer.apply(review.ticket, true)).code).toBe('INSTALLED');
    expect((await f.writer.prepareRemoval()).review.mode).toBe('exact-rollback');
  });

  it('refuses removal planning against a substituted identity and retains its ownership backup', async () => {
    const f = await installed();
    f.state.identity = 'replacement-with-identical-content';
    expect((await f.writer.prepareRemoval()).code).toBe('TARGET_IDENTITY_CHANGED');
    expect(f.state.writes).toBe(1);
    expect(f.state.backups[0].bytes.equals(original)).toBe(true);
  });

  it('locks removal uncertainty while preserving original and current-byte backups', async () => {
    const f = await installed();
    f.state.bytes = Buffer.from(
      f.state.bytes.toString().replace('secret-config', 'concurrent-secret'),
    );
    const beforeRemoval = Buffer.from(f.state.bytes);
    const review = await f.writer.prepareRemoval();
    const write = f.io.compareAndWrite;
    f.io.compareAndWrite = async (input) => {
      await write(input);
      throw Error('private post-removal failure');
    };
    expect((await f.writer.apply(review.ticket, true)).code).toBe('WRITE_UNCERTAIN');
    expect(f.state.backups).toHaveLength(2);
    expect(f.state.backups[0].bytes.equals(original)).toBe(true);
    expect(f.state.backups[1].bytes.equals(beforeRemoval)).toBe(true);
    expect((await f.writer.prepareRemoval()).code).toBe('RETAINED_UNKNOWN');
    expect(f.state.writes).toBe(2);
    expect(JSON.parse(f.state.bytes).secret).toBe('concurrent-secret');
  });

  it('refuses malformed configuration and selections without exposing planner diagnostics', async () => {
    const f = fixture(Buffer.from('{"secret":"secret-config",}'));
    expect(await f.writer.prepareInstall(selection)).toEqual({
      ok: false,
      code: 'PLAN_REFUSED',
      presence: 'Unknown',
    });
    expect(f.state.backups).toHaveLength(0);
    expect(f.state.writes).toBe(0);
    const clean = fixture();
    expect((await clean.writer.prepareInstall({ ...selection, contract: 'wrong' })).code).toBe(
      'PLAN_REFUSED',
    );
    expect((await clean.writer.prepareRemoval()).code).toBe('NO_OWNED_INSTALL');
  });
});
