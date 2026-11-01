import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  discoverGitLayout,
  copyPortableGit,
} from '../../tools/development/cloud-native-read-git.mjs';

const folders = [];
afterEach(() => {
  for (const folder of folders.splice(0)) {
    expect(path.dirname(path.resolve(folder))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(folder).startsWith('aegis-git-layout-')).toBe(true);
    expect(fs.realpathSync(folder)).toBe(path.resolve(folder));
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
function layoutFixture(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-git-layout-'));
  folders.push(root);
  const launcher = path.join(root, 'cmd/git.exe');
  const native = path.join(root, prefix, 'bin/git.exe');
  const execPath = path.join(root, prefix, 'libexec/git-core');
  fs.mkdirSync(path.dirname(launcher), { recursive: true });
  fs.mkdirSync(path.dirname(native), { recursive: true });
  fs.mkdirSync(execPath, { recursive: true });
  fs.writeFileSync(launcher, 'fixture launcher, never executable');
  fs.writeFileSync(native, 'fixture native, never executable');
  fs.writeFileSync(path.join(path.dirname(native), 'libz.dll'), 'fixture dependency');
  fs.writeFileSync(path.join(path.dirname(native), 'gitconfig'), 'PRIVATE_FIXTURE_CONFIG');
  return { root, launcher, native, execPath };
}

describe('portable Git layout discovery without executing fixture files', () => {
  it.each(['mingw64', 'ucrt64'])(
    'discovers %s from the observed exec path and excludes configuration',
    (prefix) => {
      const fixture = layoutFixture(prefix);
      const layout = discoverGitLayout(fixture.launcher, fixture.execPath);
      expect(layout.native).toBe(fixture.native);
      const output = path.join(fixture.root, 'portable');
      const receipt = copyPortableGit(layout, output, (from, to) => fs.copyFileSync(from, to));
      expect(receipt.files.map((file) => file.name)).toEqual(['bin/git.exe', 'bin/libz.dll']);
      expect(fs.readFileSync(path.join(output, 'bin/git.exe'), 'utf8')).toBe(
        'fixture native, never executable',
      );
      expect(fs.existsSync(path.join(output, 'bin/gitconfig'))).toBe(false);
      expect(fs.existsSync(path.join(output, 'cmd/git.exe'))).toBe(false);
    },
  );
  it('refuses a shim-only layout instead of silently using an original installation', () => {
    const fixture = layoutFixture('ucrt64');
    fs.unlinkSync(fixture.native);
    expect(() => discoverGitLayout(fixture.launcher, fixture.execPath)).toThrow(
      'portable-git-layout-unavailable',
    );
  });
});
