import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFixtureProcesses } from '../helpers/fixture-processes';
const require = createRequire(import.meta.url);
const windowsJob = require('../../src/main/mcp-gateway-windows-job');
const { helperPath, spawnInWindowsJob } = windowsJob;
const project = path.resolve(import.meta.dirname, '../..');
let root;
let running;
let ownedPids = [];
let processes;
let helperRoot, helper;
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
    // Compile this suite's own helper. A shared build/sidecar executable can be
    // held by another native suite and cannot safely be overwritten on Windows.
    helperRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-mcpjob-helper-'));
    helper = path.join(helperRoot, 'aegis-mcpjob.exe');
    execFileSync(
      path.join(
        process.env.WINDIR || 'C:\\Windows',
        'Microsoft.NET',
        'Framework64',
        'v4.0.30319',
        'csc.exe',
      ),
      [
        '/nologo',
        '/target:exe',
        '/platform:x64',
        '/optimize+',
        '/warnaserror+',
        '/reference:System.Web.Extensions.dll',
        `/out:${helper}`,
        ...fs
          .readdirSync(path.join(project, 'sidecar', 'mcpjob'))
          .filter((name) => name.endsWith('.cs'))
          .map((name) => path.join(project, 'sidecar', 'mcpjob', name)),
      ],
      { cwd: project, windowsHide: true, stdio: 'pipe', timeout: 30000 },
    );
  });
  afterAll(async () => {
    expect(path.dirname(helperRoot)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(helperRoot).isSymbolicLink()).toBe(false);
    await fs.promises.rm(helperRoot, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
  });
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-mcpjob-'));
    running = undefined;
    ownedPids = [];
    processes = createFixtureProcesses();
  });
  afterEach(async () => {
    await processes.stopAndWait(ownedPids);
    expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
    // Windows can retain a closed fixture briefly after the process exit event.
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
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
      running = processes.track(spawnInWindowsJob(launch(''), helper));
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
    running = processes.track(
      spawnInWindowsJob(launch(code, argv, { ...baseEnv(), AEGIS_TEST_SECRET: secret }), helper),
    );
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
    running = processes.track(spawnInWindowsJob(launch(tree(marker)), helper));
    const pids = await treePids(marker);
    const closed = once(running, 'close');
    running.stop();
    await closed;
    expect(running.cleanupConfirmed).toBe(true);
    await vi.waitFor(() => expect(pids.some(alive)).toBe(false), { timeout: 1500 });
  });

  it('ends the grandchild when the selected child exits first', async () => {
    const marker = path.join(root, 'tree.json');
    running = processes.track(spawnInWindowsJob(launch(tree(marker, true)), helper));
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
    running = processes.track(
      spawnInWindowsJob({ ...launch(''), executable: path.join(root, 'missing.exe') }, helper),
    );
    const closed = new Promise((resolve) => running.once('close', resolve));
    running.on('error', () => {});
    await closed;
    expect(running.cleanupConfirmed).toBe(false);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('does not claim cleanup after unexpected helper death, though the job closes', async () => {
    const marker = path.join(root, 'tree.json');
    running = processes.track(spawnInWindowsJob(launch(tree(marker)), helper));
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
        ...fs
          .readdirSync(path.join(project, 'sidecar', 'mcpjob'))
          .filter((name) => name.endsWith('.cs'))
          .map((name) => path.join(project, 'sidecar', 'mcpjob', name)),
      ],
      { cwd: project, stdio: 'pipe', timeout: 30000 },
    );
    running = processes.track(
      spawn(helper, [], {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, AEGIS_MCPJOB_CRASH_MARKER: marker },
      }),
    );
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
    // CommonJS captures its dependency at require time. Restore both the export
    // and cache immediately after construction so this seam stays in this suite.
    const peerPath = require.resolve('../../src/main/mcp-gateway-peer');
    const previousModule = require.cache[peerPath];
    const seam = vi
      .spyOn(windowsJob, 'spawnInWindowsJob')
      .mockImplementation((selected) => processes.track(spawnInWindowsJob(selected, helper)));
    let peer;
    delete require.cache[peerPath];
    try {
      peer = require(peerPath).createGatewayPeer(launch(tree(marker)), failed);
    } finally {
      seam.mockRestore();
      delete require.cache[peerPath];
      if (previousModule) require.cache[peerPath] = previousModule;
    }
    const pending = peer.request('never-answers', {});
    const pids = await treePids(marker);
    await expect(pending).rejects.toThrow('upstream-closed');
    expect(await peer.done).toBe(true);
    expect(failed).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(pids.some(alive)).toBe(false), { timeout: 1500 });
  }, 7000);

  it('discards selected stderr, including launch-secret text', async () => {
    const secret = 'PRIVATE_STDERR_VALUE';
    const code = `process.stderr.write(process.env.AEGIS_TEST_SECRET); process.stdout.write('fixture-started\\n'); process.stdin.resume();`;
    running = processes.track(
      spawnInWindowsJob(launch(code, [], { ...baseEnv(), AEGIS_TEST_SECRET: secret }), helper),
    );
    let helperStderr = '';
    let helperStdout = '';
    running.stderr.on('data', (chunk) => {
      helperStderr += chunk;
    });
    running.stdout.on('data', (chunk) => {
      helperStdout += chunk;
    });
    const closed = once(running, 'close');
    // Observe execution of the stderr write before stopping the selected process.
    expect(await line(running.stdout)).toBe('fixture-started');
    running.stop();
    await closed;
    expect(running.cleanupConfirmed).toBe(true);
    expect(helperStderr + helperStdout).not.toContain(secret);
    expect(helperStdout).toBe('fixture-started\n');
    expect(helperStderr).toBe('');
  });
});
