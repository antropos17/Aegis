import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const input = require('../../../bench/lib/corpus-input');
const { LIMITS } = input;
const native = Object.fromEntries(
  ['openSync', 'closeSync', 'readSync', 'fstatSync', 'lstatSync'].map((name) => [
    name,
    fs[name].bind(fs),
  ]),
);
const roots = [],
  links = [];
function directory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-corpus-input-'));
  roots.push(dir);
  return dir;
}
function artifact(bytes = Buffer.from('{"value":"private fixture"}')) {
  const file = path.join(directory(), 'input.json');
  fs.writeFileSync(file, bytes);
  return file;
}
function handles() {
  return { open: vi.spyOn(fs, 'openSync'), close: vi.spyOn(fs, 'closeSync') };
}
function expectClosed({ open, close }) {
  expect(open).toHaveBeenCalledTimes(1);
  const fd = open.mock.results[0].value;
  expect(close.mock.calls).toEqual([[fd]]);
  expect(() => native.fstatSync(fd)).toThrow();
}
function fault() {
  return Object.assign(new Error('private-path-and-content'), { code: 'EIO' });
}
const json = (value) => input.parse(Buffer.from(value));
afterEach(() => {
  vi.restoreAllMocks();
  for (const link of links.splice(0)) fs.unlinkSync(link);
  for (const dir of roots.splice(0)) {
    expect(path.dirname(dir)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(dir)).toMatch(/^aegis-corpus-input-/);
    expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
    fs.rmSync(dir, { recursive: true });
  }
});

