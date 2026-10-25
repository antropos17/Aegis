import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import {
  capturePackageWindow,
  observePackageWindow,
} from '../../frontend/observatory/tests/package-window-observation.mjs';
import { runWindowPreflightSession } from '../../tools/development/etw-window-preflight.mjs';
import { prepareNativeReadWindow } from '../../scripts/qualification/windows-native-read-support.mjs';

const roots = [];
const originalMain = Object.getOwnPropertyDescriptor(process, 'mainModule');
const load = createRequire(import.meta.url);
const nativeDpiReply = (dpi = 96) => ({
  command: 'window-dpi',
  schema: 'aegis-window-dpi/1',
  windowExists: true,
  ownerMatched: true,
  dpi,
});
afterEach(() => {
  vi.useRealTimers();
  if (originalMain) Object.defineProperty(process, 'mainModule', originalMain);
  else delete process.mainModule;
  for (const root of roots.splice(0)) {
    expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fixture({ packaged = true, diagnostic = true, responsive = true, rendered = true } = {}) {
  vi.useFakeTimers();
  Object.defineProperty(process, 'mainModule', {
    configurable: true,
    writable: true,
    value: { require: load },
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-window-observation-'));
  roots.push(root);
  const archive = path.join(root, 'app.asar');
  fs.mkdirSync(archive);
  fs.writeFileSync(
    path.join(archive, 'package.json'),
    JSON.stringify({ aegisEtwDiagnostic: diagnostic }),
  );
  const output = path.join(root, 'output');
  fs.mkdirSync(output);
  const state = {
    focusable: true,
    focused: true,
    visible: rendered,
    loading: !rendered,
    destroyed: false,
  };
  const window = new EventEmitter();
  Object.assign(window, {
    id: 71,
    setBounds: vi.fn((bounds) => {
      state.bounds = bounds;
    }),
    getBounds: () => state.bounds,
    getNativeWindowHandle: () => {
      const handle = Buffer.alloc(8);
      handle.writeBigUInt64LE(1234n);
      return handle;
    },
    isDestroyed: () => state.destroyed,
    setIgnoreMouseEvents: vi.fn(),
    setFocusable: vi.fn((value) => {
      if (responsive) state.focusable = value;
    }),
    blur: vi.fn(() => {
      if (responsive) state.focused = false;
    }),
    hide: vi.fn(() => {
      if (responsive) {
        state.visible = false;
        state.focused = false;
      }
    }),
    showInactive: vi.fn(() => {
      if (responsive) state.visible = true;
      window.emit('show');
    }),
    isFocusable: () => state.focusable,
    isFocused: () => state.focused,
    isVisible: () => state.visible,
    webContents: { isLoading: () => state.loading },
  });
  let windows = [window];
  const electron = {
    app: { isPackaged: packaged, getAppPath: () => archive },
    BrowserWindow: {
      getAllWindows: () => windows,
      fromId: (id) => windows.find((window) => window.id === id),
    },
    screen: { getDisplayMatching: () => ({ scaleFactor: 1 }) },
  };
  const child = Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
  child.kill = vi.fn(() => {
    child.exitCode = 1;
    child.signalCode = 'SIGTERM';
    child.emit('exit', 1);
  });
  const application = {
    process: () => child,
    evaluate: (fn, args) => fn(electron, args),
    close: vi.fn(async () => {
      child.exitCode = 0;
      child.emit('exit', 0);
    }),
    firstWindow: vi.fn(async () => ({
      getByRole: vi.fn(() => ({ waitFor: vi.fn(async () => {}) })),
    })),
  };
  return {
    root,
    output,
    state,
    window,
    electron,
    application,
    child,
    replaceWindows: (rows) => {
      windows = rows;
    },
  };
}

describe('package-window observation contract', () => {
  it('waits for actual same-window focus state and ready-to-show settling', async () => {
    const run = fixture({ responsive: false, rendered: false });
    let finished = false;
    const pending = capturePackageWindow(run.electron, { timeoutMs: 100, pollMs: 10 }).then(
      (value) => {
        finished = true;
        return value;
      },
    );
    expect(finished).toBe(false);
    setTimeout(() => {
      Object.assign(run.state, { focusable: false, focused: false, visible: true, loading: false });
      run.window.emit('ready-to-show');
    }, 30);
    await vi.advanceTimersByTimeAsync(30);
    expect(finished).toBe(false); // One good sample is insufficient.
    await vi.advanceTimersByTimeAsync(10);
    const result = await pending;
    expect(result.observation).toMatchObject({
      packaged: true,
      diagnosticBuild: true,
      sameWindow: true,
      windowInputIsolated: true,
      focusable: false,
      focused: false,
      visible: true,
      readyToShowObserved: true,
      settled: true,
      timedOut: false,
    });
    expect(run.window.listenerCount('ready-to-show')).toBe(0);
    expect(run.window.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
    expect(run.window.setFocusable).toHaveBeenCalledWith(false);
    expect(run.window.blur.mock.calls.length).toBeGreaterThan(1);
  });

  it('uses same-window inactive visibility transitions when blur cannot clear delayed or regained focus', async () => {
    const run = fixture({ rendered: false });
    run.window.blur.mockImplementation(() => {});
    let finished = false;
    const pending = capturePackageWindow(run.electron, { timeoutMs: 100, pollMs: 10 }).then(
      (value) => {
        finished = true;
        return value;
      },
    );
    setTimeout(() => {
      Object.assign(run.state, { visible: true, focused: true, loading: false });
      run.window.emit('show');
      run.window.emit('ready-to-show');
    }, 15);
    setTimeout(() => {
      // A later product activation can regain focus despite isFocusable() being false.
      expect(run.state.focusable).toBe(false);
      run.state.focused = true;
      run.window.emit('focus');
    }, 25);
    await vi.advanceTimersByTimeAsync(20);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(finished).toBe(false); // The focus transition invalidates the earlier safe sample.
    await vi.advanceTimersByTimeAsync(10);
    expect(finished).toBe(true);
    expect((await pending).observation).toMatchObject({
      sameWindow: true,
      windowInputIsolated: true,
      focusable: false,
      focused: false,
      visible: true,
      readyToShowObserved: true,
      settled: true,
      timedOut: false,
    });
    expect(run.window.blur.mock.calls.length).toBeGreaterThan(1);
    expect(run.window.hide).toHaveBeenCalledTimes(2);
    expect(run.window.showInactive).toHaveBeenCalledTimes(2);
    expect(run.window.hide.mock.invocationCallOrder[0]).toBeLessThan(
      run.window.showInactive.mock.invocationCallOrder[0],
    );
    for (const event of ['ready-to-show', 'show', 'focus'])
      expect(run.window.listenerCount(event)).toBe(0);
  });

  it('retains and refuses the actual unfocusable but persistently focused failure state', async () => {
    const run = fixture();
    run.window.blur.mockImplementation(() => {});
    run.window.hide.mockImplementation(() => {});
    const destination = path.join(run.output, 'window.json');
    const checked = expect(
      observePackageWindow(run.application, destination, { timeoutMs: 100, pollMs: 10 }),
    ).rejects.toThrow('Package window guard failed: windowInputIsolated');
    await vi.advanceTimersByTimeAsync(150);
    await checked;
    expect(JSON.parse(fs.readFileSync(destination, 'utf8'))).toMatchObject({
      sameWindow: true,
      isolationRequested: true,
      windowInputIsolated: false,
      focusable: false,
      focused: true,
      visible: true,
      settled: false,
      timedOut: true,
    });
    for (const event of ['ready-to-show', 'show', 'focus'])
      expect(run.window.listenerCount(event)).toBe(0);
    expect(run.window.hide).toHaveBeenCalledTimes(3);
    expect(run.window.showInactive).toHaveBeenCalledTimes(3);
  });

  it('cannot accept a hidden window if inactive restoration fails after ready-to-show', async () => {
    const run = fixture({ rendered: false });
    run.window.blur.mockImplementation(() => {});
    run.window.showInactive.mockImplementation(() => run.window.emit('show'));
    const pending = capturePackageWindow(run.electron, { timeoutMs: 100, pollMs: 10 });
    setTimeout(() => {
      Object.assign(run.state, { visible: true, focused: true });
      run.window.emit('ready-to-show');
    }, 15);
    await vi.advanceTimersByTimeAsync(110);
    expect((await pending).observation).toMatchObject({
      sameWindow: true,
      windowInputIsolated: true,
      focused: false,
      visible: false,
      readyToShowObserved: true,
      settled: false,
      timedOut: true,
    });
    expect(run.window.hide).toHaveBeenCalledTimes(1);
    expect(run.window.showInactive).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['packaged', { packaged: false }],
    ['diagnosticBuild', { diagnostic: false }],
    ['windowInputIsolated', { responsive: false }],
  ])('retains actual closed flags before rejecting %s', async (field, settings) => {
    const run = fixture(settings);
    const destination = path.join(run.output, 'window.json');
    const checked = expect(
      observePackageWindow(run.application, destination, { timeoutMs: 100, pollMs: 10 }),
    ).rejects.toThrow(`Package window guard failed: ${field}`);
    await vi.advanceTimersByTimeAsync(150);
    await checked;
    const retained = JSON.parse(fs.readFileSync(destination, 'utf8'));
    expect(retained[field]).toBe(false);
    expect(Object.values(retained).every((value) => typeof value === 'boolean')).toBe(true);
    if (field === 'windowInputIsolated')
      expect(retained).toMatchObject({
        focusable: true,
        focused: true,
        visible: true,
        timedOut: true,
      });
  });

  it('never substitutes a different window while confirming isolation', async () => {
    const run = fixture({ responsive: false });
    const replacement = fixture().window;
    const pending = capturePackageWindow(run.electron, { timeoutMs: 100, pollMs: 10 });
    setTimeout(() => run.replaceWindows([replacement]), 20);
    await vi.advanceTimersByTimeAsync(30);
    const observed = (await pending).observation;
    expect(observed).toMatchObject({
      sameWindow: false,
      windowInputIsolated: false,
      settled: false,
    });
    expect(replacement.setFocusable).not.toHaveBeenCalled();
    expect(run.window.listenerCount('ready-to-show')).toBe(0);
  });

  it('rejects timeout even when focus state alone is safe but rendering never settles', async () => {
    const run = fixture({ rendered: false });
    const pending = capturePackageWindow(run.electron, { timeoutMs: 100, pollMs: 10 });
    await vi.advanceTimersByTimeAsync(110);
    expect((await pending).observation).toMatchObject({
      windowInputIsolated: true,
      settled: false,
      timedOut: true,
      readyToShowObserved: false,
      visible: false,
    });
  });
});

describe('actual admission window preparation adapter', () => {
  it('uses shared bounded visibility isolation before accepting the exact sized 100% window', async () => {
    const run = fixture();
    run.window.blur.mockImplementation(() => {});
    const receipt = {};
    const env = { TEMP: 'owned-temp' };
    const readDpi = vi.fn(async () => ({
      command: 'window-dpi',
      schema: 'aegis-window-dpi/1',
      windowExists: true,
      ownerMatched: true,
      dpi: 96,
    }));
    const destination = path.join(run.output, 'admission-window.json');
    let finished = false;
    let failure = null;
    const pending = prepareNativeReadWindow(
      run.application,
      destination,
      env,
      receipt,
      readDpi,
    ).then(
      () => {
        finished = true;
      },
      (error) => {
        failure = error;
        finished = true;
      },
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(40);
    expect(finished).toBe(true);
    await pending;
    expect(failure).toBeNull();
    expect(run.window.hide).toHaveBeenCalledTimes(1);
    expect(run.window.showInactive).toHaveBeenCalledTimes(1);
    expect(run.window.setBounds).toHaveBeenCalledWith({ width: 1280, height: 800 });
    expect(readDpi).toHaveBeenCalledWith({ handle: '1234', mainPid: process.pid }, env);
    expect(receipt.window).toMatchObject({
      sameWindow: true,
      packaged: true,
      diagnosticBuild: true,
      isolated: true,
      visible: true,
      width: 1280,
      height: 800,
      scaleFactor: 1,
      dpi: 96,
    });
    expect(receipt.window).not.toHaveProperty('handle');
    expect(JSON.parse(fs.readFileSync(destination, 'utf8')).settled).toBe(true);
  });

  it('refuses replacement between bounded observation and native display measurement', async () => {
    const run = fixture();
    const replacement = fixture().window;
    replacement.id = 72;
    const evaluate = run.application.evaluate;
    let calls = 0;
    run.application.evaluate = (fn, args) => {
      if (++calls === 3) run.replaceWindows([replacement]);
      return evaluate(fn, args);
    };
    const receipt = {};
    const readDpi = vi.fn(async () => nativeDpiReply());
    const observed = prepareNativeReadWindow(
      run.application,
      path.join(run.output, 'admission-window.json'),
      {},
      receipt,
      readDpi,
    ).then(
      () => null,
      (error) => error,
    );
    await vi.advanceTimersByTimeAsync(60);
    const failure = await observed;
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('Admission window was replaced');
    expect(receipt.window.sameWindow).toBe(false);
    expect(readDpi).not.toHaveBeenCalled();
    expect(replacement.setBounds).not.toHaveBeenCalled();
    expect(replacement.hide).not.toHaveBeenCalled();
  });

  it.each([
    [1.25, 96, 'Only 100% display scaling is qualified'],
    [1, 120, 'Only 100% window DPI is qualified'],
  ])(
    'refuses actual scale %s / DPI %s after retaining window flags',
    async (scaleFactor, dpi, message) => {
      const run = fixture();
      run.electron.screen.getDisplayMatching = () => ({ scaleFactor });
      const receipt = {};
      const destination = path.join(run.output, 'admission-window.json');
      const observed = prepareNativeReadWindow(
        run.application,
        destination,
        {},
        receipt,
        async () => nativeDpiReply(dpi),
      ).then(
        () => null,
        (error) => error,
      );
      await vi.advanceTimersByTimeAsync(60);
      const failure = await observed;
      expect(failure).toBeInstanceOf(Error);
      expect(failure.message).toContain(message);
      expect(receipt.window.scaleFactor).toBe(scaleFactor);
      expect(JSON.parse(fs.readFileSync(destination, 'utf8')).windowInputIsolated).toBe(true);
      expect(receipt.window).not.toHaveProperty('handle');
    },
  );

  it('awaits the existing fixture and rechecks the exact native window handle after its reply', async () => {
    const run = fixture();
    const receipt = {};
    let resolve;
    const readDpi = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    let finished = false;
    const pending = prepareNativeReadWindow(
      run.application,
      path.join(run.output, 'dpi.json'),
      {},
      receipt,
      readDpi,
    ).then(
      () => {
        finished = true;
        return null;
      },
      (error) => {
        finished = true;
        return error;
      },
    );
    await vi.advanceTimersByTimeAsync(60);
    expect(readDpi).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    expect(receipt.window.dpiQuery.completed).toBe(false);
    run.window.getNativeWindowHandle = () => {
      const value = Buffer.alloc(8);
      value.writeBigUInt64LE(5678n);
      return value;
    };
    resolve(nativeDpiReply());
    const error = await pending;
    expect(error.message).toBe('Admission window changed during native DPI query');
    expect(receipt.window.dpiQuery).toMatchObject({
      completed: true,
      responseValid: true,
      sameWindowAfter: false,
    });
    expect(receipt.window.dpi).toBe(96);
    expect(receipt.window).not.toHaveProperty('handle');
  });

  it('refuses unavailable ownership, zero DPI and malformed native metadata without echoing it', async () => {
    for (const response of [
      { ...nativeDpiReply(), windowExists: false },
      { ...nativeDpiReply(), ownerMatched: false },
      nativeDpiReply(0),
      { ...nativeDpiReply(), schema: 'PRIVATE_SCHEMA' },
      { ...nativeDpiReply(), extra: 'PRIVATE_PATH' },
      nativeDpiReply('PRIVATE_DPI'),
    ]) {
      const run = fixture();
      const receipt = {};
      const pending = prepareNativeReadWindow(
        run.application,
        path.join(run.output, 'dpi.json'),
        {},
        receipt,
        async () => response,
      ).then(
        () => null,
        (error) => error,
      );
      await vi.advanceTimersByTimeAsync(60);
      const error = await pending;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).not.toContain('PRIVATE');
      expect(receipt.window.dpiQuery.completed).toBe(true);
      expect(receipt.window.dpiQuery.sameWindowAfter).toBe(false);
      expect(JSON.stringify(receipt.window)).not.toContain('PRIVATE');
    }
  });

  it('has no fallback provider and sends no query for an invalid native target', async () => {
    const run = fixture();
    await expect(
      prepareNativeReadWindow(run.application, path.join(run.output, 'missing.json'), {}, {}),
    ).rejects.toThrow('Native window DPI provider unavailable');
    expect(run.window.setBounds).not.toHaveBeenCalled();
    run.window.getNativeWindowHandle = () => Buffer.alloc(8);
    const provider = vi.fn(async () => nativeDpiReply());
    const pending = prepareNativeReadWindow(
      run.application,
      path.join(run.output, 'invalid.json'),
      {},
      {},
      provider,
    ).then(
      () => null,
      (error) => error,
    );
    await vi.advanceTimersByTimeAsync(60);
    expect((await pending).message).toBe('Native window DPI target invalid');
    expect(provider).not.toHaveBeenCalled();
  });

  it.each(['replacement', 'focus', 'scale'])(
    'refuses %s changes during the native DPI query',
    async (change) => {
      const run = fixture();
      const receipt = {};
      const provider = async () => {
        if (change === 'replacement') {
          const replacement = fixture().window;
          replacement.id = 72;
          run.replaceWindows([replacement]);
        }
        if (change === 'focus') run.state.focused = true;
        if (change === 'scale')
          run.electron.screen.getDisplayMatching = () => ({ scaleFactor: 1.25 });
        return nativeDpiReply();
      };
      const pending = prepareNativeReadWindow(
        run.application,
        path.join(run.output, 'dpi.json'),
        {},
        receipt,
        provider,
      ).then(
        () => null,
        (error) => error,
      );
      await vi.advanceTimersByTimeAsync(60);
      expect((await pending).message).toBe('Admission window changed during native DPI query');
      expect(receipt.window.dpiQuery.sameWindowAfter).toBe(false);
    },
  );
});

describe('ordinary package-window preflight cleanup', () => {
  it('uses only a fresh owned profile and private environment, then closes normally', async () => {
    const run = fixture();
    const baseEnv = {
      PATH: 'fixture-path',
      USERPROFILE: 'personal',
      APPDATA: 'personal',
      LOCALAPPDATA: 'personal',
      TEMP: 'personal',
      GH_TOKEN: 'SECRET',
      ANTHROPIC_API_KEY: 'SECRET',
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: 'unsafe',
    };
    const launch = vi.fn(async () => run.application);
    const pending = runWindowPreflightSession({
      executable: 'C:\\candidate\\AEGIS.exe',
      output: run.output,
      launch,
      baseEnv,
    });
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;
    expect(result).toMatchObject({
      failureCode: null,
      window: { packaged: true, diagnosticBuild: true, windowInputIsolated: true, settled: true },
      normalCloseRequested: true,
      normalCloseObserved: true,
      exitCode: 0,
      forcedCleanupRequested: false,
      noEtwArguments: true,
    });
    expect(result.monitoringHeadingObserved).toBe(true);
    const options = launch.mock.calls[0][0];
    expect(options.args).toEqual(['--user-data-dir=' + path.join(run.output, 'profile')]);
    for (const name of ['USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP']) {
      expect(path.relative(run.output, options.env[name])).not.toMatch(/^\.\./);
      expect(fs.statSync(options.env[name]).isDirectory()).toBe(true);
    }
    expect(options.env).not.toHaveProperty('GH_TOKEN');
    expect(options.env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(options.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
    expect(options.env).not.toHaveProperty('NODE_OPTIONS');
    expect(baseEnv.USERPROFILE).toBe('personal');
    expect(run.application.close).toHaveBeenCalledTimes(1);
    expect(run.child.kill).not.toHaveBeenCalled();
  });

  it('keeps failed observed flags and still requests ordinary close', async () => {
    const run = fixture({ diagnostic: false });
    run.application.close.mockImplementation(async () => {
      expect(
        JSON.parse(fs.readFileSync(path.join(run.output, 'window-observation.json'), 'utf8'))
          .diagnosticBuild,
      ).toBe(false);
      run.child.exitCode = 0;
    });
    const pending = runWindowPreflightSession({
      executable: 'C:\\candidate\\AEGIS.exe',
      output: run.output,
      launch: async () => run.application,
      baseEnv: {},
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({
      failureCode: 'window-not-diagnostic',
      window: { diagnosticBuild: false, packaged: true },
      normalCloseObserved: true,
    });
    expect(run.application.close).toHaveBeenCalledTimes(1);
  });

  it('records close failure separately and never calls forced cleanup a normal close', async () => {
    const run = fixture({ diagnostic: false });
    run.application.close.mockRejectedValue(new Error('PRIVATE-CLOSE-DATA'));
    const pending = runWindowPreflightSession({
      executable: 'C:\\candidate\\AEGIS.exe',
      output: run.output,
      launch: async () => run.application,
      baseEnv: {},
    });
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;
    expect(result).toMatchObject({
      failureCode: 'window-not-diagnostic',
      closeFailureCode: 'normal-close-failed',
      normalCloseObserved: false,
      forcedCleanupRequested: true,
      forcedCleanupObserved: true,
    });
    expect(run.child.kill).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('PRIVATE-CLOSE-DATA');
  });

  it('rejects a resolved close request whose original process exits unsuccessfully', async () => {
    const run = fixture();
    run.application.close.mockImplementation(async () => {
      run.child.exitCode = 7;
    });
    const pending = runWindowPreflightSession({
      executable: 'C:\\candidate\\AEGIS.exe',
      output: run.output,
      launch: async () => run.application,
      baseEnv: {},
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({
      failureCode: 'normal-close-failed',
      normalCloseRequested: true,
      normalCloseObserved: false,
      exitCode: 7,
    });
    expect(run.child.kill).not.toHaveBeenCalled();
  });

  it('preserves measured window flags and closes if the existing Monitoring readiness check fails', async () => {
    const run = fixture();
    const getByRole = vi.fn(() => ({
      waitFor: vi.fn(async () => {
        throw new Error('PRIVATE-HEADING-DATA');
      }),
    }));
    run.application.firstWindow.mockResolvedValue({ getByRole });
    const pending = runWindowPreflightSession({
      executable: 'C:\\candidate\\AEGIS.exe',
      output: run.output,
      launch: async () => run.application,
      baseEnv: {},
    });
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;
    expect(getByRole).toHaveBeenCalledWith('heading', {
      name: 'Monitoring',
      level: 1,
      exact: true,
    });
    expect(result).toMatchObject({
      failureCode: 'monitoring-heading-unobserved',
      monitoringHeadingObserved: false,
      window: { packaged: true, diagnosticBuild: true, windowInputIsolated: true },
      normalCloseObserved: true,
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE-HEADING-DATA');
  });
});
