import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { enrichAgents } from '../../src/renderer/lib/utils/enrich-agents';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-native-main-'));
let options;
let admissions;
const native = {
  takeAdmission: (raw) => {
    const claim = admissions.get(raw);
    admissions.delete(raw);
    return claim ?? null;
  },
};
const electron = {
  app: {
    name: 'Aegis',
    getPath: () => directory,
    getVersion: () => '0.0.0-test',
    setName() {},
    disableHardwareAcceleration() {},
    requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}),
    on() {},
    quit() {},
  },
  BrowserWindow: class {},
  globalShortcut: { register() {}, unregisterAll() {} },
  shell: { openExternal() {} },
  ipcMain: { handle() {}, on() {} },
  dialog: {},
  powerMonitor: new EventEmitter(),
  Notification: class {},
  Tray: class {},
  Menu: { buildFromTemplate: (value) => value },
  nativeImage: { createFromBuffer: (value) => value },
  safeStorage: { isEncryptionAvailable: () => false },
};
const originalLoad = Module._load;
const originalArgv = process.argv;
Module._load = function (request) {
  if (request === 'electron') return electron;
  if (request === './platform/etw-file-runtime')
    return {
      createRuntime: (value) => {
        options = value;
        return native;
      },
    };
  return originalLoad.apply(this, arguments);
};
process.argv = ['node', 'main.js'];
const require = createRequire(import.meta.url);
delete require.cache[require.resolve('../../src/main/main')];
const main = require('../../src/main/main');
const baselines = require('../../src/main/baselines');
const sessions = require('../../src/main/session-tracker');
const tray = require('../../src/main/tray-icon');
const { projectRecord } = require('../../src/main/security-event-record');
const { createSensitiveAlertJournal } = require('../../src/main/sensitive-alert-journal');
let activity, journal, audit, send, actor, accept, scanLoop, engine;

beforeEach(() => {
  vi.useFakeTimers();
  admissions = new WeakMap();
  sessions._resetForTest();
  for (const key of Object.keys(baselines.getSessionData())) delete baselines.getSessionData()[key];
  actor = {
    agent: 'Claude Code',
    process: 'claude.exe',
    pid: 320,
    instanceId: '320:1720000000000',
    createTime100ns: '133644736000000000',
    instanceIdSource: 'os',
    category: 'ai',
  };
  sessions.reconcile([actor], { now: Date.now() });
  baselines.init({ isInstanceActive: (id) => sessions.hasInstance(id) });
  activity = [];
  audit = [];
  accept = true;
  const securityEvents = {
    push: vi.fn((record) => {
      if (!accept) return false;
      audit.push(projectRecord(record));
      return true;
    }),
  };
  const scanPath = require.resolve('../../src/main/scan-loop');
  delete require.cache[scanPath];
  scanLoop = require('../../src/main/scan-loop');
  scanLoop.init({ securityEvents, baselines, audit: { log: vi.fn() } });
  main._setScannerForTest({ activityLog: activity });
  main._setWatcherForTest({ classifySensitive: () => 'SSH private key' });
  main._setScanLoopForTest(scanLoop);
  main._setBaselinesForTest(baselines);
  main._setSecurityEventsForTest(securityEvents);
  engine = { ingest: vi.fn() };
  main._setSequenceEngineForTest(engine);
  journal = createSensitiveAlertJournal(directory);
  main._setSensitiveAlertJournalForTest(journal);
  send = vi.fn();
  main._setMainWindowForTest({ isDestroyed: () => false, webContents: { send } });
  tray.init({ tray: null, getSettings: () => ({ notificationsEnabled: false }) });
  main._initializeEtwFileRuntimeForTest();
  main._initializeNativeFileIngressForTest();
});

afterEach(async () => {
  await journal.flush();
  main._setSensitiveAlertJournalForTest(undefined);
  main._setMainWindowForTest(undefined);
  main._setSecurityEventsForTest(null);
  main._setEtwFileForTest(undefined);
  main._setScannerForTest(undefined);
  main._setWatcherForTest(undefined);
  main._setScanLoopForTest(undefined);
  main._setBaselinesForTest(undefined);
  main._setSequenceEngineForTest(undefined);
  main._setAuditForTest(undefined);
  sessions._resetForTest();
  vi.useRealTimers();
  fs.rmSync(path.join(directory, 'sensitive-alerts.json'), { force: true });
});

afterAll(() => {
  Module._load = originalLoad;
  process.argv = originalArgv;
  expect(path.dirname(path.resolve(directory))).toBe(path.resolve(os.tmpdir()));
  fs.rmSync(directory, { recursive: true, force: true });
});

function issue(sequence, objectKey = 'object-1', scopeGeneration = 'scope-1') {
  const candidate = { label: 'C:\\owned-fixture\\.ssh\\id_ed25519' };
  const binding = options.onBindingCandidate(candidate, { scopeGeneration, actor });
  expect(binding).not.toBeNull();
  const raw = {};
  admissions.set(raw, {
    observationId: `session:${sequence}`,
    actor,
    timestamp: Date.now() - 10,
    createTime100ns: actor.createTime100ns,
    object: {
      objectKey,
      bindingId: 'binding-1',
      label: candidate.label,
      ...binding,
      provenance: 'issuer-handle-file-id',
    },
  });
  return raw;
}

