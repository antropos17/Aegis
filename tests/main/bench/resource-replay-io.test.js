import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const io = require('../../../bench/lib/resource-replay-io');
const directories = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) {
    if (
      path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) ||
      !path.basename(dir).startsWith('resource-replay-io-') ||
      fs.lstatSync(dir).isSymbolicLink()
    )
      throw Error('unsafe-fixture-cleanup');
    fs.rmSync(dir, { recursive: true });
  }
});
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-replay-io-'));
  directories.push(dir);
  const file = path.join(dir, 'artifact');
  fs.writeFileSync(file, 'owned bytes');
  return { dir, file };
}
describe('replay fixed artifact IO (CI only)', () => {
  it('loops real short reads through EOF with exact bytes, digest and budget', () => {
    const f = fixture(),
      expected = fs.readFileSync(f.file),
      read = fs.readSync,
      budget = { bytes: 0 };
    const calls = vi
      .spyOn(fs, 'readSync')
      .mockImplementation((fd, buffer, offset, length, position) =>
        read(fd, buffer, offset, Math.min(5, length), position),
      );
    const actual = io.read(f.file, 131073, budget);
    expect(actual).toEqual(expected);
    expect(io.hash(actual)).toBe(createHash('sha256').update(expected).digest('hex'));
    expect(budget.bytes).toBe(expected.length);
    expect(calls.mock.calls.length).toBeGreaterThan(2);
  });
  it('loops real short writes until the entire bounded report is parseable and exact', () => {
    const f = fixture(),
      out = path.join(f.dir, 'out'),
      write = fs.writeSync;
    const report = { version: 'safe-fixture', nested: { values: [1, 2, 3], complete: false } };
    const calls = vi
      .spyOn(fs, 'writeSync')
      .mockImplementation((fd, buffer, offset, length, position) =>
        write(fd, buffer, offset, Math.min(7, length), position),
      );
    io.publish(out, report);
    const bytes = fs.readFileSync(path.join(out, 'resource-replay.json'));
    expect(JSON.parse(bytes.toString('utf8'))).toEqual(report);
    expect(bytes).toEqual(Buffer.from(JSON.stringify(report, null, 2) + '\n'));
    expect(calls.mock.calls.length).toBeGreaterThan(2);
  });
  it('accepts exact real raw/derived caps, accounts bytes and observes readonly descriptor closure', () => {
    const f = fixture(),
      open = fs.openSync,
      close = fs.closeSync,
      fstat = fs.fstatSync;
    const records = [];
    vi.spyOn(fs, 'openSync').mockImplementation((file, flags, ...args) => {
      const fd = open(file, flags, ...args);
      if (file === f.file && typeof flags === 'number') records.push({ fd, flags });
      return fd;
    });
    vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
      close(fd);
    });
    for (const cap of [131073, 524289]) {
      fs.writeFileSync(f.file, Buffer.alloc(cap, 120));
      const budget = { bytes: 0 };
      expect(io.read(f.file, cap, budget).length).toBe(cap);
      expect(budget.bytes).toBe(cap);
      const record = records.at(-1);
      expect(record.flags).toBe(fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      expect(() => fstat(record.fd)).toThrow();
    }
    fs.writeFileSync(f.file, Buffer.alloc(131074));
    expect(() => io.read(f.file, 131073, { bytes: 0 })).toThrow();
    fs.writeFileSync(f.file, 'bytes');
    expect(() => io.read(f.file, 131073, { bytes: 1048575 })).toThrow();
  });
  it.each(['named-fd', 'post-fd', 'post-named', 'growth', 'short-eof', 'close'])(
    'refuses isolated %s changes and closes its actual descriptor',
    (mode) => {
      const f = fixture(),
        open = fs.openSync,
        read = fs.readSync,
        lstat = fs.lstatSync,
        fstat = fs.fstatSync,
        close = fs.closeSync;
      let fd,
        active = false,
        statCalls = 0,
        namedCalls = 0,
        reads = 0,
        closed = false;
      vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
        const value = open(file, ...args);
        if (file === f.file) {
          fd = value;
          active = true;
        }
        return value;
      });
      vi.spyOn(fs, 'lstatSync').mockImplementation((file, ...args) => {
        const stat = lstat(file, ...args);
        if (file === f.file && ++namedCalls === 2 && mode === 'post-named') stat.ino += 1n;
        return stat;
      });
      vi.spyOn(fs, 'fstatSync').mockImplementation((value, ...args) => {
        const stat = fstat(value, ...args);
        if (value === fd && active) {
          statCalls++;
          if ((mode === 'named-fd' && statCalls === 1) || (mode === 'post-fd' && statCalls === 2))
            stat.ino += 1n;
        }
        return stat;
      });
      vi.spyOn(fs, 'readSync').mockImplementation((value, buffer, offset, length, position) => {
        if (value === fd && active) {
          reads++;
          if (mode === 'growth') {
            buffer.fill(120);
            return length;
          }
          if (mode === 'short-eof' && reads > 1) return 0;
          if (mode === 'short-eof') return read(value, buffer, offset, 1, position);
        }
        return read(value, buffer, offset, length, position);
      });
      vi.spyOn(fs, 'closeSync').mockImplementation((value) => {
        close(value);
        if (value === fd && active) {
          active = false;
          closed = true;
          if (mode === 'close') throw Error('private-close-error');
        }
      });
      expect(() => io.read(f.file, 32, { bytes: 0 })).toThrow();
      expect(closed).toBe(true);
      expect(() => fstat(fd)).toThrow();
      if (mode === 'named-fd') expect(reads).toBe(0);
      if (mode === 'post-fd') expect(statCalls).toBe(2);
      if (mode === 'post-named') expect(namedCalls).toBe(2);
    },
  );
  it('distinguishes only missing fixed filenames and rejects linked artifacts or directories', () => {
    const f = fixture();
    expect(io.read(path.join(f.dir, 'absent'), 32, { bytes: 0 }, true)).toBe(null);
    const linked = path.join(f.dir, 'hardlink');
    fs.linkSync(f.file, linked);
    expect(() => io.read(f.file, 32, { bytes: 0 }, true)).toThrow();
    expect(() => io.read(f.dir, 32, { bytes: 0 }, true)).toThrow();
  });
  it.each(['race', 'partial-write', 'uncertain-close'])(
    'preserves %s report evidence without claiming publication success',
    (mode) => {
      const f = fixture(),
        out = path.join(f.dir, 'out'),
        target = path.join(out, 'resource-replay.json');
      const open = fs.openSync,
        write = fs.writeSync,
        close = fs.closeSync;
      let fd,
        active = false,
        fault = false;
      vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
        if (mode === 'race' && file === target && !fault) {
          fault = true;
          const competing = open(file, 'wx');
          write(competing, 'owned-competitor');
          close(competing);
        }
        const value = open(file, ...args);
        if (file === target && !fault) {
          fd = value;
          active = true;
        }
        return value;
      });
      vi.spyOn(fs, 'writeSync').mockImplementation((value, buffer, offset, length, position) => {
        if (mode === 'partial-write' && value === fd && active && !fault) {
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
      expect(() => io.publish(out, { state: 'safe' })).toThrow();
      expect(fault).toBe(true);
      const retained = fs.readFileSync(target, 'utf8');
      if (mode === 'race') expect(retained).toBe('owned-competitor');
      else if (mode === 'partial-write') expect(retained.length).toBe(3);
      else expect(JSON.parse(retained)).toEqual({ state: 'safe' });
    },
  );
});
