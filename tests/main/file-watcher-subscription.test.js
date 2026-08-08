/**
 * F-S01 — production chokidar subscription wiring.
 *
 * Handler unit tests call handleWatcherEvent() directly and would stay green if
 * every watcher.on('add'|'change'|'unlink', …) line were deleted. This file
 * starts setupFileWatchers() with a mocked chokidar, asserts the three evidence
 * subscriptions exist on every created watcher, and fires the captured callbacks
 * to prove they reach the real processing path.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import Module from 'module';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const originalLoad = Module._load;

/** @type {Array<{ on: ReturnType<typeof vi.fn>, close: ReturnType<typeof vi.fn>, emit: Function, _handlers: Map, _paths: unknown, _opts: unknown }>} */
let fakeWatchers = [];
/** @type {ReturnType<typeof vi.fn>} */
let watchMock;

function installChokidarMock() {
  fakeWatchers = [];
  watchMock = vi.fn((paths, opts) => {
    const handlers = new Map();
    const w = {
      on: vi.fn((event, cb) => {
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event).push(cb);
        return w;
      }),
      close: vi.fn(),
      _handlers: handlers,
      _paths: paths,
      _opts: opts,
      emit(event, ...args) {
        for (const cb of handlers.get(event) || []) cb(...args);
      },
    };
    fakeWatchers.push(w);
    return w;
  });

  Module._load = function (request, parent, isMain) {
    if (request === 'chokidar') {
      return { watch: watchMock };
    }
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
    const chokidarPath = require_.resolve('chokidar');
    delete require_.cache[chokidarPath];
  } catch {
    // optional if resolve fails after mock
  }
}

function makeState(overrides = {}) {
  return {
    getCustomRules: () => [],
    getSettings: () => ({}),
    getLatestAgents: () => [
      { pid: 100, agent: 'Claude Code', category: 'ai', cwd: os.homedir(), instanceId: '100:t1' },
    ],
    getLatestAiAgents: () => [
      { pid: 100, agent: 'Claude Code', category: 'ai', cwd: os.homedir(), instanceId: '100:t1' },
    ],
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

/** Non-ignored path so handleWatcherEvent records evidence. */
function samplePath(name = 'aegis-fs01-probe.js') {
  return path.join(os.tmpdir(), name);
}

describe('file-watcher production subscription wiring (F-S01)', () => {
  /** @type {typeof import('../../src/main/file-watcher.js')} */
  let fileWatcher;

  beforeEach(() => {
    installChokidarMock();
    fileWatcher = loadFileWatcher();
  });

  afterEach(() => {
    fileWatcher._resetForTest();
    restoreChokidar();
  });

  afterAll(() => {
    restoreChokidar();
  });

  it('creates at least the always-on project and .env* watchers via chokidar.watch', async () => {
    const state = makeState();
    fileWatcher.init(state);
    await fileWatcher.setupFileWatchers();

    // projectDir + home .env* always; sensitive/config roots only if they exist on disk.
    expect(watchMock).toHaveBeenCalled();
    expect(fakeWatchers.length).toBeGreaterThanOrEqual(2);
    expect(state.watchers).toHaveLength(fakeWatchers.length);
    expect(state.watchers).toEqual(fakeWatchers);
  });

  it('subscribes every production evidence watcher to add, change, and unlink', async () => {
    const state = makeState();
    fileWatcher.init(state);
    await fileWatcher.setupFileWatchers();

    expect(fakeWatchers.length).toBeGreaterThan(0);
    for (const w of fakeWatchers) {
      const events = w.on.mock.calls.map((c) => c[0]);
      expect(events).toContain('add');
      expect(events).toContain('change');
      expect(events).toContain('unlink');
      // Exactly one registration per evidence event (no accidental duplicates per watcher).
      expect(events.filter((e) => e === 'add')).toHaveLength(1);
      expect(events.filter((e) => e === 'change')).toHaveLength(1);
      expect(events.filter((e) => e === 'unlink')).toHaveLength(1);
    }
  });

  it('routes chokidar add → created through the production callback', async () => {
    const state = makeState();
    fileWatcher.init(state);
    await fileWatcher.setupFileWatchers();

    const w = fakeWatchers[0];
    const p = samplePath('fs01-add.js');
    w.emit('add', p);

    expect(state.activityLog).toHaveLength(1);
    expect(state.activityLog[0].action).toBe('created');
    expect(state.activityLog[0].file).toBe(path.resolve(p));
    expect(state.onFileEvent).toHaveBeenCalledTimes(1);
  });

  it('routes chokidar change → modified through the production callback', async () => {
    const state = makeState();
    fileWatcher.init(state);
    await fileWatcher.setupFileWatchers();

    const w = fakeWatchers[0];
    const p = samplePath('fs01-change.js');
    w.emit('change', p);

    expect(state.activityLog).toHaveLength(1);
    expect(state.activityLog[0].action).toBe('modified');
    expect(state.onFileEvent).toHaveBeenCalledTimes(1);
  });

  it('routes chokidar unlink → deleted through the production callback', async () => {
    const state = makeState();
    fileWatcher.init(state);
    await fileWatcher.setupFileWatchers();

    const w = fakeWatchers[0];
    const p = samplePath('fs01-unlink.js');
    w.emit('unlink', p);

    expect(state.activityLog).toHaveLength(1);
    expect(state.activityLog[0].action).toBe('deleted');
    expect(state.onFileEvent).toHaveBeenCalledTimes(1);
  });

  it('subscription path preserves F-E02: zero agents still emits unattributed evidence', async () => {
    const state = makeState({
      getLatestAgents: () => [],
      getLatestAiAgents: () => [],
    });
    fileWatcher.init(state);
    await fileWatcher.setupFileWatchers();

    fakeWatchers[0].emit('change', samplePath('fs01-zero-agents.js'));

    expect(state.activityLog).toHaveLength(1);
    expect(state.activityLog[0].agent).toBe('');
    expect(state.activityLog[0].pid).toBeNull();
    expect(state.activityLog[0].instanceId).toBeNull();
    expect(state.activityLog[0].attribution).toEqual({
      status: 'unattributed',
      evidence: ['no-ai-agents-online'],
    });
  });

  it('subscription path still ignores noise files (shouldIgnore)', async () => {
    const state = makeState();
    fileWatcher.init(state);
    await fileWatcher.setupFileWatchers();

    fakeWatchers[0].emit('change', path.join(os.tmpdir(), 'fs01-noise.tmp'));

    expect(state.activityLog).toHaveLength(0);
    expect(state.onFileEvent).not.toHaveBeenCalled();
  });
});
