import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPackage } from '@electron/asar';
import {
  produceGuiManifest,
  GUI_EXECUTABLE,
} from '../../scripts/produce-protected-gui-manifest.mjs';
import {
  rebootBinding,
  rebootHash,
  readRebootReceipt,
  writeRebootBuild,
} from '../../tools/development/etw-reboot-support.mjs';
import { withRebootHost } from '../../tools/development/etw-reboot-host.mjs';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';

const folders = [];
afterEach(() => {
  for (const folder of folders.splice(0)) {
    expect(path.dirname(path.resolve(folder))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(folder).startsWith('aegis-reboot-binding-')).toBe(true);
    expect(fs.realpathSync(folder)).toBe(path.resolve(folder));
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

async function fixture() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-reboot-binding-'));
  folders.push(folder);
  const root = path.join(folder, 'source'),
    candidate = path.join(folder, 'candidate');
  for (const dir of ['src/main', 'src/shared', 'sidecar/etw-file'])
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.mkdirSync(path.join(candidate, 'resources/etw-file'), { recursive: true });
  const rows = [
    ['src/main/main.js', 'module.exports = {};\n'],
    ['src/shared/test.json', '{}\n'],
    ['sidecar/etw-file/FileWire.cs', 'fixture-protocol-10\n'],
  ];
  for (const [file, bytes] of rows) fs.writeFileSync(path.join(root, file), bytes);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ aegisEtwDiagnostic: true }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  fs.writeFileSync(path.join(candidate, GUI_EXECUTABLE), 'fixture-only-never-executed');
  for (const file of ['EtwFile.exe', 'EtwFile.dll'])
    fs.writeFileSync(path.join(candidate, 'resources/etw-file', file), file);
  await createPackage(root, path.join(candidate, 'resources/app.asar'));
  const head = 'a'.repeat(40),
    tree = 'b'.repeat(40);
  const config = path.join(folder, 'config.json'),
    buildFile = path.join(folder, 'build.json');
  fs.writeFileSync(config, JSON.stringify({ extraMetadata: { aegisEtwDiagnostic: true } }));
  const hashed = rows.map(([file, data]) => [file, rebootHash(data)]);
  const build = {
    schemaVersion: 1,
    status: 'PASS',
    commands: ['etw-sdk-version', 'etw-publish', 'etw-published-self-test', 'package'].map(
      (name) => ({
        name,
        code: 0,
        error: null,
        reason: null,
        termination: null,
        elapsedMs: 1,
        logBytes: 10,
      }),
    ),
    sourceHead: head,
    sourceTree: tree,
    lockSha256: rebootHash('{}\n'),
    packageManifestSha256: rebootHash(produceGuiManifest(candidate)),
    nativeExeSha256: rebootHash('EtwFile.exe'),
    nativeDllSha256: rebootHash('EtwFile.dll'),
    runtimeSourcesSha256: rebootHash(JSON.stringify(hashed)),
    archiveSourceSha256: rebootHash(
      JSON.stringify(hashed.filter(([file]) => file.startsWith('src/'))),
    ),
    harnessSha256: rebootHash('[]'),
    configSha256: rebootHash(fs.readFileSync(config)),
    publicProtocol: 'etw-file/10',
    observerContract: 'full-record-sha256-v1',
    electronVersion: '44.7.2',
    dotnetSdk: '10.0.302',
    nodeVersion: process.versions.node,
    diagnosticBuild: true,
    platform: 'win32',
    arch: 'x64',
  };
  fs.writeFileSync(buildFile, JSON.stringify(build));
  let dirty = false;
  const git = (...args) => {
    if (args[0] === 'status') return dirty ? ' M source' : '';
    if (args[0] === 'rev-parse') return args[1] === 'HEAD' ? head : tree;
    return args[1] === 'src/main' ? rows.map(([file]) => file).join('\n') : '';
  };
  return {
    root,
    candidate,
    head,
    config,
    buildFile,
    build,
    git,
    read: () =>
      rebootBinding(root, candidate, head, buildFile, config, {
        git,
        platform: 'win32',
        arch: 'x64',
      }),
    dirty: () => {
      dirty = true;
    },
    save: () => fs.writeFileSync(buildFile, JSON.stringify(build)),
  };
}

describe('current restart candidate identity binding without native execution', () => {
  it('emits the supported build projection only from successful ordered bounded commands and fresh inputs', async () => {
    const f = await fixture();
    const output = path.join(path.dirname(f.config), 'produced-build.json');
    const observation = {
      ...f.build,
      source: { tree: f.build.sourceTree, lockSha256: f.build.lockSha256 },
    };
    const emit = () =>
      writeRebootBuild(f.root, f.candidate, f.head, f.config, observation, output, {
        git: f.git,
        platform: 'win32',
        arch: 'x64',
      });
    for (const change of [
      () => {
        observation.commands[1].code = 1;
      },
      () => {
        observation.commands[1].code = 0;
        observation.commands[1].reason = 'timeout';
      },
      () => {
        observation.commands[1].reason = null;
        observation.commands.reverse();
      },
    ]) {
      change();
      expect(emit).toThrow('Successful ordered bounded build commands required');
      expect(fs.existsSync(output)).toBe(false);
    }
    observation.commands.reverse();
    const actual = emit();
    expect(actual.nativeDllSha256).toBe(f.build.nativeDllSha256);
    expect(actual.commands.map((c) => c.name)).toEqual([
      'etw-sdk-version',
      'etw-publish',
      'etw-published-self-test',
      'package',
    ]);
    expect(emit).toThrow(); // A successful prior receipt is immutable.
    fs.unlinkSync(output);
    observation.source.tree = 'f'.repeat(40);
    expect(emit).toThrow('Build inputs changed');
    observation.source.tree = f.build.sourceTree;
    observation.configSha256 = 'f'.repeat(64);
    expect(emit).toThrow('Build inputs changed');
  });
  it('hashes complete builder configuration without exporting secret values or malformed input excerpts', async () => {
    const f = await fixture(),
      canary = 'PRIVATE_API_KEY_CANARY_DO_NOT_LOG';
    fs.writeFileSync(
      f.config,
      JSON.stringify({ extraMetadata: { aegisEtwDiagnostic: true }, apiKey: canary }),
    );
    f.build.configSha256 = rebootHash(fs.readFileSync(f.config));
    const output = path.join(path.dirname(f.config), 'private-projection.json');
    const observation = {
      ...f.build,
      source: { tree: f.build.sourceTree, lockSha256: f.build.lockSha256 },
      unexpectedSecret: canary,
    };
    const projection = writeRebootBuild(
      f.root,
      f.candidate,
      f.head,
      f.config,
      observation,
      output,
      { git: f.git, platform: 'win32', arch: 'x64' },
    );
    const log = JSON.stringify(projection);
    expect(log).not.toContain(canary);
    expect(log).not.toContain('apiKey');
    expect(fs.readFileSync(output, 'utf8')).not.toContain(canary);
    fs.writeFileSync(f.config, '{"apiKey":"' + canary + '",');
    let message;
    try {
      readRebootReceipt(f.config);
    } catch (error) {
      message = String(error);
    }
    expect(message).toBe('Error: Invalid bounded JSON input');
    expect(message).not.toContain(canary);
  });
  it('uses only a fresh bounded closed host exchange and never acts on malformed metadata', async () => {
    const fake = (frame) => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new Writable({
        write(_chunk, _encoding, callback) {
          child.stdout.write(
            JSON.stringify({
              type: 'host-finished',
              launches: 1,
              liveChildren: 0,
              childExitCodes: [70],
              exitCode: 0,
            }) + '\n',
          );
          child.emit('close', 0);
          callback();
        },
      });
      queueMicrotask(() => child.stdout.write(frame));
      return child;
    };
    const ready =
      JSON.stringify({ type: 'host-ready', address: 'a'.repeat(32) + ':71:134000000000001111' }) +
      '\n';
    let calls = 0;
    const good = await withRebootHost(
      'fixture-helper',
      'fixture-output',
      {},
      async (env) => {
        calls++;
        expect(env.AEGIS_ETW_QUALIFICATION_HOST).toContain(':71:');
        return 'observed';
      },
      { spawnProcess: () => fake(ready) },
    );
    expect(good.failure).toBeNull();
    expect(good.result).toBe('observed');
    expect(calls).toBe(1);
    for (const bad of [
      ready.replace('"address":', '"rawRecord":{},"address":'),
      'x'.repeat(16385),
      JSON.stringify({
        type: 'host-finished',
        launches: 0,
        liveChildren: 0,
        childExitCodes: [],
        exitCode: 0,
      }) +
        '\n' +
        ready,
    ]) {
      const result = await withRebootHost(
        'fixture-helper',
        'fixture-output',
        {},
        async () => {
          calls++;
        },
        { spawnProcess: () => fake(bad) },
      );
      expect(result.failure).not.toBeNull();
      expect(calls).toBe(1);
    }
  });
  it('compares real ASAR runtime bytes and complete package/build/config/native identities', async () => {
    const f = await fixture(),
      value = f.read();
    expect(value.buildReceiptSha256).toBe(rebootHash(fs.readFileSync(f.buildFile)));
    expect(value.publicProtocol).toBe('etw-file/10');
    expect(value.runtimeSourcesSha256).toBe(f.build.runtimeSourcesSha256);
    fs.writeFileSync(path.join(f.candidate, 'resources/etw-file/EtwFile.dll'), 'changed');
    expect(f.read).toThrow('Build input mismatch');
  });
  it('refuses stale archives, dirty source and config/build drift before any launch', async () => {
    const f = await fixture();
    fs.writeFileSync(path.join(f.root, 'src/main/main.js'), 'changed');
    expect(f.read).toThrow('Archived runtime source mismatch');
    fs.writeFileSync(path.join(f.root, 'src/main/main.js'), 'module.exports = {};\n');
    f.build.configSha256 = 'f'.repeat(64);
    f.save();
    expect(f.read).toThrow('Build input mismatch');
    f.dirty();
    expect(f.read).toThrow('Clean source required');
  });
  it('refuses unsuccessful build observations and bounded malformed receipt files', async () => {
    const f = await fixture();
    f.build.commands[0].reason = 'timeout';
    f.save();
    expect(f.read).toThrow('Successful bounded build receipt required');
    fs.writeFileSync(f.buildFile, Buffer.alloc(262145));
    expect(() => readRebootReceipt(f.buildFile)).toThrow();
  });
});
