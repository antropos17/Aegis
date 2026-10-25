import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const provenance = require('../../../bench/lib/scenario-provenance');
const native = Object.fromEntries(
  ['openSync', 'closeSync', 'fstatSync', 'lstatSync'].map((key) => [key, fs[key].bind(fs)]),
);
const directories = [],
  links = [];
function fixture(bytes = Buffer.from('{"case":"owned","value":1}')) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scenario-source-io-'));
  directories.push(dir);
  const file = path.join(dir, 'definition.json');
  fs.writeFileSync(file, bytes);
  return file;
}
function trackedHandles() {
  return { open: vi.spyOn(fs, 'openSync'), close: vi.spyOn(fs, 'closeSync') };
}
function expectClosed({ open, close }) {
  expect(open).toHaveBeenCalledTimes(1);
  const fd = open.mock.results[0].value;
  expect(close.mock.calls).toEqual([[fd]]);
  expect(() => native.fstatSync(fd)).toThrow();
}
const replaceStat = (stat, fields) =>
  Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, fields);
afterEach(() => {
  vi.restoreAllMocks();
  for (const link of links.splice(0)) fs.unlinkSync(link);
  for (const dir of directories.splice(0)) {
    expect(path.dirname(dir)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(dir)).toMatch(/^scenario-source-io-/);
    expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
    fs.rmSync(dir, { recursive: true });
  }
});

describe('exact scenario-source filesystem admission', () => {
  it('opens an ordinary source with read-only and every available nofollow flag', () => {
    const file = fixture(),
      handles = trackedHandles();
    expect(provenance.load(file)).toEqual({ case: 'owned', value: 1 });
    expect(handles.open.mock.calls[0]).toEqual([
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    ]);
    expectClosed(handles);
  });

  it('refuses adjacent BigInt named and opened identities that alias as Numbers', () => {
    const file = fixture(),
      handles = trackedHandles();
    const namedId = 2n ** 53n + 3n,
      openedId = namedId + 1n;
    expect(namedId).not.toBe(openedId);
    expect(Number(namedId)).toBe(Number(openedId));
    vi.spyOn(fs, 'lstatSync').mockImplementation((target, ...args) => {
      const stat = native.lstatSync(target, ...args);
      return target === file ? replaceStat(stat, { ino: namedId }) : stat;
    });
    vi.spyOn(fs, 'fstatSync').mockImplementation((...args) =>
      replaceStat(native.fstatSync(...args), { ino: openedId }),
    );
    const read = vi.spyOn(fs, 'readSync');
    expect(() => provenance.load(file)).toThrow(/^scenario-provenance-unavailable$/);
    expect(read).not.toHaveBeenCalled();
    expectClosed(handles);
  });

  it.skipIf(!fs.constants.O_NOFOLLOW)(
    'refuses a real terminal symlink swapped precisely at native open',
    () => {
      const file = fixture(),
        target = path.join(path.dirname(file), 'target.json');
      fs.writeFileSync(target, '{"private":"symlink-target"}');
      const handles = trackedHandles();
      handles.open.mockImplementation((...args) => {
        fs.renameSync(file, `${file}.original`);
        fs.symlinkSync(target, file, 'file');
        links.push(file);
        return native.openSync(...args);
      });
      const read = vi.spyOn(fs, 'readSync');
      expect(() => provenance.load(file)).toThrow();
      expect(handles.open).toHaveBeenCalledTimes(1);
      expect(handles.open.mock.results[0]).toMatchObject({
        type: 'throw',
        value: { code: 'ELOOP' },
      });
      expect(read).not.toHaveBeenCalled();
      expect(handles.close).not.toHaveBeenCalled();
    },
  );

  it.each(['opened descriptor', 'final pathname'])(
    'refuses isolated post-read metadata drift in the %s',
    (phase) => {
      const file = fixture(),
        original = native.lstatSync(file, { bigint: true });
      const handles = trackedHandles();
      let descriptorInspections = 0,
        namedInspections = 0,
        driftObserved = false;
      vi.spyOn(fs, 'fstatSync').mockImplementation((...args) => {
        const stat = native.fstatSync(...args);
        if (++descriptorInspections === 2 && phase === 'opened descriptor') {
          driftObserved = true;
          return replaceStat(stat, { mtimeNs: stat.mtimeNs + 1n });
        }
        return stat;
      });
      vi.spyOn(fs, 'lstatSync').mockImplementation((target, ...args) => {
        const stat = native.lstatSync(target, ...args);
        if (target === file && ++namedInspections === 2 && phase === 'final pathname') {
          driftObserved = true;
          return replaceStat(stat, { mtimeNs: stat.mtimeNs + 1n });
        }
        return stat;
      });
      expect(() => provenance.load(file)).toThrow(/^scenario-provenance-unavailable$/);
      expect(driftObserved).toBe(true);
      expect(descriptorInspections).toBe(2);
      expect(native.lstatSync(file, { bigint: true })).toMatchObject({
        ino: original.ino,
        size: original.size,
        mtimeNs: original.mtimeNs,
        ctimeNs: original.ctimeNs,
      });
      expectClosed(handles);
    },
  );

  it('accepts exactly 65536 valid JSON bytes including whitespace padding', () => {
    const json = Buffer.from('{"boundary":true}');
    const bytes = Buffer.concat([json, Buffer.alloc(65536 - json.length, 0x20)]);
    const file = fixture(bytes),
      scenario = provenance.load(file);
    expect(scenario).toEqual({ boundary: true });
    provenance.seal(scenario);
    const initial = provenance.initial(scenario),
      final = provenance.finish(scenario);
    expect(initial.loaded.byteLength).toBe(65536);
    expect(final).toMatchObject({
      loaded: initial.loaded,
      final: { state: 'unchanged', sha256: initial.loaded.sha256, byteLength: 65536 },
    });
  });
});
