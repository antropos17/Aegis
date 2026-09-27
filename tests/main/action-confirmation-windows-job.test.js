import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const confirmation = require('../../src/main/action-confirmation');
const runner = require('../../src/main/action-execution');
const { handleActionExecutionCLI } = require('../../src/main/action-execution-cli');
const { spawnActionInWindowsJob } = require('../../src/main/mcp-gateway-windows-job');
const project = path.resolve(import.meta.dirname, '../..');
let helperRoot, helper, root;
let pids = [];
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
function removeFixture(directory) {
  if (!directory) return;
  expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(directory).isSymbolicLink()).toBe(false);
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
function fixture({ running = false, reviewRequired = false } = {}) {
  const marker = path.join(root, 'PRIVATE_TREE.json');
  const action = {
    executable: process.execPath,
    cwd: root,
    args: [
      '-e',
      `const fs = require('node:fs');
       const child = require('node:child_process').spawn(process.execPath,
         ['-e', 'setInterval(() => {}, 1000)'],
         { detached: true, stdio: 'ignore', windowsHide: true });
       fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify([process.pid, child.pid]));
       ${running ? 'setInterval(() => {}, 1000)' : 'setTimeout(() => process.exit(0), 200)'}`,
    ],
    env: {
      SYSTEMROOT: process.env.SystemRoot || process.env.SYSTEMROOT,
      TEMP: root,
      TMP: root,
    },
  };
  const policy = path.join(root, 'PRIVATE_POLICY.json');
  const request = path.join(root, 'PRIVATE_REQUEST.json');
  fs.writeFileSync(request, JSON.stringify({ schemaVersion: 1, action }));
  fs.writeFileSync(
    policy,
    JSON.stringify({
      schemaVersion: reviewRequired ? 3 : 2,
      defaultDecision: 'deny',
      rules: [{ action, decision: reviewRequired ? 'allow' : 'ask' }],
      ...(reviewRequired ? { reviewRequired: [action] } : {}),
    }),
  );
  return { marker, policy, request };
}
function terminal(confirm) {
  confirmation._setDepsForTest({
    available: () => true,
    confirm,
    watchTerminal: () => () => {},
    monitorInput: () => () => {},
  });
}

describe.skipIf(process.platform !== 'win32')('confirmed Windows Job execution', () => {
  beforeAll(() => {
    helperRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-confirm-helper-'));
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
        path.join(project, 'sidecar', 'mcpjob', 'Program.cs'),
        path.join(project, 'sidecar', 'mcpjob', 'Native.cs'),
      ],
      { cwd: project, windowsHide: true, stdio: 'pipe', timeout: 30000 },
    );
  });
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-confirm-job-'));
    runner._setDepsForTest({ spawnProtected: (launch) => spawnActionInWindowsJob(launch, helper) });
  });
  afterEach(() => {
    confirmation._resetForTest();
    runner._resetForTest();
    const marker = root && path.join(root, 'PRIVATE_TREE.json');
    if (marker && fs.existsSync(marker)) pids = JSON.parse(fs.readFileSync(marker, 'utf8'));
    for (const pid of pids) if (alive(pid)) process.kill(pid, 'SIGKILL');
    pids = [];
    removeFixture(root);
    root = undefined;
  });
  afterAll(() => removeFixture(helperRoot));

  it.each([false, true])(
    'reviews before launch and cleans descendants (reviewRequired=%s)',
    async (reviewRequired) => {
      const f = fixture({ reviewRequired });
      const confirm = vi.fn(async () => {
        expect(fs.existsSync(f.marker)).toBe(false);
        return true;
      });
      terminal(confirm);
      const output = [];
      const code = await handleActionExecutionCLI(
        ['--action-exec-windows-job-confirm', f.policy, f.request],
        (line) => output.push(line),
      );
      expect(code).toBe(0);
      expect(confirm).toHaveBeenCalledOnce();
      expect(JSON.parse(output[0])).toMatchObject({
        decision: 'allow',
        policyDecision: 'ask',
        authorization: 'operator-confirmed',
        control: 'windows-job',
        descendantControl: 'confirmed',
        execution: { state: 'exited', exitCode: 0, outputComplete: true },
      });
      expect(output[0]).not.toContain('PRIVATE');
      expect(output[0]).not.toContain(root);
      pids = JSON.parse(fs.readFileSync(f.marker, 'utf8'));
      await vi.waitFor(() => expect(pids.every((pid) => !alive(pid))).toBe(true));
    },
  );

  it('refuses before any selected child or grandchild starts', async () => {
    const f = fixture();
    terminal(async () => false);
    const result = await confirmation.confirmSelectedAction(f.policy, f.request, {
      protectedDescendants: true,
    });
    expect(result).toMatchObject({
      decision: 'deny',
      control: 'windows-job',
      descendantControl: 'not-started',
      execution: { state: 'not-started' },
    });
    expect(fs.existsSync(f.marker)).toBe(false);
  });

  it('cancels an approved running action and confirms both fixture processes exited', async () => {
    const f = fixture({ running: true });
    terminal(async () => true);
    const controller = new AbortController();
    const pending = confirmation.confirmSelectedAction(f.policy, f.request, {
      protectedDescendants: true,
      signal: controller.signal,
    });
    try {
      await vi.waitFor(() => expect(fs.existsSync(f.marker)).toBe(true), { timeout: 3000 });
      pids = JSON.parse(fs.readFileSync(f.marker, 'utf8'));
      expect(pids.every(alive)).toBe(true);
    } finally {
      controller.abort();
    }
    const result = await pending;
    expect(result).toMatchObject({
      reason: 'action-cancelled',
      authorization: 'operator-confirmed',
      control: 'windows-job',
      descendantControl: 'confirmed',
      execution: { state: 'interrupted', termination: 'confirmed', outputComplete: false },
    });
    await vi.waitFor(() => expect(pids.every((pid) => !alive(pid))).toBe(true));
  });
});
