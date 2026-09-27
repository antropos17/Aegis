import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const reports = require('../../src/main/private-report-temp.js');
const ownedName = (kind, hex) => `aegis-${kind}-${hex.repeat(32)}.html`;
let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-report-temp-test-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  fs.rmSync(root, { recursive: true, force: true });
});

describe('private report temp storage', () => {
  it('writes unique, exclusive files and does not replace an existing report', () => {
    const directory = reports.reportDirectory(root, true);
    const collision = path.join(directory, ownedName('report', 'a'));
    fs.writeFileSync(collision, 'keep this file');
    vi.spyOn(crypto, 'randomBytes')
      .mockReturnValueOnce(Buffer.alloc(16, 0xaa))
      .mockReturnValueOnce(Buffer.alloc(16, 0xbb));
    const written = reports.writePrivateReport(root, 'report', 'PRIVATE PATH');
    expect(path.basename(written)).toBe(ownedName('report', 'b'));
    expect(fs.readFileSync(collision, 'utf8')).toBe('keep this file');
    expect(fs.readFileSync(written, 'utf8')).toBe('PRIVATE PATH');
    expect(path.dirname(written)).toBe(directory);
    if (process.platform !== 'win32') {
      expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
      expect(fs.statSync(written).mode & 0o777).toBe(0o600);
    }
  });

  it('prunes age and excess logical bytes while preserving recent and foreign files', () => {
    const directory = reports.reportDirectory(root, true);
    const now = Date.now();
    const aged = path.join(directory, ownedName('report', '1'));
    const oldest = path.join(directory, ownedName('report', '2'));
    const recent = path.join(directory, ownedName('threat-report', '3'));
    const foreign = path.join(directory, 'someone-else.html');
    const expired = path.join(directory, ownedName('report', '4'));
    for (const target of [aged, oldest, recent, foreign, expired])
      fs.writeFileSync(target, 'PRIVATE');
    fs.truncateSync(aged, 40 * 1024 * 1024);
    fs.truncateSync(oldest, 40 * 1024 * 1024);
    fs.utimesSync(
      aged,
      new Date(now - 2 * reports.MIN_AGE_MS),
      new Date(now - 2 * reports.MIN_AGE_MS),
    );
    fs.utimesSync(
      oldest,
      new Date(now - 3 * reports.MIN_AGE_MS),
      new Date(now - 3 * reports.MIN_AGE_MS),
    );
    fs.utimesSync(
      expired,
      new Date(now - reports.MAX_AGE_MS - 1000),
      new Date(now - reports.MAX_AGE_MS - 1000),
    );
    const result = reports.prunePrivateReports(root, now);
    expect(result.removed).toBe(2);
    expect(result.bytes).toBeLessThanOrEqual(reports.MAX_TOTAL_BYTES);
    expect(fs.existsSync(oldest)).toBe(false);
    expect(fs.existsSync(expired)).toBe(false);
    expect(fs.existsSync(aged)).toBe(true);
    expect(fs.existsSync(recent)).toBe(true);
    expect(fs.existsSync(foreign)).toBe(true);
  });

  it('leaves matching symlinks and files that are locked during deletion', () => {
    const directory = reports.reportDirectory(root, true);
    const now = Date.now();
    const locked = path.join(directory, ownedName('report', '5'));
    const outside = path.join(root, 'outside.html');
    const link = path.join(directory, ownedName('report', '6'));
    fs.writeFileSync(locked, 'PRIVATE');
    fs.writeFileSync(outside, 'foreign');
    fs.utimesSync(
      locked,
      new Date(now - reports.MAX_AGE_MS - 1000),
      new Date(now - reports.MAX_AGE_MS - 1000),
    );
    try {
      fs.symlinkSync(outside, link, 'file');
    } catch (error) {
      if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    }
    const unlink = fs.unlinkSync;
    vi.spyOn(fs, 'unlinkSync').mockImplementation((target) => {
      if (target === locked) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      return unlink(target);
    });
    const result = reports.prunePrivateReports(root, now);
    expect(result.removed).toBe(0);
    expect(fs.readFileSync(locked, 'utf8')).toBe('PRIVATE');
    expect(fs.readFileSync(outside, 'utf8')).toBe('foreign');
    if (fs.existsSync(link)) expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it('bounds each sweep when the report directory is flooded and keeps writes independent', () => {
    const directory = reports.reportDirectory(root, true);
    for (let index = 0; index < 600; index++)
      fs.writeFileSync(path.join(directory, `foreign-${index}.txt`), '');
    const result = reports.prunePrivateReports(root);
    expect(result.scanned).toBe(512);
    expect(result.truncated).toBe(true);

    const old = path.join(directory, ownedName('report', '9'));
    fs.writeFileSync(old, 'PRIVATE');
    fs.utimesSync(old, new Date(0), new Date(0));
    const written = reports.writePrivateReport(root, 'report', 'NEW PRIVATE');
    expect(fs.readFileSync(written, 'utf8')).toBe('NEW PRIVATE');
    expect(fs.existsSync(old)).toBe(true);
  });

  it('continues past 512 foreign entries without deleting a report needed by a viewer', async () => {
    vi.useFakeTimers();
    const directory = reports.reportDirectory(root, true);
    const now = Date.now();
    const expired = path.join(directory, ownedName('report', 'a'));
    const recent = path.join(directory, ownedName('report', 'b'));
    fs.writeFileSync(expired, 'OLD PRIVATE');
    fs.writeFileSync(recent, 'NEW PRIVATE');
    fs.utimesSync(
      expired,
      new Date(now - reports.MAX_AGE_MS - 1000),
      new Date(now - reports.MAX_AGE_MS - 1000),
    );

    const names = [
      ...Array.from({ length: 512 }, (_, index) => `foreign-${index}.txt`),
      path.basename(expired),
      path.basename(recent),
    ];
    let reads = 0;
    let closes = 0;
    let opens = 0;
    vi.spyOn(fs, 'opendirSync').mockImplementation(() => {
      opens++;
      let index = 0;
      return {
        readSync() {
          reads++;
          const name = names[index++];
          return name ? { name, isFile: () => true, isSymbolicLink: () => false } : null;
        },
        closeSync() {
          closes++;
        },
      };
    });

    const modulePath = require.resolve('../../src/main/private-report-temp.js');
    const cached = require.cache[modulePath];
    delete require.cache[modulePath];
    try {
      const isolated = require(modulePath);
      const onError = vi.fn();
      isolated.startPrivateReportRetention(() => root, onError);
      const firstBatchReads = reads;
      expect(fs.existsSync(expired)).toBe(true);

      await vi.advanceTimersByTimeAsync(10);
      expect(fs.existsSync(expired)).toBe(false);
      expect(fs.existsSync(recent)).toBe(true);
      expect(firstBatchReads).toBe(512);
      expect(reads).toBe(2 * (names.length + 1));
      expect(opens).toBe(2);
      expect(closes).toBe(2);
      expect(onError).not.toHaveBeenCalled();
    } finally {
      delete require.cache[modulePath];
      require.cache[modulePath] = cached;
    }
  });

  it('finishes eligible files left by the delete cap before reading the next page', async () => {
    vi.useFakeTimers();
    const directory = reports.reportDirectory(root, true);
    const expired = Array.from({ length: 130 }, (_, index) =>
      path.join(directory, `aegis-report-${index.toString(16).padStart(32, '0')}.html`),
    );
    for (const target of expired) {
      fs.writeFileSync(target, 'OLD PRIVATE');
      fs.utimesSync(target, new Date(0), new Date(0));
    }
    const names = [
      ...expired.slice(0, 129).map((target) => path.basename(target)),
      ...Array.from({ length: 383 }, (_, index) => `foreign-${index}.txt`),
      path.basename(expired[129]),
    ];
    let reads = 0;
    let closes = 0;
    let deletesSinceYield = 0;
    let maxDeletes = 0;
    const schedule = globalThis.setImmediate;
    vi.spyOn(globalThis, 'setImmediate').mockImplementation((callback, ...args) => {
      maxDeletes = Math.max(maxDeletes, deletesSinceYield);
      deletesSinceYield = 0;
      return schedule(callback, ...args);
    });
    const unlink = fs.unlinkSync;
    vi.spyOn(fs, 'unlinkSync').mockImplementation((target) => {
      unlink(target);
      deletesSinceYield++;
    });
    vi.spyOn(fs, 'opendirSync').mockImplementation(() => {
      let index = 0;
      return {
        readSync() {
          reads++;
          const name = names[index++];
          return name ? { name, isFile: () => true, isSymbolicLink: () => false } : null;
        },
        closeSync() {
          closes++;
        },
      };
    });

    const modulePath = require.resolve('../../src/main/private-report-temp.js');
    const cached = require.cache[modulePath];
    delete require.cache[modulePath];
    try {
      const isolated = require(modulePath);
      const onError = vi.fn();
      isolated.startPrivateReportRetention(() => root, onError);
      expect(reads).toBe(512);
      expect(expired.filter((target) => fs.existsSync(target))).toHaveLength(130);

      await vi.advanceTimersByTimeAsync(10);
      expect(expired.filter((target) => fs.existsSync(target))).toEqual([]);
      expect(reads).toBe(2 * (names.length + 1));
      expect(closes).toBe(2);
      expect(Math.max(maxDeletes, deletesSinceYield)).toBeLessThanOrEqual(128);
      expect(onError).not.toHaveBeenCalled();
    } finally {
      delete require.cache[modulePath];
      require.cache[modulePath] = cached;
    }
  });

  it('uses the full directory size before pruning older reports across batches', async () => {
    vi.useFakeTimers();
    const directory = reports.reportDirectory(root, true);
    const now = Date.now();
    const old = Array.from({ length: 8 }, (_, index) =>
      path.join(directory, `aegis-report-${(index + 1).toString(16).padStart(32, '0')}.html`),
    );
    for (const target of old) {
      fs.writeFileSync(target, '');
      fs.truncateSync(target, 8 * 1024 * 1024);
      fs.utimesSync(
        target,
        new Date(now - 2 * reports.MIN_AGE_MS),
        new Date(now - 2 * reports.MIN_AGE_MS),
      );
    }
    const recent = path.join(directory, ownedName('threat-report', '9'));
    fs.writeFileSync(recent, 'x');
    const names = [
      ...old.map((target) => path.basename(target)),
      ...Array.from({ length: 504 }, (_, index) => `foreign-${index}.txt`),
      path.basename(recent),
    ];
    let reads = 0;
    let opens = 0;
    let closes = 0;
    let readsSinceYield = 0;
    let maxReads = 0;
    const schedule = globalThis.setImmediate;
    vi.spyOn(globalThis, 'setImmediate').mockImplementation((callback, ...args) => {
      maxReads = Math.max(maxReads, readsSinceYield);
      readsSinceYield = 0;
      return schedule(callback, ...args);
    });
    vi.spyOn(fs, 'opendirSync').mockImplementation(() => {
      opens++;
      let index = 0;
      return {
        readSync() {
          reads++;
          readsSinceYield++;
          const name = names[index++];
          return name ? { name, isFile: () => true, isSymbolicLink: () => false } : null;
        },
        closeSync() {
          closes++;
        },
      };
    });

    const modulePath = require.resolve('../../src/main/private-report-temp.js');
    const cached = require.cache[modulePath];
    delete require.cache[modulePath];
    try {
      const isolated = require(modulePath);
      const onError = vi.fn();
      isolated.startPrivateReportRetention(() => root, onError);
      expect(reads).toBe(512);

      await vi.advanceTimersByTimeAsync(10);
      expect(old.filter((target) => fs.existsSync(target))).toHaveLength(7);
      expect(fs.existsSync(recent)).toBe(true);
      expect(Math.max(maxReads, readsSinceYield)).toBeLessThanOrEqual(512);
      expect(opens).toBe(closes);
      expect(onError).not.toHaveBeenCalled();
    } finally {
      delete require.cache[modulePath];
      require.cache[modulePath] = cached;
    }
  });

  it('stops and closes a pending sweep when its report directory changes', async () => {
    vi.useFakeTimers();
    const directory = reports.reportDirectory(root, true);
    const expired = path.join(directory, ownedName('report', 'c'));
    fs.writeFileSync(expired, 'OLD PRIVATE');
    fs.utimesSync(expired, new Date(0), new Date(0));

    const names = [
      ...Array.from({ length: 512 }, (_, index) => `foreign-${index}.txt`),
      path.basename(expired),
    ];
    let reads = 0;
    let closes = 0;
    vi.spyOn(fs, 'opendirSync').mockImplementation(() => {
      let index = 0;
      return {
        readSync() {
          reads++;
          const name = names[index++];
          return name ? { name, isFile: () => true, isSymbolicLink: () => false } : null;
        },
        closeSync() {
          closes++;
        },
      };
    });
    const lstat = fs.lstatSync;
    let changed = false;
    vi.spyOn(fs, 'lstatSync').mockImplementation((target, ...args) => {
      const stat = lstat(target, ...args);
      if (target === directory && changed) stat.ino = stat.ino === 0 ? 1 : 0;
      return stat;
    });

    const modulePath = require.resolve('../../src/main/private-report-temp.js');
    const cached = require.cache[modulePath];
    delete require.cache[modulePath];
    try {
      const isolated = require(modulePath);
      const onError = vi.fn();
      isolated.startPrivateReportRetention(() => root, onError);
      expect(reads).toBe(512);
      changed = true;

      await vi.advanceTimersByTimeAsync(1);
      expect(reads).toBe(512);
      expect(fs.existsSync(expired)).toBe(true);
      expect(closes).toBe(1);
      expect(onError).toHaveBeenCalledTimes(1);
    } finally {
      delete require.cache[modulePath];
      require.cache[modulePath] = cached;
    }
  });

  it('does not reopen a replaced report directory between count and prune passes', async () => {
    vi.useFakeTimers();
    const directory = reports.reportDirectory(root, true);
    const expired = path.join(directory, ownedName('report', 'd'));
    fs.writeFileSync(expired, 'OLD PRIVATE');
    fs.utimesSync(expired, new Date(0), new Date(0));
    let opens = 0;
    let closes = 0;
    vi.spyOn(fs, 'opendirSync').mockImplementation(() => {
      opens++;
      let read = false;
      return {
        readSync() {
          if (read) return null;
          read = true;
          return { name: path.basename(expired), isFile: () => true, isSymbolicLink: () => false };
        },
        closeSync() {
          closes++;
        },
      };
    });
    const lstat = fs.lstatSync;
    let changed = false;
    vi.spyOn(fs, 'lstatSync').mockImplementation((target, ...args) => {
      const stat = lstat(target, ...args);
      if (target === directory && changed) stat.ino = stat.ino === 0 ? 1 : 0;
      return stat;
    });

    const modulePath = require.resolve('../../src/main/private-report-temp.js');
    const cached = require.cache[modulePath];
    delete require.cache[modulePath];
    try {
      const isolated = require(modulePath);
      const onError = vi.fn();
      isolated.startPrivateReportRetention(() => root, onError);
      expect(opens).toBe(1);
      expect(closes).toBe(1);
      changed = true;

      await vi.advanceTimersByTimeAsync(1);
      expect(opens).toBe(1);
      expect(closes).toBe(1);
      expect(fs.existsSync(expired)).toBe(true);
      expect(onError).toHaveBeenCalledTimes(1);
    } finally {
      delete require.cache[modulePath];
      require.cache[modulePath] = cached;
    }
  });

  it('rejects a linked report directory and leaves its target untouched', () => {
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    const directory = path.join(root, 'aegis-private-reports-v1');
    fs.symlinkSync(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => reports.writePrivateReport(root, 'report', 'PRIVATE')).toThrow(
      'Private report directory unavailable',
    );
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('sweeps expired reports at startup and again while the app stays open', async () => {
    vi.useFakeTimers();
    const directory = reports.reportDirectory(root, true);
    const now = Date.now();
    const old = path.join(directory, ownedName('report', '7'));
    fs.writeFileSync(old, 'PRIVATE');
    fs.utimesSync(
      old,
      new Date(now - reports.MAX_AGE_MS - 1000),
      new Date(now - reports.MAX_AGE_MS - 1000),
    );
    reports.startPrivateReportRetention(() => root);
    await vi.advanceTimersByTimeAsync(10);
    expect(fs.existsSync(old)).toBe(false);

    const later = path.join(directory, ownedName('report', '8'));
    fs.writeFileSync(later, 'PRIVATE');
    fs.utimesSync(
      later,
      new Date(now - reports.MAX_AGE_MS - 1000),
      new Date(now - reports.MAX_AGE_MS - 1000),
    );
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 + 10);
    expect(fs.existsSync(later)).toBe(false);
    vi.useRealTimers();
  });
});
