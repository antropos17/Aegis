import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { createBundle, cleanup, files, hash } from './linux-cpu-replay-fixtures.js';
const require = createRequire(import.meta.url);
const io = require('../../../bench/lib/linux-cpu-replay-io');
const { replayLinuxCpu } = require('../../../bench/lib/linux-cpu-replay');
afterEach(cleanup);
describe('offline bounded descriptor and report publication', () => {
  it('loops legitimate short reads and attests exact original bytes after closure', () => {
    const b = createBundle(),
      native = fs.readSync,
      observed = [];
    const close = fs.closeSync;
    vi.spyOn(fs, 'readSync').mockImplementation((fd, buf, off, len, pos) =>
      native(fd, buf, off, Math.min(len, 7), pos),
    );
    vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
      close(fd);
      observed.push(fd);
    });
    const result = io.bundle(b.input);
    for (const file of files) {
      const bytes = fs.readFileSync(path.join(b.input, file));
      expect(result[file].sha256).toBe(hash(bytes));
      expect(result[file].byteLength).toBe(bytes.length);
    }
    for (const fd of observed) expect(() => fs.fstatSync(fd)).toThrow();
  });
  it('loops legitimate short writes to a complete exact parseable report', () => {
    const b = createBundle(),
      native = fs.writeSync;
    vi.spyOn(fs, 'writeSync').mockImplementation((fd, buf, off, len, pos) =>
      native(fd, buf, off, Math.min(len, 5), pos),
    );
    io.publish(b.out, { safe: true });
    expect(fs.readFileSync(path.join(b.out, 'linux-cpu-replay.json'), 'utf8')).toBe(
      '{\n  "safe": true\n}\n',
    );
  });
  it.each(['before', 'after', 'named'])('refuses isolated %s identity drift', (testCase) => {
    const b = createBundle(),
      native = fs.fstatSync,
      lstat = fs.lstatSync;
    let calls = 0,
      named = 0;
    vi.spyOn(fs, 'fstatSync').mockImplementation((fd, opts) => {
      const s = native(fd, opts);
      calls++;
      if ((calls === 1 && testCase === 'before') || (calls === 2 && testCase === 'after'))
        return new Proxy(s, {
          get(t, k) {
            return k === 'ino' ? t.ino + 1n : Reflect.get(t, k);
          },
        });
      return s;
    });
    vi.spyOn(fs, 'lstatSync').mockImplementation((name, opts) => {
      const s = lstat(name, opts);
      if (name === path.join(b.input, files[0]) && ++named === 2 && testCase === 'named')
        return new Proxy(s, {
          get(t, k) {
            return k === 'ino' ? t.ino + 1n : Reflect.get(t, k);
          },
        });
      return s;
    });
    expect(() => io.bundle(b.input)).toThrow();
  });
  it('rejects growth beyond fixed artifact cap', async () => {
    const b = createBundle();
    fs.writeFileSync(path.join(b.input, files[0]), Buffer.alloc(16385, 32));
    expect((await replayLinuxCpu({ input: b.input, out: b.out })).exitCode).toBe(4);
  });
  it('rejects uncertain actual read-close without returning an attested packet', () => {
    const b = createBundle(),
      native = fs.closeSync;
    let once = true;
    vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
      native(fd);
      if (once) {
        once = false;
        throw Error('private-close');
      }
    });
    expect(() => io.bundle(b.input)).toThrow();
  });
  it('preserves output competitor from actual exclusive-open race', async () => {
    const b = createBundle(),
      native = fs.openSync;
    const target = path.join(b.out, 'linux-cpu-replay.json');
    vi.spyOn(fs, 'openSync').mockImplementation((file, flags, ...rest) => {
      if (file === target && !fs.existsSync(target)) {
        const fd = native(target, 'wx');
        fs.writeSync(fd, 'sentinel');
        fs.closeSync(fd);
      }
      return native(file, flags, ...rest);
    });
    expect((await replayLinuxCpu({ input: b.input, out: b.out })).exitCode).toBe(6);
    expect(fs.readFileSync(target, 'utf8')).toBe('sentinel');
  });
  it('preserves a partial report and returns publication failure', async () => {
    const b = createBundle(),
      native = fs.writeSync;
    let targetFd,
      wrote = false;
    const open = fs.openSync;
    vi.spyOn(fs, 'openSync').mockImplementation((name, ...args) => {
      const fd = open(name, ...args);
      if (name === path.join(b.out, 'linux-cpu-replay.json')) targetFd = fd;
      return fd;
    });
    vi.spyOn(fs, 'writeSync').mockImplementation((fd, buf, off, len, pos) => {
      if (fd === targetFd) {
        if (wrote) throw Error('private-write');
        wrote = true;
        return native(fd, buf, off, 7, pos);
      }
      return native(fd, buf, off, len, pos);
    });
    expect((await replayLinuxCpu({ input: b.input, out: b.out })).exitCode).toBe(6);
    expect(fs.statSync(path.join(b.out, 'linux-cpu-replay.json')).size).toBe(7);
    expect(() => fs.fstatSync(targetFd)).toThrow();
  });
  it('returns6 on final close uncertainty even if full JSON exists', async () => {
    const b = createBundle(),
      native = fs.closeSync,
      open = fs.openSync;
    let targetFd,
      uncertain = false;
    vi.spyOn(fs, 'openSync').mockImplementation((name, ...args) => {
      const fd = open(name, ...args);
      if (name === path.join(b.out, 'linux-cpu-replay.json')) targetFd = fd;
      return fd;
    });
    vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
      native(fd);
      if (fd === targetFd && !uncertain) {
        uncertain = true;
        throw Error('private-close');
      }
    });
    expect((await replayLinuxCpu({ input: b.input, out: b.out })).exitCode).toBe(6);
    expect(
      JSON.parse(fs.readFileSync(path.join(b.out, 'linux-cpu-replay.json'), 'utf8'))
        .finalPublication,
    ).toBe('not-self-attested');
  });
  it('classifies current source drift7 without changing historical verdict', async () => {
    const b = createBundle(),
      native = io.inventory;
    let count = 0;
    vi.spyOn(io, 'inventory').mockImplementation(() => {
      const v = native();
      if (count++ === 1) v.files[0].sha256 = 'f'.repeat(64);
      return v;
    });
    const result = await replayLinuxCpu({ input: b.input, out: b.out });
    expect(result.exitCode).toBe(7);
    expect(result.report.current.state).toBe('changed');
    expect(result.report.replay.state).toBe('equal');
  });
  it('labels current source unavailable separately7', async () => {
    const b = createBundle();
    vi.spyOn(io, 'inventory').mockImplementation(() => {
      throw Error('private-source');
    });
    const r = await replayLinuxCpu({ input: b.input, out: b.out });
    expect(r.exitCode).toBe(7);
    expect(JSON.stringify(r.report)).not.toContain('private-source');
  });
});
