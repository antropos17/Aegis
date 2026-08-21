/**
 * The `getStats()` composer (main.js).
 *
 * `app.whenReady()` never resolves in this harness, so `loadDeferredModules` never
 * runs and every deferred module stays `undefined`. That IS the BOOTING branch, and
 * exercising it here is the point: it is the one path where the composer must answer
 * without a single leaf record existing.
 */
import { describe, it, expect, afterAll } from 'vitest';
import Module from 'module';
import os from 'os';
import { createRequire } from 'module';
import { APP_HEALTH_STATE } from '../../src/main/app-health.js';

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

describe('getStats() — app health composition', () => {
  it('21. answers BOOTING before the deferred modules load, and does not throw', () => {
    const stats = main.getStats();
    expect(stats.appHealth.state).toBe(APP_HEALTH_STATE.BOOTING);
    expect(stats.appHealth.reasons).toEqual([]);
  });

  it('22. monitoringPaused is a SIBLING of appHealth, never inside it', () => {
    const stats = main.getStats();
    expect(stats).toHaveProperty('monitoringPaused');
    expect(typeof stats.monitoringPaused).toBe('boolean');
    // The orthogonality that the whole model rests on: a deliberate silence must stay
    // distinguishable from a broken sensor, so operator control never enters the enum.
    expect(stats.appHealth).not.toHaveProperty('monitoringPaused');
    expect(Object.values(APP_HEALTH_STATE)).not.toContain('PAUSED');
  });

  it('23. populationState rides beside populationReliable and populationAsOf', () => {
    const health = main.getAppHealth();
    expect(health).toHaveProperty('populationState');
    expect(health).toHaveProperty('populationReliable');
    expect(health).toHaveProperty('populationAsOf');
    // Null, not a guessed 'STARTING'. No leaf record exists yet, and "not observed" is
    // a different fact from "observed and starting" — the renderer gates the
    // "population unknown" copy on this field, so it must not be invented here.
    expect(health.populationState).toBeNull();
    expect(health.populationReliable).toBe(false);
    expect(health.populationAsOf).toBeNull();
  });

  it('the BOOTING payload is fully shaped — a reader needs no undefined guards', () => {
    const health = main.getAppHealth();
    expect(health.sensors).toEqual({ byId: {}, raw: null, effective: null, projections: [] });
    expect(health.watchPlan).toBeNull();
    expect(health.identityDegraded).toBe(false);
    expect(health.identityQuality).toBeNull();
  });

  it('both getStats branches carry the same appHealth key set', () => {
    // The pre-load branch is a separate literal in main.js, so it can drift from the
    // loaded one silently. This pins the two together at the only point they are both
    // reachable — the payload contract, not the values.
    const keys = Object.keys(main.getStats().appHealth).sort();
    expect(keys).toEqual([
      'identityDegraded',
      'identityQuality',
      'populationAsOf',
      'populationReliable',
      'populationState',
      'reasons',
      'sensors',
      'state',
      'watchPlan',
    ]);
  });

  it('the legacy stats fields are untouched', () => {
    // appHealth is additive: nothing that already rode this payload may move or vanish.
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
    ]) {
      expect(stats, `missing legacy field ${key}`).toHaveProperty(key);
    }
  });
});