describe('ordinary corpus input paths and bounded exact reads', () => {
  it('accepts an ordinary owned directory and returns its absolute path', () => {
    const dir = directory(),
      nested = path.join(dir, 'nested');
    fs.mkdirSync(nested);
    expect(input.ordinaryDirectory(nested)).toBe(path.resolve(nested));
    expect(input.ordinaryDirectory(path.relative(process.cwd(), nested))).toBe(
      path.resolve(nested),
    );
  });

  it('rejects missing directories and ordinary files supplied as directories', () => {
    const file = artifact();
    expect(() => input.ordinaryDirectory(file)).toThrow();
    expect(() => input.ordinaryDirectory(path.join(path.dirname(file), 'missing'))).toThrow();
  });

  it.each(['', '\\0', '//remote/private', '\\\\remote\\private'])(
    'rejects invalid directory spelling %j before filesystem access',
    (dir) => {
      const inspect = vi.spyOn(fs, 'lstatSync');
      expect(() => input.ordinaryDirectory(dir.replace('\\0', '\0'))).toThrow(
        /^corpus-input-invalid$/,
      );
      expect(inspect).not.toHaveBeenCalled();
    },
  );

  it('rejects a real junction at the leaf and within a requested directory', () => {
    const dir = directory(),
      target = path.join(dir, 'target'),
      link = path.join(dir, 'junction');
    fs.mkdirSync(target);
    fs.mkdirSync(path.join(target, 'nested'));
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    links.push(link);
    const open = vi.spyOn(fs, 'openSync');
    expect(() => input.ordinaryDirectory(link)).toThrow(/^corpus-input-invalid$/);
    expect(() => input.ordinaryDirectory(path.join(link, 'nested'))).toThrow(
      /^corpus-input-invalid$/,
    );
    expect(open).not.toHaveBeenCalled();
  });

  it('rejects a real file symlink without opening its target', ({ skip }) => {
    const file = artifact(),
      link = path.join(path.dirname(file), 'symlink.json');
    try {
      fs.symlinkSync(file, link, 'file');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) {
        skip();
        return;
      }
      throw error;
    }
    links.push(link);
    const open = vi.spyOn(fs, 'openSync');
    expect(() => input.read(link, { bytes: 0 })).toThrow(/^corpus-input-invalid$/);
    expect(open).not.toHaveBeenCalled();
  });

  it('rejects a real hardlink without opening either name', () => {
    const file = artifact(),
      link = path.join(path.dirname(file), 'hardlink.json');
    fs.linkSync(file, link);
    const open = vi.spyOn(fs, 'openSync');
    expect(fs.lstatSync(file).nlink).toBe(2);
    expect(() => input.read(file, { bytes: 0 })).toThrow(/^corpus-input-invalid$/);
    expect(() => input.read(link, { bytes: 0 })).toThrow(/^corpus-input-invalid$/);
    expect(open).not.toHaveBeenCalled();
  });

  it('returns exact binary bytes, accounts them once, and closes its sole descriptor', () => {
    const bytes = Buffer.from([0x00, 0xff, 0x7b, 0x0d, 0x0a]),
      file = artifact(bytes),
      budget = { bytes: 13 },
      tracked = handles();
    expect(input.read(file, budget)).toEqual(bytes);
    expect(budget.bytes).toBe(13 + bytes.length);
    expect(tracked.open.mock.calls[0]).toEqual([
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    ]);
    expectClosed(tracked);
  });

  it('loops through legitimate short reads until EOF', () => {
    const bytes = Buffer.from('short reads preserve every original byte'),
      file = artifact(bytes),
      tracked = handles();
    const read = vi
      .spyOn(fs, 'readSync')
      .mockImplementation((fd, buffer, offset, length, position) =>
        native.readSync(fd, buffer, offset, Math.min(length, 3), position),
      );
    expect(input.read(file, { bytes: 0 })).toEqual(bytes);
    expect(read.mock.calls.length).toBeGreaterThan(3);
    expectClosed(tracked);
  });

  it('accepts the exact per-artifact and aggregate byte limits', () => {
    const file = artifact(Buffer.alloc(LIMITS.artifactBytes, 0x61)),
      budget = { bytes: LIMITS.totalBytes - LIMITS.artifactBytes };
    expect(input.read(file, budget)).toEqual(Buffer.alloc(LIMITS.artifactBytes, 0x61));
    expect(budget.bytes).toBe(LIMITS.totalBytes);
    const empty = artifact(Buffer.alloc(0));
    expect(input.read(empty, budget)).toEqual(Buffer.alloc(0));
    expect(budget.bytes).toBe(LIMITS.totalBytes);
  });

  it.each(['artifact', 'aggregate'])(
    'refuses one byte beyond the %s limit before opening',
    (kind) => {
      const file = artifact(Buffer.alloc(kind === 'artifact' ? LIMITS.artifactBytes + 1 : 1));
      const budget = { bytes: kind === 'aggregate' ? LIMITS.totalBytes : 0 },
        open = vi.spyOn(fs, 'openSync');
      expect(() => input.read(file, budget)).toThrow(/^corpus-input-invalid$/);
      expect(open).not.toHaveBeenCalled();
      expect(budget.bytes).toBe(kind === 'aggregate' ? LIMITS.totalBytes : 0);
    },
  );

  it('treats only a missing optional file as absent', () => {
    const file = artifact(),
      missing = path.join(path.dirname(file), 'missing.json'),
      budget = { bytes: 7 };
    expect(input.read(missing, budget, true)).toBeNull();
    expect(budget.bytes).toBe(7);
    expect(() => input.read(missing, budget)).toThrow();
    expect(() => input.read(path.dirname(file), budget, true)).toThrow();
    fs.writeFileSync(file, '{malformed');
    expect(() => input.parse(input.read(file, budget, true))).toThrow(/^corpus-input-invalid$/);
  });

  it('refuses an unreadable optional file rather than treating it as missing', () => {
    const file = artifact(),
      budget = { bytes: 0 };
    vi.spyOn(fs, 'openSync').mockImplementation(() => {
      throw Object.assign(fault(), { code: 'EACCES' });
    });
    expect(() => input.read(file, budget, true)).toThrow();
    expect(budget.bytes).toBe(0);
  });
});

