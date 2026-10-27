import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import hashchain from '../../src/main/audit-hashchain.js';
import integrity from '../../src/main/audit-integrity-review.js';

describe('bounded audit consistency review', () => {
  let dir;
  let file;
  let review;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-audit-integrity-'));
    file = path.join(dir, 'aegis-audit-2026-10-27.json');
    review = integrity.createAuditIntegrityReview({ getLogDir: () => dir });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  function writeChain(events) {
    let previous = hashchain.GENESIS;
    const lines = events.map((event, seq) => {
      const hash = hashchain.computeHash(previous, event);
      previous = hash;
      return JSON.stringify({ ...event, seq, hash });
    });
    fs.writeFileSync(file, lines.join('\n') + '\n');
  }

  it('checks the selected daily chain without modifying it', async () => {
    writeChain([{ type: 'start' }, { type: 'end', detail: 'private' }]);
    const before = fs.readFileSync(file);
    expect(await review('2026-10-27')).toEqual({ status: 'consistent' });
    expect(fs.readFileSync(file)).toEqual(before);
  });
  it('uses the existing verifier nonempty-line ordinals', async () => {
    writeChain([{ type: 'start' }, { type: 'end' }]);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('\n', '\n \t\n'));
    expect(hashchain.verifyChain(file).valid).toBe(true);
    expect(await review('2026-10-27')).toEqual({ status: 'consistent' });
  });
  it('reports a changed record or broken sequence as inconsistent without returning data', async () => {
    writeChain([{ type: 'start' }, { type: 'end', detail: 'private' }]);
    const data = fs.readFileSync(file, 'utf8').replace('private', 'changed');
    fs.writeFileSync(file, data);
    expect(await review('2026-10-27')).toEqual({ status: 'inconsistent' });
    fs.writeFileSync(file, '{"seq":3,"hash":"private"}\n');
    expect(await review('2026-10-27')).toEqual({ status: 'inconsistent' });
  });
  it('refuses empty, incomplete and oversized files, missing days and invalid selectors', async () => {
    expect(await review('2026-10-27')).toEqual({ status: 'unavailable' });
    fs.writeFileSync(file, '');
    expect(await review('2026-10-27')).toEqual({ status: 'unavailable' });
    fs.writeFileSync(file, ' \t\n\n');
    expect(await review('2026-10-27')).toEqual({ status: 'unavailable' });
    fs.writeFileSync(file, '{"partial":true}');
    expect(await review('2026-10-27')).toEqual({ status: 'unavailable' });
    fs.writeFileSync(file, Buffer.alloc(4 * 1024 * 1024 + 1));
    expect(await review('2026-10-27')).toEqual({ status: 'unavailable' });
    for (const selector of ['../../private', '2026-02-30', '2026-10-27.json', null])
      expect(await review(selector)).toEqual({ status: 'unavailable' });
  });
  it('rejects a file replaced or changed while reading', async () => {
    writeChain([{ type: 'start' }]);
    const real = fs.promises;
    const io = {
      ...real,
      open: async (...args) => {
        const handle = await real.open(...args);
        return {
          stat: (...statArgs) => handle.stat(...statArgs),
          close: () => handle.close(),
          read: async (...readArgs) => {
            const result = await handle.read(...readArgs);
            fs.appendFileSync(file, 'extra\n');
            return result;
          },
        };
      },
    };
    review = integrity.createAuditIntegrityReview({ getLogDir: () => dir, io });
    expect(await review('2026-10-27')).toEqual({ status: 'unavailable' });
  });
  it('refuses hard-linked files and symlinked directory ancestors', async () => {
    writeChain([{ type: 'start' }]);
    const alias = path.join(dir, 'alias');
    fs.linkSync(file, alias);
    expect(await review('2026-10-27')).toEqual({ status: 'unavailable' });
    fs.unlinkSync(alias);
    const io = {
      ...fs.promises,
      lstat: async (name, options) => {
        const stat = await fs.promises.lstat(name, options);
        if (path.resolve(name) !== path.resolve(dir)) return stat;
        return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, {
          isSymbolicLink: () => true,
        });
      },
    };
    review = integrity.createAuditIntegrityReview({ getLogDir: () => dir, io });
    expect(await review('2026-10-27')).toEqual({ status: 'unavailable' });
  });
  it('rejects replacement identities that collide when rounded as JavaScript numbers', async () => {
    writeChain([{ type: 'start' }]);
    let fileStats = 0;
    const identity = (stat, ino) =>
      Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { ino });
    const io = {
      ...fs.promises,
      lstat: async (name, options) => {
        const stat = await fs.promises.lstat(name, options);
        if (path.resolve(name) !== path.resolve(file)) return stat;
        return identity(stat, ++fileStats === 1 ? 9007199254740992n : 9007199254740993n);
      },
      open: async (...args) => {
        const handle = await fs.promises.open(...args);
        return {
          stat: async (...statArgs) => identity(await handle.stat(...statArgs), 9007199254740992n),
          read: (...readArgs) => handle.read(...readArgs),
          close: () => handle.close(),
        };
      },
    };
    review = integrity.createAuditIntegrityReview({ getLogDir: () => dir, io });
    expect(await review('2026-10-27')).toEqual({ status: 'unavailable' });
  });
  it('refuses concurrent checks until the original operation settles', async () => {
    writeChain([{ type: 'start' }]);
    let release;
    const wait = new Promise((resolve) => {
      release = resolve;
    });
    const io = {
      ...fs.promises,
      lstat: async (...args) => {
        await wait;
        return fs.promises.lstat(...args);
      },
    };
    review = integrity.createAuditIntegrityReview({ getLogDir: () => dir, io });
    const pending = review('2026-10-27');
    expect(await review('2026-10-27')).toEqual({ status: 'unavailable' });
    release();
    expect(await pending).toEqual({ status: 'consistent' });
  });
  it('returns at the deadline and keeps a stalled operation single-flight', async () => {
    vi.useFakeTimers();
    try {
      let release;
      const wait = new Promise((resolve) => {
        release = resolve;
      });
      const io = {
        ...fs.promises,
        lstat: async (...args) => {
          await wait;
          return fs.promises.lstat(...args);
        },
      };
      review = integrity.createAuditIntegrityReview({ getLogDir: () => dir, io });
      const pending = review('2026-10-27');
      await vi.advanceTimersByTimeAsync(2001);
      expect(await pending).toEqual({ status: 'unavailable' });
      expect(await review('2026-10-27')).toEqual({ status: 'unavailable' });
      release();
    } finally {
      vi.useRealTimers();
    }
  });
  it('requests nonblocking and no-follow flags where the platform supports them', async () => {
    writeChain([{ type: 'start' }]);
    const open = vi.fn((...args) => fs.promises.open(...args));
    review = integrity.createAuditIntegrityReview({
      getLogDir: () => dir,
      io: { ...fs.promises, open },
    });
    expect(await review('2026-10-27')).toEqual({ status: 'consistent' });
    const flags = open.mock.calls[0][1];
    if (fs.constants.O_NONBLOCK)
      expect(flags & fs.constants.O_NONBLOCK).toBe(fs.constants.O_NONBLOCK);
    if (fs.constants.O_NOFOLLOW)
      expect(flags & fs.constants.O_NOFOLLOW).toBe(fs.constants.O_NOFOLLOW);
  });
  it('returns only a fixed unavailable outcome on filesystem errors', async () => {
    const io = { ...fs.promises, lstat: vi.fn().mockRejectedValue(Error('private path')) };
    review = integrity.createAuditIntegrityReview({ getLogDir: () => dir, io });
    expect(await review('2026-10-27')).toEqual({ status: 'unavailable' });
  });
});
