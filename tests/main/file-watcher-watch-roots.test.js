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
  const watchMock = vi.fn((paths) => {
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
      emit(event, ...args) {
        for (const cb of handlers.get(event) || []) cb(...args);
      },
    };
    fakeWatchers.push(w);
    return w;
  });

  Module._load = function (request) {
    if (request === 'chokidar') return { watch: watchMock };
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
    if (!present) throw new Error('ENOENT');
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
      expect(root(plan, 'credential-dirs').lastError).toMatch(/watch refused #1/);
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
      expect(h.lastError).toMatch(/credential-dirs:watch refused #1/);
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

      fakeWatchers[1].emit('error', new Error('watch failed'));

      const plan = fileWatcher.getWatchPlan();
      expect(plan.unavailableGroups).toEqual([
        { id: 'agent-config-dirs', state: 'errored', reason: 'watch failed' },
      ]);
      expect(plan.state).toBe('DEGRADED');
      expect(root(plan, 'project-dir').state).toBe(fileWatcher.WATCH_ROOT_STATE.READY);
      const h = chokidarHealth();
      expect(h.state).toBe('DEGRADED');
      expect(h.lastError).toMatch(/watch failed/);
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
});
