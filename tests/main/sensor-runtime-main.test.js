import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHarness, installShims } from './helpers/health-umbrella-harness.js';
import { batch, bootId, context, event, fakeChild, ready } from './sensor-host-fixtures.js';

const require_ = createRequire(import.meta.url);
const shims = installShims();
const shimLoad = Module._load;
const electron = require_('electron');
const priorOn = electron.app.on;
const events = new EventEmitter();
electron.app.on = events.on.bind(events);
let main;
const runtimeModule = require_('../../src/main/platform/sensor-runtime');
let h, child, directory, contextReady, snapshotHealthy, ticks, runtimePlatform, spawn;
const initialTicks = '12345';
function processMap() {
  contextReady = snapshotHealthy;
  return snapshotHealthy
    ? new Map([
        [
          4242,
          {
            name: 'claude',
            ppid: 1,
            startTime: 1700000000000 + Number((BigInt(ticks) * 1000n) / 100n),
            witness: `${bootId}:${ticks}`,
            witnessSource: 'linuxStartTicks',
          },
        ],
      ])
    : new Map();
}
function snapshotLeaf() {
  return {
    sensorId: 'proc-snapshot',
    state: snapshotHealthy ? 'HEALTHY' : 'FAILED',
    lastAttemptAt: Date.now(),
    lastSuccessAt: snapshotHealthy ? Date.now() : null,
    lastError: snapshotHealthy ? null : 'fixture-outage',
    consecutiveFailures: snapshotHealthy ? 0 : 1,
    lossCount: 0,
    detail: null,
  };
}
beforeEach(() => {
  events.removeAllListeners();
  delete require_.cache[require_.resolve('../../src/main/main.js')];
  shims.main = require_('../../src/main/main.js');
  main = shims.main;
  expect(main.getStats().nativeSensor).toBeNull();
  ticks = initialTicks;
  snapshotHealthy = true;
  contextReady = false;
  child = null;
  runtimePlatform = 'linux';
  h = createHarness(shims);
  spawn = vi.fn(() => (child = fakeChild()));
  shims.fakePlatform.getProcessBirthContext = () => (contextReady ? context : null);
  shims.fakePlatform.getSnapshotHealth = snapshotLeaf;
  h.scanner._setPlatformForTest({
    providesStartTime: true,
    getSnapshotHealth: snapshotLeaf,
    getParentProcessMap: async () => processMap(),
  });
  const procUtil = require_('../../src/main/process-utils');
  procUtil._resetForTest();
  procUtil._setPlatformForTest({
    providesStartTime: true,
    getParentProcessMap: async () => processMap(),
    getProcessCwds: async () => new Map(),
  });
  // Production startup and its real scan-loop are retained. Replace only external
  // discovery/I/O owners and the native child boundary, then inspect public stats.
  const discovery = {
    refresh: vi.fn(),
    cancelRefresh: vi.fn(),
    stop: vi.fn(),
    snapshot: () => ({ status: 'unsupported', candidates: [], stale: false }),
  };
  Module._load = function (request) {
    if (request === './platform/sensor-runtime')
      return {
        createSensorRuntime: (deps) =>
          runtimeModule.createSensorRuntime({
            ...deps,
            _test: {
              platform: runtimePlatform,
              host: { spawn, exists: () => true, mono: Date.now },
            },
          }),
      };
    if (request === './container-scanner') return { createDockerDiscovery: () => discovery };
    if (request === './podman-scanner') return { createPodmanDiscovery: () => discovery };
    if (request === './wsl-inventory') return { createWslInventory: () => discovery };
    return shimLoad.apply(this, arguments);
  };
  const audit = require_('../../src/main/audit-logger');
  for (const method of ['init', 'log', 'shutdown'])
    vi.spyOn(audit, method).mockImplementation(() => {});
  vi.spyOn(audit, 'persistBatch').mockReturnValue(true);
  const baselines = require_('../../src/main/baselines');
  vi.spyOn(baselines, 'loadBaselines').mockImplementation(() => {});
  vi.spyOn(baselines, 'finalizeSession').mockImplementation(() => {});
  const config = require_('../../src/main/config-manager');
  vi.spyOn(config, 'trackSeenAgent').mockImplementation(() => {});
  vi.spyOn(config, 'getSettings').mockReturnValue({ scanIntervalSec: 10 });
  for (const method of ['info', 'warn', 'error', 'debug', 'shutdown'])
    vi.spyOn(require_('../../src/main/logger'), method).mockImplementation(() => {});
  vi.spyOn(require_('../../src/main/tray-icon'), 'updateTrayIcon').mockImplementation(() => {});
  main._resetWatchersForTest();
  main._setMonitoringPausedForTest(false);
  main._setSensitiveAlertJournalForTest(null);
  main._setMainWindowForTest({
    isDestroyed: () => false,
    webContents: {
      isLoading: () => true,
      once: vi.fn(),
      send: vi.fn(),
    },
  });
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-native-owner-'));
});
afterEach(async () => {
  const dispose = main._resetSensorRuntimeForTest();
  child?.close(0);
  await dispose;
  events.emit('before-quit', { preventDefault: vi.fn() });
  events.emit('quit');
  await h.tearDown();
  vi.clearAllTimers();
  vi.restoreAllMocks();
  Module._load = shimLoad;
  delete shims.fakePlatform.getProcessBirthContext;
  require_('../../src/main/process-utils')._resetForTest();
  if (
    path.dirname(directory) !== path.resolve(os.tmpdir()) ||
    !path.basename(directory).startsWith('aegis-native-owner-')
  )
    throw Error('fixture-directory-invalid');
  fs.rmSync(directory, { recursive: true, force: true });
});
afterAll(() => {
  electron.app.on = priorOn;
  shims.restore();
});

