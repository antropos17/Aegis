import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const confirmation = require('../../src/main/action-confirmation');
const runner = require('../../src/main/action-execution');
const { handleActionExecutionCLI } = require('../../src/main/action-execution-cli');
const { spawnActionInAppContainer } = require('../../src/main/mcp-gateway-windows-job');
const project = path.resolve(import.meta.dirname, '../..');
const scratch = path.resolve(process.env.AEGIS_APPCONTAINER_TEST_TMP || os.tmpdir());
const csc = path.join(
  process.env.WINDIR || 'C:\\Windows',
  'Microsoft.NET',
  'Framework64',
  'v4.0.30319',
  'csc.exe',
);
const allPackages = '*S-1-15-2-1';
let helperRoot, helper, root, cwd, probe, privateFile;
let children = [];

function removeOwned(directory) {
  if (!directory || !fs.existsSync(directory)) return;
  expect(path.dirname(directory)).toBe(scratch);
  expect(fs.lstatSync(directory).isSymbolicLink()).toBe(false);
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
function compile(output, sources) {
  execFileSync(
    csc,
    [
      '/nologo',
      '/target:exe',
      '/platform:x64',
      '/optimize+',
      '/warnaserror+',
      '/reference:System.Web.Extensions.dll',
      ...(path.basename(output) === 'aegis-mcpjob.exe' ? ['/define:APPCONTAINER_TEST'] : []),
      '/out:' + output,
      ...sources,
    ],
    { cwd: project, windowsHide: true, stdio: 'pipe', timeout: 30000 },
  );
}
function acl(directory, access) {
  execFileSync('icacls.exe', [directory, '/grant', allPackages + ':' + access], {
    windowsHide: true,
    stdio: 'pipe',
    timeout: 5000,
  });
}
function setupFixture() {
  root = fs.mkdtempSync(path.join(scratch, 'aegis-appcontainer-'));
  const bin = path.join(root, 'bin');
  const privateDir = path.join(root, 'private');
  fs.mkdirSync(bin);
  fs.mkdirSync(privateDir);
  cwd = path.join(root, 'isolated-workspace');
  privateFile = path.join(privateDir, 'secret.txt');
  probe = path.join(bin, 'appcontainer-probe.exe');
  fs.writeFileSync(privateFile, 'AEGIS_PRIVATE_SENTINEL');
  compile(probe, [path.join(project, 'tests', 'fixtures', 'appcontainer-probe.cs')]);
  // Grant only this disposable executable and its directory, not installed software.
  acl(root, '(RX)');
  acl(bin, '(OI)(CI)(RX)');
  acl(probe, '(RX)');
}
function selected(executable, args, workingDirectory = cwd) {
  const action = {
    executable,
    cwd: workingDirectory,
    args,
    env: {
      SYSTEMROOT: process.env.SystemRoot || process.env.SYSTEMROOT,
      WINDIR: process.env.WINDIR,
      TEMP: workingDirectory,
      TMP: workingDirectory,
      LOCALAPPDATA: workingDirectory,
      USERPROFILE: workingDirectory,
    },
  };
  const policy = path.join(root, 'policy.json');
  const request = path.join(root, 'request.json');
  fs.writeFileSync(
    policy,
    JSON.stringify({
      schemaVersion: 2,
      defaultDecision: 'deny',
      rules: [{ action, decision: 'ask' }],
    }),
  );
  fs.writeFileSync(request, JSON.stringify({ schemaVersion: 1, action }));
  return { policy, request };
}
function approve() {
  confirmation._setDepsForTest({
    available: () => true,
    confirm: async () => true,
    watchTerminal: () => () => {},
    monitorInput: () => () => {},
  });
}
function readEvidence(name, directory = cwd) {
  return Object.fromEntries(
    fs
      .readFileSync(path.join(directory, name), 'utf8')
      .trim()
      .split('\n')
      .map((line) => {
        const at = line.indexOf('=');
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function nativeImportAttempt(input, directory = cwd) {
  const chosen = selected(probe, ['child', privateFile], directory);
  const launch = JSON.parse(fs.readFileSync(chosen.request, 'utf8')).action;
  const peer = spawnActionInAppContainer(
    {
      ...launch,
      input,
      executableSnapshot: {
        path: probe,
        size: fs.statSync(probe).size,
        sha256: createHash('sha256').update(fs.readFileSync(probe)).digest('hex'),
      },
    },
    helper,
  );
  peer.on('error', () => {});
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('native import timeout')), 12000);
    peer.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  return peer;
}
async function nativeExecutableAttempt(executable, changes = {}, directory = cwd) {
  const chosen = selected(executable, ['child', privateFile], directory);
  const launch = JSON.parse(fs.readFileSync(chosen.request, 'utf8')).action;
  const peer = spawnActionInAppContainer(
    {
      ...launch,
      executableSnapshot: {
        path: executable,
        size: fs.statSync(probe).size,
        sha256: createHash('sha256').update(fs.readFileSync(probe)).digest('hex'),
        ...changes,
      },
    },
    helper,
  );
  peer.on('error', () => {});
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('native executable timeout')), 12000);
    peer.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  return peer;
}
async function listener() {
  let connections = 0;
  const server = net.createServer((socket) => {
    connections++;
    socket.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port, connections: () => connections };
}
async function directConnect(port) {
  await new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.end();
      resolve();
    });
    socket.once('error', reject);
  });
}

