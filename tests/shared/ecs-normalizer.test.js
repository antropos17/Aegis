/**
 * The ECS view of an AEGIS internal event (src/shared/ecs-normalizer.js).
 *
 * Every fixture below is shaped from a LIVE emit site, not from a doc:
 *   - FileEvent          — src/main/file-watcher.js, the three `const event = {…}` literals
 *   - NetworkConnection  — src/main/network-monitor.js, the `deduped.map` return
 *   - session record     — src/main/session-tracker.js, `reconcile()`'s entered/exited pushes
 *   - AuditRecordV1      — src/main/audit-logger.js `log()`, fed by scan-loop.js
 *
 * The whole-document `toEqual` assertions are deliberate: they pin what is ABSENT as hard as
 * what is present, which is the property the B2.2 omit-never-null convention actually needs.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ECS_VERSION, normalizeToEcs } = require('../../src/shared/ecs-normalizer.js');
const catalogue = require('../../bench/lib/catalogue.js');

/** An instance key in space 1 — `pid:startTime`, the reuse-resistant case. */
const INSTANCE_ID = '4242:1755950000000';
const EVENT_MS = 1755950123456;
const EVENT_ISO = new Date(EVENT_MS).toISOString();
const AUDIT_ISO = '2026-08-23T10:00:00.000Z';

/** @returns {Object} A `created` FileEvent with a confirmed owner. */
function fileEvent(overrides = {}) {
  return {
    agent: 'Claude Code',
    pid: 4242,
    instanceId: INSTANCE_ID,
    parentEditor: 'VS Code',
    cwd: 'C:/proj/app',
    file: 'C:/proj/app/.env',
    sensitive: true,
    selfAccess: false,
    reason: 'Credentials file',
    action: 'created',
    timestamp: EVENT_MS,
    category: 'coding',
    attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
    ...overrides,
  };
}

/** @returns {Object} An enriched connection to an allowlisted endpoint. */
function networkConnection(overrides = {}) {
  return {
    agent: 'Claude Code',
    pid: 4242,
    instanceId: INSTANCE_ID,
    parentEditor: null,
    cwd: 'C:/proj/app',
    category: 'coding',
    remoteIp: '160.79.104.10',
    remotePort: 443,
    domain: 'api.anthropic.com',
    state: 'Established',
    verdict: 'allowlisted',
    verdictReason: 'ip-allowlist',
    flagged: false,
    httpUnencrypted: false,
    userAgent: 'node.exe',
    ...overrides,
  };
}

/** @returns {Object} An `entered` session record; add `lastSeen` to make it an exit. */
function sessionRecord(overrides = {}) {
  return {
    pid: 4242,
    instanceId: INSTANCE_ID,
    agent: 'Claude Code',
    process: 'node.exe',
    firstSeen: EVENT_MS,
    ...overrides,
  };
}

/** @returns {Object} A v1 audit record as `flush()` leaves it on disk. */
function auditRecord(overrides = {}) {
  return {
    schemaVersion: 1,
    timestamp: AUDIT_ISO,
    type: 'agent-enter',
    agent: 'Claude Code',
    pid: 4242,
    instanceId: INSTANCE_ID,
    action: 'started',
    path: '',
    severity: 'normal',
    riskScore: 0,
    attribution: null,
    details: { startTime: 1755950000000 },
    seq: 12,
    hash: 'a'.repeat(64),
    ...overrides,
  };
}

