import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  produceGuiManifest,
  GUI_EXECUTABLE,
} from '../../scripts/produce-protected-gui-manifest.mjs';
import { createPackage } from '@electron/asar';
import { writeRebootBuild, rebootHash } from '../../tools/development/etw-reboot-support.mjs';

const folders = [];
afterEach(() => {
  for (const folder of folders.splice(0)) {
    expect(path.dirname(path.resolve(folder))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(folder).startsWith('aegis-reboot-producer-')).toBe(true);
    expect(fs.realpathSync(folder)).toBe(path.resolve(folder));
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

// Execute the actual CLI body with disposable files and bounded-command observations.
// Imports are injected; no Electron, dotnet, PowerShell or native helper is launched.
async function producer({
  buildOnly = true,
  drift = false,
  sourceDrift = false,
  fail = null,
} = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-reboot-producer-'));
  folders.push(folder);
  const root = path.join(folder, 'source'),
    output = path.join(folder, 'build');
  for (const dir of ['src/main', 'node_modules/electron/dist'])
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.mkdirSync(path.join(folder, 'Microsoft.NET/Framework64/v4.0.30319'), { recursive: true });
  fs.writeFileSync(
    path.join(folder, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    'never-executed',
  );
  fs.writeFileSync(path.join(root, 'node_modules/electron/dist/version'), '44.7.2');
  fs.writeFileSync(
    path.join(root, 'node_modules/electron/package.json'),
    JSON.stringify({ version: '44.7.2' }),
  );
  fs.writeFileSync(path.join(root, 'src/main/main.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ aegisEtwDiagnostic: true }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  const head = 'a'.repeat(40),
    tree = 'b'.repeat(40),
    calls = [],
    logs = [];
  const git = (...args) => {
    if (args[0] === 'status') return '';
    if (args[0] === 'ls-files') return args[1] === 'src/main' ? 'src/main/main.js' : '';
    return args[1] === 'HEAD'
      ? head
      : args[1] === 'HEAD^{tree}'
        ? tree
        : args[1] === '--git-dir'
          ? 'worktree-dir'
          : 'common-dir';
  };
  const canary = 'PRIVATE_BUILDER_SECRET_CANARY';
  const processStub = {
    ...process,
    platform: 'win32',
    arch: 'x64',
    versions: { ...process.versions, node: '24.20.0' },
    env: { ...process.env, SystemRoot: folder, WINDIR: folder },
    exitCode: 0,
  };
  const imports = {
    'node:fs': { default: fs },
    'node:path': { default: path },
    'node:crypto': await import('node:crypto'),
    'node:os': { default: os },
    'node:child_process': { execFileSync: (_exe, args) => git(...args) },
    'node:url': { fileURLToPath: () => path.join(root, 'tools/development/packaged-desktop.mjs') },
    'node:util': {
      parseArgs: () => ({
        values: { output, 'source-sha': head, 'etw-build-only': buildOnly, etw: !buildOnly },
      }),
    },
    './bounded-command.mjs': {
      boundedCommand: async (_exe, _args, options) => {
        const name = path.basename(options.log, '.log');
        calls.push(name);
        expect(options.env.DOTNET_GENERATE_ASPNET_CERTIFICATE).toBe('false');
        for (const key of ['TEMP', 'TMP', 'DOTNET_CLI_HOME', 'NUGET_PACKAGES'])
          expect(options.env[key].startsWith(output)).toBe(true);
        if (
          ![
            'electron-install',
            'etw-sdk-version',
            'etw-publish',
            'etw-published-self-test',
            'package',
          ].includes(name)
        )
          throw new Error('Fixture stops before live observation');
        if (name === 'package') {
          const candidate = path.join(output, 'package/win-unpacked');
          fs.mkdirSync(path.join(candidate, 'resources/etw-file'), { recursive: true });
          fs.writeFileSync(path.join(candidate, GUI_EXECUTABLE), 'never-executed');
          for (const file of ['EtwFile.exe', 'EtwFile.dll'])
            fs.writeFileSync(path.join(candidate, 'resources/etw-file', file), file);
          await createPackage(root, path.join(candidate, 'resources/app.asar'));
          if (drift) fs.appendFileSync(path.join(output, 'etw-builder.json'), ' ');
          if (sourceDrift)
            fs.appendFileSync(path.join(root, 'src/main/main.js'), '// changed after archive');
        }
        const bytes = name === 'etw-sdk-version' ? '10.0.302\n' : 'bounded fixture observation\n';
        fs.writeFileSync(options.log, bytes, { flag: 'wx' });
        return {
          code: fail === name ? 1 : 0,
          error: null,
          reason: null,
          termination: null,
          elapsedMs: 1,
          logBytes: Buffer.byteLength(bytes),
        };
      },
    },
    './desktop-contract.mjs': {
      desktopPassed: () => {
        throw Error('Unexpected GUI oracle');
      },
    },
    '../../tests/fixtures/protected-gui-process/harness.mjs': { processCoreSources: () => [] },
    '../../scripts/produce-protected-gui-manifest.mjs': { produceGuiManifest },
    './etw-package.mjs': {
      prepareEtwPackage: async (_root, _output, command) => {
        await command('etw-publish', 'never-executed', [], 240000);
        await command('etw-published-self-test', 'never-executed', [], 30000);
        const config = path.join(output, 'etw-builder.json');
        fs.writeFileSync(
          config,
          JSON.stringify({ extraMetadata: { aegisEtwDiagnostic: true }, apiKey: canary }),
        );
        return config;
      },
    },
    './etw-qualification.mjs': {
      qualifyEtw: () => {
        throw Error('Unexpected live qualification');
      },
    },
    './etw-reboot-support.mjs': {
      writeRebootBuild: (...args) =>
        writeRebootBuild(...args, { git, platform: 'win32', arch: 'x64' }),
    },
  };
  const file = fileURLToPath(
    new URL('../../tools/development/packaged-desktop.mjs', import.meta.url),
  );
  const source = fs
    .readFileSync(file, 'utf8')
    .replace(/^import\s+([\s\S]*?)\s+from\s+'([^']+)';/gm, (_match, binding, name) =>
      binding.trim().startsWith('{')
        ? `const ${binding} = imports[${JSON.stringify(name)}];`
        : `const ${binding} = imports[${JSON.stringify(name)}].default;`,
    )
    .replaceAll(
      'import.meta.url',
      JSON.stringify(new URL('../../tools/development/packaged-desktop.mjs', import.meta.url).href),
    );
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction('imports', 'process', 'console', source)(imports, processStub, {
    log: (value) => logs.push(value),
  });
  const evidence = path.join(output, 'evidence');
  return {
    calls,
    logs,
    canary,
    receipt: JSON.parse(fs.readFileSync(path.join(evidence, 'receipt.json'))),
    projection: fs.existsSync(path.join(evidence, 'reboot-build.json'))
      ? fs.readFileSync(path.join(evidence, 'reboot-build.json'), 'utf8')
      : null,
    logBytes: fs
      .readdirSync(output)
      .filter((f) => f.endsWith('.log'))
      .map((f) => fs.readFileSync(path.join(output, f), 'utf8'))
      .join(''),
    lock: rebootHash('{}\n'),
  };
}

it('stops the actual build-only CLI before probe/GUI/UAC/capture and writes a hash-only private projection', async () => {
  const r = await producer();
  expect(r.receipt.status).toBe('BUILD_PASS');
  expect(r.calls).toEqual([
    'etw-sdk-version',
    'electron-install',
    'etw-publish',
    'etw-published-self-test',
    'package',
  ]);
  expect(r.receipt.scope.windowObservation).toBe(false);
  expect(JSON.parse(r.projection).lockSha256).toBe(r.lock);
  for (const text of [r.projection, r.logBytes, JSON.stringify(r.logs), JSON.stringify(r.receipt)])
    expect(text).not.toContain(r.canary);
});

it.each([
  { drift: true },
  { sourceDrift: true },
  { fail: 'etw-sdk-version' },
  { fail: 'electron-install' },
  { fail: 'etw-publish' },
  { fail: 'etw-published-self-test' },
  { fail: 'package' },
])(
  'does not emit successful evidence after failed commands or input drift: %j',
  async (options) => {
    const r = await producer(options);
    expect(r.receipt.status).toBe('FAIL');
    expect(r.projection).toBeNull();
    expect(r.calls).not.toContain('compile-probe');
    expect(JSON.stringify(r.receipt)).not.toContain(r.canary);
  },
);

it('keeps the existing ETW profile on the desktop path, stopped by the fixture before native execution', async () => {
  const r = await producer({ buildOnly: false });
  expect(r.calls).toContain('compile-probe');
  expect(r.calls).not.toContain('etw-sdk-version');
  expect(r.projection).toBeNull();
  expect(r.receipt.status).toBe('FAIL');
});