describe('descriptor stability and failure cleanup', () => {
  it.skipIf(!fs.constants.O_NOFOLLOW)(
    'refuses a real terminal symlink swapped at open through the native nofollow flag',
    () => {
      const file = artifact(),
        target = path.join(path.dirname(file), 'target.json');
      fs.writeFileSync(target, 'private symlink target');
      const tracked = handles();
      tracked.open.mockImplementation((...args) => {
        fs.renameSync(file, `${file}.original`);
        fs.symlinkSync(target, file, 'file');
        links.push(file);
        return native.openSync(...args);
      });
      const read = vi.spyOn(fs, 'readSync');
      expect(() => input.read(file, { bytes: 0 })).toThrow();
      expect(tracked.open).toHaveBeenCalledTimes(1);
      expect(tracked.open.mock.results[0]).toMatchObject({
        type: 'throw',
        value: { code: 'ELOOP' },
      });
      expect(read).not.toHaveBeenCalled();
      expect(tracked.close).not.toHaveBeenCalled();
    },
  );

  it('refuses post-read descriptor metadata drift even when the final named file is unchanged', () => {
    const file = artifact(),
      named = native.lstatSync(file, { bigint: true }),
      budget = { bytes: 0 },
      tracked = handles();
    let inspections = 0;
    vi.spyOn(fs, 'fstatSync').mockImplementation((...args) => {
      const stat = native.fstatSync(...args);
      if (++inspections === 2)
        return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, {
          mtimeNs: stat.mtimeNs + 1n,
        });
      return stat;
    });
    expect(() => input.read(file, budget)).toThrow(/^corpus-input-invalid$/);
    expect(inspections).toBe(2);
    expect(native.lstatSync(file, { bigint: true })).toMatchObject({
      ino: named.ino,
      size: named.size,
      mtimeNs: named.mtimeNs,
      ctimeNs: named.ctimeNs,
    });
    expect(budget.bytes).toBe(0);
    expectClosed(tracked);
  });

  it.each(['growth', 'truncation', 'same-size rewrite'])(
    'refuses %s during reading and closes once',
    (change) => {
      const file = artifact(Buffer.from('original bytes')),
        budget = { bytes: 0 },
        tracked = handles();
      let changed = false;
      vi.spyOn(fs, 'readSync').mockImplementation((...args) => {
        if (!changed) {
          changed = true;
          if (change === 'growth') fs.appendFileSync(file, 'growth');
          else if (change === 'truncation') {
            const mutator = native.openSync(file, 'r+');
            try {
              fs.ftruncateSync(mutator, 2);
            } finally {
              native.closeSync(mutator);
            }
          } else {
            fs.writeFileSync(file, 'rewritten data');
            fs.utimesSync(file, new Date(0), new Date(0));
          }
        }
        return native.readSync(...args);
      });
      expect(() => input.read(file, budget)).toThrow();
      expect(changed).toBe(true);
      expect(budget.bytes).toBe(0);
      expectClosed(tracked);
    },
  );

  it('refuses replacement between pathname inspection and descriptor opening', () => {
    const file = artifact(),
      replacement = path.join(path.dirname(file), 'replacement.json');
    fs.writeFileSync(replacement, fs.readFileSync(file));
    const tracked = handles();
    tracked.open.mockImplementation((...args) => {
      fs.renameSync(file, `${file}.old`);
      fs.renameSync(replacement, file);
      return native.openSync(...args);
    });
    const read = vi.spyOn(fs, 'readSync');
    expect(() => input.read(file, { bytes: 0 })).toThrow();
    expect(read).not.toHaveBeenCalled();
    expectClosed(tracked);
  });

  it('refuses a changed final pathname while its retained descriptor remains stable', () => {
    const file = artifact(),
      replacement = path.join(path.dirname(file), 'replacement.json');
    fs.writeFileSync(replacement, fs.readFileSync(file));
    const tracked = handles();
    let inspections = 0,
      replaced = false;
    vi.spyOn(fs, 'lstatSync').mockImplementation((...args) => {
      if (++inspections === 2) {
        replaced = true;
        fs.renameSync(file, `${file}.old`);
        fs.renameSync(replacement, file);
      }
      return native.lstatSync(...args);
    });
    expect(() => input.read(file, { bytes: 0 })).toThrow();
    expect(replaced).toBe(true);
    expectClosed(tracked);
  });

  it.each(['initial fstat', 'read', 'final fstat', 'final lstat'])(
    'closes its sole opened descriptor after a %s failure',
    (stage) => {
      const file = artifact(),
        tracked = handles(),
        budget = { bytes: 0 };
      if (stage === 'read')
        vi.spyOn(fs, 'readSync').mockImplementation(() => {
          throw fault();
        });
      else {
        const name = stage.endsWith('lstat') ? 'lstatSync' : 'fstatSync',
          failAt = stage.startsWith('initial') ? 1 : 2;
        let calls = 0;
        vi.spyOn(fs, name).mockImplementation((...args) => {
          if (++calls === failAt) throw fault();
          return native[name](...args);
        });
      }
      expect(() => input.read(file, budget)).toThrow();
      expect(budget.bytes).toBe(0);
      expectClosed(tracked);
    },
  );

  it('refuses uncertain close confirmation and does not retry a descriptor that was closed', () => {
    const file = artifact(),
      tracked = handles();
    tracked.close.mockImplementation((fd) => {
      native.closeSync(fd);
      throw fault();
    });
    expect(() => input.read(file, { bytes: 0 })).toThrow();
    expectClosed(tracked);
  });
});