describe('actual deferred startup, process scan and main stats', () => {
  it('starts with honest context fallback, then publishes provider status and separate degraded native leaf', async () => {
    expect(main.getStats().nativeSensor).toBeNull();
    main._initDeferredSubsystemsForTest(directory);
    expect(spawn).not.toHaveBeenCalled();
    expect(main.getStats().nativeSensor).toMatchObject({ reason: 'identity-context-unavailable' });
    await h.advance(3000);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(h.scanner.getProcessCapabilities().populationReliable).toBe(true);
    ready(child);
    const watch = child.messages.find((m) => m.t === 'watch');
    expect(watch.roots).toEqual([
      {
        pid: 4242,
        birth: initialTicks,
        witness: { kind: 'linux-start-ticks', bootId, startTicks: initialTicks },
      },
    ]);
    const stats = main.getStats();
    expect(stats.nativeSensor).toMatchObject({
      providerState: 'HEALTHY',
      watchScope: 'current',
      admission: { state: 'unsupported-admission', accepted: 0, rejected: 0 },
    });
    expect(stats.appHealth.sensors.byId['native-sensor']).toMatchObject({
      state: 'DEGRADED',
      detail: 'unsupported-admission',
    });
    expect(stats.appHealth.sensors.effective.degradedSensorIds).toContain('native-sensor');
    expect(Object.values(stats.nativeSensor.coverage)).toEqual(Array(5).fill('coverage-lost'));
    child.send(batch(event('1')));
    expect(main.getStats().nativeSensor).toMatchObject({
      reason: 'sink-rejected',
      lossCount: 1,
      admission: { accepted: 0, rejected: 1 },
    });
    expect(stats.appHealth.populationReliable).toBe(true);
  });

  it('changes watch generation on the real scanner pass and freezes sessions across snapshot outage', async () => {
    main._initDeferredSubsystemsForTest(directory);
    await h.advance(3000);
    ready(child);
    const active = h.sessionTracker.activeCount();
    ticks = '12346';
    h.scanLoop.stopScanIntervals();
    h.scanLoop.staggeredStartup(10000, true);
    await h.advance(1500);
    child.send({ t: 'health', state: 'HEALTHY', detail: 'ready' });
    await h.advance(1500);
    expect(child.messages.at(-1)).toMatchObject({
      t: 'watch',
      roots: [{ pid: 4242, birth: ticks }],
    });
    child.ack();
    snapshotHealthy = false;
    const current = h.sessionTracker.activeCount();
    expect(h.sessionTracker.hasInstance('4242:1700000123460')).toBe(true);
    h.scanLoop.stopScanIntervals();
    h.scanLoop.staggeredStartup(10000, true);
    await h.advance(1500);
    child.send({ t: 'health', state: 'HEALTHY', detail: 'ready' });
    await h.advance(1500);
    expect(child.messages.at(-1)).toMatchObject({ t: 'watch', roots: [] });
    expect(main.getStats().nativeSensor.watchScope).toBe('process-observation-unavailable');
    expect(h.sessionTracker.activeCount()).toBe(current);
    expect(h.sessionTracker.hasInstance('4242:1700000123460')).toBe(true);
    expect(active).toBe(1);
  });

  it('keeps Windows startup and loaded health free of a native attempt or additional leaf', async () => {
    runtimePlatform = 'win32';
    main._initDeferredSubsystemsForTest(directory);
    await h.advance(3000);
    expect(spawn).not.toHaveBeenCalled();
    expect(main.getStats().nativeSensor).toBeNull();
    expect(main.getAppHealth().sensors.byId).not.toHaveProperty('native-sensor');
    expect(main.getAppHealth().populationReliable).toBe(true);
  });

  it('withdraws native roots after an actual provider rejection without retiring polling sessions', async () => {
    main._initDeferredSubsystemsForTest(directory);
    await h.advance(3000);
    ready(child);
    h.scanner._setPlatformForTest({
      getParentProcessMap: async () => {
        contextReady = false;
        throw Object.assign(new Error('fixture-outage'), { code: 'EPERM' });
      },
    });
    const count = h.sessionTracker.activeCount();
    h.scanLoop.stopScanIntervals();
    h.scanLoop.staggeredStartup(10000, true);
    await h.advance(1500);
    child.send({ t: 'health', state: 'HEALTHY', detail: 'ready' });
    await h.advance(1500);
    expect(child.messages.at(-1)).toMatchObject({ t: 'watch', roots: [] });
    expect(main.getStats().nativeSensor.watchScope).toBe('process-observation-unavailable');
    expect(h.sessionTracker.activeCount()).toBe(count);
  });

  it('awaits the actual before-quit owner deadline and fences delivery while closing', async () => {
    main._initDeferredSubsystemsForTest(directory);
    await h.advance(3000);
    ready(child);
    const quit = vi.spyOn(electron.app, 'quit').mockImplementation(() => {});
    const preventDefault = vi.fn();
    events.emit('before-quit', { preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(main.getStats().nativeSensor.phase).toBe('stopping');
    child.send(batch(event('1')));
    expect(main.getStats().nativeSensor.admission.rejected).toBe(0);
    await h.advance(2100);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(quit).toHaveBeenCalledTimes(1);
    expect(main.getStats().nativeSensor.reason).toBe('custody-unconfirmed');
  });

  it('withdraws native roots when CWD enrichment rejects after a successful process observation', async () => {
    main._initDeferredSubsystemsForTest(directory);
    await h.advance(3000);
    ready(child);
    ticks = '12346';
    require_('../../src/main/process-utils')._setPlatformForTest({
      getProcessCwds: async () => {
        throw new Error('fixture-cwd-unavailable');
      },
    });
    h.scanLoop.stopScanIntervals();
    h.scanLoop.staggeredStartup(10000, true);
    await h.advance(1500);
    child.send({ t: 'health', state: 'HEALTHY', detail: 'ready' });
    await h.advance(1500);
    expect(main.getAppHealth().populationReliable).toBe(true);
    expect(child.messages.at(-1)).toMatchObject({ t: 'watch', roots: [] });
    expect(main.getStats().nativeSensor.watchScope).toBe('process-observation-unavailable');
  });

  it.each(['provider', 'cwd', 'model'])(
    'rejects a held pre-pause %s completion and waits for a subsequent fresh process pass',
    async (stage) => {
      main._initDeferredSubsystemsForTest(directory);
      await h.advance(3000);
      ready(child);
      ticks = '12346';
      let release,
        held = false;
      const pending = new Promise((resolve) => {
        release = resolve;
      });
      const procUtil = require_('../../src/main/process-utils');
      if (stage === 'provider')
        h.scanner._setPlatformForTest({
          getParentProcessMap: () => {
            held = true;
            const captured = processMap();
            return pending.then(() => captured);
          },
        });
      if (stage === 'cwd')
        procUtil._setPlatformForTest({
          getProcessCwds: () => {
            held = true;
            return pending.then(() => new Map());
          },
        });
      if (stage === 'model')
        vi.spyOn(
          require_('../../src/main/llm-runtime-detector'),
          'detectOllamaModels',
        ).mockImplementationOnce(() => {
          held = true;
          return pending.then(() => ({ running: false, models: [] }));
        });
      h.scanLoop.stopScanIntervals();
      h.scanLoop.staggeredStartup(10000, true);
      await h.advance(1500);
      child.send({ t: 'health', state: 'HEALTHY', detail: 'ready' });
      await h.advance(1500);
      expect(held).toBe(true);
      h.scanLoop.stopScanIntervals();
      main._setMonitoringPausedForTest(true);
      child.close(0);
      main._setMonitoringPausedForTest(false);
      h.scanLoop.staggeredStartup(10000, true);
      release();
      await h.flush();
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(main.getStats().nativeSensor.watchScope).toBe('process-observation-unavailable');
      ticks = '12347';
      h.scanner._setPlatformForTest({ getParentProcessMap: async () => processMap() });
      procUtil._setPlatformForTest({ getProcessCwds: async () => new Map() });
      await h.advance(3000);
      expect(spawn).toHaveBeenCalledTimes(2);
      ready(child);
      expect(child.messages.find((message) => message.t === 'watch').roots).toEqual([
        {
          pid: 4242,
          birth: '12347',
          witness: { kind: 'linux-start-ticks', bootId, startTicks: '12347' },
        },
      ]);
      expect(main.getStats().nativeSensor.watchScope).toBe('current');
    },
  );
});

describe('existing watch-filter settings wiring', () => {
  function wire(initial = {}) {
    const config = require_('../../src/main/config-manager');
    let settings = {
      scanIntervalSec: 10,
      ignoreCommonBuildDirs: true,
      ignoredDirectories: [],
      ...initial,
    };
    config.getSettings.mockImplementation(() => settings);
    const configInit = vi.spyOn(config, 'init');
    const watcherInit = vi.spyOn(h.watcher, 'init');
    const setup = vi.spyOn(h.watcher, 'setupFileWatchers').mockResolvedValue();
    const rules = vi.spyOn(h.watcher, 'setupRulesWatcher').mockReturnValue(null);
    const sequences = vi.spyOn(h.watcher, 'setupSequenceRulesWatcher').mockReturnValue(null);
    vi.spyOn(h.scanLoop, 'staggeredStartup').mockImplementation(() => {});
    const stop = vi.spyOn(h.scanLoop, 'stopScanIntervals');
    const start = vi.spyOn(h.scanLoop, 'startScanIntervals').mockImplementation(() => {});
    main._initDeferredSubsystemsForTest(directory);
    const state = watcherInit.mock.calls.at(-1)[0];
    const callback = configInit.mock.calls.at(-1)[0].applyCallback;
    return {
      state,
      setup,
      rules,
      sequences,
      stop,
      start,
      callback,
      set: (patch) => {
        settings = { ...settings, ...patch };
      },
      current: () => settings,
      apply: () => config.applySettings(),
    };
  }
  it('injects the live current config getter and registers the actual apply callback', async () => {
    const t = wire();
    expect(typeof t.callback).toBe('function');
    expect(t.state.getSettings()).toBe(t.current());
    t.set({ ignoredDirectories: ['selected-exclusion'] });
    expect(t.state.getSettings()).toBe(t.current());
    expect(t.state.getSettings().ignoredDirectories).toEqual(['selected-exclusion']);
    t.apply();
    await h.flush();
    expect(t.setup).not.toHaveBeenCalled();
    await main.startWatchers();
    expect(t.setup).toHaveBeenCalledOnce();
  });
  it('refreshes selected watch filters and retires the native policy generation on the same settings save', async () => {
    const factory = vi.spyOn(
      require_('../../src/main/native-file-ingress'),
      'createNativeFileIngress',
    );
    const t = wire();
    const ingress = factory.mock.calls.at(-1)[0];
    const originalGeneration = ingress.getPolicyGeneration();
    await main.startWatchers();
    t.set({ ignoredDirectories: ['new-private-filter'] });
    t.apply();
    await h.flush();
    expect(ingress.getPolicyGeneration()).not.toBe(originalGeneration);
    expect(t.setup).toHaveBeenCalledTimes(2);
    expect(t.state.getSettings().ignoredDirectories).toEqual(['new-private-filter']);
    expect(t.stop).toHaveBeenCalledOnce();
    expect(t.start).toHaveBeenCalledExactlyOnceWith(10000);
  });
  it('keeps file watchers for theme, interval and identical effective exclusion saves', async () => {
    const t = wire({ ignoredDirectories: ['one', 'two'] });
    await main.startWatchers();
    t.set({ darkMode: true, scanIntervalSec: 20 });
    t.apply();
    t.set({ ignoredDirectories: ['two', 'one', 'one'] });
    t.apply();
    await h.flush();
    expect(t.setup).toHaveBeenCalledOnce();
    expect(t.stop).toHaveBeenCalledTimes(2);
    expect(t.start).toHaveBeenLastCalledWith(20000);
  });
  it('coalesces filter saves into one setup consuming the latest settings without duplicating rules', async () => {
    const t = wire();
    await main.startWatchers();
    let observed;
    t.setup.mockImplementation(async () => {
      observed = t.state.getSettings();
    });
    t.set({ ignoredDirectories: ['one'] });
    t.apply();
    t.set({ ignoredDirectories: ['two'], ignoreCommonBuildDirs: false });
    t.apply();
    expect(t.setup).toHaveBeenCalledOnce();
    await h.flush();
    expect(t.setup).toHaveBeenCalledTimes(2);
    expect(observed).toBe(t.current());
    expect(observed).toMatchObject({ ignoredDirectories: ['two'], ignoreCommonBuildDirs: false });
    expect(t.rules).toHaveBeenCalledOnce();
    expect(t.sequences).toHaveBeenCalledOnce();
  });
  it('cancels a reverted filter change before recreating healthy roots', async () => {
    const t = wire();
    await main.startWatchers();
    t.set({ ignoredDirectories: ['temporary'] });
    t.apply();
    t.set({ ignoredDirectories: [] });
    t.apply();
    await h.flush();
    expect(t.setup).toHaveBeenCalledOnce();
  });
  it('applies a build-directory toggle alone without changing exclusions', async () => {
    const t = wire({ ignoredDirectories: ['retained'] });
    await main.startWatchers();
    t.set({ ignoreCommonBuildDirs: false });
    t.apply();
    await h.flush();
    expect(t.setup).toHaveBeenCalledTimes(2);
    expect(t.state.getSettings()).toMatchObject({
      ignoreCommonBuildDirs: false,
      ignoredDirectories: ['retained'],
    });
  });
  it.each([false, true])(
    'serializes latest filters behind in-flight setup (reject=%s)',
    async (reject) => {
      const t = wire();
      let settle;
      t.setup.mockImplementationOnce(
        () =>
          new Promise((resolve, fail) => {
            settle = () => (reject ? fail(Error('controlled setup failure')) : resolve());
          }),
      );
      const starting = main.startWatchers();
      t.set({ ignoredDirectories: ['one'] });
      t.apply();
      t.set({ ignoredDirectories: ['latest'] });
      t.apply();
      expect(t.setup).toHaveBeenCalledOnce();
      settle();
      await starting;
      await h.flush();
      expect(t.setup).toHaveBeenCalledTimes(2);
      expect(t.state.getSettings().ignoredDirectories).toEqual(['latest']);
      expect(t.rules).toHaveBeenCalledOnce();
      expect(t.sequences).toHaveBeenCalledOnce();
    },
  );
  it('fences a queued settings refresh at quit and does not restart scan intervals afterward', async () => {
    const t = wire();
    await main.startWatchers();
    t.set({ ignoredDirectories: ['queued'] });
    t.apply();
    events.emit('before-quit', { preventDefault: vi.fn() });
    const starts = t.start.mock.calls.length;
    t.set({ ignoredDirectories: ['after-quit'] });
    t.apply();
    await h.flush();
    expect(t.setup).toHaveBeenCalledOnce();
    expect(t.start).toHaveBeenCalledTimes(starts);
  });
  it('existing watch health poll retires a changed private selection without a settings view or restart storm', async () => {
    let current = true;
    const privateOwner = {
      getWatchKey: vi.fn(() => (current ? 'selected-private-key' : 'unavailable-private-key')),
      resolveRoot: async () => ({ state: current ? 'selected' : 'unavailable' }),
      close: vi.fn(),
    };
    main._setProjectWatchSelectionForTest(privateOwner);
    const t = wire();
    const observed = [];
    t.setup.mockImplementation(async () => {
      observed.push(await t.state.getProjectWatchRoot());
    });
    await main.startWatchers();
    const reads = privateOwner.getWatchKey.mock.calls.length;
    main.getStats();
    main.getStats();
    expect(privateOwner.getWatchKey).toHaveBeenCalledTimes(reads);
    current = false;
    await h.advance(30000);
    expect(t.setup).toHaveBeenCalledTimes(2);
    expect(observed).toEqual([{ state: 'selected' }, { state: 'unavailable' }]);
    await h.advance(60000);
    expect(t.setup).toHaveBeenCalledTimes(2);
  });
});
