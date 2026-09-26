import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const runner = require('../../src/main/action-execution');
const { spawnActionInWindowsJob } = require('../../src/main/mcp-gateway-windows-job');
const project = path.resolve(import.meta.dirname, '../..');
let helperRoot;
let helperPath;
let root;
let owner;
let pids = [];

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
function fixture(code, decision = 'allow', executable = process.execPath) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-protected-action-'));
  const action = {
    executable,
    cwd: root,
    args: ['-e', typeof code === 'function' ? code(root) : code],
    env: { SYSTEMROOT: process.env.SystemRoot || process.env.SYSTEMROOT, TEMP: root, TMP: root },
  };
  const policy = path.join(root, 'policy.json');
  const request = path.join(root, 'request.json');
  fs.writeFileSync(
    policy,
    JSON.stringify({
      schemaVersion: 2,
      defaultDecision: 'deny',
      rules: [{ action, decision }],
    }),
  );
  fs.writeFileSync(request, JSON.stringify({ schemaVersion: 1, action }));
  return { policy, request };
}
function tree(marker, exitAfterSpawn = false) {
  return `
    const fs = require('node:fs');
    const { spawn } = require('node:child_process');
    const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
      { detached: true, stdio: 'ignore', windowsHide: true });
    fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify([process.pid, grandchild.pid]));
    ${exitAfterSpawn ? 'setTimeout(() => process.exit(0), 150);' : 'setInterval(() => {}, 1000);'}
  `;
}
async function treePids(marker) {
  await vi.waitFor(() => expect(fs.existsSync(marker)).toBe(true), { timeout: 3000 });
  pids = JSON.parse(fs.readFileSync(marker, 'utf8'));
  expect(pids).toHaveLength(2);
  expect(pids.every(alive)).toBe(true);
}
async function expectTreeGone() {
  await vi.waitFor(() => expect(pids.every((pid) => !alive(pid))).toBe(true), {
    timeout: 2000,
  });
}