describe('strict bounded JSON and byte digests', () => {
  it('preserves JSON values and treats special property names as data', () => {
    const value = json(
      '{"__proto__":{"safe":true},"a":[null,true,false,0,-1.5,1e2],"text":"Ключ"}',
    );
    expect(Object.hasOwn(value, '__proto__')).toBe(true);
    expect(value.__proto__).toEqual({ safe: true });
    expect(value.a).toEqual([null, true, false, 0, -1.5, 100]);
    expect(value.text).toBe('Ключ');
    expect(json('[{"key":1},{"key":2}]')).toEqual([{ key: 1 }, { key: 2 }]);
  });

  it.each(['{"a":1,"a":2}', '{"x":1,"\\u0078":2}', '{"nested":{"\\u0061":1,"a":2}}'])(
    'rejects duplicate decoded keys %s with a fixed private-input error',
    (text) => {
      expect(() => json(text)).toThrow(/^corpus-input-invalid$/);
    },
  );

  it.each([
    '',
    '{"private-path":}',
    '{"a":1,}',
    '[1,]',
    '0 1',
    '01',
    '+1',
    'NaN',
    'Infinity',
    '1e999',
    '"raw\nline"',
    '"\\x41"',
  ])('rejects malformed JSON %j with a fixed private-input error', (text) => {
    expect(() => json(text)).toThrow(/^corpus-input-invalid$/);
  });

  it.each([[0xff], [0xc0, 0xaf], [0xe2, 0x82], [0xed, 0xa0, 0x80]])(
    'rejects malformed UTF-8 sequence %j',
    (...bytes) => {
      expect(() =>
        input.parse(Buffer.concat([Buffer.from('"'), Buffer.from(bytes), Buffer.from('"')])),
      ).toThrow(/^corpus-input-invalid$/);
    },
  );

  it('enforces exact raw-byte and decoded-string limits', () => {
    expect(json(`${' '.repeat(LIMITS.artifactBytes - 1)}0`)).toBe(0);
    expect(() => json(`${' '.repeat(LIMITS.artifactBytes)}0`)).toThrow(/^corpus-input-invalid$/);
    expect(json(JSON.stringify('x'.repeat(LIMITS.string)))).toHaveLength(LIMITS.string);
    expect(() => json(JSON.stringify('x'.repeat(LIMITS.string + 1)))).toThrow(
      /^corpus-input-invalid$/,
    );
  });

  it('accepts the depth boundary and refuses the next nested value', () => {
    const nested = (depth) => `${'['.repeat(depth)}0${']'.repeat(depth)}`;
    expect(() => json(nested(LIMITS.depth))).not.toThrow();
    expect(() => json(nested(LIMITS.depth + 1))).toThrow(/^corpus-input-invalid$/);
  });

  it('accepts the aggregate JSON-node boundary and refuses one more node', () => {
    function nodes(total) {
      const groups = [];
      let remaining = total - 1;
      while (remaining) {
        const count = Math.min(remaining, 1025);
        groups.push(Array(count - 1).fill(0));
        remaining -= count;
      }
      return JSON.stringify(groups);
    }
    expect(() => json(nodes(LIMITS.nodes))).not.toThrow();
    expect(() => json(nodes(LIMITS.nodes + 1))).toThrow(/^corpus-input-invalid$/);
  });

  it('hashes the original bytes using a published SHA-256 vector', () => {
    expect(input.digest(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(json('{"a":1}')).toEqual(json('{ "a": 1 }\r\n'));
    expect(input.digest(Buffer.from('{"a":1}'))).not.toBe(
      input.digest(Buffer.from('{ "a": 1 }\r\n')),
    );
  });
});