/**
 * Freeze an object graph so any write inside the module throws instead of being observed
 * after the fact. The module is `'use strict'`, so a frozen-property assignment is a TypeError.
 * @param {*} value @returns {*} the same value
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

describe('normalizeToEcs — file events', () => {
  it('maps a created FileEvent onto the full ECS document', () => {
    expect(normalizeToEcs(fileEvent())).toEqual({
      '@timestamp': EVENT_ISO,
      ecs: { version: ECS_VERSION },
      event: { kind: 'event', category: ['file'], type: ['creation'], action: 'file-created' },
      file: { path: 'C:/proj/app/.env' },
      process: {
        entity_id: INSTANCE_ID,
        pid: 4242,
        working_directory: 'C:/proj/app',
      },
      aegis: {
        agent: { name: 'Claude Code' },
        attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
      },
    });
  });

  it('categorizes every member of the closed FileAction union', () => {
    const seen = ['created', 'modified', 'deleted', 'accessed', 'holding'].map(
      (action) => normalizeToEcs(fileEvent({ action })).event,
    );
    expect(seen).toEqual([
      { kind: 'event', category: ['file'], type: ['creation'], action: 'file-created' },
      { kind: 'event', category: ['file'], type: ['change'], action: 'file-modified' },
      { kind: 'event', category: ['file'], type: ['deletion'], action: 'file-deleted' },
      { kind: 'event', category: ['file'], type: ['access'], action: 'file-accessed' },
      // A point-in-time handle HOLD is not a read; `access` would claim more than was observed.
      { kind: 'event', category: ['file'], type: ['info'], action: 'file-handle-held' },
    ]);
  });

  it('keeps the file category but invents no type for an action outside the union', () => {
    const ev = normalizeToEcs(fileEvent({ action: 'renamed' })).event;
    expect(ev).toEqual({ kind: 'event', category: ['file'] });
    expect('type' in ev).toBe(false);
    expect('action' in ev).toBe(false);
  });

  it('omits @timestamp for a timestamp that is not a usable epoch-ms', () => {
    for (const timestamp of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e18, '2026-01-01']) {
      expect('@timestamp' in normalizeToEcs(fileEvent({ timestamp }))).toBe(false);
    }
  });
});

describe('normalizeToEcs — network connections', () => {
  it('maps a NetworkConnection, and carries no observation time because it has none', () => {
    const doc = normalizeToEcs(networkConnection());
    expect(doc).toEqual({
      ecs: { version: ECS_VERSION },
      event: {
        kind: 'event',
        category: ['network'],
        type: ['connection'],
        action: 'network-connection',
      },
      network: { transport: 'tcp' },
      destination: { ip: '160.79.104.10', port: 443, domain: 'api.anthropic.com' },
      process: { entity_id: INSTANCE_ID, pid: 4242, working_directory: 'C:/proj/app' },
      aegis: { agent: { name: 'Claude Code' } },
    });
    // The connection object holds no time at all; its audit record is where one comes from.
    expect('@timestamp' in doc).toBe(false);
    // No local endpoint exists in a RawTcpConnection, so no source is invented for one.
    expect('source' in doc).toBe(false);
  });

  it('omits destination.domain when no name was forward-confirmed', () => {
    const doc = normalizeToEcs(networkConnection({ domain: '' }));
    expect(doc.destination).toEqual({ ip: '160.79.104.10', port: 443 });
  });

  it('drops the whole destination branch when neither address nor port is usable', () => {
    const doc = normalizeToEcs(networkConnection({ remoteIp: '', remotePort: 0, domain: '' }));
    expect('destination' in doc).toBe(false);
    expect(doc.network).toEqual({ transport: 'tcp' });
  });
});

describe('normalizeToEcs — agent-scoped session records', () => {
  it('maps an entered session to process/start and keeps the OS process name', () => {
    expect(normalizeToEcs(sessionRecord())).toEqual({
      '@timestamp': EVENT_ISO,
      ecs: { version: ECS_VERSION },
      event: { kind: 'event', category: ['process'], type: ['start'], action: 'agent-enter' },
      process: { entity_id: INSTANCE_ID, pid: 4242, name: 'node.exe' },
      aegis: { agent: { name: 'Claude Code' } },
    });
  });

  it('maps an exited session to process/end and times it by lastSeen', () => {
    const lastSeen = EVENT_MS + 60_000;
    const doc = normalizeToEcs(sessionRecord({ lastSeen }));
    expect(doc.event).toEqual({
      kind: 'event',
      category: ['process'],
      type: ['end'],
      action: 'agent-exit',
    });
    expect(doc['@timestamp']).toBe(new Date(lastSeen).toISOString());
  });

  it('never writes the AEGIS-observed firstSeen into ECS process.start', () => {
    const doc = normalizeToEcs(sessionRecord());
    expect('start' in doc.process).toBe(false);
  });
});

describe('normalizeToEcs — audit records', () => {
  it('maps an agent-enter record, risk_score included at its vestigial 0', () => {
    expect(normalizeToEcs(auditRecord())).toEqual({
      '@timestamp': AUDIT_ISO,
      ecs: { version: ECS_VERSION },
      event: {
        kind: 'event',
        category: ['process'],
        type: ['start'],
        action: 'agent-enter',
        risk_score: 0,
      },
      process: { entity_id: INSTANCE_ID, pid: 4242 },
      aegis: { agent: { name: 'Claude Code' }, schema_version: 1 },
    });
  });

  it('separates config-access from file-access by category, not by a custom field', () => {
    const record = auditRecord({
      type: 'config-access',
      action: 'modified',
      path: 'C:/Users/u/.claude/settings.json',
      severity: 'sensitive',
    });
    const doc = normalizeToEcs(record);
    expect(doc.event.category).toEqual(['configuration', 'file']);
    expect(doc.event.type).toEqual(['change']);
    expect(doc.file).toEqual({ path: 'C:/Users/u/.claude/settings.json' });
    expect(
      normalizeToEcs(auditRecord({ type: 'file-access', action: 'modified' })).event.category,
    ).toEqual(['file']);
  });

  it('raises an anomaly-alert to event.kind alert', () => {
    const doc = normalizeToEcs(
      auditRecord({ type: 'anomaly-alert', action: 'sensitive', pid: null, severity: 'high' }),
    );
    expect(doc.event).toEqual({
      kind: 'alert',
      category: ['intrusion_detection'],
      type: ['info'],
      action: 'anomaly-alert',
      risk_score: 0,
    });
    expect(doc.process).toEqual({ entity_id: INSTANCE_ID });
  });

  it('raises a sequence-detection to event.kind alert under its own action', () => {
    // The record main.js writes for a completed sequence (roadmap §5 "Emission"): the rule id
    // is the `action`, the level the `severity`, the steps ride in `details`.
    const doc = normalizeToEcs(
      auditRecord({
        type: 'sequence-detection',
        action: 'SEQ001',
        severity: 'high',
        attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
        details: { ruleId: 'SEQ001', title: 'Credential read', timespan: 300000, steps: [] },
      }),
    );
    expect(doc.event).toEqual({
      kind: 'alert',
      category: ['intrusion_detection'],
      type: ['info'],
      action: 'sequence-detection',
      risk_score: 0,
    });
    expect(doc.process).toEqual({ entity_id: INSTANCE_ID, pid: 4242 });
    expect(doc.aegis.attribution).toEqual({ status: 'confirmed', evidence: ['handle-scan-pid'] });
    expect('file' in doc).toBe(false);
  });

  it('routes an observation-gap to event.category host, type info, under its own action', () => {
    // The record main.js writes on powerMonitor resume (Block B5): no agent, no pid, no
    // owner question, and the gap itself in `details`.
    const doc = normalizeToEcs(
      auditRecord({
        type: 'observation-gap',
        agent: '',
        pid: null,
        instanceId: null,
        action: 'os-resume',
        attribution: null,
        details: {
          cause: 'os-suspend',
          suspendedAt: '2026-08-23T09:55:00.000Z',
          resumedAt: AUDIT_ISO,
          gapMs: 300000,
          suspendCount: 1,
          monitoringPaused: false,
          activeSessions: 2,
        },
      }),
    );
    expect(doc.event).toEqual({
      kind: 'event',
      category: ['host'],
      type: ['info'],
      action: 'observation-gap',
      risk_score: 0,
    });
    expect(doc['@timestamp']).toBe(AUDIT_ISO);
    expect('process' in doc).toBe(false);
    expect('file' in doc).toBe(false);
    expect('attribution' in doc.aegis).toBe(false);
  });

  it('never rebuilds destination.* out of a network audit record display path', () => {
    const doc = normalizeToEcs(
      auditRecord({ type: 'network-connection', action: 'Established', path: '160.79.104.10:443' }),
    );
    expect(doc.event.category).toEqual(['network']);
    expect('destination' in doc).toBe(false);
    expect('file' in doc).toBe(false);
  });

  it('states an uncategorizable type and claims nothing else about it', () => {
    for (const type of [
      'permission-deny',
      'buffer-overflow-drop',
      'something-a-later-build-adds',
    ]) {
      const ev = normalizeToEcs(auditRecord({ type })).event;
      expect(ev).toEqual({ kind: 'event', action: type, risk_score: 0 });
      expect('category' in ev).toBe(false);
      expect('type' in ev).toBe(false);
    }
  });

  it('carries a v0 record with no schemaVersion and writes no aegis.schema_version', () => {
    const v0 = auditRecord();
    delete v0.schemaVersion;
    const doc = normalizeToEcs(v0);
    expect('schema_version' in doc.aegis).toBe(false);
    expect(doc['@timestamp']).toBe(AUDIT_ISO);
  });
});

describe('normalizeToEcs — absence stays absent', () => {
  it('omits process.entity_id for a null instanceId rather than writing null', () => {
    const doc = normalizeToEcs(fileEvent({ instanceId: null }));
    expect('entity_id' in doc.process).toBe(false);
    expect(JSON.stringify(doc)).not.toContain('entity_id');
  });

  it('drops the whole process branch when nothing about the process was observed', () => {
    // The C-01 unattributed file event: no owner, so no name, no pid, no key and no cwd.
    const doc = normalizeToEcs(
      fileEvent({
        agent: '',
        pid: null,
        instanceId: null,
        cwd: null,
        attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
      }),
    );
    expect('process' in doc).toBe(false);
    expect(doc.aegis).toEqual({
      attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
    });
  });

  it('refuses pid 0 as a pid — a synthetic agent is identified by its entity_id', () => {
    const doc = normalizeToEcs(sessionRecord({ pid: 0, instanceId: '0:lm-studio' }));
    expect('pid' in doc.process).toBe(false);
    expect(doc.process.entity_id).toBe('0:lm-studio');
  });

  it('writes aegis.demo only for a record that claims it, never by truthiness', () => {
    expect('demo' in normalizeToEcs(fileEvent()).aegis).toBe(false);
    expect('demo' in normalizeToEcs(fileEvent({ _demo: false })).aegis).toBe(false);
    expect(normalizeToEcs(fileEvent({ _demo: 1 })).aegis.demo).toBeUndefined();
    expect(normalizeToEcs(fileEvent({ _demo: true })).aegis.demo).toBe(true);
  });
});

describe('normalizeToEcs — purity and refusal', () => {
  it('does not mutate the input and shares no reference with it', () => {
    const input = deepFreeze(fileEvent());
    const doc = normalizeToEcs(input);
    expect(doc.aegis.attribution.evidence).toEqual(['handle-scan-pid']);
    expect(doc.aegis.attribution.evidence).not.toBe(input.attribution.evidence);
    expect(doc.aegis.attribution).not.toBe(input.attribution);
    // Writing through the output must not reach the input.
    doc.aegis.attribution.evidence.push('rm-holder-pid');
    expect(input.attribution.evidence).toEqual(['handle-scan-pid']);
  });

  it('mutates no carrier — every shape survives a deep-frozen input', () => {
    for (const input of [fileEvent(), networkConnection(), sessionRecord(), auditRecord()]) {
      expect(() => normalizeToEcs(deepFreeze(input))).not.toThrow();
    }
  });

  it('refuses an unrecognised shape instead of answering an empty document', () => {
    for (const bad of [{}, { agent: 'Claude Code', pid: 7 }, { instanceId: INSTANCE_ID }]) {
      expect(() => normalizeToEcs(bad)).toThrow(TypeError);
      expect(() => normalizeToEcs(bad)).toThrow(/unrecognised event shape/);
    }
  });

  it('refuses a non-object argument', () => {
    for (const bad of [null, undefined, 'file-access', 42]) {
      expect(() => normalizeToEcs(bad)).toThrow(TypeError);
    }
  });
});

describe('ECS_VERSION', () => {
  it('agrees with the independent declaration in bench/lib/catalogue.js', () => {
    // bench may not import from src/ (an oracle sharing code with the sensor stops being
    // independent), so the constant is duplicated on purpose. This case is the only gate on it.
    expect(ECS_VERSION).toBe(catalogue.ECS_VERSION);
  });

  it('is written into every document', () => {
    for (const input of [fileEvent(), networkConnection(), sessionRecord(), auditRecord()]) {
      expect(normalizeToEcs(input).ecs).toEqual({ version: ECS_VERSION });
    }
  });
});
