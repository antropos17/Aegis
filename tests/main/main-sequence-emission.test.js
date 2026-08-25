/**
 * The emission side of docs/roadmap/sequence-rules.md §5: main.js turns the detection the
 * engine hands `onDetection` into the `sequence-detection` audit record ON THE EVENT, and
 * `getStats()` carries the engine's §3 counters as a `sequences` block on BOTH of its
 * branches — the pre-`loadDeferredModules` literal and the loaded one are separate object
 * literals, so one can grow a field the other never gets (the `ipc` precedent,
 * main-ipc-stats.test.js).
 *
 * `app.whenReady()` never resolves in this harness, so `loadDeferredModules` never runs and
 * the `_set…ForTest` seams are the only collaborators main.js holds: the audit sink and the
 * engine are fakes, the record-building code is the production one. One case installs the
 * REAL engine so the key set of the block is the engine's own and not a fake's opinion.
 */
import { describe, it, expect, afterEach, afterAll, vi } from 'vitest';
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

const INSTANCE_ID = '4242:1717000000000';
const CONFIRMED = { status: 'confirmed', evidence: ['handle-scan-pid'] };

/** The payload `sequence-engine.js` `_emit` builds for SEQ001, as its header documents it. */
function detection() {
  return {
    ruleId: 'SEQ001',
    title: 'Credential file read followed by outbound connection',
    level: 'high',
    timespan: 300000,
    instanceId: INSTANCE_ID,
    agent: 'Claude Code',
    pid: 4242,
    attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
    steps: [
      {
        step: 'cred_file_read',
        at: 1000,
        action: 'file-accessed',
        path: 'C:\\work\\creds.txt',
        attribution: CONFIRMED,
      },
      { step: 'outbound_conn', at: 2000, action: 'network-connection', attribution: null },
    ],
  };
}

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

/** The §3 counters and gauges the engine's `getStats()` publishes at the top level, sorted. */
const ENGINE_STATS_KEYS = [
  'closedOnExit',
  'completed',
  'evicted',
  'expired',
  'ingestErrors',
  'lateAfterExit',
  'openNow',
  'opened',
  'peakOpen',
  'recentlyExited',
  'reloadDiscarded',
  'retriggerIgnored',
  'rules',
  'skippedNullInstanceId',
  'slid',
];

afterEach(() => {
  // Module-level state in main.js: leave the booting branch as the default so test
  // order cannot decide which branch a later case sees.
  main._setAuditForTest(undefined);
  main._setSequenceEngineForTest(undefined);
  main._setScannerForTest(undefined);
});

afterAll(() => {
  Module._load = originalLoad;
  process.argv = originalArgv;
});

describe('main — onSequenceDetection writes the sequence-detection audit record', () => {
  it('writes the record on the event, in the shape roadmap §5 "Emission" states', () => {
    const audit = { log: vi.fn() };
    main._setAuditForTest(audit);
    const d = detection();

    main.onSequenceDetection(d);

    expect(audit.log).toHaveBeenCalledTimes(1);
    const [type, record] = audit.log.mock.calls[0];
    expect(type).toBe('sequence-detection');
    expect(record).toEqual({
      agent: 'Claude Code',
      pid: 4242,
      instanceId: INSTANCE_ID,
      action: 'SEQ001',
      severity: 'high',
      attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
      extra: {
        ruleId: 'SEQ001',
        title: 'Credential file read followed by outbound connection',
        timespan: 300000,
        steps: d.steps,
      },
    });
    // The steps ride as the engine handed them — its own array, which it no longer shares
    // with any live state (sequence-engine.js "THE DETECTION").
    expect(record.extra.steps).toBe(d.steps);
  });

  it('carries an absent actor as the audit conventions do — agent "" and pid null', () => {
    const audit = { log: vi.fn() };
    main._setAuditForTest(audit);

    main.onSequenceDetection({ ...detection(), agent: '', pid: null });

    const record = audit.log.mock.calls[0][1];
    expect(record.agent).toBe('');
    expect(record.pid).toBeNull();
    expect(record.instanceId).toBe(INSTANCE_ID);
  });

  it('the severity is the rule level, verbatim, for every level the loader accepts', () => {
    const audit = { log: vi.fn() };
    main._setAuditForTest(audit);

    for (const level of ['informational', 'low', 'medium', 'high', 'critical']) {
      main.onSequenceDetection({ ...detection(), level });
    }

    expect(audit.log.mock.calls.map((c) => c[1].severity)).toEqual([
      'informational',
      'low',
      'medium',
      'high',
      'critical',
    ]);
  });
});

describe('getStats().sequences — the engine counters ride the existing stats push', () => {
  it('is the engine snapshot on the scanner-absent branch', () => {
    const snapshot = { opened: 2, completed: 1, rules: { SEQ001: { opened: 2, completed: 1 } } };
    const engine = { getStats: vi.fn().mockReturnValue(snapshot) };
    main._setSequenceEngineForTest(engine);

    const stats = main.getStats();

    expect(stats.sequences).toEqual(snapshot);
    expect(engine.getStats).toHaveBeenCalledTimes(1);
  });

  it('is the engine snapshot on the loaded branch too', () => {
    const snapshot = { opened: 5, completed: 4, rules: {} };
    main._setSequenceEngineForTest({ getStats: vi.fn().mockReturnValue(snapshot) });
    main._setScannerForTest(scannerStub());

    const stats = main.getStats();

    // The loaded branch, proven by a field only it computes off the scanner.
    expect(stats.peakAgents).toBe(3);
    expect(stats.sequences).toEqual(snapshot);
  });

  it('is null before the engine is loaded — no zeroed lookalike of counters nobody moved', () => {
    expect(main.getStats().sequences).toBeNull();
    main._setScannerForTest(scannerStub());
    expect(main.getStats().sequences).toBeNull();
  });

  it('with the REAL engine, the block carries the §3 counters and gauges', () => {
    const engine = require_('../../src/main/sequence-engine.js');
    engine.init({ rules: [] });
    main._setSequenceEngineForTest(engine);

    const block = main.getStats().sequences;

    expect(Object.keys(block).sort()).toEqual(ENGINE_STATS_KEYS);
    expect(block.rules).toEqual({});
    // A snapshot, not a live reference: moving a counter on it moves nothing in the engine.
    block.opened = 99;
    expect(main.getStats().sequences.opened).toBe(0);
  });

  it('sequences is a SIBLING of appHealth and ipc, never inside either', () => {
    main._setSequenceEngineForTest({ getStats: () => ({ opened: 0, rules: {} }) });
    const stats = main.getStats();
    expect(stats).toHaveProperty('sequences');
    expect(stats.appHealth).not.toHaveProperty('sequences');
    expect(stats.ipc).not.toHaveProperty('sequences');
  });
});
