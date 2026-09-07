/**
 * `getStats()` carries the observation gap (Block B5) as a SIBLING of `appHealth`.
 *
 * Same harness as main-app-health-stats.test.js: `app.whenReady()` never resolves, so
 * the deferred modules stay unloaded and the pre-load `getStats` branch is the one
 * exercised — the branch that must answer with a real gap shape when no sensor exists
 * yet, because a laptop can sleep during boot too.
 */
import { describe, it, expect, afterAll } from 'vitest';
import Module from 'module';
import os from 'os';
import { EventEmitter } from 'events';
import { createRequire } from 'module';
import { OBSERVATION_GAP_STATE } from '../../src/main/observation-gap.js';

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
  powerMonitor: new EventEmitter(),
};

const originalLoad = Module._load;
Module._load = function (request, _parent, _isMain) {
  if (request === 'electron') return fakeElectron;
  return originalLoad.apply(this, arguments);
};

const originalArgv = process.argv;
process.argv = ['node', 'main.js'];

const require_ = createRequire(import.meta.url);
const main = require_('../../src/main/main.js');

afterAll(() => {
  Module._load = originalLoad;
  process.argv = originalArgv;
});

describe('getStats() — observation gap (B5)', () => {
  it('observationGap rides on the pre-load branch with the fresh NONE shape', () => {
    const stats = main.getStats();
    expect(stats.observationGap).toEqual({
      state: OBSERVATION_GAP_STATE.NONE,
      suspendedAt: null,
      resumedAt: null,
      gapMs: null,
      clearedAt: null,
      suspendCount: 0,
      totalGapMs: 0,
    });
  });

  it('observationGap is a SIBLING of appHealth and monitoringPaused, never inside either', () => {
    const stats = main.getStats();
    expect(stats).toHaveProperty('observationGap');
    expect(stats.appHealth).not.toHaveProperty('observationGap');
    expect(stats.observationGap).not.toHaveProperty('appHealth');
    expect(stats.observationGap).not.toHaveProperty('monitoringPaused');
    // Time continuity is not a health enum member either.
    expect(Object.keys(stats.appHealth)).not.toContain('observationGap');
  });

  it('the appHealth key set is unchanged by the new sibling', () => {
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

  it('a fresh object per call — never the module record handed to the renderer', () => {
    const a = main.getStats().observationGap;
    const b = main.getStats().observationGap;
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});
