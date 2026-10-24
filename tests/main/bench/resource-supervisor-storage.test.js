import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const storage = require('../../../bench/lib/resource-supervisor-storage');
const directories = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) {
    if (
      path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) ||
      !path.basename(dir).startsWith('resource-supervisor-storage-') ||
      fs.lstatSync(dir).isSymbolicLink()
    )
      throw Error('unsafe-fixture-cleanup');
    fs.rmSync(dir, { recursive: true });
  }
});
function writerFixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-supervisor-storage-'));
  directories.push(parent);
  const out = path.join(parent, 'outer');
  return { out, writer: storage.createStorage(out) };
}
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
describe('supervisor fixed parent storage (CI only)', () => {
  it('bounds fixed parent artifacts before creation and loops real short descriptor writes', () => {
    const { out, writer } = writerFixture(),
      open = vi.spyOn(fs, 'openSync');
    expect(() => writer.write('supervision-pending.json', { text: 'x'.repeat(4096) })).toThrow(
      'resource-supervisor-storage-unavailable',
    );
    expect(open).not.toHaveBeenCalled();
    const write = fs.writeSync;
    vi.spyOn(fs, 'writeSync').mockImplementation((fd, bytes, offset, length, position) =>
      write(fd, bytes, offset, Math.min(7, length), position),
    );
    const record = writer.write('supervision-pending.json', { state: 'pending' });
    const bytes = fs.readFileSync(path.join(out, 'supervision-pending.json'));
    expect(record).toEqual({
      file: 'supervision-pending.json',
      sha256: sha(bytes),
      byteLength: bytes.length,
      closed: true,
    });
    expect(JSON.parse(bytes.toString('utf8'))).toEqual({ state: 'pending' });
  });
  it('refuses a competitor at the actual exclusive descriptor open and preserves its bytes', () => {
    const { out, writer } = writerFixture(),
      open = fs.openSync,
      target = path.join(out, 'supervision-pending.json');
    let raced = false;
    vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
      if (file === target && !raced) {
        raced = true;
        const fd = open(file, 'wx');
        fs.writeSync(fd, 'owned-competitor');
        fs.closeSync(fd);
      }
      return open(file, ...args);
    });
    expect(() => writer.write('supervision-pending.json', { state: 'pending' })).toThrow();
    expect(fs.readFileSync(target, 'utf8')).toBe('owned-competitor');
    expect(writer.files).toEqual([]);
  });
  it.each(['partial-write', 'uncertain-close'])(
    'preserves %s data without attesting a failed descriptor',
    (mode) => {
      const { out, writer } = writerFixture(),
        open = fs.openSync,
        write = fs.writeSync,
        close = fs.closeSync,
        fstat = fs.fstatSync;
      writer.write('supervision-plan.json', { state: 'plan' });
      const target = path.join(out, 'supervision-pending.json');
      let targetFd,
        active = false,
        faultApplied = false;
      vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
        const fd = open(file, ...args);
        if (file === target && !faultApplied) {
          targetFd = fd;
          active = true;
        }
        return fd;
      });
      vi.spyOn(fs, 'writeSync').mockImplementation((fd, buffer, offset, length, position) => {
        if (mode === 'partial-write' && fd === targetFd && active && !faultApplied) {
          write(fd, buffer, offset, 3, position);
          faultApplied = true;
          throw Error('private-write-error');
        }
        return write(fd, buffer, offset, length, position);
      });
      vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
        close(fd);
        if (fd === targetFd && active) {
          active = false;
          if (mode === 'uncertain-close' && !faultApplied) {
            faultApplied = true;
            throw Error('private-close-error');
          }
        }
      });
      expect(() => writer.write('supervision-pending.json', { state: 'pending' })).toThrow();
      expect(faultApplied).toBe(true);
      expect(() => fstat(targetFd)).toThrow();
      expect(writer.files.map((file) => file.file)).toEqual(['supervision-plan.json']);
      const bytes = fs.readFileSync(target);
      expect(bytes.length).toBeGreaterThan(0);
      if (mode === 'partial-write') expect(bytes.length).toBe(3);
      else expect(JSON.parse(bytes.toString('utf8'))).toEqual({ state: 'pending' });
      expect(JSON.stringify(writer.files)).not.toContain('private-');
    },
  );
});
