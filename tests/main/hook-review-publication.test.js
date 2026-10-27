import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { publishAssets } = require('../../scripts/hook-review-publication.cjs');
const { loadProfileAssets } = require('../../src/main/claude-hook-app-profile');
let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-publish-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function sourceTree() {
  const source = path.join(root, 'stage');
  fs.mkdirSync(path.join(source, 'host'), { recursive: true });
  fs.mkdirSync(path.join(source, 'runtime'));
  fs.writeFileSync(path.join(source, 'host', 'host.dll'), 'host fixture');
  fs.writeFileSync(path.join(source, 'runtime', 'dotnet.exe'), 'runtime fixture');
  fs.writeFileSync(path.join(source, 'assets.json'), '{"fixture":true}');
  return source;
}

describe('hook-review asset publication', () => {
  it('publishes the descriptor only after verifying the complete copy', () => {
    const source = sourceTree();
    const destination = path.join(root, 'result');
    publishAssets(source, destination, (published) => {
      expect(fs.existsSync(path.join(published, 'assets.json'))).toBe(false);
      expect(fs.readFileSync(path.join(published, 'host', 'host.dll'), 'utf8')).toBe(
        'host fixture',
      );
      expect(fs.readFileSync(path.join(published, 'runtime', 'dotnet.exe'), 'utf8')).toBe(
        'runtime fixture',
      );
    });
    expect(fs.readFileSync(path.join(destination, 'assets.json'), 'utf8')).toBe('{"fixture":true}');
  });

  it('retains an interrupted copy without publishing a descriptor', async () => {
    const source = sourceTree();
    const destination = path.join(root, 'partial');
    let copies = 0;
    const interrupted = (from, to, options) => {
      if (++copies === 2) throw new Error('copy interrupted');
      fs.cpSync(from, to, options);
    };
    expect(() =>
      publishAssets(
        source,
        destination,
        () => {
          throw new Error('unexpected verify');
        },
        interrupted,
      ),
    ).toThrow('copy interrupted');
    expect(fs.readFileSync(path.join(destination, 'host', 'host.dll'), 'utf8')).toBe(
      'host fixture',
    );
    expect(fs.existsSync(path.join(destination, 'assets.json'))).toBe(false);
    await expect(loadProfileAssets(destination)).resolves.toBeNull();
    expect(fs.existsSync(path.join(source, 'assets.json'))).toBe(true);
  });

  it('refuses to adopt or overwrite an unexpected destination', () => {
    const source = sourceTree();
    const destination = path.join(root, 'existing');
    fs.mkdirSync(destination);
    fs.writeFileSync(path.join(destination, 'owner.txt'), 'do not overwrite');
    expect(() => publishAssets(source, destination, () => {})).toThrow();
    expect(fs.readdirSync(destination)).toEqual(['owner.txt']);
    expect(fs.readFileSync(path.join(destination, 'owner.txt'), 'utf8')).toBe('do not overwrite');
  });
});

describe.skipIf(process.platform !== 'win32')('electron-builder signing selection', () => {
  it('preserves the copied Microsoft dotnet bytes while still signing another executable', async () => {
    require('app-builder-lib'); // Initialize the public entry before its internal packager.
    const { WinPackager } = require('app-builder-lib/out/winPackager');
    const { FileCopier, DO_NOT_USE_HARD_LINKS } = require('builder-util');
    const signExts = require('../../package.json').build.win.signExts;
    const calls = [];
    const packager = {
      platformSpecificBuildOptions: { signExts },
      shouldSignFile: WinPackager.prototype.shouldSignFile,
      async signIf(file) {
        calls.push(file);
        fs.appendFileSync(file, ' signed');
        return true;
      },
    };
    const appOutDir = path.join(root, 'package');
    const transformer = WinPackager.prototype.createTransformerForExtraFiles.call(packager, {
      appOutDir,
    });
    const source = path.join(root, 'source', 'hook-review', 'runtime');
    const target = path.join(appOutDir, 'resources', 'hook-review', 'runtime');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    const copier = new FileCopier(DO_NOT_USE_HARD_LINKS, transformer);
    const runtime = path.join(source, 'dotnet.exe');
    for (const version of ['10.0.10', '10.0.14']) {
      const runtimeFolder = path.join(source, 'shared', 'Microsoft.NETCore.App', version);
      const targetFolder = path.join(target, 'shared', 'Microsoft.NETCore.App', version);
      fs.mkdirSync(runtimeFolder, { recursive: true });
      fs.mkdirSync(targetFolder, { recursive: true });
      const dump = path.join(runtimeFolder, 'createdump.exe');
      const copied = path.join(targetFolder, 'createdump.exe');
      fs.writeFileSync(dump, 'signed dump fixture');
      expect(packager.shouldSignFile(dump)).toBe(false);
      expect(packager.shouldSignFile(copied)).toBe(false);
      await copier.copy(dump, copied, fs.statSync(dump));
      expect(fs.readFileSync(copied, 'utf8')).toBe('signed dump fixture');
    }
    const helper = path.join(source, 'other-helper.exe');
    fs.writeFileSync(runtime, 'signed microsoft fixture');
    fs.writeFileSync(helper, 'helper fixture');
    expect(packager.shouldSignFile(runtime)).toBe(false);
    expect(packager.shouldSignFile(path.join(target, 'dotnet.exe'))).toBe(false);
    expect(packager.shouldSignFile(helper)).toBe(true);
    await copier.copy(runtime, path.join(target, 'dotnet.exe'), fs.statSync(runtime));
    await copier.copy(helper, path.join(target, 'other-helper.exe'), fs.statSync(helper));
    expect(fs.readFileSync(path.join(target, 'dotnet.exe'), 'utf8')).toBe(
      'signed microsoft fixture',
    );
    expect(fs.readFileSync(path.join(target, 'other-helper.exe'), 'utf8')).toBe(
      'helper fixture signed',
    );
    expect(calls).toEqual([path.join(target, 'other-helper.exe')]);
  });
});
