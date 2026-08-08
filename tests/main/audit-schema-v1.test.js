/**
 * @file audit-schema-v1.test.js
 * @description Event Schema v1: the versioned record envelope, identity and attribution as
 *   top-level fields, and the read normalizer for pre-v1 records.
 *
 *   The central premise is pinned by an executable test rather than an argument: a daily file
 *   holding BOTH v0 and v1 records verifies end to end. That is what makes the schema change
 *   safe, and it is the claim the old "keep it in `details` so the chain is unchanged"
 *   comments got wrong.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { normalizeAuditEntry } from '../../src/main/audit-normalize.js';
import * as hashchainNs from '../../src/main/audit-hashchain.js';
import { deriveStatus, EVIDENCE, EVIDENCE_CODES } from '../../src/main/attribution.js';

const hashchain = hashchainNs.default || hashchainNs;

describe('event schema v1 — record shape', () => {
  let auditLogger;
  let tmpDir;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-schema-v1-'));
    vi.resetModules();
    const mod = await import('../../src/main/audit-logger.js');
    auditLogger = mod.default;
  });

  afterEach(() => {
    auditLogger.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const auditDir = () => path.join(tmpDir, 'audit-logs');

  function readLines() {
    const name = fs.readdirSync(auditDir()).find((f) => f.endsWith('.json'));
    return fs
      .readFileSync(path.join(auditDir(), name), 'utf-8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
  }

  it('stamps schemaVersion and carries identity + attribution at top level', () => {
    auditLogger.init({ userDataPath: tmpDir });
    auditLogger.log('network-connection', {
      agent: 'claude',
      pid: 4242,
      instanceId: '4242:1780000000000',
      action: 'ESTABLISHED',
      path: '1.2.3.4:443',
      severity: 'normal',
      attribution: { status: 'confirmed', evidence: [EVIDENCE.OS_TCP_OWNER_PID] },
      extra: { domain: 'api.anthropic.com' },
    });
    auditLogger.flush();

    const [rec] = readLines();
    expect(rec.schemaVersion).toBe(1);
    expect(rec.pid).toBe(4242);
    expect(rec.instanceId).toBe('4242:1780000000000');
    expect(rec.attribution).toEqual({
      status: 'confirmed',
      evidence: ['os-tcp-owner-pid'],
    });
    // The event-specific extras still live in `details`; only identity and attribution moved.
    expect(rec.details).toEqual({ domain: 'api.anthropic.com' });
  });

  it('keeps a missing pid as null and a real pid 0 as 0', () => {
    // pid 0 is a REAL value — a synthetic, process-less agent. `|| 0` would turn a missing
    // pid into a false synthetic-agent claim, and `|| null` would erase a genuine 0.
    auditLogger.init({ userDataPath: tmpDir });
    auditLogger.log('agent-enter', { agent: 'Kilo Code', pid: 0, instanceId: '0:Kilo Code' });
    auditLogger.log('anomaly-alert', { agent: 'claude' });
    auditLogger.flush();

    const [synthetic, noPid] = readLines();
    expect(synthetic.pid).toBe(0);
    expect(synthetic.instanceId).toBe('0:Kilo Code');
    expect(noPid.pid).toBeNull();
    expect(noPid.instanceId).toBeNull();
  });

  it('distinguishes "question does not apply" from "owner unknown"', () => {
    auditLogger.init({ userDataPath: tmpDir });
    // No attribution passed at all -> null: the ownership question does not apply.
    auditLogger.log('agent-exit', { agent: 'claude', pid: 7 });
    // Attribution passed with an unattributed status -> the question applies, owner unknown.
    auditLogger.log('file-access', {
      agent: '',
      attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
    });
    auditLogger.flush();

    const [exit, file] = readLines();
    expect(exit.attribution).toBeNull();
    expect(file.attribution.status).toBe('unattributed');
  });

  it('versions the internally-generated loss marker too', () => {
    auditLogger.init({ userDataPath: tmpDir, bufferCap: 2 });
    for (const agent of ['A', 'B', 'C']) auditLogger.log('t', { agent });
    auditLogger.flush();

    const marker = readLines().find((l) => l.type === 'buffer-overflow-drop');
    expect(marker.schemaVersion).toBe(1);
    // Nothing owns this record, so every identity field is empty rather than invented,
    // and attribution is null because there is no owner to resolve.
    expect(marker.agent).toBe('');
    expect(marker.pid).toBeNull();
    expect(marker.instanceId).toBeNull();
    expect(marker.attribution).toBeNull();
  });

  it('verifies a daily file that holds BOTH v0 and v1 records', () => {
    // The premise of the whole change. Written by hand because the logger can no longer
    // produce a v0 record: verifyChain rebuilds each record's preimage from that record's
    // OWN stored fields, so the two shapes coexist.
    auditLogger.init({ userDataPath: tmpDir });
    auditLogger.log('file-access', { agent: 'claude', pid: 1 });
    auditLogger.flush();

    const name = fs.readdirSync(auditDir()).find((f) => f.endsWith('.json'));
    const fp = path.join(auditDir(), name);

    const seed = hashchain.seedFromTail(fp);
    const v0 = {
      timestamp: '2026-07-30T09:00:00.000Z',
      type: 'file-access',
      agent: 'legacy',
      action: 'read',
      path: '/tmp/old',
      severity: 'normal',
      riskScore: 0,
      details: { attribution: 'confirmed' },
    };
    const hash = hashchain.computeHash(seed.prevHash, v0);
    fs.appendFileSync(fp, JSON.stringify({ ...v0, seq: seed.seq, hash }) + '\n', 'utf-8');

    expect(hashchain.verifyChain(fp)).toEqual({
      valid: true,
      brokenAtSeq: null,
      reason: 'ok',
    });
    const lines = readLines();
    expect(lines.map((l) => l.seq)).toEqual([0, 1]);
    expect(lines[0].schemaVersion).toBe(1);
    expect(lines[1].schemaVersion).toBeUndefined();
  });

  it('normalizes v0 records on the paginated read path but not on export', () => {
    auditLogger.init({ userDataPath: tmpDir });
    auditLogger.log('file-access', { agent: 'claude' });
    auditLogger.flush();

    const name = fs.readdirSync(auditDir()).find((f) => f.endsWith('.json'));
    const fp = path.join(auditDir(), name);
    const seed = hashchain.seedFromTail(fp);
    const v0 = {
      timestamp: '2026-07-30T09:00:00.000Z',
      type: 'file-access',
      agent: 'legacy',
      action: 'read',
      path: '/tmp/old',
      severity: 'normal',
      riskScore: 0,
      details: { attribution: 'inferred', instanceId: '99:123', pid: 99 },
    };
    const hash = hashchain.computeHash(seed.prevHash, v0);
    fs.appendFileSync(fp, JSON.stringify({ ...v0, seq: seed.seq, hash }) + '\n', 'utf-8');

    const paginated = auditLogger.getEntriesBefore('9999-01-01T00:00:00.000Z', 100);
    const legacy = paginated.find((e) => e.agent === 'legacy');
    expect(legacy.pid).toBe(99);
    expect(legacy.instanceId).toBe('99:123');
    expect(legacy.attribution).toEqual({ status: 'inferred', evidence: null });

    // exportAll is forensic: it must show what is actually on disk.
    const rawLegacy = auditLogger.exportAll().find((e) => e.agent === 'legacy');
    expect(rawLegacy.attribution).toBeUndefined();
    expect(rawLegacy.details.attribution).toBe('inferred');
  });
});

// `instanceId` is only useful if the call sites actually populate it. The logger
// stores whatever it is handed, so these drive the two scan-loop sites that build a
// record out of a live event and assert what reaches the logger — the key when the
// event has one, `null` when it does not.
describe('event schema v1 — instanceId on the scan-loop call sites', () => {
  const require_ = createRequire(import.meta.url);
  let scanLoop;
  let auditLog;

  beforeEach(() => {
    delete require_.cache[require_.resolve('../../src/main/scan-loop.js')];
    scanLoop = require_('../../src/main/scan-loop.js');
    auditLog = vi.fn();
  });

  /** @returns {Object} minimal deps for doNetworkScan */
  function netDeps(connections) {
    return {
      audit: { log: auditLog },
      baselines: { recordNetworkEndpoint: vi.fn() },
      logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
      network: {
        isNetworkScanRunning: () => false,
        setNetworkScanRunning: vi.fn(),
        scanNetworkConnections: vi.fn().mockResolvedValue(connections),
      },
      getLatestAgents: () => [{ agent: 'Claude Code', pid: 100 }],
      setLatestNetConnections: vi.fn(),
      sendToRenderer: vi.fn(),
    };
  }

  /** @returns {Promise<void>} let the scanNetworkConnections promise chain settle */
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  describe('file-access / config-access', () => {
    // `logAuditForFile` reaches for nothing but the audit sink, so every test here
    // drives it through the same minimal init.
    beforeEach(() => {
      scanLoop.init({ audit: { log: auditLog } });
    });

    it('carries the key the file event was stamped with', () => {
      scanLoop.logAuditForFile({
        agent: 'Claude Code',
        pid: 100,
        instanceId: '100:1700000000111',
        action: 'accessed',
        file: '/home/user/.ssh/id_rsa',
        sensitive: true,
        reason: 'SSH keys/config',
        attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
      });
      expect(auditLog.mock.calls[0][1].instanceId).toBe('100:1700000000111');
    });

    // An `inferred` event has a real owner from its own tick, so it has a real key.
    // Gating the record on `confirmed` would blank every chokidar-sourced entry.
    it('carries the key on an inferred config-access too', () => {
      scanLoop.logAuditForFile({
        agent: 'Cursor',
        pid: 200,
        instanceId: '200:1700000000222',
        action: 'modified',
        file: '/home/user/.cursor/settings.json',
        sensitive: false,
        reason: 'AI agent config — Cursor',
        attribution: { status: 'inferred', evidence: ['self-config-path'] },
      });
      const [type, record] = auditLog.mock.calls[0];
      expect(type).toBe('config-access');
      expect(record.instanceId).toBe('200:1700000000222');
    });

    it('stays null for an unattributed event', () => {
      scanLoop.logAuditForFile({
        agent: '',
        pid: null,
        instanceId: null,
        action: 'modified',
        file: '/home/user/.ssh/id_rsa',
        sensitive: true,
        reason: 'SSH keys/config',
        attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
      });
      expect(auditLog.mock.calls[0][1].instanceId).toBeNull();
    });

    // A pre-v0.12.0 activity-log entry has no such field at all. `undefined` must not
    // reach the record — the schema says `string | null`.
    it('stays null for an event that predates the field', () => {
      scanLoop.logAuditForFile({
        agent: 'Claude Code',
        action: 'read',
        file: '/home/user/.bashrc',
        sensitive: false,
        reason: '',
      });
      expect(auditLog.mock.calls[0][1].instanceId).toBeNull();
    });
  });

  describe('network-connection', () => {
    it('carries the key the connection was stamped with', async () => {
      scanLoop.init(
        netDeps([
          {
            agent: 'Claude Code',
            pid: 100,
            instanceId: '100:1700000000111',
            remoteIp: '1.2.3.4',
            remotePort: 443,
            state: 'ESTABLISHED',
            flagged: false,
            domain: 'api.anthropic.com',
          },
        ]),
      );
      scanLoop.doNetworkScan();
      await settle();
      expect(auditLog.mock.calls[0][1].instanceId).toBe('100:1700000000111');
    });

    it('stays null for a connection that matched no agent', async () => {
      scanLoop.init(
        netDeps([
          {
            agent: '',
            pid: 999,
            instanceId: null,
            remoteIp: '8.8.8.8',
            remotePort: 53,
            state: 'ESTABLISHED',
            flagged: true,
            domain: '',
          },
        ]),
      );
      scanLoop.doNetworkScan();
      await settle();
      const record = auditLog.mock.calls[0][1];
      expect(record.agent).toBe('');
      expect(record.pid).toBe(999);
      expect(record.instanceId).toBeNull();
    });

    // The reason the audit trail needed this at all: two live instances of one agent
    // wrote two records that were indistinguishable once the pid was recycled.
    it('writes two different keys for two same-name instances', async () => {
      scanLoop.init(
        netDeps([
          {
            agent: 'Claude Code',
            pid: 100,
            instanceId: '100:1700000000111',
            remoteIp: '1.2.3.4',
            remotePort: 443,
            state: 'ESTABLISHED',
            flagged: false,
            domain: '',
          },
          {
            agent: 'Claude Code',
            pid: 200,
            instanceId: '200:1700000000222',
            remoteIp: '5.6.7.8',
            remotePort: 443,
            state: 'ESTABLISHED',
            flagged: false,
            domain: '',
          },
        ]),
      );
      scanLoop.doNetworkScan();
      await settle();
      const keys = auditLog.mock.calls.map((c) => c[1].instanceId);
      expect(keys).toEqual(['100:1700000000111', '200:1700000000222']);
      expect(new Set(keys).size).toBe(2);
    });
  });
});

