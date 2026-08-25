/**
 * End to end — docs/roadmap/sequence-rules.md §5 and §7 block 3: a rule the loader compiled from
 * source, the REAL engine on an injected clock, the file carrier through the REAL tap 1
 * (`main.onFileEvent` → real scan-loop dedup → `engine.ingest`), the network carrier through the
 * engine's tap signature, the detection through the production `onSequenceDetection` into a fake
 * audit sink, the score surface, and then the hot-reload path exactly as main.js runs it —
 * `reset('reload')` followed by `init` with the next ruleset — dropping the open sequence, moving
 * `reloadDiscarded` and swapping the rule that fires.
 *
 * No Electron runs: `electron` is the stub the main-*.test.js harness hands main.js through
 * `Module._load`, `app.whenReady()` never resolves, so main.js holds only the collaborators
 * injected here. Loader, engine, `normalizeToEcs` and the dedup are the production modules;
 * nothing about a carrier, a detection or the record is a fake's opinion.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import Module from 'module';
import os from 'os';
import { createRequire } from 'module';
import engine from '../../src/main/sequence-engine.js';
import loader from '../../src/main/sequence-rule-loader.js';

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
// is a syntax error under an ESM transform but legal for the CJS loader. `logger` comes
// through the same native loader so the spy lands on the instance main.js and the
// engine hold (the sequence-engine.test.js convention).
const require_ = createRequire(import.meta.url);
const main = require_('../../src/main/main.js');
const logger = require_('../../src/main/logger.js');

afterAll(() => {
  Module._load = originalLoad;
  process.argv = originalArgv;
});

/**
 * One two-step rule as `rules/sequences/sequences.yaml` writes it, under the given id, so the
 * reload case can hand the engine a ruleset that differs from the first by its rule id alone.
 * @param {string} id
 * @returns {string}
 */
function ruleSource(id) {
  return [
    'title: Credential file read',
    'name: cred_file_read',
    'logsource:',
    '  product: aegis',
    '  category: file',
    'detection:',
    '  selection:',
    '    event.action: file-accessed',
    '    file.path|contains: creds',
    '  condition: selection',
    '---',
    'title: Outbound connection',
    'name: outbound_conn',
    'logsource:',
    '  product: aegis',
    '  category: network',
    'detection:',
    '  selection:',
    '    destination.port: 443',
    '  condition: selection',
    '---',
    `title: Credential read followed by an outbound connection (${id})`,
    `id: ${id}`,
    'level: high',
    'correlation:',
    '  type: temporal_ordered',
    '  rules:',
    '    - cred_file_read',
    '    - outbound_conn',
    '  group-by:',
    '    - process.entity_id',
    '  timespan: 5m',
  ].join('\n');
}

const INSTANCE_ID = '4242:1717000000000';
const CONFIRMED = { status: 'confirmed', evidence: ['handle-scan-pid'] };
const CREDS_PATH = 'C:\\work\\creds.txt';

/**
 * The step-1 carrier: an attributed, non-sensitive FileEvent as file-watcher.js builds it.
 * @returns {Record<string, unknown>}
 */
function fileCarrier() {
  return {
    instanceId: INSTANCE_ID,
    file: CREDS_PATH,
    action: 'accessed',
    sensitive: false,
    category: 'ai',
    timestamp: 1_717_000_001_000,
    agent: 'Claude Code',
    pid: 4242,
    attribution: CONFIRMED,
  };
}

/**
 * The real dedup in scan-loop keys on instance + path over a 30 s window read off `Date.now()`
 * (fake timers here), not off the carrier's `timestamp`: a second read of the same file inside
 * the window is dropped by production and must be dropped here too, so the wall clock moves
 * past the window before every read after the first. The engine reads only the injected clock.
 * @returns {void}
 */
function pastDedupWindow() {
  vi.advanceTimersByTime(31_000);
}

/**
 * The step-2 carrier: a NetworkConnection as the scan hands it over — no `attribution` field,
 * so the step is neutral (`src/shared/types/events.ts` `NetworkConnection`).
 * @returns {Record<string, unknown>}
 */
function netCarrier() {
  return {
    instanceId: INSTANCE_ID,
    remoteIp: '203.0.113.5',
    remotePort: 443,
    agent: 'Claude Code',
    pid: 4242,
  };
}

/** @type {number} */
let clock = 0;
const now = () => clock;

/** @type {import('vitest').Mock} */
let onDetection;
/** @type {{log: import('vitest').Mock}} */
let audit;
/** @type {import('vitest').MockInstance} */
let infoSpy;
/** @type {import('vitest').MockInstance} */
let warnSpy;

/**
 * Installs a loader-compiled ruleset with the SAME `onDetection` and clock every time — what
 * main.js does at startup and again on reload.
 * @param {string} id
 * @returns {void}
 */
function installRules(id) {
  const loaded = loader.loadFromString(ruleSource(id), 'sequences.yaml');
  expect(loaded.loadErrors).toBe(0);
  expect(loaded.rules.map((r) => r.id)).toEqual([id]);
  engine.init({ rules: loaded.rules, onDetection, now });
}

