import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { loadProfileAssets, prepareProfile } = require('../../src/main/claude-hook-app-profile');
const { qualifyAssets } = require('../../src/main/claude-hook-windows-io-wire');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hostNames = [
  'HookTransaction.dll',
  'HookTransaction.deps.json',
  'HookTransaction.runtimeconfig.json',
  'HookConfigTarget.dll',
  'HookPrivateBackup.dll',
];
let fixture;

function createAssets(root) {
  const host = path.join(root, 'host');
  const runtime = path.join(root, 'runtime');
  const shared = path.join(runtime, 'shared', 'Microsoft.NETCore.App', '10.0.14');
  const fxr = path.join(runtime, 'host', 'fxr', '10.0.14');
  fs.mkdirSync(host, { recursive: true });
  fs.mkdirSync(shared, { recursive: true });
  fs.mkdirSync(fxr, { recursive: true });
  const config = JSON.stringify({
    runtimeOptions: {
      tfm: 'net10.0',
      rollForward: 'Disable',
      framework: { name: 'Microsoft.NETCore.App', version: '10.0.14' },
      configProperties: {
        'System.Reflection.Metadata.MetadataUpdater.IsSupported': false,
        'System.Runtime.Serialization.EnableUnsafeBinaryFormatterSerialization': false,
        CSWINRT_USE_WINDOWS_UI_XAML_PROJECTIONS: false,
      },
    },
  });
  const hostFiles = hostNames.map((name) => {
    const contents = name.endsWith('runtimeconfig.json') ? config : `fixture-${name}`;
    fs.writeFileSync(path.join(host, name), contents);
    return { name, sha256: digest(contents) };
  });
  fs.writeFileSync(path.join(shared, 'coreclr.dll'), 'fixture runtime');
  fs.writeFileSync(path.join(fxr, 'hostfxr.dll'), 'fixture fxr');
  fs.writeFileSync(path.join(runtime, 'dotnet.exe'), 'fixture executable');
  fs.writeFileSync(
    path.join(root, 'assets.json'),
    JSON.stringify({
      schemaVersion: 2,
      hostFiles,
      runtimeVersion: '10.0.14',
      runtimeFiles: [{ name: 'coreclr.dll', sha256: digest('fixture runtime') }],
      hostFxrSha256: digest('fixture fxr'),
      executableSha256: digest('fixture executable'),
    }),
  );
}

describe.skipIf(process.platform !== 'win32')('portable Claude hook review assets', () => {
  beforeEach(() => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-guard-assets-'));
    createAssets(path.join(fixture, 'first'));
  });
  afterEach(() => fs.rmSync(fixture, { recursive: true, force: true }));

  it('loads after relocation and supplies an isolated runtime environment', async () => {
    const relocated = path.join(fixture, 'different install', 'guard');
    fs.cpSync(path.join(fixture, 'first'), relocated, { recursive: true });
    const assets = await loadProfileAssets(relocated);
    expect(assets).not.toBeNull();
    expect(assets.runtimeRoot).toBe(path.win32.join(relocated, 'runtime'));
    const launch = qualifyAssets(assets);
    expect(launch.executable).toBe(path.win32.join(relocated, 'runtime', 'dotnet.exe'));
    expect(launch.env.DOTNET_ROOT).toBe(path.win32.join(relocated, 'runtime'));
    expect(launch.env.DOTNET_ROLL_FORWARD).toBe('Disable');
    expect(launch.env.PATH).toBeUndefined();
    expect(launch.env.DOTNET_STARTUP_HOOKS).toBeUndefined();
  });

  it('loads an ordinary Windows installation path with a lowercase drive letter', async () => {
    const root = path.join(fixture, 'first').replace(/^[A-Z]:/, (drive) => drive.toLowerCase());
    expect(root[0]).toMatch(/[a-z]/);
    expect(await loadProfileAssets(root)).not.toBeNull();
  });

  it('prepares the same owned profile for a lowercase Windows user-data drive', async () => {
    const directory = path.join(fixture, 'profile').replace(/^[A-Z]:/, (drive) => drive.toLowerCase());
    const selected = await prepareProfile(directory);
    expect(selected.targetPath[0]).toMatch(/[A-Z]/);
    expect(selected.backupRoot[0]).toBe(selected.targetPath[0]);
    expect(fs.readFileSync(selected.targetPath, 'utf8')).toBe('{}\n');
    expect(fs.existsSync(path.join(directory, 'settings.json'))).toBe(true);
  });

  it.each(['missing', 'extra', 'altered', 'runtime-config', 'extra-hostfxr'])(
    'refuses %s assets',
    async (change) => {
      const root = path.join(fixture, 'first');
      const runtime = path.join(root, 'runtime', 'shared', 'Microsoft.NETCore.App', '10.0.14');
      if (change === 'missing') fs.unlinkSync(path.join(runtime, 'coreclr.dll'));
      if (change === 'extra') fs.writeFileSync(path.join(runtime, 'extra.dll'), 'extra');
      if (change === 'altered') fs.writeFileSync(path.join(runtime, 'coreclr.dll'), 'changed');
      if (change === 'runtime-config') {
        const config = path.join(root, 'host', 'HookTransaction.runtimeconfig.json');
        const value = JSON.parse(fs.readFileSync(config, 'utf8'));
        value.runtimeOptions.rollForward = 'LatestMajor';
        const bytes = JSON.stringify(value);
        fs.writeFileSync(config, bytes);
        const descriptor = path.join(root, 'assets.json');
        const manifest = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
        manifest.hostFiles.find((x) => x.name.endsWith('runtimeconfig.json')).sha256 =
          digest(bytes);
        fs.writeFileSync(descriptor, JSON.stringify(manifest));
      }
      if (change === 'extra-hostfxr')
        fs.writeFileSync(
          path.join(root, 'runtime', 'host', 'fxr', '10.0.14', 'extra.dll'),
          'extra',
        );
      expect(await loadProfileAssets(root)).toBeNull();
    },
  );

  it('refuses a linked ancestor', async () => {
    const link = path.join(fixture, 'link');
    fs.symlinkSync(path.join(fixture, 'first'), link, 'junction');
    try {
      expect(await loadProfileAssets(link)).toBeNull();
    } finally {
      fs.unlinkSync(link);
    }
  });
});