describe('normalizeAuditEntry', () => {
  it('returns a v1 record untouched', () => {
    const v1 = { schemaVersion: 1, agent: 'a', pid: 1, instanceId: 'x', attribution: null };
    expect(normalizeAuditEntry(v1)).toBe(v1);
  });

  it('reports evidence as null — never recorded is not the same as recorded empty', () => {
    const out = normalizeAuditEntry({
      timestamp: 't',
      type: 'file-access',
      details: { attribution: 'confirmed' },
    });
    expect(out.attribution).toEqual({ status: 'confirmed', evidence: null });
    expect(out.attribution.evidence).not.toEqual([]);
  });

  it('never back-fills an attribution that was not recorded', () => {
    // Pre-v0.11.0 records predate attribution entirely, and loss markers never had an
    // owner. Stamping 'unattributed' here would assert a determination nobody made.
    for (const entry of [
      { timestamp: 't', type: 'file-access', details: null },
      { timestamp: 't', type: 'file-access' },
      { timestamp: 't', type: 'buffer-overflow-drop', details: { droppedCount: 3 } },
      { timestamp: 't', type: 'file-access', details: { attribution: { status: 'confirmed' } } },
    ]) {
      expect(normalizeAuditEntry(entry).attribution).toBeNull();
    }
  });

  it('leaves the promoted keys in details, so the view matches the file', () => {
    const out = normalizeAuditEntry({
      timestamp: 't',
      type: 'agent-enter',
      details: { pid: 5, instanceId: '5:9' },
    });
    expect(out.pid).toBe(5);
    expect(out.details.pid).toBe(5);
  });

  it('does not choke on a non-object', () => {
    expect(normalizeAuditEntry(null)).toBeNull();
    expect(normalizeAuditEntry('nonsense')).toBe('nonsense');
  });
});

describe('os-tcp-owner-pid evidence code', () => {
  it('is registered and derives to confirmed', () => {
    expect(EVIDENCE.OS_TCP_OWNER_PID).toBe('os-tcp-owner-pid');
    expect(EVIDENCE_CODES).toContain('os-tcp-owner-pid');
    expect(deriveStatus(['os-tcp-owner-pid'])).toBe('confirmed');
  });

  it('is as strong as the other kernel-reported pid codes', () => {
    // All three are "the OS told us this pid owns the resource" — no reason to rank them.
    expect(deriveStatus(['os-tcp-owner-pid'])).toBe(deriveStatus(['handle-scan-pid']));
    expect(deriveStatus(['os-tcp-owner-pid'])).toBe(deriveStatus(['rm-holder-pid']));
  });

  it('still rejects a typo, so a bad code cannot silently degrade an event', () => {
    expect(() => deriveStatus(['os-tcp-owner-pdi'])).toThrow(/unknown evidence code/);
  });
});
