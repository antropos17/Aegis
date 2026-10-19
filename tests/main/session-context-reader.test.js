import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createSessionContext } = require('../../src/main/session-context');
const { createSessionContextReader } = require('../../src/main/session-context-reader');
const selection = { sessionId: 'session-local', cwd: '/work', platform: 'posix' };
const fixture = (name) =>
  fs.readFileSync(new URL(`../fixtures/session-context/${name}.jsonl`, import.meta.url));
const file = '/owned-fixture/PRIVATE_FILE_NAME.jsonl';

function model(bytes = fixture('claude')) {
  const state = {
    kind: 'regular',
    symlink: false,
    reparse: false,
    volumeId: '1',
    fileId: '2',
    size: bytes.length,
    mtimeNs: '100',
    ctimeNs: '200',
  };
  const handle = {
    stat: vi.fn(async () => ({ ...state })),
    close: vi.fn(async () => {}),
    read: vi.fn(async (target, offset, length, position) =>
      bytes.copy(target, offset, position, Math.min(position + length, bytes.length)),
    ),
  };
  const files = {
    pathStyle: 'posix',
    statPath: vi.fn(async () => ({ ...state })),
    openRead: vi.fn(async () => handle),
  };
  const owner = createSessionContext({ digestKey: Buffer.alloc(32, 7) });
  let captured;
  const adapter = {
    parse: vi.fn((source, raw, selected) => {
      captured = raw === null ? null : Buffer.from(raw);
      return owner.parse(source, raw, selected);
    }),
    bind: vi.fn(),
    correlate: vi.fn(),
  };
  const reader = createSessionContextReader({ files, adapter });
  return { state, files, handle, adapter, reader, captured: () => captured };
}

