import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const storage = require('../../../bench/lib/resource-supervisor-storage');
afterEach(() => vi.restoreAllMocks());
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
describe('supervisor bounded disk-source inventory (CI only)', () => {
  it('opens every fixed source read-only with NOFOLLOW where supported and observes actual descriptor closure', () => {
    const open = fs.openSync,
      close = fs.closeSync,
      fstat = fs.fstatSync;
    const records = [],
      active = new Map();
    let tracking = true;
    vi.spyOn(fs, 'openSync').mockImplementation((file, flags, ...args) => {
      const fd = open(file, flags, ...args);
      if (tracking) {
        const record = { file, flags, fd, closed: false, nativeError: null };
        records.push(record);
        active.set(fd, record);
      }
      return fd;
    });
    vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
      close(fd);
      const record = active.get(fd);
      if (record) {
        record.closed = true;
        try {
          fstat(fd);
        } catch (err) {
          record.nativeError = err.code;
        }
        active.delete(fd);
      }
    });
    const inventory = storage.inventory();
    tracking = false;
    expect(records.map((r) => r.file)).toEqual(
      storage.SOURCES.map((file) => path.join(storage.ROOT, file)),
    );
    for (const record of records)
      expect(record).toMatchObject({
        flags: fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
        closed: true,
        nativeError: 'EBADF',
      });
    expect(active.size).toBe(0);
    const bytes = fs.readFileSync(path.join(storage.ROOT, storage.SOURCES[0]));
    expect(inventory.files[0]).toEqual({
      file: storage.SOURCES[0],
      sha256: sha(bytes),
      byteLength: bytes.length,
    });
  });
  it.each([
    'named-to-descriptor',
    'post-read-drift',
    'size-mismatch',
    'growth-sentinel',
    'close-uncertainty',
  ])('refuses %s and closes the actual owned source descriptor', (mode) => {
    const target = path.join(storage.ROOT, storage.SOURCES[0]);
    const open = fs.openSync,
      fstat = fs.fstatSync,
      read = fs.readSync,
      close = fs.closeSync;
    const originalSize = Number(fs.lstatSync(target, { bigint: true }).size);
    let targetFd,
      active = false,
      statCalls = 0,
      readCalls = 0,
      bytesReturned = 0,
      closed = false,
      closeFault = false;
    const requests = [];
    vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
      const fd = open(file, ...args);
      if (file === target) {
        targetFd = fd;
        active = true;
      }
      return fd;
    });
    vi.spyOn(fs, 'fstatSync').mockImplementation((fd, ...args) => {
      const stat = fstat(fd, ...args);
      if (fd === targetFd && active) {
        statCalls++;
        if (mode === 'named-to-descriptor' && statCalls === 1) stat.ino += 1n;
        if (mode === 'post-read-drift' && statCalls === 2) stat.mtimeNs += 1n;
      }
      return stat;
    });
    vi.spyOn(fs, 'readSync').mockImplementation((fd, buffer, offset, length, position) => {
      if (fd !== targetFd || !active) return read(fd, buffer, offset, length, position);
      readCalls++;
      requests.push(length);
      if (mode === 'size-mismatch') {
        if (readCalls > 1) return 0;
        const count = read(fd, buffer, offset, Math.min(length, originalSize - 1), position);
        bytesReturned += count;
        return count;
      }
      if (mode === 'growth-sentinel') {
        buffer.fill(120, offset, offset + length);
        bytesReturned += length;
        return length;
      }
      const count = read(fd, buffer, offset, length, position);
      bytesReturned += count;
      return count;
    });
    vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
      close(fd);
      if (fd === targetFd && active) {
        active = false;
        closed = true;
        if (mode === 'close-uncertainty') {
          closeFault = true;
          throw Error('private-close-uncertainty');
        }
      }
    });
    expect(() => storage.inventory()).toThrow();
    expect(closed).toBe(true);
    expect(active).toBe(false);
    expect(() => fstat(targetFd)).toThrow();
    if (mode === 'named-to-descriptor') {
      expect(statCalls).toBe(1);
      expect(readCalls).toBe(0);
    }
    if (mode === 'post-read-drift') {
      expect(statCalls).toBe(2);
      expect(bytesReturned).toBe(originalSize);
    }
    if (mode === 'size-mismatch') expect(bytesReturned).toBe(originalSize - 1);
    if (mode === 'growth-sentinel') {
      expect(requests).toEqual([65537]);
      expect(bytesReturned).toBe(65537);
    }
    if (mode === 'close-uncertainty') expect(closeFault).toBe(true);
  });
});
