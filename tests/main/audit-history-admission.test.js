import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require_ = createRequire(import.meta.url);
const loggerPath = require_.resolve('../../src/main/audit-logger.js');
const originalModule = require_.cache[loggerPath];
const index = require_('../../src/main/audit-index.js');
const failure = 'Audit history unavailable: the journal files could not be read.';
const unreadable = (read, expected = failure) => {
  let thrown;
  try {
    read();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect(thrown.message).toBe(expected);
  expect(thrown.cause).toBeUndefined();
};
const day = (value) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

describe('canonical audit history admission', () => {
  let audit;
  let root;
  let newer;
  let older;
  let expectedTimes;
  const before = () => new Date(Date.now() + 86400000).toISOString();

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-history-admission-'));
    delete require_.cache[loggerPath];
    audit = require_(loggerPath);
    const logDir = path.join(root, 'audit-logs');
    fs.mkdirSync(logDir);
    const now = Date.now();
    newer = path.join(logDir, `aegis-audit-${day(new Date(now))}.json`);
    older = path.join(logDir, `aegis-audit-${day(new Date(now - 86400000))}.json`);
    expectedTimes = [
      new Date(now - 86400000 - 1000).toISOString(),
      new Date(now - 1000).toISOString(),
    ];
    for (const [file, timestamp] of [
      [older, expectedTimes[0]],
      [newer, expectedTimes[1]],
    ])
      fs.writeFileSync(
        file,
        JSON.stringify({ timestamp, type: 'file-access', agent: 'fixture' }) + '\n',
      );
    audit.init({ userDataPath: root, loadSqlite: () => null });
    await audit._awaitIndexForTest();
    expect(index.isReady()).toBe(false);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await audit._awaitIndexForTest();
    audit.shutdown();
    delete require_.cache[loggerPath];
    if (originalModule) require_.cache[loggerPath] = originalModule;
    expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(root)).toMatch(/^aegis-history-admission-/);
    expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it('discards newer rows when an older file fails, reports a path-free error and recovers unchanged', () => {
    const originalBytes = [fs.readFileSync(older), fs.readFileSync(newer)];
    const open = fs.openSync;
    const opened = [];
    const spy = vi.spyOn(fs, 'openSync').mockImplementation((...args) => {
      opened.push(String(args[0]));
      if (String(args[0]) === older) throw new Error(`PRIVATE_PATH_SENTINEL ${older}`);
      return open(...args);
    });
    unreadable(() => audit.getEntriesBefore(before(), 100));
    expect(opened).toEqual([newer, older]);
    spy.mockRestore();
    expect(audit.getEntriesBefore(before(), 100).map((row) => row.timestamp)).toEqual(
      expectedTimes,
    );
    expect([fs.readFileSync(older), fs.readFileSync(newer)]).toEqual(originalBytes);
  });

  it('discards the page and closes the older descriptor when a requested chunk returns zero', () => {
    const open = fs.openSync;
    const read = fs.readSync;
    const close = fs.closeSync;
    let olderFd;
    let olderActive = false;
    let olderCloseCount = 0;
    vi.spyOn(fs, 'openSync').mockImplementation((...args) => {
      const fd = open(...args);
      if (String(args[0]) === older) {
        olderFd = fd;
        olderActive = true;
      }
      return fd;
    });
    vi.spyOn(fs, 'readSync').mockImplementation((...args) =>
      olderActive && args[0] === olderFd ? 0 : read(...args),
    );
    vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
      if (olderActive && fd === olderFd) {
        olderCloseCount++;
        olderActive = false;
      }
      return close(fd);
    });
    unreadable(() => audit.getEntriesBefore(before(), 100));
    expect(olderCloseCount).toBe(1);
    expect(olderActive).toBe(false);
    vi.restoreAllMocks();
    expect(audit.getEntriesBefore(before(), 100).map((row) => row.timestamp)).toEqual(
      expectedTimes,
    );
  });

  it('fills positive short reads with advancing offsets and preserves the complete rows', () => {
    const open = fs.openSync;
    const read = fs.readSync;
    const close = fs.closeSync;
    const calls = [];
    const files = new Map();
    const closed = [];
    vi.spyOn(fs, 'openSync').mockImplementation((...args) => {
      const fd = open(...args);
      files.set(fd, String(args[0]));
      return fd;
    });
    vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
      closed.push(files.get(fd));
      return close(fd);
    });
    const spy = vi
      .spyOn(fs, 'readSync')
      .mockImplementation((fd, buffer, offset, length, position) => {
        const bytes = read(fd, buffer, offset, Math.min(length, 7), position);
        calls.push({ offset, position, bytes });
        return bytes;
      });
    expect(audit.getEntriesBefore(before(), 100).map((row) => row.timestamp)).toEqual(
      expectedTimes,
    );
    expect(calls.length).toBeGreaterThan(2);
    expect(closed).toEqual([newer, older]);
    for (let i = 1; i < calls.length; i++) {
      if (calls[i].offset === 0) continue;
      expect(calls[i].offset).toBe(calls[i - 1].offset + calls[i - 1].bytes);
      expect(calls[i].position).toBe(calls[i - 1].position + calls[i - 1].bytes);
    }
    spy.mockRestore();
  });

  it('stops at the page cap without opening an unnecessary older file', () => {
    fs.writeFileSync(newer, 'x'.repeat(12000) + '\n' + fs.readFileSync(newer, 'utf8'));
    const open = fs.openSync;
    const reads = vi.spyOn(fs, 'readSync');
    const spy = vi.spyOn(fs, 'openSync').mockImplementation((...args) => {
      if (String(args[0]) === older) throw new Error('Older file must remain unopened');
      return open(...args);
    });
    expect(audit.getEntriesBefore(before(), 1).map((row) => row.timestamp)).toEqual([
      expectedTimes[1],
    ]);
    expect(spy.mock.calls.map((args) => String(args[0]))).toEqual([newer]);
    expect(reads).toHaveBeenCalledOnce();
  });

  it('qualifies complete storage measurements separately from counters and recovers after stat failure', () => {
    const healthy = audit.getStats();
    expect(healthy.storageReadState).toBe('ready');
    const readDir = fs.readdirSync;
    const stat = fs.statSync;
    vi.spyOn(fs, 'readdirSync').mockImplementation((...args) =>
      String(args[0]) === audit.getLogDir()
        ? [path.basename(newer), path.basename(older)]
        : readDir(...args),
    );
    vi.spyOn(fs, 'statSync').mockImplementation((...args) => {
      if (String(args[0]) === older) throw new Error(`PRIVATE_PATH_SENTINEL ${older}`);
      return stat(...args);
    });
    const failed = audit.getStats();
    expect(failed.storageReadState).toBe('unavailable');
    expect(failed.persistedEntries).toBe(healthy.persistedEntries);
    expect(JSON.stringify(failed)).not.toContain('PRIVATE_PATH_SENTINEL');
    vi.restoreAllMocks();
    expect(audit.getStats()).toEqual(healthy);
  });

  it('rejects valid history requests before initialization while preserving input validation', () => {
    audit.shutdown();
    delete require_.cache[loggerPath];
    audit = require_(loggerPath);
    expect(audit.getStats().storageReadState).toBe('uninitialized');
    unreadable(
      () => audit.getEntriesBefore(before()),
      'Audit history unavailable: the journal is not initialized.',
    );
    expect(audit.getEntriesBefore('invalid')).toEqual([]);
    expect(() => audit.getEntriesBefore(before(), 100, undefined, -1)).toThrow('boundary');
  });

  it('reports directory failures without source paths and recovers the same history', () => {
    const readDir = fs.readdirSync;
    vi.spyOn(fs, 'readdirSync').mockImplementation((...args) => {
      if (String(args[0]) === audit.getLogDir()) throw new Error(`PRIVATE_PATH_SENTINEL ${root}`);
      return readDir(...args);
    });
    unreadable(() => audit.getEntriesBefore(before()));
    expect(audit.getStats().storageReadState).toBe('unavailable');
    vi.restoreAllMocks();
    expect(audit.getEntriesBefore(before()).map((row) => row.timestamp)).toEqual(expectedTimes);
  });

  it('distinguishes a successful empty canonical read from unavailable storage', () => {
    fs.unlinkSync(newer);
    fs.unlinkSync(older);
    expect(audit.getEntriesBefore(before())).toEqual([]);
    expect(audit.getStats()).toMatchObject({
      storageReadState: 'ready',
      totalSize: 0,
      currentSize: 0,
    });
  });
});