describe('explicit bounded session file reader, fixture-only', () => {
  it.each([
    ['claude-code', 'claude', 'Read'],
    ['codex', 'codex', 'exec_command'],
    ['gemini-cli', 'gemini', 'read_file'],
  ])(
    'delegates a complete %s file to the existing owner and returns exactly its metadata',
    async (source, name, tool) => {
      const bytes = fixture(name),
        m = model(bytes),
        result = await m.reader.read(source, file, selection);
      expect(result.availability).toBe('available');
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0].toolName).toBe(tool);
      expect(result).toBe(m.adapter.parse.mock.results[0].value);
      expect(m.captured().equals(bytes)).toBe(true);
      expect(m.handle.close).toHaveBeenCalledTimes(1);
      expect(m.adapter.bind).not.toHaveBeenCalled();
      expect(m.adapter.correlate).not.toHaveBeenCalled();
      for (const secret of ['PRIVATE_', '/work', 'session-local', 'call-local', file])
        expect(JSON.stringify(result)).not.toContain(secret);
    },
  );
  it.each([
    { kind: 'directory' },
    { kind: null },
    { symlink: true },
    { symlink: null },
    { reparse: true },
    { reparse: null },
    { volumeId: null },
    { fileId: '0' },
    { fileId: null },
    { size: 512 * 1024 + 1 },
    { size: -1 },
    { size: 1.5 },
    { mtimeNs: null },
    { ctimeNs: null },
    { mtimeNs: '18446744073709551616' },
  ])(
    'never opens when regularity, identity, exact version or complete size is unproved: %j',
    async (patch) => {
      const m = model();
      Object.assign(m.state, patch);
      const r = await m.reader.read('claude-code', file, selection);
      expect(r.availability).toBe('unavailable');
      expect(r.reasons).toContain('source-unavailable');
      expect(m.files.openRead).not.toHaveBeenCalled();
      expect(m.captured()).toBeNull();
    },
  );
  it.each([
    'relative.jsonl',
    '../private',
    '/owned/../private',
    '//network/file',
    '/owned/PRIVATE\0file',
  ])('rejects unsafe explicit path without IO: %s', async (selected) => {
    const m = model();
    const r = await m.reader.read('claude-code', selected, selection);
    expect(r.availability).toBe('unavailable');
    expect(m.files.statPath).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain(selected);
  });
  it('requires a drive-qualified Windows path and never invents a truncated selection', async () => {
    for (const selected of [
      'X:relative',
      '\\rooted',
      '\\\\server\\share\\file',
      'X:/owned/file:stream',
      'X:/owned/CON.txt',
      'X:/owned/file.',
    ]) {
      const m = model();
      m.files.pathStyle = 'win32';
      expect((await m.reader.read('claude-code', selected, selection)).availability).toBe(
        'unavailable',
      );
      expect(m.files.statPath).not.toHaveBeenCalled();
    }
    for (const flags of [{ headTruncated: true }, { tailTruncated: true }]) {
      const m = model();
      expect(
        (await m.reader.read('claude-code', file, { ...selection, ...flags })).availability,
      ).toBe('unavailable');
      expect(m.files.statPath).not.toHaveBeenCalled();
    }
    const m = model();
    expect((await m.reader.read('PRIVATE_SOURCE_CANARY', file, selection)).source).toBeNull();
    expect(m.files.statPath).not.toHaveBeenCalled();
  });
  it.each(['statPath', 'openRead', 'handleStat', 'read', 'close'])(
    'hides raw IO errors from %s and closes every obtained handle',
    async (operation) => {
      const m = model();
      const fail = async () => {
        throw Error('PRIVATE_IO_ERROR ' + file);
      };
      if (operation === 'statPath' || operation === 'openRead')
        m.files[operation].mockImplementation(fail);
      else m.handle[operation === 'handleStat' ? 'stat' : operation].mockImplementation(fail);
      const r = await m.reader.read('claude-code', file, selection);
      expect(r).toMatchObject({ availability: 'unavailable', calls: [] });
      expect(r.reasons).toContain('source-unavailable');
      expect(JSON.stringify(r)).not.toMatch(/PRIVATE_|owned-fixture/);
      expect(m.handle.close).toHaveBeenCalledTimes(
        ['statPath', 'openRead'].includes(operation) ? 0 : 1,
      );
      expect(m.captured()).toBeNull();
    },
  );
  it.each([
    'opened-identity',
    'post-identity',
    'post-size',
    'post-mtime',
    'post-ctime',
    'path-replaced',
    'shared-object',
  ])('rejects path/handle mutation before parsing: %s', async (race) => {
    const m = model();
    if (race === 'opened-identity') m.handle.stat.mockResolvedValue({ ...m.state, fileId: '3' });
    else if (race === 'path-replaced')
      m.files.statPath
        .mockResolvedValueOnce({ ...m.state })
        .mockResolvedValue({ ...m.state, fileId: '3' });
    else if (race === 'shared-object') {
      const shared = { ...m.state };
      m.files.statPath.mockResolvedValue(shared);
      m.handle.stat.mockImplementation(async () => {
        shared.fileId = '3';
        return shared;
      });
    } else {
      const patch =
        race === 'post-identity'
          ? { fileId: '3' }
          : race === 'post-size'
            ? { size: m.state.size + 1 }
            : race === 'post-mtime'
              ? { mtimeNs: '101' }
              : { ctimeNs: '201' };
      m.handle.stat
        .mockResolvedValueOnce({ ...m.state })
        .mockResolvedValue({ ...m.state, ...patch });
    }
    const r = await m.reader.read('claude-code', file, selection);
    expect(r.availability).toBe('unavailable');
    expect(m.captured()).toBeNull();
    expect(m.handle.close).toHaveBeenCalledTimes(1);
    if (['opened-identity', 'shared-object'].includes(race))
      expect(m.handle.read).not.toHaveBeenCalled();
  });
  it('bounds short reads/call count, rejects extra bytes and wipes only owned temporary buffers', async () => {
    for (const mode of ['short', 'too-many', 'extra', 'invalid-count']) {
      const m = model(),
        seen = [];
      const raw = fixture('claude');
      m.handle.read.mockImplementation(async (target, offset, length, position) => {
        seen.push(target);
        if (mode === 'invalid-count') return length + 1;
        if (mode === 'extra' && position === raw.length) {
          target[0] = 7;
          return 1;
        }
        if (mode === 'short') return 0;
        return raw.copy(
          target,
          offset,
          position,
          Math.min(position + (mode === 'too-many' ? 1 : length), raw.length),
        );
      });
      expect((await m.reader.read('claude-code', file, selection)).availability).toBe(
        'unavailable',
      );
      expect(m.captured()).toBeNull();
      expect(m.handle.read.mock.calls.length).toBeLessThanOrEqual(17);
      expect(seen.every((buffer) => buffer.every((value) => value === 0))).toBe(true);
      expect(m.handle.close).toHaveBeenCalledTimes(1);
    }
    const raw = fixture('claude'),
      m = model(raw);
    m.handle.read.mockImplementation(async (target, offset, length, position) =>
      raw.copy(target, offset, position, Math.min(position + Math.min(128, length), raw.length)),
    );
    expect((await m.reader.read('claude-code', file, selection)).availability).toBe('available');
  });
  it('admits exactly512KiB in eight bounded chunks plus EOF and preserves explicit legacy JSON format', async () => {
    const raw = Buffer.alloc(512 * 1024, 32);
    for (let n = 64 * 1024 - 1; n < raw.length; n += 64 * 1024) raw[n] = 10;
    fixture('claude').copy(raw);
    const m = model(raw);
    expect((await m.reader.read('claude-code', file, selection)).availability).toBe('available');
    expect(m.captured().length).toBe(512 * 1024);
    expect(m.handle.read).toHaveBeenCalledTimes(9);
    expect(m.handle.read.mock.calls.every((args) => args[2] <= 64 * 1024)).toBe(true);
    const rows = fixture('gemini').toString().trim().split('\n').map(JSON.parse);
    const legacy = model(Buffer.from(JSON.stringify({ ...rows[0], messages: [rows[1]] })));
    expect(
      (await legacy.reader.read('gemini-cli', file, { ...selection, format: 'json' })).availability,
    ).toBe('available');
  });
  it('preserves existing partial-record/invalid-UTF8 semantics and strips unknown-field canaries', async () => {
    const complete = fixture('claude');
    const partial = model(Buffer.concat([complete, Buffer.from('{"PRIVATE_TRAILING":"')]));
    const r = await partial.reader.read('claude-code', file, selection);
    expect(r.availability).toBe('partial');
    expect(r.reasons).toContain('truncated-input');
    expect(r.calls).toHaveLength(1);
    const invalid = model(Buffer.from([255]));
    const bad = await invalid.reader.read('claude-code', file, selection);
    expect(bad.availability).toBe('unavailable');
    expect(bad.reasons).toContain('invalid-encoding-or-json');
    expect(invalid.captured()).not.toBeNull();
    const unknown = complete
      .toString()
      .split('\n')
      .filter(Boolean)
      .map(JSON.parse)
      .map((row) => ({ ...row, unknown: { prompt: 'PRIVATE_UNKNOWN_CANARY', sourcePath: file } }));
    const m = model(Buffer.from(unknown.map(JSON.stringify).join('\n') + '\n'));
    expect(JSON.stringify(await m.reader.read('claude-code', file, selection))).not.toMatch(
      /PRIVATE_|owned-fixture|\/work/,
    );
    m.adapter.parse.mockImplementation(() => {
      throw Error('PRIVATE_PARSE_ERROR ' + file);
    });
    await expect(m.reader.read('claude-code', file, selection)).rejects.toThrow(
      /^session-reader-unavailable$/,
    );
  });
  it('has no default file access or runtime/parser/binding dependency', () => {
    expect(() => createSessionContextReader({})).toThrow('session-reader-invalid-options');
    const entry = require.cache[require.resolve('../../src/main/session-context-reader')];
    expect(entry.children).toEqual([]);
    expect(fs.readFileSync(entry.filename, 'utf8')).not.toMatch(
      /require\(['"](?:node:fs|\.\/session-context|\.\/main)|\.bind\(|\.correlate\(/,
    );
  });
  it.skipIf(process.platform !== 'win32' || !/^X:[/\\]/i.test(process.env.TEMP ?? ''))(
    'reads and rereads only an explicitly owned X fixture; shim is not a Windows reparse verifier',
    async () => {
      const base = path.resolve(process.env.TEMP),
        folder = fs.mkdtempSync(path.join(base, 'aegis-session-reader-'));
      const selected = path.join(folder, 'PRIVATE_SELECTED.jsonl');
      fs.writeFileSync(selected, fixture('claude'), { flag: 'wx' });
      const metadata = (st) => ({
        kind: st.isFile() ? 'regular' : 'other',
        symlink: st.isSymbolicLink(),
        reparse: false,
        volumeId: String(st.dev),
        fileId: String(st.ino),
        size: Number(st.size),
        mtimeNs: String(st.mtimeNs),
        ctimeNs: String(st.ctimeNs),
      });
      // reparse:false is restricted to this file created by the fixture. This shim
      // supplies no production Windows reparse or parent-redirection qualification.
      const files = {
        pathStyle: 'win32',
        statPath: async (p) => {
          expect(p).toBe(selected);
          return metadata(await fs.promises.lstat(p, { bigint: true }));
        },
        openRead: async (p) => {
          expect(p).toBe(selected);
          const h = await fs.promises.open(p, 'r');
          return {
            stat: async () => metadata(await h.stat({ bigint: true })),
            read: async (...args) => (await h.read(...args)).bytesRead,
            close: () => h.close(),
          };
        },
      };
      try {
        const adapter = createSessionContext({ digestKey: Buffer.alloc(32, 7) }),
          reader = createSessionContextReader({ files, adapter });
        expect((await reader.read('claude-code', selected, selection)).calls[0].toolName).toBe(
          'Read',
        );
        fs.writeFileSync(selected, fixture('claude').toString().replace('"Read"', '"Write"'));
        expect((await reader.read('claude-code', selected, selection)).calls[0].toolName).toBe(
          'Write',
        );
      } finally {
        expect(path.dirname(path.resolve(folder))).toBe(base);
        expect(fs.realpathSync(folder)).toBe(folder);
        expect(path.basename(folder).startsWith('aegis-session-reader-')).toBe(true);
        fs.unlinkSync(selected);
        fs.rmdirSync(folder);
      }
    },
  );
});
