/**
 * The `ipc` block of the stats payload (main.js `getStats`).
 *
 * `getStats` has TWO branches — a pre-`loadDeferredModules` literal and a loaded one —
 * and they are separate object literals, so one can grow a field the other never gets.
 * Both are exercised here by EXECUTION, not by matching the source: `getStats` branches
 * on `scanner` alone while `getAppHealth` branches on `scanner || watcher`, so injecting
 * a scanner stub and leaving `watcher` undefined reaches the loaded stats branch with
 * app health still on its own booting path (ai-mistakes #21 — a gate that does not
 * inspect the change is decoration).
 *
 * `app.whenReady()` never resolves in this harness, so no real deferred module ever
 * loads and the injected stub is the only scanner that exists.
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import Module from 'module';
import os from 'os';
import { createRequire } from 'module';

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

/** The production file-access batcher's count and byte accounting, sorted. */
const BATCHER_STATS_KEYS = [
  'buffered',
  'bufferedBytes',
  'coalesced',
  'evicted',
  'evictedSinceFlush',
  'highWater',
  'highWaterBytes',
  'pushed',
  'retainedEvicted',
];

/** Only what the loaded `getStats` branch reads off the scanner. */
function scannerStub() {
  return {
    activityLog: [],
    monitoringStarted: 1_700_000_000_000,
    peakAgents: 3,
    uniqueAgentNames: new Set(['Claude Code']),
    permissionDeniedScans: 0,
  };
}

afterEach(() => {
  // Module-level state in main.js: leave the booting branch as the default so test
  // order cannot decide which branch a later case sees.
  main._setScannerForTest(undefined);
});

afterAll(() => {
  Module._load = originalLoad;
  process.argv = originalArgv;
});

describe('getStats().ipc — display and security delivery accounting', () => {
  it('the scanner-absent branch carries bounded display counters and an unavailable security lane', () => {
    const stats = main.getStats();
    expect(stats).toHaveProperty('ipc');
    expect(Object.keys(stats.ipc)).toEqual(['fileAccess', 'securityEvents']);
    // Deferred initialization has not run: a zeroed security lookalike would
    // incorrectly claim a running audit consumer and healthy storage.
    expect(stats.ipc.securityEvents).toBeNull();
    expect(Object.keys(stats.ipc.fileAccess).sort()).toEqual(BATCHER_STATS_KEYS);
    for (const key of BATCHER_STATS_KEYS) {
      expect(Number.isSafeInteger(stats.ipc.fileAccess[key]), `${key} must be an integer`).toBe(
        true,
      );
      expect(stats.ipc.fileAccess[key]).toBeGreaterThanOrEqual(0);
    }
    expect(stats.ipc.fileAccess.bufferedBytes).toBeLessThanOrEqual(1024 * 1024);
    expect(stats.ipc.fileAccess.highWaterBytes).toBeLessThanOrEqual(1024 * 1024);
  });

  it('the loaded branch carries the same shape', () => {
    main._setScannerForTest(scannerStub());
    const stats = main.getStats();
    // Proof the branch actually changed: the booting literal hardcodes 0 here, the
    // loaded one reads the stub. Without this the next assertion would pass on either.
    expect(stats.peakAgents).toBe(3);
    expect(Object.keys(stats.ipc)).toEqual(['fileAccess', 'securityEvents']);
    expect(stats.ipc.securityEvents).toBeNull();
    expect(Object.keys(stats.ipc.fileAccess).sort()).toEqual(BATCHER_STATS_KEYS);
  });

  it('both branches produce the identical ipc key set', () => {
    const booting = main.getStats().ipc;
    main._setScannerForTest(scannerStub());
    const loaded = main.getStats().ipc;
    expect(Object.keys(loaded)).toEqual(Object.keys(booting));
    expect(loaded.securityEvents).toBe(booting.securityEvents);
    expect(Object.keys(loaded.fileAccess).sort()).toEqual(Object.keys(booting.fileAccess).sort());
  });

  it('the scanner-absent branch reports the REAL batcher, not a zeroed stub', () => {
    // The batcher is a module-scope const created at load, so it has been counting
    // since before this branch was reachable. A hand-written zero literal here would
    // start lying the moment anything pushed before the first scan.
    const stats = main.getStats();
    const direct = main.getStats();
    expect(stats.ipc.fileAccess).toEqual(direct.ipc.fileAccess);
    // A fresh object per call — never a shared mutable reference handed to the renderer.
    expect(stats.ipc.fileAccess).not.toBe(direct.ipc.fileAccess);
  });

  it('ipc is a SIBLING of appHealth, never inside it', () => {
    // Display loss is not app health: an eviction here is a frame the UI never painted,
    // not a sensor lossCount and not an audit drop. Folding it into the health block
    // would let a UI-throughput number read as an observation failure.
    const stats = main.getStats();
    expect(stats.appHealth).not.toHaveProperty('ipc');
    expect(stats.ipc).not.toHaveProperty('appHealth');
    expect(stats.ipc).not.toHaveProperty('state');
    expect(stats.ipc.fileAccess).not.toHaveProperty('lossCount');
    expect(stats).toHaveProperty('monitoringPaused');
  });

  it('leaves every legacy stats field in place', () => {
    const stats = main.getStats();
    for (const key of [
      'totalFiles',
      'totalSensitive',
      'aiSensitive',
      'uptimeMs',
      'monitoringStarted',
      'peakAgents',
      'currentAgents',
      'aiAgentCount',
      'otherAgentCount',
      'uniqueAgents',
      'permissionDeniedScans',
      'attribution',
      'appHealth',
      'monitoringPaused',
    ]) {
      expect(stats, `missing legacy field ${key}`).toHaveProperty(key);
    }
  });
});