describe.skipIf(process.platform !== 'win32')('Windows selected-action Job lifetime', () => {
  beforeAll(() => {
    // Compile into this suite's private fixture; the gateway suite builds the
    // shared sidecar concurrently in Vitest.
    helperRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-action-helper-'));
    helperPath = path.join(helperRoot, 'aegis-mcpjob.exe');
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
        '/reference:System.Web.Extensions.dll',
        `/out:${helperPath}`,
        path.join(project, 'sidecar', 'mcpjob', 'Program.cs'),
        path.join(project, 'sidecar', 'mcpjob', 'Native.cs'),
      ],
      {
        cwd: project,
        stdio: 'pipe',
        timeout: 30000,
      },
    );
  });
  beforeEach(() =>
    runner._setDepsForTest({
      spawnProtected: (launch) => spawnActionInWindowsJob(launch, helperPath),
    }),
  );
  afterAll(() => {
    if (!helperRoot) return;
    expect(path.dirname(helperRoot)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(helperRoot).isSymbolicLink()).toBe(false);
    fs.rmSync(helperRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  afterEach(() => {
    runner._resetForTest();
    owner?.kill('SIGKILL');
    owner = undefined;
    for (const pid of pids) if (alive(pid)) process.kill(pid, 'SIGKILL');
    pids = [];
    if (root) {
      expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
      expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      root = undefined;
    }
  });

  it('returns the selected exit code and counts while withholding output', async () => {
    const selected = fixture(
      "process.stdout.write('PRIVATE_OUT');process.stderr.write('PRIVATE_ERR');process.exit(7)",
    );
    const result = await runner.executeAction(selected.policy, selected.request, {
      protectedDescendants: true,
    });
    expect(result).toMatchObject({
      decision: 'allow',
      reason: 'child-exited',
      control: 'windows-job',
      descendantControl: 'confirmed',
      execution: {
        state: 'exited',
        exitCode: 7,
        termination: 'not-requested',
        stdoutBytes: 11,
        stderrBytes: 11,
        outputComplete: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('refuses a missing helper without falling back to direct execution', async () => {
    const selected = fixture(
      (directory) =>
        `require('node:fs').writeFileSync(${JSON.stringify(path.join(directory, 'unstarted'))}, 'x')`,
    );
    runner._setDepsForTest({
      spawnProtected: () => {
        throw Error('missing-helper');
      },
    });
    const result = await runner.executeAction(selected.policy, selected.request, {
      protectedDescendants: true,
    });
    expect(result).toMatchObject({
      decision: 'deny',
      reason: 'protected-launch-unavailable',
      control: 'windows-job',
      descendantControl: 'not-started',
      execution: { state: 'not-started' },
    });
    expect(fs.existsSync(path.join(root, 'unstarted'))).toBe(false);
  });

  it('reports an unstartable selected executable without claiming cleanup', async () => {
    const selected = fixture(
      '',
      'allow',
      path.join(os.tmpdir(), `missing-aegis-selected-${process.pid}.exe`),
    );
    const result = await runner.executeAction(selected.policy, selected.request, {
      protectedDescendants: true,
    });
    expect(result).toMatchObject({
      decision: 'unknown',
      reason: 'cleanup-unconfirmed',
      control: 'windows-job',
      descendantControl: 'unconfirmed',
      execution: { state: 'unknown', termination: 'unconfirmed', outputComplete: false },
    });
  });

  it('kills a detached grandchild after an ordinary selected exit', async () => {
    const selected = fixture((directory) => tree(path.join(directory, 'tree.json'), true));
    const pending = runner.executeAction(selected.policy, selected.request, {
      protectedDescendants: true,
    });
    await treePids(path.join(root, 'tree.json'));
    const result = await pending;
    expect(result).toMatchObject({
      reason: 'child-exited',
      descendantControl: 'confirmed',
      execution: { state: 'exited', exitCode: 0, outputComplete: true },
    });
    await expectTreeGone();
  });

  it('kills the selected tree on owner cancellation', async () => {
    const selected = fixture((directory) => tree(path.join(directory, 'tree.json')));
    const controller = new AbortController();
    const pending = runner.executeAction(selected.policy, selected.request, {
      protectedDescendants: true,
      signal: controller.signal,
    });
    await treePids(path.join(root, 'tree.json'));
    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({
      reason: 'action-cancelled',
      descendantControl: 'confirmed',
      execution: { state: 'interrupted', termination: 'confirmed', outputComplete: false },
    });
    await expectTreeGone();
  });

  it('kills the selected tree at its runtime deadline', async () => {
    const selected = fixture((directory) => tree(path.join(directory, 'tree.json')));
    const pending = runner.executeAction(selected.policy, selected.request, {
      protectedDescendants: true,
    });
    await treePids(path.join(root, 'tree.json'));
    const result = await pending;
    expect(result).toMatchObject({
      reason: 'runtime-timeout',
      descendantControl: 'confirmed',
      execution: { state: 'interrupted', termination: 'confirmed', outputComplete: false },
    });
    await expectTreeGone();
  }, 10000);

  it('stops the tree when combined output exceeds the action bound', async () => {
    const selected = fixture(
      'process.stdout.write(Buffer.alloc(65537, 65));setInterval(() => {}, 1000)',
    );
    const result = await runner.executeAction(selected.policy, selected.request, {
      protectedDescendants: true,
    });
    expect(result).toMatchObject({
      decision: 'allow',
      reason: 'output-limit',
      descendantControl: 'confirmed',
      execution: {
        state: 'interrupted',
        termination: 'confirmed',
        stdoutBytes: runner.LIMITS.outputBytes,
        stderrBytes: 0,
        outputComplete: false,
      },
    });
  });

  it('never claims verified cleanup after unexpected helper death', async () => {
    const selected = fixture((directory) => tree(path.join(directory, 'tree.json')));
    let helper;
    runner._setDepsForTest({
      spawnProtected: (launch) => {
        helper = spawnActionInWindowsJob(launch, helperPath);
        return helper;
      },
    });
    const pending = runner.executeAction(selected.policy, selected.request, {
      protectedDescendants: true,
    });
    await treePids(path.join(root, 'tree.json'));
    helper.kill('SIGKILL');
    const result = await pending;
    expect(result).toMatchObject({
      decision: 'unknown',
      reason: 'cleanup-unconfirmed',
      descendantControl: 'unconfirmed',
      execution: { state: 'unknown', termination: 'unconfirmed', outputComplete: false },
    });
    await expectTreeGone();
  });

  it('closes the Job after the action owner dies', async () => {
    const selected = fixture((directory) => tree(path.join(directory, 'tree.json')));
    const script = `const job = require('./src/main/mcp-gateway-windows-job');
      const original = job.spawnActionInWindowsJob;
      job.spawnActionInWindowsJob = (launch) => original(launch, ${JSON.stringify(helperPath)});
      require('./src/main/action-execution').executeAction(
      ${JSON.stringify(selected.policy)}, ${JSON.stringify(selected.request)},
      { protectedDescendants: true }); setInterval(() => {}, 1000);`;
    owner = spawn(process.execPath, ['-e', script], {
      cwd: project,
      env: {
        SystemRoot: process.env.SystemRoot || process.env.SYSTEMROOT,
        TEMP: os.tmpdir(),
        TMP: os.tmpdir(),
      },
      stdio: 'ignore',
      windowsHide: true,
    });
    await treePids(path.join(root, 'tree.json'));
    owner.kill('SIGKILL');
    await expectTreeGone();
  });
});
