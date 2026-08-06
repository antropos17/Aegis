/**
 * Regression test for the watcher-startup race (main.js).
 *
 * `initDeferredSubsystems` runs off `ready-to-show` → `setImmediate`. For a local
 * `loadFile` the renderer's `did-finish-load` has ALREADY fired by then, so the
 * previous `webContents.once('did-finish-load', …)` was attached to a spent event
 * and never ran: `setupFileWatchers` was never called and zero chokidar watchers
 * existed. Both orderings are asserted here — the already-loaded one is the case
 * that regressed.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import Module from 'module';
import os from 'os';
import { createRequire } from 'module';

// ── electron stub ─────────────────────────────────────────────────────────────
// `app.whenReady()` never resolves, so requiring main.js wires the module scope
// (and the exports below) without running the startup sequence.
const fakeElectron = {
  app: {
    name: 'Aegis',
    getPath: () => os.tmpdir(),
    getVersion: () => '0.0.0-test',
    setName: () => {},
    disableHardwareAcceleration: () => {},
    requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}),
    on: () => {},
    quit: () => {},
  },
  BrowserWindow: class {},
  globalShortcut: { register: () => {}, unregisterAll: () => {} },
  shell: { openExternal: () => {} },
  ipcMain: { handle: () => {}, on: () => {} },
  dialog: {},
  Notification: class {},
  Tray: class {},
  Menu: { buildFromTemplate: (t) => t },
  nativeImage: { createFromBuffer: (b) => b },
  safeStorage: { isEncryptionAvailable: () => false },
};

const originalLoad = Module._load;
Module._load = function (request, _parent, _isMain) {
  if (request === 'electron') return fakeElectron;
  return originalLoad.apply(this, arguments);
};

const originalArgv = process.argv;
// main.js exits early via a module-scope `return` when argv carries a CLI flag —
// vitest's own argv must not trip that branch and blank out module.exports.
process.argv = ['node', 'main.js'];

// createRequire, not `import`: main.js is CommonJS with a module-scope `return`,
// which is a syntax error under an ESM transform but legal for the CJS loader.
const require_ = createRequire(import.meta.url);
const main = require_('../../src/main/main.js');
const logger = require_('../../src/main/logger.js');

afterAll(() => {
  Module._load = originalLoad;
  process.argv = originalArgv;
});

/** Let the `await setupFileWatchers()` inside startWatchers settle. */
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Minimal webContents double: `isLoading()` is the branch main.js reads, `once`
 * records the listener so the test can fire `did-finish-load` on demand.
 * @param {boolean} loading
 */
function makeWebContents(loading) {
  /** @type {Record<string, Function[]>} */
  const listeners = {};
  return {
    isLoading: () => loading,
    once(event, cb) {
      (listeners[event] ||= []).push(cb);
    },
    emit(event) {
      const cbs = listeners[event] || [];
      listeners[event] = [];
      for (const cb of cbs) cb();
    },
    listenerCount: (event) => (listeners[event] || []).length,
  };
}

describe('main — watcher startup ordering', () => {
  let watcherMock;

  beforeEach(() => {
    main._resetWatchersForTest();
    watcherMock = {
      setupFileWatchers: vi.fn(async () => {}),
      setupRulesWatcher: vi.fn(),
    };
    main._setWatcherForTest(watcherMock);
    vi.restoreAllMocks();
  });

  it('exports the startup entry points', () => {
    expect(typeof main.startWatchersWhenLoaded).toBe('function');
    expect(typeof main.startWatchers).toBe('function');
  });

  it('starts the watchers when did-finish-load fires AFTER registration', async () => {
    const wc = makeWebContents(true);

    main.startWatchersWhenLoaded(wc);
    await flush();
    expect(watcherMock.setupFileWatchers).not.toHaveBeenCalled();
    expect(wc.listenerCount('did-finish-load')).toBe(1);

    wc.emit('did-finish-load');
    await flush();
    expect(watcherMock.setupFileWatchers).toHaveBeenCalledTimes(1);
    expect(watcherMock.setupRulesWatcher).toHaveBeenCalledTimes(1);
  });

  it('starts the watchers when the load has ALREADY finished (the regressed case)', async () => {
    const wc = makeWebContents(false);

    main.startWatchersWhenLoaded(wc);
    await flush();

    expect(watcherMock.setupFileWatchers).toHaveBeenCalledTimes(1);
    expect(watcherMock.setupRulesWatcher).toHaveBeenCalledTimes(1);
    // No listener may be parked on an event that can never fire again.
    expect(wc.listenerCount('did-finish-load')).toBe(0);
  });

  it('creates the watcher set exactly once across repeated calls and both branches', async () => {
    const pending = makeWebContents(true);
    const loaded = makeWebContents(false);

    main.startWatchersWhenLoaded(pending);
    main.startWatchersWhenLoaded(loaded);
    await flush();
    pending.emit('did-finish-load');
    await main.startWatchers();
    await flush();

    expect(watcherMock.setupFileWatchers).toHaveBeenCalledTimes(1);
    expect(watcherMock.setupRulesWatcher).toHaveBeenCalledTimes(1);
  });

  it('logs one line with the number of registered watch roots', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    // setupFileWatchers pushes each watcher into the shared array main.js owns;
    // the mock stands in for that so the logged count is not always zero.
    watcherMock.setupFileWatchers = vi.fn(async () => {
      main._getWatchersForTest().push({ close: () => {} }, { close: () => {} });
    });

    await main.startWatchers();

    const created = info.mock.calls.filter((c) => c[1] === 'File watchers created');
    expect(created).toHaveLength(1);
    expect(created[0][0]).toBe('main');
    expect(created[0][2]).toEqual({ watchRoots: 2 });
  });

  it('logs an error instead of dying silently when setup rejects', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    watcherMock.setupFileWatchers = vi.fn(async () => {
      throw new Error('EACCES');
    });

    await main.startWatchers();

    const failed = error.mock.calls.filter((c) => c[1] === 'File watcher setup failed');
    expect(failed).toHaveLength(1);
    expect(failed[0][2]).toEqual({ error: 'EACCES' });
  });
});
