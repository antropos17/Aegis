/**
 * Tap 1 of docs/roadmap/sequence-rules.md §5: main.js `onFileEvent` hands the record
 * that survived `dedupFileEvent` to the sequence engine — the SAME object the audit call
 * receives, after it — and hands nothing over for a record dedup dropped.
 *
 * The REAL scan-loop module does the dedup here, so "passed" and "dropped" are the
 * production 30 s window and not a stub's opinion; only the engine and the audit sink
 * are fakes. `app.whenReady()` never resolves in this harness, so `loadDeferredModules`
 * never runs and the two `_set…ForTest` seams are the only collaborators main.js holds.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import Module from 'module';
import os from 'os';
import { createRequire } from 'module';

// ── electron stub ─────────────────────────────────────────────────────────────
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

// createRequire, not `import`: main.js is CommonJS with a module-scope `return`, which
// is a syntax error under an ESM transform but legal for the CJS loader.
const require_ = createRequire(import.meta.url);
const main = require_('../../src/main/main.js');

afterAll(() => {
  Module._load = originalLoad;
  process.argv = originalArgv;
});

/** One attributed, non-sensitive FileEvent as file-watcher.js builds it. */
function fileEvent() {
  return {
    agent: 'Claude Code',
    pid: 100,
    instanceId: '100:1717000000000',
    file: 'C:\\Users\\me\\passwords.txt',
    action: 'accessed',
    sensitive: false,
    category: 'ai',
    attribution: { status: 'confirmed', evidence: ['cwd-containment'] },
    timestamp: 1717000005000,
  };
}

describe('main — file-event tap into the sequence engine', () => {
  let engine;
  let auditLog;

  beforeEach(() => {
    // Fake timers: the two batchers `onFileEvent` pushes into would otherwise arm real
    // flush timers that fire after this file is torn down.
    vi.useFakeTimers();
    // A FRESH scan-loop per test: its dedup map is module state, and a record dropped
    // here must be dropped by THIS test's window, not a previous test's.
    const scanLoopPath = require_.resolve('../../src/main/scan-loop.js');
    delete require_.cache[scanLoopPath];
    const scanLoop = require_('../../src/main/scan-loop.js');
    auditLog = vi.fn();
    scanLoop.init({ audit: { log: auditLog } });
    engine = { ingest: vi.fn(), sweep: vi.fn() };
    main._setScanLoopForTest(scanLoop);
    main._setSequenceEngineForTest(engine);
  });

  afterEach(() => {
    main._setScanLoopForTest(undefined);
    main._setSequenceEngineForTest(undefined);
    vi.useRealTimers();
  });

  it('ingests the record that passed dedup — the very object the audit call received', () => {
    const ev = fileEvent();
    main.onFileEvent(ev);

    expect(engine.ingest).toHaveBeenCalledTimes(1);
    // Identity, not equality: the deduped record carries `repeatCount` now, and the
    // engine must see that object, not a copy taken before dedup.
    expect(engine.ingest.mock.calls[0][0]).toBe(ev);
    expect(ev.repeatCount).toBe(1);
    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(auditLog.mock.calls[0][1].instanceId).toBe(ev.instanceId);
    // After the audit record, never before it.
    expect(engine.ingest.mock.invocationCallOrder[0]).toBeGreaterThan(
      auditLog.mock.invocationCallOrder[0],
    );
  });

  it('hands nothing over for a record dedup dropped, and does again past the window', () => {
    main.onFileEvent(fileEvent());
    // Same instance + same path inside 30 s: dedup returns null, so neither the audit
    // nor the engine sees it.
    main.onFileEvent(fileEvent());
    expect(engine.ingest).toHaveBeenCalledTimes(1);
    expect(auditLog).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(31000);
    main.onFileEvent(fileEvent());
    expect(engine.ingest).toHaveBeenCalledTimes(2);
    expect(auditLog).toHaveBeenCalledTimes(2);
  });

  it('passes a keyless (unattributed) record through unfiltered — the engine counts it', () => {
    const ev = {
      ...fileEvent(),
      agent: '',
      pid: null,
      instanceId: null,
      category: 'other',
      attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
    };
    main.onFileEvent(ev);

    // Roadmap §4: the null policy lives in the engine (`skippedNullInstanceId`); a tap
    // that dropped the record first would turn a counted skip into silence.
    expect(engine.ingest).toHaveBeenCalledTimes(1);
    expect(engine.ingest.mock.calls[0][0]).toBe(ev);
  });
});