/** The `sequence-detection` records the fake audit sink received, in order. */
function detectionRecords() {
  return audit.log.mock.calls.filter((c) => c[0] === 'sequence-detection').map((c) => c[1]);
}

beforeEach(() => {
  clock = 0;
  // The two batchers `onFileEvent` pushes into would otherwise arm real flush timers that
  // fire after this file is torn down. The engine reads only the injected clock.
  vi.useFakeTimers();
  infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
  warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  audit = { log: vi.fn() };
  // The production consumer, spied so the call count is asserted on the seam main.js owns.
  onDetection = vi.fn((d) => main.onSequenceDetection(d));
  // A FRESH scan-loop per test: its dedup map is module state.
  const scanLoopPath = require_.resolve('../../src/main/scan-loop.js');
  delete require_.cache[scanLoopPath];
  const scanLoop = require_('../../src/main/scan-loop.js');
  scanLoop.init({ audit });
  main._setScanLoopForTest(scanLoop);
  main._setSequenceEngineForTest(engine);
  main._setAuditForTest(audit);
});

afterEach(() => {
  main._setWatcherForTest(undefined);
  main._resetWatchersForTest();
  main._setScanLoopForTest(undefined);
  main._setSequenceEngineForTest(undefined);
  main._setAuditForTest(undefined);
  engine.init({ rules: [] });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('sequence rules end to end — loader, tap, engine, emission, hot reload', () => {
  it('a compiled rule fires once through the real tap and becomes the §5 record; a reload drops the open state and swaps the rule', () => {
    installRules('SEQ001');

    // ── Step 1 through tap 1: main.onFileEvent → real dedup → engine.ingest ──
    clock = 1000;
    main.onFileEvent(fileCarrier());
    expect(engine.getStats()).toMatchObject({ opened: 1, openNow: 1 });
    expect(onDetection).not.toHaveBeenCalled();

    // ── Step 2 through the engine's tap signature ──
    clock = 2000;
    engine.ingest(netCarrier());

    expect(onDetection).toHaveBeenCalledTimes(1);
    const detection = onDetection.mock.calls[0][0];
    expect(detection).toEqual({
      ruleId: 'SEQ001',
      title: 'Credential read followed by an outbound connection (SEQ001)',
      level: 'high',
      timespan: 5 * 60 * 1000,
      instanceId: INSTANCE_ID,
      agent: 'Claude Code',
      pid: 4242,
      attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
      steps: [
        {
          step: 'cred_file_read',
          at: 1000,
          action: 'file-accessed',
          path: CREDS_PATH,
          attribution: CONFIRMED,
        },
        { step: 'outbound_conn', at: 2000, action: 'network-connection', attribution: null },
      ],
    });

    // ── Emission: the §5 audit record, written on the event by the production consumer ──
    const records = detectionRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      agent: 'Claude Code',
      pid: 4242,
      instanceId: INSTANCE_ID,
      action: 'SEQ001',
      severity: 'high',
      attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
      extra: {
        ruleId: 'SEQ001',
        title: 'Credential read followed by an outbound connection (SEQ001)',
        timespan: 5 * 60 * 1000,
        steps: detection.steps,
      },
    });
    // The file-access record tap 1 wrote came BEFORE the detection: the tap runs after the
    // audit call, and the detection landed inside the ingest that completed it.
    const types = audit.log.mock.calls.map((c) => c[0]);
    expect(types.indexOf('sequence-detection')).toBeGreaterThan(types.indexOf('file-access'));
    // The score surface the alert path merges: high ⇒ 70 while the hold lasts.
    expect(engine.scoreFor(INSTANCE_ID)).toBe(70);
    expect(engine.getStats()).toMatchObject({ completed: 1, openNow: 0 });

    // ── A second read opens a new sequence the reload will have to drop ──
    pastDedupWindow();
    clock = 3000;
    main.onFileEvent(fileCarrier());
    expect(engine.getStats()).toMatchObject({ opened: 2, openNow: 1 });

    // ── Hot reload, first half: reset('reload') drops the open state and counts it ──
    engine.reset('reload');
    const afterReset = engine.getStats();
    expect(afterReset.reloadDiscarded).toBe(1);
    expect(afterReset.rules.SEQ001.reloadDiscarded).toBe(1);
    expect(afterReset.openNow).toBe(0);
    expect(afterReset.rules.SEQ001.openNow).toBe(0);
    expect(infoSpy).toHaveBeenCalledWith(
      'sequence-engine',
      'discarded 1 open sequence(s)',
      expect.objectContaining({ reason: 'reload', discarded: 1 }),
    );

    // ── Hot reload, second half: init with a ruleset of a different id ──
    installRules('SEQ900');
    // A re-init is a FRESH engine (sequence-engine.js `init`): the counters `reset` moved a
    // moment ago read zero again, and only the `discarded … reason: 'reload'` log line above
    // survives the reload. Pinned as the known cost of the reset-then-init path this prompt
    // specifies, not endorsed — a later engine change that keeps counters across a reload
    // is meant to turn this line red on purpose.
    expect(engine.getStats().reloadDiscarded).toBe(0);
    expect(Object.keys(engine.getStats().rules)).toEqual(['SEQ900']);

    // ── The same pair again: the old rule id no longer fires, the new one does ──
    pastDedupWindow();
    clock = 4000;
    main.onFileEvent(fileCarrier());
    clock = 5000;
    engine.ingest(netCarrier());

    expect(onDetection).toHaveBeenCalledTimes(2);
    expect(onDetection.mock.calls.map((c) => c[0].ruleId)).toEqual(['SEQ001', 'SEQ900']);
    expect(detectionRecords().map((r) => r.action)).toEqual(['SEQ001', 'SEQ900']);
    expect(detectionRecords()[1]).toMatchObject({
      action: 'SEQ900',
      extra: { ruleId: 'SEQ900', steps: [{ at: 4000 }, { at: 5000 }] },
    });
  });

  it('the reset alone does not lose the ruleset: the same rule fires again after reset without init', () => {
    installRules('SEQ001');
    clock = 1000;
    main.onFileEvent(fileCarrier());

    engine.reset('reload');
    expect(engine.getStats()).toMatchObject({ reloadDiscarded: 1, openNow: 0 });

    // The B that would have completed the dropped state opens nothing: the reset is what
    // closes the hole a flat-rule edit must not open (roadmap §5 "Hot-reload").
    clock = 2000;
    engine.ingest(netCarrier());
    expect(onDetection).not.toHaveBeenCalled();

    pastDedupWindow();
    clock = 3000;
    main.onFileEvent(fileCarrier());
    clock = 4000;
    engine.ingest(netCarrier());
    expect(onDetection).toHaveBeenCalledTimes(1);
    expect(onDetection.mock.calls[0][0].ruleId).toBe('SEQ001');
    // `reset` keeps the counters it moved: the discard is still on the ledger after the fire.
    expect(engine.getStats()).toMatchObject({ reloadDiscarded: 1, completed: 1 });
  });

  it('the production reload — watcher → main → loader → reset → init — installs the real rules/sequences ruleset behind the production consumer', async () => {
    // A state open under a rule that exists only in this test, so the reload has something
    // to discard and a rule id that must be gone afterwards.
    installRules('SEQ777');
    clock = 1000;
    main.onFileEvent(fileCarrier());
    expect(engine.getStats()).toMatchObject({ openNow: 1 });

    // `startWatchers` hands both watchers their dependencies; the mock captures them.
    const watcherMock = {
      setupFileWatchers: vi.fn(async () => {}),
      setupRulesWatcher: vi.fn(),
      setupSequenceRulesWatcher: vi.fn(),
    };
    main._resetWatchersForTest();
    main._setWatcherForTest(watcherMock);
    await main.startWatchers();
    const { reload } = watcherMock.setupSequenceRulesWatcher.mock.calls[0][1];
    const { sequenceCount } = watcherMock.setupRulesWatcher.mock.calls[0][1];

    // The directory as the loader reads it — the same read main.js is about to make.
    const onDisk = loader.loadDir();
    expect(onDisk.rules.length).toBeGreaterThan(0);
    const count = reload();

    expect(count).toBe(onDisk.rules.length);
    expect(sequenceCount()).toBe(count);
    expect(Object.keys(engine.getStats().rules)).toEqual(onDisk.rules.map((r) => r.id));
    // The reset ran, and ran BEFORE the init: only `reset` writes this line, and after an
    // init there is no state left for it to count.
    expect(infoSpy).toHaveBeenCalledWith(
      'sequence-engine',
      'discarded 1 open sequence(s)',
      expect.objectContaining({ reason: 'reload', discarded: 1 }),
    );
    // The one-line summary, on whichever level the directory's notices put it.
    const summaries = [...infoSpy.mock.calls, ...warnSpy.mock.calls].filter(
      (c) => c[0] === 'sequence-loader' && /^Sequence rules reloaded/.test(c[1]),
    );
    expect(summaries).toHaveLength(1);
    expect(summaries[0][2]).toMatchObject({ rules: onDisk.rules.map((r) => r.id) });

    // The consumer the reload installed is the production one: SEQ001's own pair — a
    // credential-named file, then a 443 connection — lands as the audit record, and the
    // test rule fires no more.
    pastDedupWindow();
    clock = 2000;
    main.onFileEvent({ ...fileCarrier(), file: 'C:\\work\\credentials.json' });
    clock = 3000;
    engine.ingest(netCarrier());
    const actions = detectionRecords().map((r) => r.action);
    expect(actions).toContain('SEQ001');
    expect(actions).not.toContain('SEQ777');
    expect(detectionRecords()[0].extra.steps.map((s) => s.step)).toEqual([
      'cred_file_read',
      'outbound_conn',
    ]);

    // Before the deferred init has run there is no engine: the reload answers the count it
    // knows and touches nothing.
    main._setSequenceEngineForTest(undefined);
    expect(reload()).toBe(count);
  });
});