describe.skipIf(process.platform !== 'win32')('Windows AppContainer selected action', () => {
  beforeAll(() => {
    fs.mkdirSync(scratch, { recursive: true });
    helperRoot = fs.mkdtempSync(path.join(scratch, 'aegis-appcontainer-helper-'));
    helper = path.join(helperRoot, 'aegis-mcpjob.exe');
    compile(
      helper,
      fs
        .readdirSync(path.join(project, 'sidecar', 'mcpjob'))
        .filter((name) => name.endsWith('.cs'))
        .map((name) => path.join(project, 'sidecar', 'mcpjob', name)),
    );
  });
  beforeEach(() => {
    setupFixture();
    runner._setDepsForTest({
      spawnIsolated: (launch) => spawnActionInAppContainer(launch, helper),
    });
    approve();
  });
  afterEach(() => {
    confirmation._resetForTest();
    runner._resetForTest();
    for (const pid of children) if (alive(pid)) process.kill(pid, 'SIGKILL');
    children = [];
    removeOwned(root);
    root = undefined;
  });
  afterAll(() => removeOwned(helperRoot));

  it('keeps private files and loopback out while retaining the isolated workspace', async () => {
    const peer = await listener();
    try {
      await directConnect(peer.port);
      const control = path.join(root, 'control');
      fs.mkdirSync(control);
      const controlPrivate = path.join(control, 'sentinel.txt');
      fs.writeFileSync(controlPrivate, 'AEGIS_PRIVATE_SENTINEL');
      const controlExit = await new Promise((resolve, reject) => {
        const process = spawn(probe, ['evidence', controlPrivate, String(peer.port)], {
          cwd: control,
          windowsHide: true,
          stdio: 'ignore',
        });
        process.once('error', reject);
        process.once('exit', resolve);
      });
      expect(controlExit).toBe(0);
      const controlParent = readEvidence('parent.txt', control);
      const controlChild = readEvidence('child.txt', control);
      expect(controlParent).toMatchObject({
        read: 'secret-leaked',
        write: 'write-succeeded',
        network: 'connected',
      });
      expect(controlChild).toMatchObject({ read: 'secret-leaked', write: 'write-succeeded' });
      expect(peer.connections()).toBe(2);
      const chosen = selected(probe, ['evidence', privateFile, String(peer.port)]);
      const output = [];
      const code = await handleActionExecutionCLI(
        ['--action-exec-appcontainer-confirm', chosen.policy, chosen.request],
        (line) => output.push(line),
      );
      expect(code).toBe(0);
      const report = JSON.parse(output[0]);
      expect(report).toMatchObject({
        decision: 'allow',
        authorization: 'operator-confirmed',
        control: 'windows-appcontainer-job',
        descendantControl: 'confirmed',
        isolation: { state: 'verified', workspace: 'retained', profileCleanup: 'confirmed' },
        execution: { state: 'exited', exitCode: 0, outputComplete: true },
      });
      const parent = readEvidence('parent.txt');
      const child = readEvidence('child.txt');
      expect(parent.read).toBe('UnauthorizedAccessException');
      expect(parent.write).toBe('UnauthorizedAccessException');

      expect(['timeout', 'socket-10013']).toContain(parent.network);
      expect(child.read).toBe('UnauthorizedAccessException');
      expect(child.write).toBe('UnauthorizedAccessException');
      expect(peer.connections()).toBe(2);
      expect(fs.existsSync(privateFile + '.parent')).toBe(false);
      expect(fs.existsSync(privateFile + '.child')).toBe(false);
      expect(output[0]).not.toContain(privateFile);
      expect(output[0]).not.toContain('AEGIS_PRIVATE_SENTINEL');
    } finally {
      await new Promise((resolve) => peer.server.close(resolve));
    }
  }, 15000);

  it('runs an accessible system executable under the verified boundary', async () => {
    const chosen = selected(
      path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'whoami.exe'),
      [],
    );
    const result = await confirmation.confirmSelectedAction(chosen.policy, chosen.request, {
      appContainer: true,
    });
    expect(result).toMatchObject({
      decision: 'allow',
      control: 'windows-appcontainer-job',
      isolation: { state: 'verified', workspace: 'retained', profileCleanup: 'confirmed' },
      execution: { state: 'exited', exitCode: 0 },
    });

    expect(fs.existsSync(cwd)).toBe(true);
  }, 15000);

  it('refuses an executable changed during terminal review before the child starts', async () => {
    const chosen = selected(probe, ['child', privateFile]);
    const privateDigest = createHash('sha256').update(fs.readFileSync(probe)).digest('hex');
    confirmation._setDepsForTest({
      available: () => true,
      confirm: async (preview) => {
        expect(JSON.stringify(preview)).not.toContain(privateDigest);
        fs.appendFileSync(probe, Buffer.from('changed-after-review'));
        return true;
      },
      watchTerminal: () => () => {},
      monitorInput: () => () => {},
    });
    const result = await confirmation.confirmSelectedAction(chosen.policy, chosen.request, {
      appContainer: true,
    });
    expect(result.execution.state).not.toBe('exited');
    expect(fs.existsSync(path.join(cwd, 'child.txt'))).toBe(false);
    expect(JSON.stringify(result)).not.toContain(probe);
  }, 15000);

  it('stops a suspended child when the native image identity check disagrees', async () => {
    const mismatch = path.join(root, 'bin', 'image-mismatch-probe.exe');
    fs.copyFileSync(probe, mismatch);
    acl(mismatch, '(RX)');
    const chosen = selected(mismatch, ['child', privateFile]);
    const result = await confirmation.confirmSelectedAction(chosen.policy, chosen.request, {
      appContainer: true,
    });
    expect(result.execution.state).not.toBe('exited');
    expect(fs.existsSync(path.join(cwd, 'child.txt'))).toBe(false);
    expect(JSON.stringify(result)).not.toContain(mismatch);
  }, 15000);

  it('stops a suspended child when the native image path differs only by case', async () => {
    const mismatch = path.join(root, 'bin', 'image-case-mismatch-probe.exe');
    fs.copyFileSync(probe, mismatch);
    acl(mismatch, '(RX)');
    const chosen = selected(mismatch, ['child', privateFile]);
    const result = await confirmation.confirmSelectedAction(chosen.policy, chosen.request, {
      appContainer: true,
    });
    expect(result.execution.state).not.toBe('exited');
    expect(fs.existsSync(path.join(cwd, 'child.txt'))).toBe(false);
    expect(JSON.stringify(result)).not.toContain(mismatch);
  }, 15000);

  it('native owner rejects an isolated frame without the executable descriptor', async () => {
    const chosen = selected(probe, ['child', privateFile]);
    const launch = JSON.parse(fs.readFileSync(chosen.request, 'utf8')).action;
    const child = spawn(helper, [], {
      cwd: helperRoot,
      env: { SystemRoot: process.env.SystemRoot || process.env.SYSTEMROOT },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString('ascii');
    });
    child.stdin.end(JSON.stringify({ ...launch, purpose: 'appcontainer-action' }) + '\n');
    const exit = await new Promise((resolve) => child.once('close', resolve));
    expect(exit).toBe(2);
    expect(output).toBe('F');
    expect(fs.existsSync(cwd)).toBe(false);
  }, 15000);

  it('native owner refuses unsafe executable paths and a stale approved digest', async () => {
    const link = path.join(root, 'linked-bin');
    fs.symlinkSync(path.dirname(probe), link, 'junction');
    const leaf = path.join(root, 'bin', 'linked-probe.exe');
    fs.symlinkSync(probe, leaf, 'file');
    const mapped = path.join(root, 'bin', 'mapped-executable.exe');
    fs.copyFileSync(probe, mapped);
    const invalid = [
      ['\\\\server\\share\\probe.exe', {}],
      [probe + ':stream', {}],
      [path.join(link, path.basename(probe)), {}],
      [leaf, {}],
      [mapped, {}],
      [probe, { sha256: '0'.repeat(64) }],
    ];
    for (const [index, [executable, changes]] of invalid.entries()) {
      const directory = path.join(root, `rejected-exe-${index}`);
      const peer = await nativeExecutableAttempt(executable, changes, directory);
      expect(peer.cleanupConfirmed).toBe(false);
      expect(peer.actionOutcome).toBeNull();
      expect(fs.existsSync(directory)).toBe(false);
    }
    await expect(nativeExecutableAttempt(probe, { size: 128 * 1024 * 1024 + 1 })).rejects.toThrow(
      'gateway-protected-launch-unavailable',
    );
    expect(fs.existsSync(cwd)).toBe(false);
  }, 30000);

  it('native owner refuses an executable with an existing writer', async () => {
    const writer = fs.openSync(probe, 'r+');
    try {
      const peer = await nativeExecutableAttempt(probe);
      expect(peer.cleanupConfirmed).toBe(false);
      expect(fs.existsSync(cwd)).toBe(false);
    } finally {
      fs.closeSync(writer);
    }
  }, 15000);

  it('imports only the approved bytes before launch while the original and loopback stay restricted', async () => {
    const peer = await listener();
    try {
      confirmation._setDepsForTest({
        available: () => true,
        confirm: async (preview, review) => {
          expect(review.kind).toBe('appcontainer-import');
          expect(preview.input).toEqual({
            path: privateFile,
            size: fs.statSync(privateFile).size,
            operation: 'copy-to-input.bin',
          });
          expect(JSON.stringify(preview)).not.toContain(
            createHash('sha256').update(fs.readFileSync(privateFile)).digest('hex'),
          );
          return true;
        },
        watchTerminal: () => () => {},
        monitorInput: () => () => {},
      });
      const chosen = selected(probe, ['evidence', privateFile, String(peer.port)]);
      const output = [];
      const code = await handleActionExecutionCLI(
        ['--action-exec-appcontainer-import-confirm', chosen.policy, chosen.request, privateFile],
        (line) => output.push(line),
      );
      expect(code).toBe(0);
      expect(JSON.parse(output[0])).toMatchObject({
        decision: 'allow',
        input: 'imported',
        execution: { state: 'exited', exitCode: 0 },
        isolation: { state: 'verified', workspace: 'retained' },
      });
      expect(fs.readFileSync(path.join(cwd, 'input.bin'))).toEqual(fs.readFileSync(privateFile));
      const parent = readEvidence('parent.txt');
      const child = readEvidence('child.txt');
      expect(parent.read).toBe('UnauthorizedAccessException');
      expect(parent.import).toBe('secret-leaked');
      expect(child.import).toBe('secret-leaked');
      expect(['timeout', 'socket-10013']).toContain(parent.network);
      expect(peer.connections()).toBe(0);
      expect(output[0]).not.toContain(privateFile);
      expect(output[0]).not.toContain('AEGIS_PRIVATE_SENTINEL');
    } finally {
      await new Promise((resolve) => peer.server.close(resolve));
    }
  }, 15000);

  it('rejects a source mutation after private review before the child starts', async () => {
    const chosen = selected(probe, ['child', privateFile]);
    confirmation._setDepsForTest({
      available: () => true,
      confirm: async () => {
        fs.writeFileSync(privateFile, 'CHANGED');
        return true;
      },
      watchTerminal: () => () => {},
      monitorInput: () => () => {},
    });
    const report = await confirmation.confirmSelectedAction(chosen.policy, chosen.request, {
      appContainer: true,
      inputFile: privateFile,
    });
    expect(report.input).toBe('unknown');
    expect(report.execution.state).not.toBe('exited');
    expect(fs.existsSync(path.join(cwd, 'child.txt'))).toBe(false);
    expect(JSON.stringify(report)).not.toContain(privateFile);
  }, 15000);

  it('native owner refuses unsafe or changed source descriptors before child launch', async () => {
    const bytes = fs.readFileSync(privateFile);
    const good = {
      path: privateFile,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    const invalid = [
      { ...good, path: '\\\\server\\share\\source.bin' },
      { ...good, path: privateFile + ':stream' },
      { ...good, size: good.size + 1 },
      { ...good, sha256: '0'.repeat(64) },
    ];
    const large = path.join(root, 'large.bin');
    fs.writeFileSync(large, Buffer.alloc(65537, 0x61));
    invalid.push({ path: large, size: 65537, sha256: '0'.repeat(64) });
    const link = path.join(root, 'linked-private');
    fs.symlinkSync(path.dirname(privateFile), link, 'junction');
    invalid.push({ ...good, path: path.join(link, path.basename(privateFile)) });
    for (const [index, input] of invalid.entries()) {
      const directory = path.join(root, `refused-${index}`);
      const peer = await nativeImportAttempt(input, directory);
      expect(peer.cleanupConfirmed).toBe(false);
      expect(peer.actionOutcome).toBeNull();
      expect(fs.existsSync(path.join(directory, 'child.txt'))).toBe(false);
    }
  }, 30000);

  it('rejects unsafe import selections before showing the terminal challenge', async () => {
    const chosen = selected(probe, ['child', privateFile]);
    const confirm = vi.fn(async () => true);
    const spawn = vi.fn();
    confirmation._setDepsForTest({
      available: () => true,
      confirm,
      watchTerminal: () => () => {},
      monitorInput: () => () => {},
    });
    runner._setDepsForTest({ spawnIsolated: spawn });
    const large = path.join(root, 'too-large.bin');
    fs.writeFileSync(large, Buffer.alloc(65537));
    const link = path.join(root, 'source-link');
    fs.symlinkSync(path.dirname(privateFile), link, 'junction');
    for (const inputFile of [
      '\\\\server\\share\\source.bin',
      privateFile + ':stream',
      large,
      path.join(link, path.basename(privateFile)),
    ]) {
      const report = await confirmation.confirmSelectedAction(chosen.policy, chosen.request, {
        appContainer: true,
        inputFile,
      });
      expect(report).toMatchObject({ decision: 'deny', input: 'not-imported' });
      expect(report.execution.state).toBe('not-started');
    }
    expect(confirm).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(fs.existsSync(cwd)).toBe(false);
  });

  it('native owner refuses a source that already has a write-capable open handle', async () => {
    const bytes = fs.readFileSync(privateFile);
    const input = {
      path: privateFile,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    const writer = fs.openSync(privateFile, 'r+');
    try {
      const peer = await nativeImportAttempt(input);
      expect(peer.cleanupConfirmed).toBe(false);
      expect(fs.existsSync(path.join(cwd, 'child.txt'))).toBe(false);
    } finally {
      fs.closeSync(writer);
    }
  }, 15000);

  it('removes only its partial input.bin after an injected copy failure', async () => {
    const source = path.join(root, 'copy-fail-source.bin');
    const bytes = Buffer.from('approved snapshot');
    fs.writeFileSync(source, bytes);
    const peer = await nativeImportAttempt({
      path: source,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(peer.cleanupConfirmed).toBe(false);
    expect(fs.existsSync(path.join(cwd, 'input.bin'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, 'child.txt'))).toBe(false);
  }, 15000);

  it('native fixed-drive gate refuses a mapped-drive classification', async () => {
    const source = path.join(root, 'mapped-source.bin');
    const bytes = Buffer.from('approved snapshot');
    fs.writeFileSync(source, bytes);
    const peer = await nativeImportAttempt({
      path: source,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(peer.cleanupConfirmed).toBe(false);
    expect(fs.existsSync(path.join(cwd, 'input.bin'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, 'child.txt'))).toBe(false);
  }, 15000);

  it.each(['deny', 'decline'])(
    '%s prevents even workspace creation for an import',
    async (mode) => {
      const chosen = selected(probe, ['child', privateFile]);
      if (mode === 'deny') {
        const policy = JSON.parse(fs.readFileSync(chosen.policy, 'utf8'));
        policy.rules[0].decision = 'deny';
        fs.writeFileSync(chosen.policy, JSON.stringify(policy));
      } else {
        confirmation._setDepsForTest({
          available: () => true,
          confirm: async () => false,
          watchTerminal: () => () => {},
          monitorInput: () => () => {},
        });
      }
      const output = [];
      const code = await handleActionExecutionCLI(
        ['--action-exec-appcontainer-import-confirm', chosen.policy, chosen.request, privateFile],
        (line) => output.push(line),
      );
      expect(code).toBe(2);
      expect(JSON.parse(output[0])).toMatchObject({
        decision: 'deny',
        input: 'not-imported',
        execution: { state: 'not-started' },
      });
      expect(fs.existsSync(cwd)).toBe(false);
      expect(output[0]).not.toContain(privateFile);
    },
  );

  it('cancellation after copy closes native control before a child can resume', async () => {
    const source = path.join(root, 'pause-source.bin');
    fs.writeFileSync(source, 'approved');
    const chosen = selected(probe, ['child', privateFile]);
    const controller = new AbortController();
    const pending = confirmation.confirmSelectedAction(chosen.policy, chosen.request, {
      appContainer: true,
      inputFile: source,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fs.existsSync(path.join(cwd, 'import-pause.txt'))).toBe(true), {
      timeout: 5000,
    });
    controller.abort();
    const result = await pending;
    expect(result.execution.state).not.toBe('exited');
    expect(fs.existsSync(path.join(cwd, 'child.txt'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, 'input.bin'))).toBe(false);
  }, 15000);

  it('runs installed Node in the new workspace without changing a private sentinel', async () => {
    const script =
      `const fs=require('node:fs');let outcome='unexpected';` +
      `try{fs.writeFileSync(${JSON.stringify(privateFile)},'MODIFIED')}` +
      `catch(error){outcome=error.code}` +
      `fs.writeFileSync('node-result.txt',outcome)`;
    const chosen = selected(process.execPath, ['-e', script]);
    const result = await confirmation.confirmSelectedAction(chosen.policy, chosen.request, {
      appContainer: true,
    });
    expect(result).toMatchObject({
      decision: 'allow',
      control: 'windows-appcontainer-job',
      isolation: { state: 'verified', workspace: 'retained', profileCleanup: 'confirmed' },
      execution: { state: 'exited', exitCode: 0 },
    });
    expect(['EACCES', 'EPERM']).toContain(
      fs.readFileSync(path.join(cwd, 'node-result.txt'), 'utf8'),
    );
    expect(fs.readFileSync(privateFile, 'utf8')).toBe('AEGIS_PRIVATE_SENTINEL');
  }, 15000);
  it('refuses an existing cwd without altering its contents', async () => {
    fs.mkdirSync(cwd);
    const marker = path.join(cwd, 'existing.txt');
    fs.writeFileSync(marker, 'KEEP');
    const chosen = selected(probe, ['child', privateFile]);
    const output = [];
    const code = await handleActionExecutionCLI(
      ['--action-exec-appcontainer-confirm', chosen.policy, chosen.request],
      (line) => output.push(line),
    );
    expect(code).toBe(2);
    expect(fs.readFileSync(marker, 'utf8')).toBe('KEEP');
    expect(fs.readdirSync(cwd)).toEqual(['existing.txt']);
    expect(JSON.parse(output[0]).execution.state).not.toBe('exited');
  }, 15000);

  it('requires affirmative review before creating a workspace or launching a child', async () => {
    const chosen = selected(probe, ['child', privateFile]);
    const spawn = vi.fn();
    runner._setDepsForTest({ spawnIsolated: spawn });
    confirmation._setDepsForTest({
      available: () => true,
      confirm: async () => false,
      watchTerminal: () => () => {},
      monitorInput: () => () => {},
    });
    const result = await confirmation.confirmSelectedAction(chosen.policy, chosen.request, {
      appContainer: true,
    });
    expect(result).toMatchObject({
      decision: 'deny',
      reason: 'confirmation-denied',
      isolation: { state: 'not-started', workspace: 'not-created', profileCleanup: 'not-required' },
      execution: { state: 'not-started' },
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(fs.existsSync(cwd)).toBe(false);
  });

  it('keeps policy deny final without starting the AppContainer helper', async () => {
    const chosen = selected(probe, ['child', privateFile]);
    const policy = JSON.parse(fs.readFileSync(chosen.policy, 'utf8'));
    policy.rules[0].decision = 'deny';
    fs.writeFileSync(chosen.policy, JSON.stringify(policy));
    const spawn = vi.fn();
    runner._setDepsForTest({ spawnIsolated: spawn });
    const result = await confirmation.confirmSelectedAction(chosen.policy, chosen.request, {
      appContainer: true,
    });
    expect(result).toMatchObject({
      decision: 'deny',
      reason: 'policy-deny',
      isolation: { state: 'not-started', workspace: 'not-created', profileCleanup: 'not-required' },
      execution: { state: 'not-started' },
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(fs.existsSync(cwd)).toBe(false);
  });
  it('recovers only its own profile after helper loss', async () => {
    const journal = path.join(helperRoot, 'AEGIS', 'AppContainerJournal');
    const markers = () =>
      (fs.existsSync(journal) ? fs.readdirSync(journal) : []).filter((name) =>
        /^aegis-action-[a-f0-9]{32}\.profile$/.test(name),
      );
    expect(markers()).toEqual([]);
    const chosen = selected(probe, ['hang', privateFile]);
    const launch = JSON.parse(fs.readFileSync(chosen.request, 'utf8')).action;
    const helperProcess = spawn(helper, [], {
      cwd: helperRoot,
      env: { SystemRoot: process.env.SystemRoot || process.env.SYSTEMROOT },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    try {
      const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('helper ready timed out')), 5000);
        helperProcess.once('error', reject);
        helperProcess.stdout.once('data', (chunk) => {
          clearTimeout(timer);
          resolve(chunk);
        });
      });
      helperProcess.stdin.write(
        JSON.stringify({
          ...launch,
          purpose: 'appcontainer-action',
          executableSnapshot: {
            path: probe,
            size: fs.statSync(probe).size,
            sha256: createHash('sha256').update(fs.readFileSync(probe)).digest('hex'),
          },
        }) + '\n',
      );
      expect((await ready).toString('ascii')).toBe('S');
      await vi.waitFor(() => expect(fs.existsSync(path.join(cwd, 'running.txt'))).toBe(true), {
        timeout: 5000,
      });
      children = [Number(fs.readFileSync(path.join(cwd, 'running.txt'), 'utf8'))];
      expect(children.every(alive)).toBe(true);
      expect(markers()).toHaveLength(1);
      helperProcess.kill('SIGKILL');
      await new Promise((resolve) => helperProcess.once('close', resolve));
      await vi.waitFor(() => expect(children.every((pid) => !alive(pid))).toBe(true));
      expect(markers()).toHaveLength(1);
      const nextCwd = path.join(root, 'recovered-workspace');
      const recovery = selected(
        path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'whoami.exe'),
        [],
        nextCwd,
      );
      const result = await confirmation.confirmSelectedAction(recovery.policy, recovery.request, {
        appContainer: true,
      });
      expect(result).toMatchObject({
        decision: 'allow',
        control: 'windows-appcontainer-job',
        isolation: { state: 'verified', workspace: 'retained', profileCleanup: 'confirmed' },
        execution: { state: 'exited', exitCode: 0 },
      });
      expect(markers()).toEqual([]);
    } finally {
      if (helperProcess.exitCode === null) helperProcess.kill('SIGKILL');
    }
  }, 20000);
  it('terminates the isolated Job on cancellation', async () => {
    const chosen = selected(probe, ['hang', privateFile]);
    const controller = new AbortController();
    const pending = confirmation.confirmSelectedAction(chosen.policy, chosen.request, {
      appContainer: true,
      signal: controller.signal,
    });
    try {
      await vi.waitFor(() => expect(fs.existsSync(path.join(cwd, 'running.txt'))).toBe(true), {
        timeout: 5000,
      });
      children = [Number(fs.readFileSync(path.join(cwd, 'running.txt'), 'utf8'))];
      expect(children.every(alive)).toBe(true);
    } finally {
      controller.abort();
    }
    const result = await pending;
    expect(result).toMatchObject({
      reason: 'action-cancelled',
      control: 'windows-appcontainer-job',
      descendantControl: 'confirmed',
      isolation: { state: 'verified', workspace: 'retained', profileCleanup: 'confirmed' },
      execution: { state: 'interrupted', termination: 'confirmed' },
    });
    await vi.waitFor(() => expect(children.every((pid) => !alive(pid))).toBe(true));
  }, 15000);
});