describe('production main native object-read wiring', () => {
  it('uses the actual runtime callback to deliver one UUID to activity, alert, baseline and displayed risk', () => {
    expect(main.getNativeFileAdmissionEvidence()).toBeNull();
    expect(typeof options.onOperationalRead).toBe('function');
    const before = enrichAgents([actor], [], {}, [], [])[0].riskScore;
    const raw = issue(1);
    expect(options.onOperationalRead(raw)).toBe(true);
    expect(activity).toHaveLength(1);
    const event = activity[0];
    expect(event).not.toHaveProperty('file');
    expect(journal.list().items).toMatchObject([
      { eventId: event.eventId, observationKind: 'bound-object-read' },
    ]);
    expect(audit).toHaveLength(1);
    expect(audit[0].details.extra.eventId).toBe(event.eventId);
    const bucket = baselines.getSessionData()[actor.instanceId];
    expect(bucket.objects.size).toBe(1);
    expect(bucket.objectSensitiveCount).toBe(1);
    expect(bucket.files.size).toBe(0);
    expect(enrichAgents([actor], activity, {}, [], [])[0].riskScore).toBeGreaterThan(before);
    vi.advanceTimersByTime(150);
    const displayed = send.mock.calls
      .filter(([channel]) => channel === 'file-access')
      .flatMap(([, rows]) => rows);
    expect(displayed.map((row) => row.eventId)).toEqual([event.eventId]);
    expect(options.onOperationalRead(raw)).toBe(false);
    expect(options.onOperationalRead(issue(2))).toBe(true);
    expect(audit).toHaveLength(2);
    expect(activity).toHaveLength(1);
    expect(journal.list().items).toHaveLength(1);
    expect(bucket.objectSensitiveCount).toBe(1);
  });

  it('rejects custody before actual main activity, baseline, dedup and alert effects', () => {
    accept = false;
    expect(options.onOperationalRead(issue(1))).toBe(false);
    expect(activity).toHaveLength(0);
    expect(journal.list().items).toHaveLength(0);
    expect(baselines.getSessionData()[actor.instanceId]).toBeUndefined();
    accept = true;
    expect(options.onOperationalRead(issue(2))).toBe(true);
    expect(activity).toHaveLength(1);
    expect(audit).toHaveLength(1);
  });

  it('keeps different objects and object scopes distinct in the actual main live chain', () => {
    expect(options.onOperationalRead(issue(1))).toBe(true);
    expect(options.onOperationalRead(issue(2, 'object-2'))).toBe(true);
    expect(options.onOperationalRead(issue(3, 'object-1', 'scope-2'))).toBe(true);
    expect(activity).toHaveLength(3);
    expect(journal.list().items).toHaveLength(3);
    expect(baselines.getSessionData()[actor.instanceId].objects.size).toBe(3);
    expect(audit).toHaveLength(3);
  });

  it('quarantines a same-key different fullbirth before custody or live baseline reuse', () => {
    expect(options.onOperationalRead(issue(1))).toBe(true);
    const old = activity[0];
    actor = { ...actor, createTime100ns: '133644736000000001' };
    expect(
      options.onBindingCandidate(
        { label: old.object.label },
        {
          scopeGeneration: old.object.scopeGeneration,
          actor,
        },
      ),
    ).toBeNull();
    const raw = {};
    admissions.set(raw, {
      observationId: 'session:2',
      actor,
      object: old.object,
      timestamp: Date.now(),
      createTime100ns: actor.createTime100ns,
    });
    expect(options.onOperationalRead(raw)).toBe(false);
    expect(audit).toHaveLength(1);
    expect(activity).toHaveLength(1);
    expect(baselines.getSessionData()[actor.instanceId].objectBirth100ns).toBe(old.createTime100ns);
    expect(enrichAgents([actor], activity, {}, [], [])[0].sensitiveFiles).toBe(0);
  });

  it('drains real audit spill through the production historical consumer without replaying live effects', () => {
    const profile = fs.mkdtempSync(path.join(directory, 'replay-'));
    let acknowledge = false;
    const persisted = [];
    main._setAuditForTest({
      persistBatch: (records) => {
        if (!acknowledge) return false;
        persisted.push(...records);
        return true;
      },
    });
    let pipeline = main._createAuditDeliveryPipelineForTest(profile);
    try {
      main._setSecurityEventsForTest(pipeline);
      scanLoop.init({ securityEvents: pipeline, baselines, audit: { log: vi.fn() } });
      expect(options.onOperationalRead(issue(1))).toBe(true);
      const observation = activity[0];
      pipeline.destroy();
      expect(
        fs.readdirSync(path.join(profile, 'event-spill')).some((name) => name.endsWith('.spill')),
      ).toBe(true);
      const liveBefore = {
        activity: activity.length,
        journal: journal.list().items.length,
        baseline: baselines.getSessionData()[actor.instanceId].objectSensitiveCount,
        sequence: engine.ingest.mock.calls.length,
      };
      acknowledge = true;
      pipeline = main._createAuditDeliveryPipelineForTest(profile);
      const replay = persisted.filter((row) => row.type === 'file-access');
      expect(replay).toHaveLength(1);
      expect(replay[0].replayed).toBe(true);
      expect(replay[0].details.extra.eventId).toBe(observation.eventId);
      expect(replay[0].details.extra.createTime100ns).toBe(actor.createTime100ns);
      expect({
        activity: activity.length,
        journal: journal.list().items.length,
        baseline: baselines.getSessionData()[actor.instanceId].objectSensitiveCount,
        sequence: engine.ingest.mock.calls.length,
      }).toEqual(liveBefore);
    } finally {
      pipeline.destroy();
      expect(path.dirname(path.resolve(profile))).toBe(path.resolve(directory));
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
});
