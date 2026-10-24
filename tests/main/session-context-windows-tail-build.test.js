import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import {
  validateTaskRoot,
  readBuiltTaskRoot,
} from '../../sidecar/session-context-reader/native-fixture/tail-build-paths.mjs';

const checkout = 'X:\\tmp\\aegis-wt\\task';
const runtime = 'C:\\Program Files\\dotnet';
const output = 'X:\\tmp\\aegis-tail-owned\\reader-r1';
const key = (value) => path.win32.resolve(value).toLowerCase();
const entry = (kind = 'directory', link = false, nlink = 1) => ({
  isDirectory: () => kind === 'directory',
  isFile: () => kind === 'file',
  isSymbolicLink: () => link,
  nlink,
});
function fakeFiles(options = {}) {
  const marker = {
    schema: 1,
    kind: 'aegis-session-tail-build',
    buildKind: 'reader',
    root: key(output),
    checkout: key(checkout),
    runtimeRoot: key(runtime),
  };
  const receipt = { kind: 'reader', result: 'PASS', sourceUnchanged: true, cwd: output };
  return {
    existsSync: vi.fn((file) => key(file) !== key(output) || options.exists === true),
    statSync: vi.fn((file) =>
      entry(
        key(file) === key(path.win32.dirname(output)) && options.parentFile ? 'file' : 'directory',
      ),
    ),
    lstatSync: vi.fn((file) => {
      const name = path.win32.basename(file);
      if (key(file) === key(options.link || 'X:\\absent')) return entry('directory', true);
      if (key(file) === key(path.win32.join(output, 'temp')) && options.cacheFile)
        return entry('file');
      if (key(file) === key(path.win32.join(output, 'temp')) && options.cacheLink)
        return entry('directory', true);
      if (['tail-task.json', 'reader-build.json', 'global.json', 'nuget.config'].includes(name))
        return entry('file', false, options.hardlinkedMarker && name === 'tail-task.json' ? 2 : 1);
      return entry();
    }),
    readFileSync: vi.fn((file) =>
      JSON.stringify(path.win32.basename(file) === 'tail-task.json' ? marker : receipt),
    ),
    readdirSync: vi.fn(() => [
      'tail-task.json',
      'reader-build.json',
      'global.json',
      'nuget.config',
      'temp',
      'cli-home',
      'nuget',
      'http-cache',
      'empty-source',
      'build',
      'obj',
    ]),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
}

describe('Windows tail native build output custody', () => {
  it.each([
    ['checkout ancestor', 'X:/tmp'],
    ['case-varied ancestor', 'x:/TMP'],
    ['checkout itself', 'x:/TMP/AEGIS-WT/TASK'],
    ['checkout descendant', 'X:/tmp/aegis-wt/task/scratch'],
    ['case-varied descendant', 'x:/TMP/AEGIS-WT/TASK/SCRATCH'],
    ['runtime ancestor', 'C:/Program Files'],
    ['runtime descendant', 'c:/PROGRAM FILES/DOTNET/scratch'],
    ['drive root', 'X:/'],
    ['UNC namespace', '\\\\server\\share\\fresh'],
    ['relative path', 'relative/native'],
  ])('refuses %s before setup', (_name, selected) => {
    const files = fakeFiles();
    expect(() => validateTaskRoot(selected, checkout, runtime, 'reader', files)).toThrow();
    expect(files.mkdirSync).not.toHaveBeenCalled();
    expect(files.writeFileSync).not.toHaveBeenCalled();
  });

  it.each(['reader', 'fixture'])('requires a new dedicated %s leaf', (kind) => {
    const fresh = fakeFiles();
    expect(validateTaskRoot(output, checkout, runtime, kind, fresh)).toBe(output);
    const existing = fakeFiles({ exists: true });
    expect(() => validateTaskRoot(output, checkout, runtime, kind, existing)).toThrow(
      'tail-build-output-exists',
    );
    expect(existing.readFileSync).not.toHaveBeenCalled();
    expect(existing.mkdirSync).not.toHaveBeenCalled();
    expect(existing.writeFileSync).not.toHaveBeenCalled();
  });

  it.each([
    ['junction cache', { exists: true, cacheLink: true }],
    ['non-directory cache', { exists: true, cacheFile: true }],
  ])('never continues an existing fixture root with a %s', (_name, options) => {
    const files = fakeFiles(options);
    expect(() => validateTaskRoot(output, checkout, runtime, 'fixture', files)).toThrow(
      'tail-build-output-exists',
    );
    expect(files.readFileSync).not.toHaveBeenCalled();
    expect(files.mkdirSync).not.toHaveBeenCalled();
    expect(files.writeFileSync).not.toHaveBeenCalled();
  });

  it('rejects a linked parent and a non-directory immediate parent', () => {
    expect(() =>
      validateTaskRoot(
        output,
        checkout,
        runtime,
        'reader',
        fakeFiles({ link: 'X:/tmp/aegis-tail-owned' }),
      ),
    ).toThrow('tail-build-output-link');
    expect(() =>
      validateTaskRoot(output, checkout, runtime, 'reader', fakeFiles({ parentFile: true })),
    ).toThrow('tail-build-parent-unavailable');
  });

  it('checks a completed root only for read-only control execution', () => {
    const files = fakeFiles({ exists: true });
    const result = readBuiltTaskRoot(output, checkout, 'reader', files);
    expect(result.root).toBe(output);
    expect(result.receipt.result).toBe('PASS');
    expect(files.mkdirSync).not.toHaveBeenCalled();
    expect(files.writeFileSync).not.toHaveBeenCalled();
  });

  it('refuses linked completed roots before reading their markers', () => {
    const files = fakeFiles({ exists: true, link: output });
    expect(() => readBuiltTaskRoot(output, checkout, 'reader', files)).toThrow(
      'tail-build-output-link',
    );
    expect(files.readFileSync).not.toHaveBeenCalled();
  });

  it('refuses a hardlinked completed-root marker', () => {
    const files = fakeFiles({ exists: true, hardlinkedMarker: true });
    expect(() => readBuiltTaskRoot(output, checkout, 'reader', files)).toThrow(
      'tail-build-marker-unavailable',
    );
  });
});
