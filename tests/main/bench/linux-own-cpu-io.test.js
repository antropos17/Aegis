import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, options, statText } from './linux-own-cpu-fixtures.js';
const require = createRequire(import.meta.url);
const proc = require('../../../bench/lib/linux-own-cpu-proc');
const storage = require('../../../bench/lib/linux-own-cpu-storage');
afterEach(cleanup);
describe('proc pseudofile and fresh artifact IO (CI only)', () => {
  it('allows regular st_size zero, loops real short reads and closes the actual descriptor', () => {
    const opts = options(),
      file = path.join(path.dirname(opts.out), 'owned-stat'),
      expected = statText();
    fs.writeFileSync(file, expected);
    const open = fs.openSync,
      read = fs.readSync,
      fstat = fs.fstatSync;
    let fd, flags;
    vi.spyOn(fs, 'openSync').mockImplementation((name, mode, ...args) => {
      if (name === '/proc/self/stat') {
        flags = mode;
        fd = open(file, mode, ...args);
        return fd;
      }
      return open(name, mode, ...args);
    });
    vi.spyOn(fs, 'fstatSync').mockImplementation((value, ...args) => {
      const stat = fstat(value, ...args);
      if (value === fd) stat.size = 0;
      return stat;
    });
    vi.spyOn(fs, 'readSync').mockImplementation((value, buffer, offset, length, position) =>
      read(value, buffer, offset, Math.min(7, length), position),
    );
    expect(proc.readSelfStat()).toEqual(expected);
    expect(flags).toBe(fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    expect(() => fstat(fd)).toThrow();
  });
  it.each(['growth', 'nonregular', 'close'])(
    'refuses pseudofile %s without leaking the owned descriptor',
    (mode) => {
      const opts = options(),
        file = path.join(path.dirname(opts.out), 'owned-stat');
      fs.writeFileSync(file, Buffer.alloc(mode === 'growth' ? 16385 : 32, 120));
      const open = fs.openSync,
        fstat = fs.fstatSync,
        close = fs.closeSync;
      let fd,
        active = false;
      vi.spyOn(fs, 'openSync').mockImplementation((name, ...args) => {
        if (name === '/proc/self/stat') {
          fd = open(file, ...args);
          active = true;
          return fd;
        }
        return open(name, ...args);
      });
      if (mode === 'nonregular')
        vi.spyOn(fs, 'fstatSync').mockImplementation((value, ...args) => {
          const stat = fstat(value, ...args);
          if (value === fd) stat.isFile = () => false;
          return stat;
        });
      vi.spyOn(fs, 'closeSync').mockImplementation((value) => {
        close(value);
        if (value === fd && active) {
          active = false;
          if (mode === 'close') throw Error('private-close-error');
        }
      });
      expect(() => proc.readSelfStat()).toThrow();
      expect(active).toBe(false);
      expect(() => fstat(fd)).toThrow();
    },
  );
  it('enforces fixed artifact caps before creation and completes real short writes', () => {
    const opts = options(),
      writer = storage.createStorage(opts.out),
      nativeOpen = fs.openSync,
      fstat = fs.fstatSync;
    let fd;
    const open = vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
      const value = nativeOpen(file, ...args);
      if (file === path.join(opts.out, 'cpu-reference-pending.json')) fd = value;
      return value;
    });
    expect(() => writer.write('cpu-reference-pending.json', { data: 'x'.repeat(4096) })).toThrow();
    expect(open).not.toHaveBeenCalled();
    const write = fs.writeSync;
    vi.spyOn(fs, 'writeSync').mockImplementation((fd, buffer, offset, length, position) =>
      write(fd, buffer, offset, Math.min(5, length), position),
    );
    writer.write('cpu-reference-pending.json', { state: 'pending' });
    let closeCode = null;
    try {
      fstat(fd);
    } catch (err) {
      closeCode = err.code;
    }
    expect(closeCode).toBe('EBADF');
    expect(JSON.parse(fs.readFileSync(path.join(opts.out, 'cpu-reference-pending.json')))).toEqual({
      state: 'pending',
    });
    expect(writer.files[0].closed).toBe(true);
  });
  it.each(['competitor', 'partial-write', 'uncertain-close'])(
    'preserves %s bytes without attesting or overwriting them',
    (mode) => {
      const opts = options(),
        writer = storage.createStorage(opts.out),
        target = path.join(opts.out, 'cpu-reference-pending.json');
      const open = fs.openSync,
        write = fs.writeSync,
        close = fs.closeSync,
        fstat = fs.fstatSync;
      let fd,
        active = false,
        fault = false;
      vi.spyOn(fs, 'openSync').mockImplementation((name, ...args) => {
        if (name === target && mode === 'competitor' && !fault) {
          fault = true;
          const other = open(name, 'wx');
          write(other, 'owned-competitor');
          close(other);
        }
        const value = open(name, ...args);
        if (name === target && !fault) {
          fd = value;
          active = true;
        }
        return value;
      });
      vi.spyOn(fs, 'writeSync').mockImplementation((value, buffer, offset, length, position) => {
        if (value === fd && active && mode === 'partial-write') {
          write(value, buffer, offset, 3, position);
          fault = true;
          throw Error('private-write-error');
        }
        return write(value, buffer, offset, length, position);
      });
      vi.spyOn(fs, 'closeSync').mockImplementation((value) => {
        close(value);
        if (value === fd && active) {
          active = false;
          if (mode === 'uncertain-close') {
            fault = true;
            throw Error('private-close-error');
          }
        }
      });
      expect(() => writer.write('cpu-reference-pending.json', { state: 'pending' })).toThrow();
      expect(fault).toBe(true);
      expect(writer.files).toEqual([]);
      if (mode !== 'competitor') {
        let closeCode = null;
        try {
          fstat(fd);
        } catch (err) {
          closeCode = err.code;
        }
        expect(closeCode).toBe('EBADF');
      }
      const retained = fs.readFileSync(target, 'utf8');
      if (mode === 'competitor') expect(retained).toBe('owned-competitor');
      else if (mode === 'partial-write') expect(retained.length).toBe(3);
      else expect(JSON.parse(retained)).toEqual({ state: 'pending' });
    },
  );
});
