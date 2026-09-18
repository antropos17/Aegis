import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const api = require('../../src/main/action-confirmation');
const directories = [];
function fixture(decision = 'ask') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-confirmation-'));
  directories.push(root);
  const policy = path.join(root, 'PRIVATE_POLICY.json');
  const request = path.join(root, 'PRIVATE_REQUEST.json');
  const sentinel = path.join(root, 'sentinel');
  const action = {
    executable: process.execPath,
    cwd: root,
    args: [
      '-e',
      "require('node:fs').appendFileSync('sentinel','once');console.log('PRIVATE_OUTPUT')",
    ],
    env:
      process.platform === 'win32'
        ? {
            SYSTEMROOT: process.env.SystemRoot,
            WINDIR: process.env.SystemRoot,
            TEMP: root,
            TMP: root,
          }
        : {},
  };
  const write = () => {
    fs.writeFileSync(request, JSON.stringify({ schemaVersion: 1, action }));
    fs.writeFileSync(
      policy,
      JSON.stringify({ schemaVersion: 2, defaultDecision: 'deny', rules: [{ action, decision }] }),
    );
  };
  write();
  return { root, policy, request, sentinel, action, write };
}
function setup(confirm, available = () => true) {
  api._setDepsForTest({
    confirm,
    available,
    watchTerminal: () => () => {},
    monitorInput: () => () => {},
  });
}
function notStarted(report, f) {
  expect(report.execution.state).toBe('not-started');
  expect(fs.existsSync(f.sentinel)).toBe(false);
  expect(JSON.stringify(report)).not.toContain('PRIVATE');
  expect(JSON.stringify(report)).not.toContain(f.root);
}
afterEach(() => {
  api._resetForTest();
  require('../../src/main/action-execution')._resetForTest();
  vi.useRealTimers();
  for (const root of directories.splice(0)) {
    expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('terminal confirmation owner', () => {
  it('keeps terminal loss connected after affirmation and before child launch', async () => {
    const f = fixture();
    let disconnect;
    const cleanup = vi.fn();
    const spawn = vi.fn();
    const confirm = vi.fn(async () => true);
    api._setDepsForTest({
      available: () => true,
      confirm,
      monitorInput: () => () => {},
      watchTerminal: (abort) => {
        disconnect = abort;
        return cleanup;
      },
    });
    const prepare = vi.fn(async () => {
      disconnect();
      return { decision: 'allow', reason: 'policy-allow', launch: f.action };
    });
    require('../../src/main/action-execution')._setDepsForTest({ prepare, spawn });
    const report = await api.confirmSelectedAction(f.policy, f.request);
    notStarted(report, f);
    expect(confirm, JSON.stringify(report)).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledOnce();
    expect(spawn).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it('rejects the actual CLI with piped stdin without exposing private preview or executing', () => {
    const f = fixture();
    const result = spawnSync(
      process.execPath,
      ['src/main/main.js', '--action-exec-confirm', f.policy, f.request],
      {
        input: 'RUN a1b2c3d4\n',
        encoding: 'utf8',
        timeout: 8000,
        maxBuffer: 65536,
        windowsHide: true,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('PRIVATE');
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    notStarted(JSON.parse(result.stdout), f);
    expect(JSON.parse(result.stdout).reason).toBe('terminal-required');
  });

  it('checks elapsed monotonic time after a callback returns affirmative', async () => {
    const f = fixture();
    let clock = 0;
    api._setDepsForTest({
      available: () => true,
      now: () => clock,
      watchTerminal: () => () => {},
      monitorInput: () => () => {},
      confirm: async () => {
        clock = api.LIMITS.reviewMs;
        return true;
      },
    });
    notStarted(await api.confirmSelectedAction(f.policy, f.request), f);
  });
  it('never prompts or executes an explicit deny', async () => {
    const f = fixture('deny');
    const confirm = vi.fn(async () => true);
    setup(confirm);
    notStarted(await api.confirmSelectedAction(f.policy, f.request), f);
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each(['allow', 'ask'])(
    'executes %s only after affirmative confirmation of the effective frozen launch',
    async (decision) => {
      const f = fixture(decision);
      const confirm = vi.fn(async (launch, { signal }) => {
        expect(fs.existsSync(f.sentinel)).toBe(false);
        expect(Object.isFrozen(launch)).toBe(true);
        expect(Object.isFrozen(launch.args)).toBe(true);
        expect(Object.isFrozen(launch.env)).toBe(true);
        expect(launch.args).toEqual(f.action.args);
        expect(launch.cwd).toBe(f.root);
        expect(signal.aborted).toBe(false);
        return true;
      });
      setup(confirm);
      const report = await api.confirmSelectedAction(f.policy, f.request);
      expect(report).toMatchObject({
        decision: 'allow',
        execution: { state: 'exited', exitCode: 0 },
      });
      expect(fs.readFileSync(f.sentinel, 'utf8')).toBe('once');
      expect(confirm).toHaveBeenCalledOnce();
      expect(JSON.stringify(report)).not.toContain('PRIVATE');
    },
  );

  it.each([false, undefined, 'true', 1])('rejects nonliteral affirmation %j', async (answer) => {
    const f = fixture();
    setup(async () => answer);
    notStarted(await api.confirmSelectedAction(f.policy, f.request), f);
  });

  it('rejects confirmation exceptions without exposing their details', async () => {
    const f = fixture();
    setup(async () => {
      throw Error('PRIVATE_CONFIRMATION_ERROR');
    });
    notStarted(await api.confirmSelectedAction(f.policy, f.request), f);
  });

  it('fails unavailable terminal before reading private files or prompting', async () => {
    const f = fixture();
    fs.unlinkSync(f.policy);
    fs.unlinkSync(f.request);
    const confirm = vi.fn();
    setup(confirm, () => false);
    const report = await api.confirmSelectedAction(f.policy, f.request);
    notStarted(report, f);
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each(['policy', 'request'])(
    'rejects changed %s bytes after preview even when confirmation is affirmative',
    async (target) => {
      const f = fixture();
      setup(async () => {
        fs.appendFileSync(f[target], '\n');
        return true;
      });
      notStarted(await api.confirmSelectedAction(f.policy, f.request), f);
    },
  );

  it('rejects a newly matching allow pair substituted during review', async () => {
    const f = fixture('allow');
    setup(async () => {
      f.action.args = ['-e', "require('node:fs').writeFileSync('sentinel','changed')"];
      f.write();
      return true;
    });
    notStarted(await api.confirmSelectedAction(f.policy, f.request), f);
  });

  it('bounds stalled confirmation and refuses a late affirmative answer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = fixture();
    let entered;
    let answer;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    setup(() => {
      entered();
      return new Promise((resolve) => {
        answer = resolve;
      });
    });
    const done = api.confirmSelectedAction(f.policy, f.request);
    await started;
    await vi.advanceTimersByTimeAsync(api.LIMITS.reviewMs + 1);
    notStarted(await done, f);
    answer(true);
    await Promise.resolve();
    expect(fs.existsSync(f.sentinel)).toBe(false);
  });

  it('aborts review without executing and rejects later affirmation', async () => {
    const f = fixture();
    const controller = new AbortController();
    let entered;
    let answer;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    setup(() => {
      entered();
      return new Promise((resolve) => {
        answer = resolve;
      });
    });
    const done = api.confirmSelectedAction(f.policy, f.request, { signal: controller.signal });
    await started;
    controller.abort();
    notStarted(await done, f);
    answer(true);
    await Promise.resolve();
    expect(fs.existsSync(f.sentinel)).toBe(false);
  });
});
