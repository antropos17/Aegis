import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  prepareNativeReadWindow: vi.fn(),
  readFixture: vi.fn(),
  observeCustodian: vi.fn(),
  exitWithin: vi.fn(),
  until: vi.fn(),
}));

vi.mock('playwright', () => ({ _electron: { launch: mocks.launch } }));
vi.mock('../../scripts/produce-protected-gui-manifest.mjs', () => ({
  GUI_EXECUTABLE: 'AEGIS.exe',
}));
vi.mock('../../scripts/qualification/windows-native-read-support.mjs', () => ({
  until: mocks.until,
  evidence: vi.fn(),
  displayedRisk: vi.fn(),
  prepareNativeReadWindow: mocks.prepareNativeReadWindow,
  probeRetainedObjectRelease: vi.fn(),
}));
vi.mock('../../frontend/observatory/tests/etw-support.mjs', () => ({
  diagnostics: vi.fn(),
  readFixture: mocks.readFixture,
  observeQuit: vi.fn(),
  matchingRead: vi.fn(),
}));
vi.mock('../../frontend/observatory/tests/sensor-support.mjs', () => ({
  inspectProfile: vi.fn(),
  exitWithin: mocks.exitWithin,
}));
vi.mock('../../frontend/observatory/tests/etw-custodian-support.mjs', () => ({
  observeCustodian: mocks.observeCustodian,
}));

import { runNativeReadScenario } from '../../scripts/qualification/windows-native-read-scenario.mjs';

describe('actual native-read scenario launch composition', () => {
  let app;
  let fixture;
  let observer;
  let receipt;

  beforeEach(() => {
    vi.clearAllMocks();
    receipt = { reads: [] };
    fixture = {
      child: { pid: 42, exitCode: null },
      next: vi.fn().mockResolvedValue({ pid: 42, birth: '123', shareDelete: false }),
      close: vi.fn(async () => {
        fixture.child.exitCode = 0;
      }),
    };
    observer = {
      child: { exitCode: null },
      until: vi.fn().mockResolvedValue({ type: 'endpoint', address: 'owned-endpoint' }),
      stop: vi.fn(() => {
        observer.child.exitCode = 0;
      }),
      settled: vi.fn(),
    };
    app = {
      process: vi.fn(() => ({ pid: 84 })),
      close: vi.fn(),
    };
    mocks.readFixture.mockReturnValue(fixture);
    mocks.observeCustodian.mockReturnValue(observer);
    mocks.exitWithin.mockResolvedValue(0);
  });

  afterEach(() => vi.useRealTimers());

  it('lets the real scenario cross a 45 second cold connection under the 90 second bound', async () => {
    vi.useFakeTimers();
    mocks.launch.mockImplementation(
      (options) =>
        new Promise((resolve, reject) => {
          setTimeout(() => {
            if (options.timeout < 45_000)
              reject(Object.assign(new Error('too early'), { name: 'TimeoutError' }));
            else resolve(app);
          }, 45_000);
        }),
    );
    mocks.prepareNativeReadWindow.mockRejectedValue(new Error('stop after launch composition'));

    const pending = runNativeReadScenario({
      fixtureExe: 'fixture.exe',
      file: 'X:/owned/.env',
      out: 'X:/owned/evidence',
      env: {},
      r: receipt,
      canary: 'canary',
      candidate: 'X:/owned/candidate',
      helper: 'helper.exe',
    });
    const rejection = expect(pending).rejects.toThrow('stop after launch composition');
    await vi.advanceTimersByTimeAsync(45_000);
    await rejection;

    expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({ timeout: 90_000 }));
    expect(receipt.launch).toMatchObject({
      phase: 'connected',
      returned: true,
      timeoutMilliseconds: 90_000,
      elapsedMilliseconds: 45_000,
    });
    expect(mocks.prepareNativeReadWindow).toHaveBeenCalledOnce();
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(app.close).toHaveBeenCalledOnce();
    expect(observer.stop).toHaveBeenCalledOnce();
  });

  it('projects a launch timeout before cleanup without retaining the raw failure', async () => {
    const privateValue = 'PRIVATE_CANARY_C:\\Users\\owner\\profile';
    mocks.launch.mockRejectedValue(
      Object.assign(new Error(privateValue), { name: 'TimeoutError' }),
    );

    const pending = runNativeReadScenario({
      fixtureExe: 'fixture.exe',
      file: 'X:/owned/.env',
      out: 'X:/owned/evidence',
      env: {},
      r: receipt,
      canary: 'canary',
      candidate: 'X:/owned/candidate',
      helper: 'helper.exe',
    });

    await expect(pending).rejects.toThrow('Native-read Electron launch timed out');
    expect(JSON.stringify(receipt.launch)).not.toContain(privateValue);
    expect(receipt.launch).toMatchObject({
      phase: 'failed',
      returned: false,
      failureCode: 'timeout',
    });
    expect(mocks.prepareNativeReadWindow).not.toHaveBeenCalled();
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(app.close).not.toHaveBeenCalled();
    expect(observer.stop).toHaveBeenCalledOnce();
  });

  it('uses the owned-profile Settings flow before subscribing in the Simple investigation workspace', async () => {
    let simple = false;
    let workspace = 'Monitoring';
    const actions = [];
    const navigation = {
      getByRole(role, { name, exact }) {
        expect(role).toBe('button');
        expect(exact).toBe(true);
        return {
          async click() {
            actions.push(name);
            if (name === 'Settings') workspace = 'Settings';
            else if (name === 'Investigate' && simple) workspace = 'Investigate';
            else throw new Error('Requested workspace is unavailable in the current mode');
          },
        };
      },
    };
    const page = {
      getByRole(role, options) {
        if (role === 'navigation' && options.name === 'Main navigation') return navigation;
        if (role === 'heading')
          return {
            async waitFor() {
              expect(workspace).toBe(options.name);
            },
          };
        if (role === 'checkbox' && options.name === 'Simple interface')
          return {
            async check() {
              expect(workspace).toBe('Settings');
              simple = true;
              actions.push('Simple interface');
            },
          };
        if (role === 'region' && options.name === 'Investigation workspace')
          return {
            async waitFor() {
              expect(simple && workspace === 'Investigate').toBe(true);
              actions.push('workspace-ready');
            },
          };
        throw new Error('Unscoped or unavailable UI control');
      },
      evaluate: vi.fn(async () => {
        expect(actions.at(-1)).toBe('workspace-ready');
        actions.push('subscribe');
      }),
    };
    app.firstWindow = vi.fn().mockResolvedValue(page);
    mocks.launch.mockResolvedValue(app);
    mocks.prepareNativeReadWindow.mockResolvedValue(undefined);
    mocks.until.mockRejectedValue(new Error('stop before native readiness'));

    await expect(
      runNativeReadScenario({
        fixtureExe: 'fixture.exe',
        file: 'X:/owned/.env',
        out: 'X:/owned/evidence',
        env: {},
        r: receipt,
        canary: 'canary',
        candidate: 'X:/owned/candidate',
        helper: 'helper.exe',
      }),
    ).rejects.toThrow('stop before native readiness');

    expect(actions).toEqual([
      'Settings',
      'Simple interface',
      'Investigate',
      'workspace-ready',
      'subscribe',
    ]);
    expect(page.evaluate).toHaveBeenCalledOnce();
    expect(mocks.launch).toHaveBeenCalledOnce();
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(app.close).toHaveBeenCalledOnce();
    expect(observer.stop).toHaveBeenCalledOnce();
  });
});
