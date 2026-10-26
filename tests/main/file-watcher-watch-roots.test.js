/**
 * Step B — the chokidar watch-root registry and the W-plane lifecycle derived from it.
 *
 * `fs-chokidar` is ONE health record over SEVERAL FSWatcher objects. The defect this
 * suite pins is that the record used to be written by whichever object spoke last: one
 * `ready` made the whole mechanism HEALTHY even while three other roots had never been
 * registered, and the "expected set" was whatever setup happened to reach, so an abort
 * after the first successful `chokidar.watch` produced a plan of exactly one root and a
 * falsely clean W.
 *
 * Three rules carry the correction, and each has a test written to go red if the rule is
 * removed rather than merely to describe it:
 *   (a) `errored` is terminal — nothing the same watcher object says afterwards clears it
 *       (chokidar's post-error semantics are unresolved, roadmap U3);
 *   (b) W FAILED comes from ZERO live watcher objects and from nothing else — N errored
 *       roots are N unknowns, not a proven death;
 *   (c) a delivered add/change/unlink is recorded as a delivery and moves no state.
 *
 * Nothing here spies on file-watcher itself: the module under test is the real one, with
 * only `chokidar.watch` and the preflight `fs.promises.access` replaced — the two edges
 * that would otherwise touch the host filesystem and make the plan host-dependent.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import Module from 'module';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const fsMod = require_('fs');
const originalLoad = Module._load;

/** @type {typeof import('../../src/main/file-watcher.js')} */
let fileWatcher;
/** @type {Array<{on: Function, close: Function, emit: Function, _paths: unknown}>} */
let fakeWatchers = [];
/** The plan exactly as it stood when `chokidar.watch` was called for the FIRST time. */
let planAtFirstRegistration = null;

/**
 * @param {{failOnCall?: number|null}} [opts] - 1-based index of the watch() call that throws
 * @returns {void}
 */
function installChokidarMock({ failOnCall = null } = {}) {
  fakeWatchers = [];
  planAtFirstRegistration = null;
  let calls = 0;
  const watchMock = vi.fn((paths, options) => {
    calls += 1;
    // Read the plan from INSIDE the first registration: this is the direct evidence
    // that the plan was fixed before any watcher existed, not assembled as they came.
    if (calls === 1) planAtFirstRegistration = fileWatcher.getWatchPlan();
    if (failOnCall !== null && calls === failOnCall) {
      throw new Error(`watch refused #${calls}`);
    }
    const handlers = new Map();
    const w = {
      on: vi.fn((event, cb) => {
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event).push(cb);
        return w;
      }),
      close: vi.fn(),
      _paths: paths,
      _options: options,
      emit(event, ...args) {
        for (const cb of handlers.get(event) || []) cb(...args);
      },
    };
    fakeWatchers.push(w);
    return w;
  });

  Module._load = function (request) {
    if (request === 'chokidar' || request === './watch-worker-client') return { watch: watchMock };
    return originalLoad.apply(this, arguments);
  };
}

function loadFileWatcher() {
  const fwPath = require_.resolve('../../src/main/file-watcher.js');
  delete require_.cache[fwPath];
  return require_('../../src/main/file-watcher.js');
}

function restoreChokidar() {
  Module._load = originalLoad;
  const fwPath = require_.resolve('../../src/main/file-watcher.js');
  delete require_.cache[fwPath];
  try {
    delete require_.cache[require_.resolve('chokidar')];
  } catch {
    // optional if resolve fails after the mock
  }
}

/**
 * Decide the preflight outcome for the whole run. Without this the plan depends on
 * which dot-directories exist in the runner's home — four groups on a developer box,
 * two on a fresh CI runner — and every count assertion below would be host-luck.
 * @param {boolean} present
 * @returns {void}
 */
function stubPreflight(present) {
  vi.spyOn(fsMod.promises, 'access').mockImplementation(async () => {
    if (!present) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  });
}

function makeState(overrides = {}) {
  return {
    getCustomRules: () => [],
    getSettings: () => ({}),
    getLatestAgents: () => [],
    getLatestAiAgents: () => [],
    isMonitoringPaused: () => false,
    isOtherPanelExpanded: () => false,
    activityLog: [],
    knownHandles: new Map(),
    watchers: [],
    recordFileAccess: vi.fn(),
    onFileEvent: vi.fn(),
    onActivityPush: vi.fn(),
    ...overrides,
  };
}

/** Non-ignored path, so a delivered event reaches the real processing path. */
function samplePath(name) {
  return path.join(os.tmpdir(), name);
}

const ALL_GROUPS = ['credential-dirs', 'agent-config-dirs', 'project-dir', 'env-files'];

/** @param {object} plan @returns {string[]} */
function ids(plan) {
  return plan.groups.map((g) => g.id);
}

/** @param {object} plan @param {string} id @returns {object} */
function root(plan, id) {
  const found = plan.groups.find((g) => g.id === id);
  expect(found, `group ${id} missing from the plan`).toBeDefined();
  return found;
}

function chokidarHealth() {
  return fileWatcher.getFileSensorHealth()['fs-chokidar'];
}

/** Every watcher created so far reports a successful initialization. */
function readyAll() {
  for (const w of fakeWatchers) w.emit('ready');
}

