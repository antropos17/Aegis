import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createGatewayPeer } = require('../../src/main/mcp-gateway-peer');
const { helperPath, spawnInWindowsJob } = require('../../src/main/mcp-gateway-windows-job');
const project = path.resolve(import.meta.dirname, '../..');
let root;
let running;
let ownedPids = [];
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const baseEnv = () => ({ SYSTEMROOT: process.env.SYSTEMROOT || process.env.SystemRoot });
const launch = (code, args = [], env = baseEnv()) => ({
  executable: process.execPath,
  cwd: root,
  args: ['-e', code, ...args],
  env,
});
const line = (stream) =>
  new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(Error('no-upstream-line')), 2000);
    stream.on('data', (chunk) => {
      text += chunk.toString('utf8');
      if (!text.includes('\n')) return;
      clearTimeout(timer);
      resolve(text.slice(0, text.indexOf('\n')));
    });
  });
const tree = (marker, exitAfterSpawn = false) => {
  const grandchild = 'setInterval(() => {}, 1000)';
  return `
    const fs = require('node:fs');
    const { spawn } = require('node:child_process');
    const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}],
      { stdio: 'ignore', detached: true, windowsHide: true });
    fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify([process.pid, grandchild.pid]));
    ${exitAfterSpawn ? 'setTimeout(() => process.exit(0), 200);' : 'setInterval(() => {}, 1000);'}
  `;
};
async function treePids(marker) {
  await vi.waitFor(() => expect(fs.existsSync(marker)).toBe(true), { timeout: 3000 });
  const pids = JSON.parse(fs.readFileSync(marker, 'utf8'));
  ownedPids.push(...pids);
  expect(pids.every(alive)).toBe(true);
  return pids;
}

