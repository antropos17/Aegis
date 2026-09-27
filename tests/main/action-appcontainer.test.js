import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const { runProtectedAction } = require('../../src/main/action-protected-execution');
const runner = require('../../src/main/action-execution');
const confirmation = require('../../src/main/action-confirmation');
const { handleActionExecutionCLI } = require('../../src/main/action-execution-cli');
const isolation = { state: 'verified', workspace: 'retained', profileCleanup: 'confirmed' };
const outcome = {
  exited: true,
  exitCode: 0,
  stdoutBytes: 7,
  stderrBytes: 2,
  outputComplete: true,
  outputLimit: false,
  isolationVerified: true,
  workspaceRetained: true,
  profileCleanup: true,
};
const protection = { appContainer: true, protectedDescendants: true };
function peer(overrides = {}) {
  return Object.assign(new EventEmitter(), {
    cleanupConfirmed: true,
    isolationVerified: true,
    actionOutcome: { ...outcome },
    stop: vi.fn(),
    kill: vi.fn(),
    unref: vi.fn(),
    ...overrides,
  });
}
function run(child, signal) {
  return runProtectedAction({}, signal, null, () => child, runner.LIMITS, protection);
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  runner._resetForTest();
});

describe('AppContainer receipt boundary', () => {
  it('starts the action deadline after isolated readiness and bounds setup independently', async () => {
    vi.useFakeTimers();
    const child = peer({ isolationVerified: false });
    const pending = run(child);
    await vi.advanceTimersByTimeAsync(runner.LIMITS.runtimeMs);
    expect(child.stop).not.toHaveBeenCalled();
    child.isolationVerified = true;
    child.emit('ready');
    await vi.advanceTimersByTimeAsync(runner.LIMITS.runtimeMs);
    expect(child.stop).toHaveBeenCalledOnce();
    child.emit('close');
    expect(await pending).toMatchObject({ reason: 'runtime-timeout', isolation });

    const silent = peer({ isolationVerified: false, cleanupConfirmed: false, actionOutcome: null });
    const refused = run(silent);
    await vi.advanceTimersByTimeAsync(runner.LIMITS.isolationStartupMs);
    expect(silent.stop).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(runner.LIMITS.protectedCleanupMs);
    expect(await refused).toMatchObject({ decision: 'unknown', reason: 'cleanup-unconfirmed' });
  });

  it('reports verified isolation only with native readiness and a complete final receipt', async () => {
    const child = peer();
    const pending = run(child);
    child.emit('close');
    expect(await pending).toMatchObject({
      decision: 'allow',
      control: 'windows-appcontainer-job',
      descendantControl: 'confirmed',
      execution: { state: 'exited', exitCode: 0, stdoutBytes: 7, stderrBytes: 2 },
      isolation,
    });
  });

  it.each(['isolationVerified', 'workspaceRetained', 'profileCleanup'])(
    'does not accept a successful child exit without %s',
    async (field) => {
      const child = peer({ actionOutcome: { ...outcome, [field]: false } });
      const pending = run(child);
      child.emit('close');
      expect(await pending).toMatchObject({
        decision: 'unknown',
        reason: 'isolation-unconfirmed',
        execution: { state: 'unknown', outputComplete: false },
      });
    },
  );

  it('rejects a Job-only receipt even if the process exited zero', async () => {
    const child = peer({ isolationVerified: false });
    const pending = run(child);
    child.emit('close');
    expect(await pending).toMatchObject({ decision: 'unknown', isolation: { state: 'unknown' } });
  });

  it('preserves uncertainty about retained files and profile cleanup after helper loss', async () => {
    const child = peer({ cleanupConfirmed: false, actionOutcome: null });
    const pending = run(child);
    child.emit('close');
    expect(await pending).toMatchObject({
      decision: 'unknown',
      descendantControl: 'unconfirmed',
      isolation: { state: 'verified', workspace: 'unknown', profileCleanup: 'unconfirmed' },
    });
  });

  it('keeps import state unknown when helper cleanup or final receipt is missing', async () => {
    const child = peer({ cleanupConfirmed: false, actionOutcome: null });
    const pending = runProtectedAction({}, undefined, null, () => child, runner.LIMITS, {
      ...protection,
      importInput: true,
    });
    child.emit('close');
    expect(await pending).toMatchObject({
      decision: 'unknown',
      input: 'unknown',
      execution: { state: 'unknown' },
    });
  });

  it('bounds cancellation when the native owner provides no final receipt', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const child = peer({ cleanupConfirmed: false, actionOutcome: null });
    const pending = run(child, controller.signal);
    controller.abort();
    expect(child.stop).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(runner.LIMITS.protectedCleanupMs);
    expect(await pending).toMatchObject({ decision: 'unknown', reason: 'cleanup-unconfirmed' });
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('refuses unavailable native protection without creating a workspace', async () => {
    expect(
      await runProtectedAction(
        {},
        undefined,
        null,
        () => {
          throw Error('PRIVATE');
        },
        runner.LIMITS,
        protection,
      ),
    ).toMatchObject({
      decision: 'deny',
      execution: { state: 'not-started' },
      isolation: { state: 'not-started', workspace: 'not-created', profileCleanup: 'not-required' },
    });
  });

  it('rejects a malformed isolation option before preparing any action', async () => {
    const prepare = vi.fn();
    runner._setDepsForTest({ prepare });
    expect(
      await runner.executeAction('PRIVATE', 'PRIVATE', { appContainer: 'true' }),
    ).toMatchObject({ decision: 'deny', reason: 'protected-option-invalid' });
    expect(prepare).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === 'win32')(
    'refuses unsupported hosts before preparing an action',
    async () => {
      const prepare = vi.fn();
      runner._setDepsForTest({ prepare });
      expect(
        await runner.executeAction('PRIVATE', 'PRIVATE', { appContainer: true }),
      ).toMatchObject({
        reason: 'protected-runtime-unsupported',
        control: 'windows-appcontainer-job',
      });
      expect(prepare).not.toHaveBeenCalled();
    },
  );
});

describe('AppContainer CLI result', () => {
  it('requires confirmed import for the import route', async () => {
    const confirm = vi.spyOn(confirmation, 'confirmSelectedAction').mockResolvedValue({
      decision: 'allow',
      execution: { state: 'exited', exitCode: 0, outputComplete: true },
      control: 'windows-appcontainer-job',
      descendantControl: 'confirmed',
      isolation,
      input: 'unknown',
    });
    expect(
      await handleActionExecutionCLI(
        ['--action-exec-appcontainer-import-confirm', 'policy', 'request', 'C:\\source.bin'],
        () => {},
      ),
    ).toBe(2);
    expect(confirm).toHaveBeenCalledWith('policy', 'request', {
      signal: expect.any(AbortSignal),
      appContainer: true,
      inputFile: 'C:\\source.bin',
    });
  });
  it.each([
    ['verified', 'retained', 'confirmed', 0],
    ['unknown', 'retained', 'confirmed', 2],
    ['verified', 'unknown', 'confirmed', 2],
    ['verified', 'retained', 'unconfirmed', 2],
  ])(
    'requires all isolation receipts: %s/%s/%s',
    async (state, workspace, profileCleanup, expected) => {
      const confirm = vi.spyOn(confirmation, 'confirmSelectedAction').mockResolvedValue({
        decision: 'allow',
        execution: { state: 'exited', exitCode: 0, outputComplete: true },
        control: 'windows-appcontainer-job',
        descendantControl: 'confirmed',
        isolation: { state, workspace, profileCleanup },
      });
      const listeners = process.listenerCount('SIGINT');
      expect(
        await handleActionExecutionCLI(
          ['--action-exec-appcontainer-confirm', 'policy', 'request'],
          () => {},
        ),
      ).toBe(expected);
      expect(confirm).toHaveBeenCalledWith('policy', 'request', {
        signal: expect.any(AbortSignal),
        appContainer: true,
      });
      expect(process.listenerCount('SIGINT')).toBe(listeners);
    },
  );

  it('retains the requested protection label and uncertainty when confirmation throws', async () => {
    vi.spyOn(confirmation, 'confirmSelectedAction').mockRejectedValue(Error('PRIVATE'));
    const output = [];
    expect(
      await handleActionExecutionCLI(
        ['--action-exec-appcontainer-confirm', 'policy', 'request'],
        (s) => output.push(s),
      ),
    ).toBe(2);
    expect(JSON.parse(output[0])).toMatchObject({
      decision: 'unknown',
      control: 'windows-appcontainer-job',
      isolation: { state: 'unknown', workspace: 'unknown', profileCleanup: 'unconfirmed' },
    });
    expect(output[0]).not.toContain('PRIVATE');
  });
});