describe('chokidar watch-root registry (step B)', () => {
  let state;

  it('lets a progressing project scan finish without claiming readiness from progress', async () => {
    vi.useFakeTimers();
    try {
      await fileWatcher.setupFileWatchers();
      const project = fakeWatchers[2];
      for (const watcher of fakeWatchers.filter((w) => w !== project)) watcher.emit('ready');
      await vi.advanceTimersByTimeAsync(9000);
      project.emit('progress', 10);
      await vi.advanceTimersByTimeAsync(9000);
      expect(project.close).not.toHaveBeenCalled();
      expect(fileWatcher.getWatchPlan().state).toBe('STARTING');
      expect(chokidarHealth().lastSuccessAt).toBeNull();
      project.emit('ready');
      await vi.advanceTimersByTimeAsync(60000);
      expect(project.close).not.toHaveBeenCalled();
      expect(fileWatcher.getWatchPlan().state).toBe('HEALTHY');
    } finally {
      await fileWatcher.closeFileWatchers();
      vi.useRealTimers();
    }
  });

  it('caps a progressing project scan at one minute and still times out an idle project', async () => {
    vi.useFakeTimers();
    try {
      await fileWatcher.setupFileWatchers();
      const project = fakeWatchers[2];
      for (const watcher of fakeWatchers.filter((w) => w !== project)) watcher.emit('ready');
      for (let n = 1; n <= 6; n++) {
        await vi.advanceTimersByTimeAsync(9000);
        project.emit('progress', n);
        expect(project.close).not.toHaveBeenCalled();
      }
      await vi.advanceTimersByTimeAsync(5999);
      expect(project.close).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(project.close).toHaveBeenCalledOnce();
      expect(root(fileWatcher.getWatchPlan(), 'project-dir').lastError).toBe(
        'watch-root-ready-timeout',
      );
      await vi.advanceTimersByTimeAsync(1000);
      const replacement = fakeWatchers.at(-1);
      project.emit('progress', 1000);
      await vi.advanceTimersByTimeAsync(10000);
      expect(replacement.close).toHaveBeenCalledOnce();
    } finally {
      await fileWatcher.closeFileWatchers();
      vi.useRealTimers();
    }
  });

  it('retires an initial root that never becomes ready and recovers beside ready survivors', async () => {
    vi.useFakeTimers();
    try {
      await fileWatcher.setupFileWatchers();
      const initial = [...fakeWatchers];
      for (const survivor of initial.slice(1)) survivor.emit('ready');
      await vi.advanceTimersByTimeAsync(9999);
      expect(initial[0].close).not.toHaveBeenCalled();
      expect(fileWatcher.getWatchPlan().state).toBe('STARTING');
      await vi.advanceTimersByTimeAsync(1);
      expect(initial[0].close).toHaveBeenCalledOnce();
      expect(state.watchers).toHaveLength(3);
      expect(root(fileWatcher.getWatchPlan(), ALL_GROUPS[0])).toMatchObject({
        hasLiveWatcher: false,
        lastError: 'watch-root-ready-timeout',
      });
      expect(fileWatcher.getWatchPlan().state).toBe('DEGRADED');
      initial[0].emit('ready');
      await vi.advanceTimersByTimeAsync(1000);
      expect(fakeWatchers).toHaveLength(5);
      fakeWatchers[4].emit('ready');
      await vi.advanceTimersByTimeAsync(10000);
      expect(fileWatcher.getWatchPlan().state).toBe('HEALTHY');
      expect(state.watchers).toHaveLength(4);
      for (const survivor of [...initial.slice(1), fakeWatchers[4]]) {
        expect(survivor.close).not.toHaveBeenCalled();
      }
    } finally {
      await fileWatcher.closeFileWatchers();
      vi.useRealTimers();
    }
  });

  it('leaves complete plan loss to the main retry without creating a local worker', async () => {
    vi.useFakeTimers();
    try {
      stubPreflight(true);
      await fileWatcher.setupFileWatchers();
      readyAll();
      for (const watcher of fakeWatchers) {
        watcher.emit('error', { code: 'AEGIS_WATCH_WORKER_TERMINATED' });
      }
      await vi.advanceTimersByTimeAsync(20000);
      expect(fakeWatchers).toHaveLength(4);
      expect(state.watchers).toHaveLength(0);
      expect(fileWatcher.getWatchPlan().state).toBe('FAILED');
    } finally {
      await fileWatcher.closeFileWatchers();
      vi.useRealTimers();
    }
  });

  it('bounds replacement readiness failures and keeps survivors active', async () => {
    vi.useFakeTimers();
    try {
      stubPreflight(true);
      await fileWatcher.setupFileWatchers();
      readyAll();
      fakeWatchers[0].emit('error', { code: 'AEGIS_WATCH_WORKER_TERMINATED' });
      await vi.advanceTimersByTimeAsync(40000);
      expect(fakeWatchers).toHaveLength(7);
      expect(state.watchers).toHaveLength(3);
      expect(fileWatcher.getWatchPlan().state).toBe('DEGRADED');
      for (const replacement of fakeWatchers.slice(4)) {
        expect(replacement.close).toHaveBeenCalledOnce();
        replacement.emit('ready');
      }
      expect(root(fileWatcher.getWatchPlan(), ALL_GROUPS[0]).hasLiveWatcher).toBe(false);
    } finally {
      await fileWatcher.closeFileWatchers();
      vi.useRealTimers();
    }
  });

  it('retries a registration exception and cancels pending recovery on shutdown', async () => {
    vi.useFakeTimers();
    try {
      installChokidarMock({ failOnCall: 5 });
      fileWatcher = loadFileWatcher();
      fileWatcher.init(state);
      stubPreflight(true);
      await fileWatcher.setupFileWatchers();
      readyAll();
      fakeWatchers[0].emit('error', { code: 'AEGIS_WATCH_WORKER_TERMINATED' });
      await vi.advanceTimersByTimeAsync(1000);
      expect(root(fileWatcher.getWatchPlan(), ALL_GROUPS[0]).state).toBe('registration-failed');
      await vi.advanceTimersByTimeAsync(1000);
      expect(fakeWatchers).toHaveLength(5);
      fakeWatchers[4].emit('ready');
      expect(fileWatcher.getWatchPlan().state).toBe('HEALTHY');
      fakeWatchers[4].emit('error', { code: 'AEGIS_WATCH_WORKER_TERMINATED' });
      await fileWatcher.closeFileWatchers();
      await vi.advanceTimersByTimeAsync(20000);
      expect(fakeWatchers).toHaveLength(5);
      expect(state.watchers).toHaveLength(0);
    } finally {
      await fileWatcher.closeFileWatchers();
      vi.useRealTimers();
    }
  });

  it('recreates only a terminated root and fences its retired callbacks', async () => {
    vi.useFakeTimers();
    try {
      stubPreflight(true);
      await fileWatcher.setupFileWatchers();
      readyAll();
      const previous = [...fakeWatchers];
      previous[0].emit('error', { code: 'AEGIS_WATCH_WORKER_TERMINATED' });
      expect(fileWatcher.getWatchPlan().state).toBe('DEGRADED');
      await vi.advanceTimersByTimeAsync(1000);
      expect(fakeWatchers).toHaveLength(5);
      expect(state.watchers).toHaveLength(4);
      for (const survivor of previous.slice(1)) expect(survivor.close).not.toHaveBeenCalled();
      previous[0].emit('ready');
      previous[0].emit('add', samplePath('retired-root.js'));
      expect(root(fileWatcher.getWatchPlan(), ALL_GROUPS[0]).deliveredCount).toBe(0);
      expect(fileWatcher.getWatchPlan().state).toBe('STARTING');
      fakeWatchers[4].emit('ready');
      expect(fileWatcher.getWatchPlan().state).toBe('HEALTHY');
    } finally {
      await fileWatcher.closeFileWatchers();
      vi.useRealTimers();
    }
  });

  beforeEach(() => {
    installChokidarMock();
    fileWatcher = loadFileWatcher();
    state = makeState();
    fileWatcher.init(state);
    fileWatcher._resetForTest();
    stubPreflight(true);
  });

  afterEach(() => {
    fileWatcher._resetForTest();
    vi.restoreAllMocks();
    restoreChokidar();
  });

  afterAll(() => {
    restoreChokidar();
  });

  it('selected external ordinary .asar folder is watched in an ASAR app with saved filters', async () => {
    vi.restoreAllMocks();
    stubPreflight(false);
    const selected = path.join(os.tmpdir(), 'external-project.asar');
    fileWatcher._setDepsForTest({ appDir: path.join(os.tmpdir(), 'resources', 'app.asar') });
    state.getProjectWatchRoot = async () => ({
      state: 'selected',
      path: selected,
      isCurrent: () => true,
    });
    state.getSettings = () => ({
      ignoredDirectories: ['private-output'],
      ignoreCommonBuildDirs: false,
    });
    await fileWatcher.setupFileWatchers();
    const project = fakeWatchers.find((w) => w._paths === selected);
    expect(project._options).toMatchObject({
      depth: 5,
      followSymlinks: false,
      ignoreInitial: true,
      ignoredDirectories: ['private-output'],
    });
    project.emit('add', path.join(selected, 'before-ready.js'));
    expect(state.activityLog).toEqual([]);
    readyAll();
    project.emit('add', path.join(selected, 'after-ready.js'));
    expect(state.activityLog).toMatchObject([
      { action: 'created', file: path.join(selected, 'after-ready.js') },
    ]);
    expect(fileWatcher.getWatchPlan().state).toBe('HEALTHY');
    expect(JSON.stringify(fileWatcher.getWatchPlan())).not.toContain(selected);
    state.getProjectWatchRoot = async () => ({ state: 'unselected' });
    await fileWatcher.setupFileWatchers();
    readyAll();
    expect(project.close).toHaveBeenCalledOnce();
    expect(fileWatcher.getWatchPlan().absentGroups).toContain('project-dir');
    expect(state.watchers.some((w) => w._paths === selected)).toBe(false);
  });
  it('selected unavailable root remains a failed coverage group instead of an ASAR fallback', async () => {
    vi.restoreAllMocks();
    stubPreflight(false);
    fileWatcher._setDepsForTest({ appDir: path.join(os.tmpdir(), 'app.asar') });
    state.getProjectWatchRoot = async () => ({ state: 'unavailable' });
    await fileWatcher.setupFileWatchers();
    readyAll();
    expect(root(fileWatcher.getWatchPlan(), 'project-dir')).toMatchObject({
      state: 'registration-failed',
      hasLiveWatcher: false,
    });
    expect(fileWatcher.getWatchPlan().state).toBe('DEGRADED');
    expect(fakeWatchers).toHaveLength(1);
  });
  it('revalidates selected identity after asynchronous preflight before registering a worker', async () => {
    let current = true;
    state.getProjectWatchRoot = async () => ({
      state: 'selected',
      path: samplePath('project'),
      isCurrent: () => current,
    });
    fsMod.promises.access.mockImplementation(async () => {
      current = false;
    });
    await fileWatcher.setupFileWatchers();
    readyAll();
    expect(fakeWatchers.some((w) => w._paths === samplePath('project'))).toBe(false);
    expect(root(fileWatcher.getWatchPlan(), 'project-dir')).toMatchObject({
      state: 'registration-failed',
      hasLiveWatcher: false,
    });
    expect(fileWatcher.getWatchPlan().state).toBe('DEGRADED');
  });
  it('refuses ready and recovery after the selected root identity changes', async () => {
    vi.useFakeTimers();
    try {
      let current = true;
      const selected = samplePath('project');
      state.getProjectWatchRoot = async () => ({
        state: 'selected',
        path: selected,
        isCurrent: () => current,
      });
      await fileWatcher.setupFileWatchers();
      const project = fakeWatchers.find((w) => w._paths === selected);
      current = false;
      project.emit('add', path.join(selected, 'replaced-before-ready.js'));
      project.emit('change', path.join(selected, 'replaced-before-ready.js'));
      project.emit('unlink', path.join(selected, 'replaced-before-ready.js'));
      expect(state.activityLog).toEqual([]);
      readyAll();
      expect(project.close).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(4000);
      expect(fakeWatchers.filter((w) => w._paths === selected)).toHaveLength(1);
      expect(root(fileWatcher.getWatchPlan(), 'project-dir').hasLiveWatcher).toBe(false);
      expect(fileWatcher.getWatchPlan().state).toBe('DEGRADED');
    } finally {
      await fileWatcher.closeFileWatchers();
      vi.useRealTimers();
    }
  });

  it.each([true, false])(
    'keeps user roots live without watching ASAR (user dirs: %s)',
    async (present) => {
      vi.restoreAllMocks();
      stubPreflight(present);
      const appDir = path.join(os.tmpdir(), 'resources', 'app.asar');
      fileWatcher._setDepsForTest({ appDir });

      await fileWatcher.setupFileWatchers();
      expect(ids(fileWatcher.getWatchPlan())).toEqual(
        present ? ['credential-dirs', 'agent-config-dirs', 'env-files'] : ['env-files'],
      );
      expect(fileWatcher.getWatchPlan().absentGroups).toContain('project-dir');
      expect(fileWatcher.setupRulesWatcher(vi.fn(), { sequenceCount: () => 1 })).toBeNull();
      expect(fileWatcher.setupSequenceRulesWatcher(vi.fn(), { reload: vi.fn() })).toBeNull();
      expect(fakeWatchers).toHaveLength(present ? 3 : 1);
      expect(fakeWatchers.flatMap((w) => w._paths).some((p) => p.includes('app.asar'))).toBe(false);

      readyAll();
      expect(fileWatcher.getWatchPlan().state).toBe('HEALTHY');
      fakeWatchers[0].emit('error', new Error('user root unavailable'));
      expect(fileWatcher.getWatchPlan().state).toBe('DEGRADED');
    },
  );

  describe('the plan (§1.2)', () => {
    it('is complete at the first registration, and every root is still only planned', async () => {
      await fileWatcher.setupFileWatchers();

      expect(ids(planAtFirstRegistration)).toEqual(ALL_GROUPS);
      expect(planAtFirstRegistration.liveWatcherCount).toBe(0);
      for (const g of planAtFirstRegistration.groups) {
        expect(g.state).toBe(fileWatcher.WATCH_ROOT_STATE.PLANNED);
        expect(g.hasLiveWatcher).toBe(false);
      }
      // Membership is immutable for the record lifetime — registration only fills it in.
      expect(ids(fileWatcher.getWatchPlan())).toEqual(ids(planAtFirstRegistration));
    });

    it('excludes a group ONLY on a completed probe, and keeps it out of W', async () => {
      stubPreflight(false);

      await fileWatcher.setupFileWatchers();
      const plan = fileWatcher.getWatchPlan();

      expect(ids(plan)).toEqual(['project-dir', 'env-files']);
      expect(plan.absentGroups).toEqual(['credential-dirs', 'agent-config-dirs']);
      // Plan ∪ absent is total over the four groups: nothing is silently forgotten.
      expect([...ids(plan), ...plan.absentGroups].sort()).toEqual([...ALL_GROUPS].sort());
      // A proven-absent group must not hold the mechanism below HEALTHY forever.
      readyAll();
      expect(fileWatcher.getWatchPlan().state).toBe('HEALTHY');
    });

    it('does not shrink to the groups registration reached', async () => {
      restoreChokidar();
      installChokidarMock({ failOnCall: 1 });
      fileWatcher = loadFileWatcher();
      fileWatcher.init(state);
      fileWatcher._resetForTest();
      stubPreflight(true);

      await expect(fileWatcher.setupFileWatchers()).rejects.toThrow(/watch refused #1/);

      const plan = fileWatcher.getWatchPlan();
      // The old code computed the expected set from what setup managed to register —
      // an abort here would have left a one-root (or empty) denominator.
      expect(ids(plan)).toEqual(ALL_GROUPS);
      expect(ids(plan)).toEqual(ids(planAtFirstRegistration));
      expect(root(plan, 'credential-dirs').state).toBe(
        fileWatcher.WATCH_ROOT_STATE.REGISTRATION_FAILED,
      );
      expect(root(plan, 'credential-dirs').lastError).toBe('watch-root-registration-failed');
      expect(JSON.stringify(plan)).not.toContain('watch refused #1');
      for (const id of ['agent-config-dirs', 'project-dir', 'env-files']) {
        expect(root(plan, id).state).toBe(fileWatcher.WATCH_ROOT_STATE.NOT_ATTEMPTED);
        expect(root(plan, id).hasLiveWatcher).toBe(false);
      }
    });
  });

  describe('W FAILED comes from zero live watcher objects (§1.5)', () => {
    it('an abort before any watcher exists is FAILED on the fs-chokidar record', async () => {
      restoreChokidar();
      installChokidarMock({ failOnCall: 1 });
      fileWatcher = loadFileWatcher();
      fileWatcher.init(state);
      fileWatcher._resetForTest();
      stubPreflight(true);

      await expect(fileWatcher.setupFileWatchers()).rejects.toThrow(/watch refused #1/);

      const plan = fileWatcher.getWatchPlan();
      expect(plan.liveWatcherCount).toBe(0);
      expect(plan.state).toBe('FAILED');
      const h = chokidarHealth();
      expect(h.state).toBe('FAILED');
      expect(h.detail).toBe('no-live-watcher');
      expect(h.lastError).toMatch(/credential-dirs:watch-root-registration-failed/);
      expect(h.lastError).toMatch(/env-files:not-attempted/);
    });

    it('a partial abort keeps the live root and lands on DEGRADED, not FAILED', async () => {
      restoreChokidar();
      installChokidarMock({ failOnCall: 2 });
      fileWatcher = loadFileWatcher();
      fileWatcher.init(state);
      fileWatcher._resetForTest();
      stubPreflight(true);

      await expect(fileWatcher.setupFileWatchers()).rejects.toThrow(/watch refused #2/);

      const plan = fileWatcher.getWatchPlan();
      expect(plan.liveWatcherCount).toBe(1);
      expect(root(plan, 'credential-dirs').state).toBe(fileWatcher.WATCH_ROOT_STATE.REGISTERED);
      expect(root(plan, 'agent-config-dirs').state).toBe(
        fileWatcher.WATCH_ROOT_STATE.REGISTRATION_FAILED,
      );
      expect(plan.state).toBe('DEGRADED');
      expect(chokidarHealth().state).toBe('DEGRADED');
      expect(chokidarHealth().detail).toBe('watch-roots-unavailable');
      expect(plan.unavailableGroups.map((g) => g.id)).toEqual([
        'agent-config-dirs',
        'project-dir',
        'env-files',
      ]);
    });

    it('EVERY root errored is still DEGRADED — an error event proves nothing about the object', async () => {
      // Mutation target (b): deriving FAILED from "all planned groups errored" flips this
      // to FAILED. chokidar is classified DEGRADED on error precisely because it may keep
      // partially operating; counting unknowns does not turn them into a proven zero.
      await fileWatcher.setupFileWatchers();
      readyAll();
      expect(fileWatcher.getWatchPlan().state).toBe('HEALTHY');

      for (const w of fakeWatchers) w.emit('error', new Error('EPERM scandir'));

      const plan = fileWatcher.getWatchPlan();
      expect(plan.groups.every((g) => g.state === fileWatcher.WATCH_ROOT_STATE.ERRORED)).toBe(true);
      // Every object still exists — that is the fact FAILED is allowed to rest on.
      expect(plan.liveWatcherCount).toBe(plan.groups.length);
      expect(plan.state).toBe('DEGRADED');
      const h = chokidarHealth();
      expect(h.state).toBe('DEGRADED');
      expect(h.consecutiveFailures).toBe(0);
      expect(h.lossCount).toBe(0); // no quantitative lost-event counter exists
    });

    it('counts one confirmed worker death as lost while preserving the other live roots', async () => {
      await fileWatcher.setupFileWatchers();
      readyAll();

      fakeWatchers[0].emit(
        'error',
        Object.assign(new Error('PRIVATE_WORKER_DEATH_CANARY'), {
          code: 'AEGIS_WATCH_WORKER_TERMINATED',
        }),
      );

      const plan = fileWatcher.getWatchPlan();
      expect(plan.state).toBe('DEGRADED');
      expect(plan.liveWatcherCount).toBe(plan.groups.length - 1);
      expect(root(plan, 'credential-dirs').hasLiveWatcher).toBe(false);
      expect(chokidarHealth().state).toBe('DEGRADED');
      expect(JSON.stringify(plan)).not.toContain('PRIVATE_WORKER_DEATH_CANARY');
    });

    it('marks total worker death FAILED so main can retry the plan', async () => {
      await fileWatcher.setupFileWatchers();
      readyAll();

      for (const watcher of fakeWatchers) {
        watcher.emit(
          'error',
          Object.assign(new Error('PRIVATE_WORKER_DEATH_CANARY'), {
            code: 'AEGIS_WATCH_WORKER_TERMINATED',
          }),
        );
      }

      const plan = fileWatcher.getWatchPlan();
      expect(plan.state).toBe('FAILED');
      expect(plan.liveWatcherCount).toBe(0);
      expect(chokidarHealth().state).toBe('FAILED');
      expect(JSON.stringify(plan)).not.toContain('PRIVATE_WORKER_DEATH_CANARY');
    });
  });

  describe('readiness is total over the plan (§1.6)', () => {
    it('one ready root no longer speaks for the mechanism', async () => {
      await fileWatcher.setupFileWatchers();
      expect(fileWatcher.getWatchPlan().state).toBe('STARTING');
      expect(chokidarHealth().state).toBe('STARTING');

      for (const w of fakeWatchers.slice(0, -1)) w.emit('ready');

      expect(fileWatcher.getWatchPlan().state).toBe('STARTING');
      const partial = chokidarHealth();
      expect(partial.state).toBe('STARTING');
      // The honest consequence of the correction: no success is claimed until the
      // whole plan is ready, so lastSuccessAt cannot advance on one root's ready.
      expect(partial.lastSuccessAt).toBeNull();

      fakeWatchers[fakeWatchers.length - 1].emit('ready');

      expect(fileWatcher.getWatchPlan().state).toBe('HEALTHY');
      const full = chokidarHealth();
      expect(full.state).toBe('HEALTHY');
      expect(full.lastSuccessAt).toBeTypeOf('number');
    });

    it('one errored root degrades the mechanism and names itself in the record', async () => {
      await fileWatcher.setupFileWatchers();
      readyAll();

      fakeWatchers[1].emit('error', new Error('PRIVATE_WATCH_ROOT_CANARY'));

      const plan = fileWatcher.getWatchPlan();
      expect(plan.unavailableGroups).toEqual([
        { id: 'agent-config-dirs', state: 'errored', reason: 'watch-root-error' },
      ]);
      expect(plan.state).toBe('DEGRADED');
      expect(root(plan, 'project-dir').state).toBe(fileWatcher.WATCH_ROOT_STATE.READY);
      const h = chokidarHealth();
      expect(h.state).toBe('DEGRADED');
      expect(h.lastError).toMatch(/watch-root-error/);
      expect(JSON.stringify({ plan, h })).not.toContain('PRIVATE_WATCH_ROOT_CANARY');
    });
  });

  describe('errored is terminal (§1.4, gap P)', () => {
    it('a later ready from the same object does NOT return the root to ready', async () => {
      // Mutation target (a): deleting the ERRORED guard in markRootReady turns this
      // green-to-red. chokidar routinely emits an error during its initial walk and then
      // `ready` on the same object — without the guard the mechanism reaches HEALTHY over
      // a root nobody can vouch for.
      await fileWatcher.setupFileWatchers();
      fakeWatchers[0].emit('error', new Error('EPERM scandir'));

      readyAll();

      const plan = fileWatcher.getWatchPlan();
      expect(root(plan, 'credential-dirs').state).toBe(fileWatcher.WATCH_ROOT_STATE.ERRORED);
      expect(root(plan, 'project-dir').state).toBe(fileWatcher.WATCH_ROOT_STATE.READY);
      expect(plan.state).toBe('DEGRADED');
      expect(chokidarHealth().state).toBe('DEGRADED');
    });

    it('a delivered event is recorded as a delivery and clears nothing', async () => {
      // Mutation target (c): the retracted v2 §E.3 rule — "a delivered event returns the
      // root to ready" — reinstated in noteRootDelivery turns this red. A delivered
      // callback proves ONE callback arrived, which is not recovery (U3).
      await fileWatcher.setupFileWatchers();
      readyAll();
      fakeWatchers[0].emit('error', new Error('EPERM scandir'));

      fakeWatchers[0].emit('change', samplePath('watch-root-delivery.js'));

      const plan = fileWatcher.getWatchPlan();
      const errored = root(plan, 'credential-dirs');
      expect(errored.state).toBe(fileWatcher.WATCH_ROOT_STATE.ERRORED);
      expect(errored.deliveredCount).toBe(1);
      expect(errored.lastEventAt).toBeTypeOf('number');
      expect(plan.state).toBe('DEGRADED');
      expect(chokidarHealth().state).toBe('DEGRADED');
      // …and the event itself is NOT dropped: chokidar keeps observing, the plane is
      // simply honest about not being able to vouch for that root's coverage.
      expect(state.activityLog).toHaveLength(1);
      expect(state.activityLog[0].action).toBe('modified');
    });

    it('counts deliveries per root, not per mechanism', async () => {
      await fileWatcher.setupFileWatchers();

      fakeWatchers[0].emit('add', samplePath('watch-root-a.js'));
      fakeWatchers[2].emit('add', samplePath('watch-root-b.js'));
      fakeWatchers[2].emit('unlink', samplePath('watch-root-c.js'));

      const plan = fileWatcher.getWatchPlan();
      expect(root(plan, 'credential-dirs').deliveredCount).toBe(1);
      expect(root(plan, 'project-dir').deliveredCount).toBe(2);
      expect(root(plan, 'env-files').deliveredCount).toBe(0);
      // Delivery never promotes a root that has not said `ready`.
      expect(root(plan, 'project-dir').state).toBe(fileWatcher.WATCH_ROOT_STATE.REGISTERED);
      expect(plan.state).toBe('STARTING');
    });
  });

  it('audits one fixed-code coverage gap for an errored root until a new full plan is ready', async () => {
    const audit = { log: vi.fn(), flush: vi.fn() };
    fileWatcher.init(makeState({ audit }));
    await fileWatcher.setupFileWatchers();
    readyAll();
    expect(audit.log).not.toHaveBeenCalled();

    fakeWatchers[0].emit('error', new Error('PRIVATE_WATCH_AUDIT_CANARY'));
    expect(audit.log).toHaveBeenCalledWith('observation-gap', {
      agent: '',
      pid: null,
      instanceId: null,
      action: 'file-watch-coverage-reduced',
      path: '',
      severity: 'normal',
      attribution: null,
      extra: { cause: 'file-watch', state: 'reduced' },
    });
    expect(audit.flush).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain('PRIVATE_WATCH_AUDIT_CANARY');

    fakeWatchers[0].emit('error', new Error('another error'));
    fakeWatchers[1].emit('loss', 3);
    fakeWatchers[0].emit('ready');
    fakeWatchers[0].emit('change', samplePath('late-watch-event.js'));
    expect(audit.log).toHaveBeenCalledTimes(1);

    await fileWatcher.setupFileWatchers();
    expect(audit.log).toHaveBeenCalledTimes(1);
    fakeWatchers.at(-ALL_GROUPS.length).emit('error', new Error('second generation failed'));
    readyAll();
    expect(fileWatcher.getWatchPlan().state).toBe('DEGRADED');
    expect(audit.log).toHaveBeenCalledTimes(1);

    await fileWatcher.setupFileWatchers();
    expect(audit.log).toHaveBeenCalledTimes(1);
    const recoveringWatchers = fakeWatchers.slice(-ALL_GROUPS.length);
    for (const w of recoveringWatchers.slice(0, -1)) w.emit('ready');
    expect(fileWatcher.getWatchPlan().state).toBe('STARTING');
    expect(audit.log).toHaveBeenCalledTimes(1);
    recoveringWatchers.at(-1).emit('ready');
    expect(fileWatcher.getWatchPlan().state).toBe('HEALTHY');
    expect(audit.log).toHaveBeenLastCalledWith('observation-gap', {
      agent: '',
      pid: null,
      instanceId: null,
      action: 'file-watch-coverage-restored',
      path: '',
      severity: 'normal',
      attribution: null,
      extra: { cause: 'file-watch', state: 'restored' },
    });
    expect(audit.log).toHaveBeenCalledTimes(2);
    expect(audit.flush).toHaveBeenCalledTimes(2);
  });

  it('audits worker loss before readiness without treating late callbacks as recovery', async () => {
    const audit = { log: vi.fn(), flush: vi.fn() };
    fileWatcher.init(makeState({ audit }));
    await fileWatcher.setupFileWatchers();
    expect(audit.log).not.toHaveBeenCalled();

    fakeWatchers[0].emit('loss', 4);
    expect(fileWatcher.getWatchPlan().state).toBe('DEGRADED');
    expect(audit.log.mock.calls.map(([type, event]) => [type, event.action])).toEqual([
      ['observation-gap', 'file-watch-coverage-reduced'],
    ]);
    fakeWatchers[0].emit('loss', 2);
    readyAll();
    fakeWatchers[0].emit('add', samplePath('late-after-loss.js'));
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log.mock.calls[0][1].extra).toEqual({ cause: 'file-watch', state: 'reduced' });
  });

  it('does not restore a reduced watch plan when a previously watched directory becomes inaccessible', async () => {
    const audit = { log: vi.fn(), flush: vi.fn() };
    fileWatcher.init(makeState({ audit }));
    await fileWatcher.setupFileWatchers();
    readyAll();
    fakeWatchers[0].emit('error', new Error('first generation failed'));
    expect(audit.log.mock.calls.map(([, event]) => event.action)).toEqual([
      'file-watch-coverage-reduced',
    ]);

    vi.restoreAllMocks();
    const deniedPath = path.join(os.homedir(), '.ssh');
    vi.spyOn(fsMod.promises, 'access').mockImplementation(async (candidate) => {
      if (candidate !== deniedPath) return;
      const error = new Error('PRIVATE_PREFLIGHT_AUDIT_CANARY');
      error.code = 'EACCES';
      throw error;
    });
    await fileWatcher.setupFileWatchers();
    readyAll();

    const plan = fileWatcher.getWatchPlan();
    expect(plan.state).toBe('DEGRADED');
    expect(root(plan, 'credential-dirs').state).toBe(fileWatcher.WATCH_ROOT_STATE.ERRORED);
    expect(plan.absentGroups).not.toContain('credential-dirs');
    expect(audit.log.mock.calls.map(([, event]) => event.action)).toEqual([
      'file-watch-coverage-reduced',
    ]);
    expect(JSON.stringify({ plan, calls: audit.log.mock.calls })).not.toContain(
      'PRIVATE_PREFLIGHT_AUDIT_CANARY',
    );

    vi.restoreAllMocks();
    stubPreflight(true);
    await fileWatcher.setupFileWatchers();
    readyAll();
    expect(fileWatcher.getWatchPlan().state).toBe('HEALTHY');
    expect(audit.log.mock.calls.map(([, event]) => event.action)).toEqual([
      'file-watch-coverage-reduced',
      'file-watch-coverage-restored',
    ]);
  });

  it('retains an entirely inaccessible credential group without registering an empty watcher', async () => {
    vi.restoreAllMocks();
    vi.spyOn(fsMod.promises, 'access').mockImplementation(async (candidate) => {
      const denied = candidate === path.join(os.homedir(), '.ssh');
      throw Object.assign(new Error('PRIVATE_PREFLIGHT_CANARY'), {
        code: denied ? 'EPERM' : 'ENOENT',
      });
    });
    const audit = { log: vi.fn(), flush: vi.fn() };
    fileWatcher.init(makeState({ audit }));

    await fileWatcher.setupFileWatchers();
    const plan = fileWatcher.getWatchPlan();
    expect(ids(plan)).toEqual(['credential-dirs', 'project-dir', 'env-files']);
    expect(root(plan, 'credential-dirs').state).toBe(
      fileWatcher.WATCH_ROOT_STATE.REGISTRATION_FAILED,
    );
    expect(root(plan, 'credential-dirs').lastError).toBe('watch-root-preflight-unavailable');
    expect(fakeWatchers).toHaveLength(2);
    expect(fakeWatchers.every((w) => !Array.isArray(w._paths) || w._paths.length > 0)).toBe(true);
    readyAll();
    expect(fileWatcher.getWatchPlan().state).toBe('DEGRADED');
    expect(audit.log.mock.calls.map(([, event]) => event.action)).toEqual([
      'file-watch-coverage-reduced',
    ]);
    expect(JSON.stringify({ plan, calls: audit.log.mock.calls })).not.toContain(
      'PRIVATE_PREFLIGHT_CANARY',
    );
  });

  it('audits a registration abort before any watcher exists with no thrown detail', async () => {
    restoreChokidar();
    installChokidarMock({ failOnCall: 1 });
    fileWatcher = loadFileWatcher();
    const audit = { log: vi.fn(), flush: vi.fn() };
    fileWatcher.init(makeState({ audit }));
    fileWatcher._resetForTest();
    stubPreflight(true);

    await expect(fileWatcher.setupFileWatchers()).rejects.toThrow(/watch refused #1/);
    expect(fakeWatchers).toHaveLength(0);
    expect(fileWatcher.getWatchPlan().state).toBe('FAILED');
    expect(audit.log.mock.calls).toEqual([
      [
        'observation-gap',
        {
          agent: '',
          pid: null,
          instanceId: null,
          action: 'file-watch-coverage-reduced',
          path: '',
          severity: 'normal',
          attribution: null,
          extra: { cause: 'file-watch', state: 'reduced' },
        },
      ],
    ]);
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain('watch refused #1');
    expect(audit.flush).toHaveBeenCalledTimes(1);
  });

  it('reports no plan at all before setup has run, without throwing', () => {
    const plan = fileWatcher.getWatchPlan();
    expect(plan).toEqual({
      state: 'STARTING',
      groups: [],
      absentGroups: [],
      liveWatcherCount: 0,
      unavailableGroups: [],
    });
  });

  it('registers exactly one handler per event on every root', async () => {
    await fileWatcher.setupFileWatchers();

    expect(fakeWatchers).toHaveLength(ALL_GROUPS.length);
    for (const w of fakeWatchers) {
      const events = w.on.mock.calls.map((c) => c[0]);
      for (const e of ['add', 'change', 'unlink', 'error', 'ready']) {
        expect(events.filter((x) => x === e)).toHaveLength(1);
      }
    }
    expect(state.watchers).toEqual(fakeWatchers);
  });

  it('keeps counted worker loss visible after subsequent ready and event callbacks', async () => {
    await fileWatcher.setupFileWatchers();
    readyAll();
    fakeWatchers[0].emit('loss', 7);
    fakeWatchers[0].emit('ready');
    fakeWatchers[0].emit('change', samplePath('after-overflow.js'));
    fakeWatchers[0].emit('loss', 2);
    expect(fileWatcher.getFileSensorHealth()['fs-chokidar']).toMatchObject({
      state: 'DEGRADED',
      lossCount: 9,
    });
    expect(root(fileWatcher.getWatchPlan(), 'credential-dirs')).toMatchObject({
      state: 'errored',
      lastError: 'watch-worker-overflow',
      deliveredCount: 1,
    });
  });

  it('retires old watchers on reinit and ignores their late callbacks', async () => {
    await fileWatcher.setupFileWatchers();
    const old = [...fakeWatchers];
    await fileWatcher.setupFileWatchers();
    expect(state.watchers).toHaveLength(4);
    for (const w of old) {
      expect(w.close).toHaveBeenCalledTimes(1);
      w.emit('ready');
      w.emit('error', new Error('late'));
      w.emit('loss', 10);
      w.emit('add', samplePath('old-generation.js'));
    }
    expect(state.activityLog).toHaveLength(0);
    expect(fileWatcher.getFileSensorHealth()['fs-chokidar']).toMatchObject({
      state: 'STARTING',
      lossCount: 0,
    });
    for (const w of state.watchers) w.emit('ready');
    state.watchers[0].emit('add', samplePath('new-generation.js'));
    expect(state.activityLog).toHaveLength(1);
    expect(fileWatcher.getFileSensorHealth()['fs-chokidar'].state).toBe('HEALTHY');
  });

  it('does not register a superseded setup or a setup closed while yielding', async () => {
    await Promise.all([fileWatcher.setupFileWatchers(), fileWatcher.setupFileWatchers()]);
    expect(fakeWatchers).toHaveLength(4);
    const pending = fileWatcher.setupFileWatchers();
    await fileWatcher.closeFileWatchers();
    await pending;
    expect(fakeWatchers).toHaveLength(4);
    expect(state.watchers).toEqual([]);
  });

  it('withdraws the previous coverage claim immediately when closing begins', async () => {
    await fileWatcher.setupFileWatchers();
    readyAll();
    expect(fileWatcher.getWatchPlan().state).toBe('HEALTHY');
    const closing = fileWatcher.closeFileWatchers();
    expect(fileWatcher.getWatchPlan()).toMatchObject({ state: 'STARTING', liveWatcherCount: 0 });
    expect(fileWatcher.getFileSensorHealth()['fs-chokidar'].state).toBe('STARTING');
    await closing;
  });
});