describe.skipIf(process.platform !== 'win32')('Windows stdio gateway Job Object', () => {
  beforeAll(() => {
    // Compile current sources for every native run; build/sidecar is ignored and
    // may otherwise contain an older helper from a previous checkout.
    execFileSync(process.execPath, ['scripts/build-sidecar.js'], {
      cwd: project,
      stdio: 'pipe',
      timeout: 30000,
    });
  });
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-mcpjob-'));
    running = undefined;
    ownedPids = [];
  });
  afterEach(async () => {
    running?.kill('SIGKILL');
    for (const pid of ownedPids) if (alive(pid)) process.kill(pid, 'SIGKILL');
    expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('resolves packaged resources and dev Electron build paths separately', () => {
    const resources = path.join(root, 'installed', 'resources');
    const devResources = path.join(root, 'electron', 'resources');
    expect(helperPath({ resourcesPath: resources, defaultApp: false })).toBe(
      path.join(resources, 'sidecar', 'aegis-mcpjob.exe'),
    );
    expect(helperPath({ resourcesPath: devResources, defaultApp: true })).toBe(
      path.join(project, 'build', 'sidecar', 'aegis-mcpjob.exe'),
    );
    expect(helperPath({})).toBe(path.join(project, 'build', 'sidecar', 'aegis-mcpjob.exe'));
  });

  it('does not inherit the parent environment into the Job helper', async () => {
    const source = path.join(root, 'EnvProbe.cs');
    const helper = path.join(root, 'env-probe.exe');
    fs.writeFileSync(
      source,
      [
        'using System;',
        'class EnvProbe {',
        '  static void Main() {',
        '    Console.ReadLine();',
        '    Console.Out.Write("R" + (Environment.GetEnvironmentVariable("AEGIS_MCPJOB_PARENT_SENTINEL") == null ? "0" : "1") + "\\n");',
        '    Console.Out.Flush();',
        '    Console.Error.Write("C");',
        '  }',
        '}',
      ].join('\n'),
    );
    const framework = path.join(
      process.env.WINDIR || 'C:\\Windows',
      'Microsoft.NET',
      'Framework64',
      'v4.0.30319',
      'csc.exe',
    );
    execFileSync(framework, ['/nologo', '/target:exe', `/out:${helper}`, source], {
      cwd: root,
      stdio: 'pipe',
      timeout: 30000,
    });
    const prior = process.env.AEGIS_MCPJOB_PARENT_SENTINEL;
    process.env.AEGIS_MCPJOB_PARENT_SENTINEL = '1';
    try {
      running = spawnInWindowsJob(launch(''), helper);
      const closed = once(running, 'close');
      expect(await line(running.stdout)).toBe('0');
      await closed;
      expect(running.cleanupConfirmed).toBe(true);
    } finally {
      if (prior === undefined) delete process.env.AEGIS_MCPJOB_PARENT_SENTINEL;
      else process.env.AEGIS_MCPJOB_PARENT_SENTINEL = prior;
    }
  }, 10000);

  it('preserves argv, cwd, and selected env without inheriting an unrelated key', async () => {
    const argv = ['space value', 'quote"value', 'slash\\', 'ümlaut', ''];
    const secret = 'PRIVATE_LAUNCH_VALUE';
    const code = `
      const crypto = require('node:crypto');
      process.stdout.write(JSON.stringify({
        args: process.argv.slice(1), cwd: process.cwd(),
        digest: crypto.createHash('sha256').update(process.env.AEGIS_TEST_SECRET).digest('hex'),
        inheritedPath: Object.hasOwn(process.env, 'PATH')
      }) + '\\n');
      process.stdin.resume();
    `;
    running = spawnInWindowsJob(launch(code, argv, { ...baseEnv(), AEGIS_TEST_SECRET: secret }));
    const output = JSON.parse(await line(running.stdout));
    expect(output.args).toEqual(argv);
    expect(output.cwd.toLowerCase()).toBe(root.toLowerCase());
    expect(output.digest).toBe(
      require('node:crypto').createHash('sha256').update(secret).digest('hex'),
    );
    expect(output.inheritedPath).toBe(false);
    const closed = once(running, 'close');
    running.stop();
    await closed;
    expect(running.cleanupConfirmed).toBe(true);
  });

  it('ends an ordinary selected child and detached grandchild on EOF', async () => {
    const marker = path.join(root, 'tree.json');
    running = spawnInWindowsJob(launch(tree(marker)));
    const pids = await treePids(marker);
    const closed = once(running, 'close');
    running.stop();
    await closed;
    expect(running.cleanupConfirmed).toBe(true);
    await vi.waitFor(() => expect(pids.some(alive)).toBe(false), { timeout: 1500 });
  });

  it('ends the grandchild when the selected child exits first', async () => {
    const marker = path.join(root, 'tree.json');
    running = spawnInWindowsJob(launch(tree(marker, true)));
    const closed = once(running, 'close');
    const pids = await treePids(marker);
    await closed;
    expect(running.cleanupConfirmed).toBe(true);
    await vi.waitFor(() => expect(pids.some(alive)).toBe(false), { timeout: 1500 });
  });

  it('fails closed when the helper is missing or selected executable cannot start', async () => {
    const marker = path.join(root, 'started');
    expect(() =>
      spawnInWindowsJob(
        launch(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x')`),
        path.join(root, 'missing-helper.exe'),
      ),
    ).toThrow('gateway-protected-launch-unavailable');
    expect(fs.existsSync(marker)).toBe(false);
    running = spawnInWindowsJob({ ...launch(''), executable: path.join(root, 'missing.exe') });
    const closed = new Promise((resolve) => running.once('close', resolve));
    running.on('error', () => {});
    await closed;
    expect(running.cleanupConfirmed).toBe(false);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('does not claim cleanup after unexpected helper death, though the job closes', async () => {
    const marker = path.join(root, 'tree.json');
    running = spawnInWindowsJob(launch(tree(marker)));
    const pids = await treePids(marker);
    const closed = once(running, 'close');
    running.kill('SIGKILL');
    await closed;
    expect(running.cleanupConfirmed).toBe(false);
    await vi.waitFor(() => expect(pids.some(alive)).toBe(false), { timeout: 1500 });
  });

  it('closes the Job if the helper dies immediately after CreateProcess', async () => {
    const helper = path.join(root, 'crash-window-mcpjob.exe');
    const marker = path.join(root, 'suspended-child-pid');
    const framework = path.join(
      process.env.WINDIR || 'C:\\Windows',
      'Microsoft.NET',
      'Framework64',
      'v4.0.30319',
      'csc.exe',
    );
    execFileSync(
      framework,
      [
        '/nologo',
        '/target:exe',
        '/platform:x64',
        '/optimize+',
        '/warnaserror+',
        '/define:MCP_JOB_CRASH_TEST',
        '/reference:System.Web.Extensions.dll',
        `/out:${helper}`,
        path.join(project, 'sidecar', 'mcpjob', 'Program.cs'),
        path.join(project, 'sidecar', 'mcpjob', 'Native.cs'),
      ],
      { cwd: project, stdio: 'pipe', timeout: 30000 },
    );
    running = spawn(helper, [], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, AEGIS_MCPJOB_CRASH_MARKER: marker },
    });
    const closed = once(running, 'close');
    running.stdin.write(JSON.stringify(launch('setInterval(() => {}, 1000)')) + '\n');
    await vi.waitFor(
      () => {
        const value = fs.existsSync(marker) ? Number(fs.readFileSync(marker, 'utf8')) : 0;
        expect(Number.isSafeInteger(value) && value > 0).toBe(true);
      },
      { timeout: 3000 },
    );
    const pid = Number(fs.readFileSync(marker, 'utf8'));
    expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
    ownedPids.push(pid);
    expect(alive(pid)).toBe(true);
    running.kill('SIGKILL');
    await closed;
    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 1500 });
  }, 10000);

  it('times out a silent upstream and verifies ordinary descendants ended', async () => {
    const marker = path.join(root, 'tree.json');
    const failed = vi.fn();
    const peer = createGatewayPeer(launch(tree(marker)), failed);
    const pending = peer.request('never-answers', {});
    const pids = await treePids(marker);
    await expect(pending).rejects.toThrow('upstream-closed');
    expect(await peer.done).toBe(true);
    expect(failed).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(pids.some(alive)).toBe(false), { timeout: 1500 });
  }, 7000);

  it('discards selected stderr, including launch-secret text', async () => {
    const secret = 'PRIVATE_STDERR_VALUE';
    const code = `process.stderr.write(process.env.AEGIS_TEST_SECRET); process.stdin.resume();`;
    running = spawnInWindowsJob(launch(code, [], { ...baseEnv(), AEGIS_TEST_SECRET: secret }));
    let helperStderr = '';
    let helperStdout = '';
    running.stderr.on('data', (chunk) => {
      helperStderr += chunk;
    });
    running.stdout.on('data', (chunk) => {
      helperStdout += chunk;
    });
    const closed = once(running, 'close');
    await new Promise((resolve) => setTimeout(resolve, 200));
    running.stop();
    await closed;
    expect(running.cleanupConfirmed).toBe(true);
    expect(helperStderr + helperStdout).not.toContain(secret);
    expect(helperStderr).toBe('');
  });
});
