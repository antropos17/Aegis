import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const runner = require('../../src/main/action-execution');
const directories = [];
const launch = () => ({
  executable: process.execPath,
  cwd: process.cwd(),
  args: ['-e', ''],
  env: {},
});
function fakeChild() {
  const child = new EventEmitter();
  child.pid = 123;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  child.unref = vi.fn();
  return child;
}
function setup(extra = {}) {
  const child = fakeChild();
  const spawn = vi.fn(() => child);
  runner._setDepsForTest({
    prepare: async () => ({ decision: 'allow', launch: launch() }),
    spawn,
    ...extra,
  });
  return { child, spawn, run: () => runner.executeAction('PRIVATE_POLICY', 'PRIVATE_REQUEST') };
}
async function tick() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
function fixture(decision, code, args = [], env = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-direct-child-'));
  directories.push(directory);
  const policyPath = path.join(directory, 'policy.json');
  const requestPath = path.join(directory, 'request.json');
  const explicitEnv =
    process.platform === 'win32'
      ? { SYSTEMROOT: process.env.SystemRoot || process.env.SYSTEMROOT, ...env }
      : env;
  const action = {
    executable: process.execPath,
    cwd: directory,
    args: ['-e', code, ...args],
    env: explicitEnv,
  };
  fs.writeFileSync(requestPath, JSON.stringify({ schemaVersion: 1, action }));
  fs.writeFileSync(
    policyPath,
    JSON.stringify({ schemaVersion: 2, defaultDecision: 'deny', rules: [{ action, decision }] }),
  );
  return { directory, policyPath, requestPath, action };
}
afterEach(() => {
  runner._resetForTest();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) {
    expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(directory).isSymbolicLink()).toBe(false);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('direct execution decision boundary', () => {
  it.each(['deny', 'ask'])('never spawns for %s', async (decision) => {
    const t = setup({
      prepare: async () => ({ decision, reason: 'PRIVATE_REASON', launch: launch() }),
    });
    const result = await t.run();
    expect(result).toMatchObject({
      decision,
      execution: { state: 'not-started', termination: 'not-requested' },
    });
    expect(t.spawn).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it.each([
    null,
    {},
    { decision: 'defer' },
    { decision: 'allow' },
    { decision: 'allow', launch: { ...launch(), executable: process.execPath + '\0' } },
    { decision: 'allow', launch: { ...launch(), env: Object.create({ PRIVATE: 'inherited' }) } },
  ])('denies invalid preparation %#', async (prepared) => {
    const t = setup({ prepare: async () => prepared });
    expect((await t.run()).decision).toBe('deny');
    expect(t.spawn).not.toHaveBeenCalled();
  });

  it('redacts a preparation exception and does not spawn', async () => {
    const t = setup({
      prepare: () => {
        throw new Error('PRIVATE_ERROR');
      },
    });
    const result = await t.run();
    expect(result.decision).toBe('deny');
    expect(t.spawn).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('times out preparation and never launches a late allow', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let complete;
    const t = setup({
      prepare: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    });
    const pending = t.run();
    await vi.advanceTimersByTimeAsync(runner.LIMITS.prepareMs);
    expect((await pending).execution.state).toBe('not-started');
    complete({ decision: 'allow', launch: launch() });
    await tick();
    expect(t.spawn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rechecks monotonic time even when the timer callback has not run', async () => {
    let now = 0;
    const t = setup({
      now: () => now,
      prepare: async () => {
        now = runner.LIMITS.prepareMs;
        return { decision: 'allow', launch: launch() };
      },
    });
    expect((await t.run()).decision).toBe('deny');
    expect(t.spawn).not.toHaveBeenCalled();
  });

  it('passes only owned explicit launch fields and never uses a shell', async () => {
    const descriptor = launch();
    descriptor.args = ['PRIVATE_ARG', '; literal'];
    descriptor.env = { PRIVATE_KEY: 'PRIVATE_VALUE' };
    const t = setup({ prepare: async () => ({ decision: 'allow', launch: descriptor }) });
    const pending = t.run();
    await tick();
    expect(t.spawn).toHaveBeenCalledOnce();
    const [exe, args, options] = t.spawn.mock.calls[0];
    expect(exe).toBe(descriptor.executable);
    expect(args).toEqual(descriptor.args);
    expect(args).not.toBe(descriptor.args);
    expect(options).toEqual({
      cwd: descriptor.cwd,
      env: descriptor.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(Object.getPrototypeOf(options.env)).toBeNull();
    t.child.emit('exit', 0);
    t.child.emit('close', 0);
    expect(JSON.stringify(await pending)).not.toContain('PRIVATE');
  });
});

describe('direct owned child outcome and bounds', () => {
  it('counts combined output but returns no child bytes', async () => {
    const t = setup();
    const pending = t.run();
    await tick();
    t.child.stdout.write('PRIVATE_STDOUT');
    t.child.stderr.write('PRIVATE_STDERR');
    t.child.emit('exit', 7);
    t.child.emit('close', 7);
    const result = await pending;
    expect(result.execution).toMatchObject({
      state: 'exited',
      exitCode: 7,
      stdoutBytes: 14,
      stderrBytes: 14,
      termination: 'not-requested',
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('kills on runtime timeout and confirms only after an exit event', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setup();
    const pending = t.run();
    await tick();
    await vi.advanceTimersByTimeAsync(runner.LIMITS.runtimeMs);
    expect(t.child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
    t.child.emit('exit', null, 'SIGKILL');
    t.child.emit('close', null, 'SIGKILL');
    expect((await pending).execution).toMatchObject({
      state: 'interrupted',
      termination: 'confirmed',
      exitCode: null,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not treat kill return true as confirmed termination', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setup();
    const pending = t.run();
    await tick();
    await vi.advanceTimersByTimeAsync(runner.LIMITS.runtimeMs + runner.LIMITS.cleanupMs);
    expect((await pending).execution).toMatchObject({
      state: 'interrupted',
      termination: 'unconfirmed',
      outputComplete: false,
    });
    expect(t.child.stdout.destroyed).toBe(true);
    expect(t.child.stderr.destroyed).toBe(true);
    expect(t.child.unref).toHaveBeenCalledOnce();
    t.child.emit('exit', 0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handles an error from kill without misreporting a spawn failure', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setup();
    t.child.kill.mockImplementation(() => {
      t.child.emit('error', new Error('PRIVATE_KILL_ERROR'));
      return false;
    });
    const pending = t.run();
    await tick();
    await vi.advanceTimersByTimeAsync(runner.LIMITS.runtimeMs + runner.LIMITS.cleanupMs);
    const result = await pending;
    expect(result.execution).toMatchObject({ state: 'interrupted', termination: 'unconfirmed' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(t.child.kill).toHaveBeenCalledOnce();
  });

  it('kills once when combined output exceeds the limit and flags truncated counts', async () => {
    const t = setup();
    const pending = t.run();
    await tick();
    t.child.stdout.write(Buffer.alloc(runner.LIMITS.outputBytes - 1));
    t.child.stderr.write('ab');
    t.child.stdout.write('PRIVATE_MORE');
    expect(t.child.kill).toHaveBeenCalledOnce();
    t.child.emit('exit', null, 'SIGKILL');
    t.child.emit('close', null, 'SIGKILL');
    const result = await pending;
    expect(result.reason).toBe('output-limit');
    expect(result.execution).toMatchObject({
      state: 'interrupted',
      termination: 'confirmed',
      outputComplete: false,
    });
    expect(result.execution.stdoutBytes + result.execution.stderrBytes).toBe(
      runner.LIMITS.outputBytes,
    );
  });

  it('bounds cleanup when a descendant holds the exited child pipes open', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setup();
    const pending = t.run();
    await tick();
    t.child.emit('exit', 0);
    await vi.advanceTimersByTimeAsync(runner.LIMITS.cleanupMs);
    expect((await pending).execution).toMatchObject({
      state: 'exited',
      exitCode: 0,
      outputComplete: false,
    });
    expect(t.child.kill).not.toHaveBeenCalled();
  });

  it('redacts synchronous and asynchronous spawn failure', async () => {
    const throwing = setup({
      spawn: () => {
        throw new Error('PRIVATE_SPAWN');
      },
    });
    expect((await throwing.run()).execution.state).toBe('spawn-failed');
    const t = setup();
    delete t.child.pid;
    const pending = t.run();
    await tick();
    t.child.emit('error', new Error('PRIVATE_EXECUTABLE'));
    const result = await pending;
    expect(result.execution.state).toBe('spawn-failed');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
});

describe('real Node child execution', () => {
  it('terminates a real direct child when it exceeds the combined output bound', async () => {
    const f = fixture(
      'allow',
      'process.stdout.write(Buffer.alloc(65537));setInterval(()=>{},1000)',
    );
    const result = await runner.executeAction(f.policyPath, f.requestPath);
    expect(result.reason).toBe('output-limit');
    expect(result.execution).toMatchObject({
      state: 'interrupted',
      termination: 'confirmed',
      outputComplete: false,
    });
    expect(result.execution.stdoutBytes + result.execution.stderrBytes).toBe(
      runner.LIMITS.outputBytes,
    );
  }, 10000);

  it('terminates a real direct child at the runtime deadline', async () => {
    const f = fixture('allow', 'setInterval(()=>{},1000)');
    const result = await runner.executeAction(f.policyPath, f.requestPath);
    expect(result.reason).toBe('runtime-timeout');
    expect(result.execution).toMatchObject({ state: 'interrupted', termination: 'confirmed' });
  }, 10000);

  it.each(['allow', 'ask', 'deny'])(
    'executes a harmless sentinel only for %s',
    async (decision) => {
      const f = fixture(
        decision,
        "require('node:fs').writeFileSync('sentinel','ok');process.stdout.write('PRIVATE_OUTPUT')",
      );
      const result = await runner.executeAction(f.policyPath, f.requestPath);
      expect(result.decision).toBe(decision);
      expect(fs.existsSync(path.join(f.directory, 'sentinel'))).toBe(decision === 'allow');
      expect(result.execution.state).toBe(decision === 'allow' ? 'exited' : 'not-started');
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
    },
  );

  it('does not launch when the selected policy is unavailable', async () => {
    const f = fixture('allow', "require('node:fs').writeFileSync('sentinel','bad')");
    const result = await runner.executeAction(
      path.join(f.directory, 'missing.json'),
      f.requestPath,
    );
    expect(result.execution.state).toBe('not-started');
    expect(fs.existsSync(path.join(f.directory, 'sentinel'))).toBe(false);
  });

  it('passes metacharacters literally and excludes parent environment values', async () => {
    vi.stubEnv('AEGIS_PARENT_ONLY', 'PRIVATE_PARENT_SECRET');
    const literal = '; & $(not-a-command) | > PRIVATE';
    const f = fixture(
      'allow',
      "require('node:fs').writeFileSync('sentinel',JSON.stringify({arg:process.argv[1],parent:process.env.AEGIS_PARENT_ONLY,coverage:process.env.NODE_V8_COVERAGE,path:process.env.PATH,profile:process.env.USERPROFILE}))",
      [literal],
    );
    const inheritedCoverage = path.join(f.directory, 'parent-coverage');
    vi.stubEnv('NODE_V8_COVERAGE', inheritedCoverage);
    const result = await runner.executeAction(f.policyPath, f.requestPath);
    expect(result.execution).toMatchObject({ state: 'exited', exitCode: 0 });
    const saved = JSON.parse(fs.readFileSync(path.join(f.directory, 'sentinel'), 'utf8'));
    expect(saved.arg).toBe(literal);
    expect(saved.parent).toBeUndefined();
    expect(saved.coverage).toBe('');
    expect(saved.path || '').toBe('');
    expect(saved.profile || '').toBe('');
    expect(fs.existsSync(inheritedCoverage)).toBe(false);
  });

  it('refuses a parent runtime configured to log child arguments', () => {
    const script =
      "require('./src/main/action-execution').executeAction('PRIVATE_POLICY','PRIVATE_REQUEST').then(r=>process.stdout.write(JSON.stringify(r)))";
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_DEBUG: 'child_process' },
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      decision: 'deny',
      reason: 'runtime-unsupported',
    });
    expect(result.stderr).not.toContain('PRIVATE');
  });
});
