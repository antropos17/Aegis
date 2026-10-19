import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import Module from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createToolContext } = require('../../src/main/tool-context-record');
const {
  projectRecord,
  replayRecord,
  MAX_RECORD_BYTES,
} = require('../../src/main/security-event-record');
const { createSecurityBatcher, createBatcher } = require('../../src/main/ipc-batcher');
const { FILE_ACCESS_BATCHER_OPTIONS } = require('../../src/main/file-access-batching');
const { candidate, result } = require('../fixtures/tool-context/capsule.cjs');
const roots = [];
const pipelines = [];
const audits = [];
const context = (id = 1) => createToolContext(result({ candidates: [candidate(id)] }));
// Independent wire expectations; never obtained from the projector under test.
const expectedContext = (id) => ({
  schemaVersion: 1,
  relation: 'preceded-by',
  strength: 'confirmed',
  reasons: ['exact-binding-object-and-interval'],
  candidateCount: 1,
  candidatesTruncated: false,
  ambiguous: false,
  objectMatch: 'matched',
  sessionBinding: 'confirmed',
  candidates: [
    {
      source: 'claude-code',
      sessionRef: 'a'.repeat(64),
      callRef: '0'.repeat(63) + id,
      toolName: 'Read',
      argsDigest: 'b'.repeat(64),
      argsShape: { operation: 'read', objectKind: 'path' },
      objectDigest: 'c'.repeat(64),
      startMs: 1000,
      endMs: 1500,
      deltaMs: 200,
      strength: 'confirmed',
      reasons: [],
    },
  ],
});
const spillRecords = (text) =>
  text
    .split('\n')
    .filter((line) => line.startsWith('['))
    .flatMap(JSON.parse);

const file = (toolContext) => ({
  agent: 'fixture',
  pid: 42,
  instanceId: '42:1000',
  file: '/fixture',
  action: 'accessed',
  sensitive: true,
  selfAccess: false,
  reason: 'synthetic',
  category: 'ai',
  timestamp: 1200,
  attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
  ...(toolContext === undefined ? {} : { toolContext }),
});
const input = (toolContext) => ({
  type: 'file-access',
  sensor: 'file-handle',
  timestamp: 1200,
  details: {
    agent: 'fixture',
    pid: 42,
    instanceId: '42:1000',
    action: 'accessed',
    path: '/fixture',
    severity: 'sensitive',
    attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
    ...(toolContext === undefined ? {} : { toolContext }),
  },
});
const directory = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-tool-custody-'));
  roots.push(root);
  return root;
};
function scan() {
  const original = Module._load;
  Module._load = function (request) {
    if (request === 'electron')
      return {
        app: { getPath: () => os.tmpdir() },
        safeStorage: { isEncryptionAvailable: () => false },
      };
    return original.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../../src/main/scan-loop')];
    return require('../../src/main/scan-loop');
  } finally {
    Module._load = original;
  }
}
afterEach(() => {
  for (const p of pipelines.splice(0)) p.destroy();
  for (const audit of audits.splice(0)) audit.shutdown();
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== os.tmpdir() || fs.lstatSync(root).isSymbolicLink())
      throw Error('unexpected-fixture-root');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('tool context custody across existing backend boundaries', () => {
  it('roundtrips closed metadata independently of actor attribution through projection/replay', () => {
    const capsule = context();
    const record = projectRecord(input(capsule));
    expect(record.details.toolContext).toEqual(capsule);
    expect(record.details.attribution.status).toBe('unattributed');
    const replayed = replayRecord(JSON.parse(JSON.stringify(record)));
    expect(replayed.details.toolContext).toEqual(capsule);
    expect(replayed.deliveryId).toBe(record.deliveryId);
    expect(replayed.replayed).toBe(true);
    expect(projectRecord(input()).details).not.toHaveProperty('toolContext');
  });

  it('retains underlying OS evidence and rejects raw capsule data before RAM/spill/replay', () => {
    const bad = { ...context(), arguments: 'PRIVATE_ARGUMENT', prompt: 'PRIVATE_PROMPT' };
    const record = projectRecord(input(bad));
    expect(record.details.path).toBe('/fixture');
    expect(record.details.toolContext.reasons).toEqual(['context-invalid']);
    expect(
      JSON.stringify(replayRecord({ ...record, details: { ...record.details, toolContext: bad } })),
    ).not.toContain('PRIVATE');
  });

  it('preserves valid base OS records when optional capsule bytes exceed remaining record budget', () => {
    const bare = input();
    bare.details.path = 'é'.repeat(31000);
    const base = projectRecord(bare);
    expect(Buffer.byteLength(JSON.stringify(base))).toBeLessThan(MAX_RECORD_BYTES);
    const large = createToolContext(
      result({ candidates: Array.from({ length: 8 }, (_, i) => candidate(i + 1)) }),
    );
    expect(
      Buffer.byteLength(
        JSON.stringify({ ...base, details: { ...base.details, toolContext: large } }),
      ),
    ).toBeGreaterThan(MAX_RECORD_BYTES);
    const combined = projectRecord({ ...bare, details: { ...bare.details, toolContext: large } });
    expect(combined.details.path).toBe(bare.details.path);
    expect(combined.details.toolContext).toMatchObject({
      strength: 'unattributed',
      candidateCount: 8,
      candidatesTruncated: true,
      ambiguous: true,
      candidates: [],
    });
    expect(combined.details.toolContext.reasons).toEqual([
      'ambiguous-tool-calls',
      'context-truncated',
      'context-unavailable',
    ]);
    expect(replayRecord(JSON.parse(JSON.stringify(combined))).details.toolContext).toEqual(
      combined.details.toolContext,
    );
    const delivered = [];
    const pipeline = createSecurityBatcher({
      directory: directory(),
      byteCapacity: MAX_RECORD_BYTES,
      intervalMs: 60000,
      consume: (rows) => {
        delivered.push(...rows);
        return true;
      },
    });
    pipelines.push(pipeline);
    expect(pipeline.push({ ...bare, details: { ...bare.details, toolContext: large } })).toBe(true);
    pipeline.flush();
    expect(delivered[0].details.toolContext).toEqual(combined.details.toolContext);
    expect(Buffer.byteLength(JSON.stringify(combined))).toBeLessThanOrEqual(MAX_RECORD_BYTES);
  });

  it('omits only optional metadata if even its compact marker cannot fit a valid base OS record', () => {
    const empty = projectRecord(input());
    const overhead =
      Buffer.byteLength(JSON.stringify(empty)) - Buffer.byteLength(empty.details.path);
    const pathValue = 'é'.repeat(Math.floor((MAX_RECORD_BYTES - overhead - 4) / 2));
    const record = projectRecord({
      ...input(context()),
      details: { ...input(context()).details, path: pathValue },
    });
    expect(record.details.path).toBe(pathValue);
    expect(record.details).not.toHaveProperty('toolContext');
    expect(() =>
      projectRecord({
        ...input(context()),
        details: { ...input(context()).details, path: 'é'.repeat(32768) },
      }),
    ).toThrow('record-oversize');
    expect(Buffer.byteLength(JSON.stringify(record))).toBeLessThanOrEqual(MAX_RECORD_BYTES);
  });
  it('keeps distinct associations visible while auditing before live dedup and rejecting invalid live capsules', () => {
    const loop = scan();
    const push = vi.fn();
    loop.init({ securityEvents: { push }, audit: { log: vi.fn() } });
    const a = file(context(1));
    const b = file(context(2));
    expect(loop.dedupFileEvent(a)).not.toBeNull();
    expect(loop.dedupFileEvent({ ...a })).toBeNull();
    expect(loop.dedupFileEvent(b)).not.toBeNull();
    expect(push).toHaveBeenCalledTimes(3);
    expect(
      push.mock.calls.map(([record]) => record.details.toolContext.candidates[0].callRef),
    ).toEqual([candidate(1).callRef, candidate(1).callRef, candidate(2).callRef]);
    const invalid = file({ ...context(), environment: 'PRIVATE_ENV' });
    expect(loop.dedupFileEvent(invalid).toolContext.reasons).toEqual(['context-invalid']);
    expect(JSON.stringify(push.mock.calls)).not.toContain('PRIVATE');
  });

  it('never merges truncated associations whose undisplayed candidates may differ', () => {
    const truncated = createToolContext(
      result({ candidates: Array.from({ length: 9 }, (_, i) => candidate(i + 1)) }),
    );
    const loop = scan();
    loop.init({ audit: { log: vi.fn() } });
    expect(loop.dedupFileEvent(file(truncated))).not.toBeNull();
    expect(loop.dedupFileEvent(file(truncated))).not.toBeNull();
    vi.useFakeTimers();
    const sent = [];
    const batcher = createBatcher(
      'file-access',
      (_channel, records) => sent.push(...records),
      FILE_ACCESS_BATCHER_OPTIONS,
    );
    pipelines.push(batcher);
    const ev = { ...file(truncated), sensitive: false, selfAccess: true };
    batcher.push({ ...ev });
    batcher.push({ ...ev });
    batcher.flush();
    expect(sent).toHaveLength(2);
  });
  it('coalesces equivalent self-churn but retains materially different capsule associations', () => {
    vi.useFakeTimers();
    const sent = [];
    const batcher = createBatcher(
      'file-access',
      (_channel, records) => sent.push(...records),
      FILE_ACCESS_BATCHER_OPTIONS,
    );
    pipelines.push(batcher);
    const benign = (id) => ({ ...file(context(id)), sensitive: false, selfAccess: true });
    batcher.push(benign(1));
    batcher.push(benign(1));
    batcher.push(benign(2));
    batcher.flush();
    expect(sent).toHaveLength(2);
    expect(sent.map((ev) => ev.toolContext.candidates[0].callRef)).toEqual([
      candidate(1).callRef,
      candidate(2).callRef,
    ]);
  });

  it('preserves direct audit and sensitive scan capsules through canonical hash-chained writes', async () => {
    delete require.cache[require.resolve('../../src/main/audit-logger')];
    const audit = require('../../src/main/audit-logger');
    audits.push(audit);
    audit.init({ userDataPath: directory() });
    await audit._awaitIndexForTest();
    const loop = scan();
    loop.init({ audit });
    loop.logAuditForFile(file(context(1)));
    audit.flush();
    expect(audit.persistBatch([projectRecord(input(context(2)))])).toBe(true);
    const names = fs.readdirSync(audit.getLogDir()).filter((n) => n.endsWith('.json'));
    const target = path.join(audit.getLogDir(), names[0]);
    const rows = fs.readFileSync(target, 'utf8').trim().split('\n').map(JSON.parse);
    expect(rows.map((r) => r.toolContext?.candidates[0]?.callRef)).toEqual([
      candidate(1).callRef,
      candidate(2).callRef,
    ]);
    expect(rows.every((r) => r.attribution.status === 'unattributed')).toBe(true);
    const exported = audit.exportAll();
    expect(exported.map((r) => r.toolContext?.candidates[0]?.callRef)).toEqual([
      candidate(1).callRef,
      candidate(2).callRef,
    ]);
    const historical = audit.getEntriesBefore('9999-12-31T23:59:59Z', 10);
    expect(historical.map((r) => r.toolContext?.candidates[0]?.callRef).sort()).toEqual(
      [candidate(1).callRef, candidate(2).callRef].sort(),
    );
    expect(JSON.stringify({ exported, historical })).not.toContain('PRIVATE');
    expect(audit.verifyChain(target).valid).toBe(true);
  });

  it.each([true, false])(
    'preserves the closed network capsule through custody=%s and live delivery',
    async (custody) => {
      const loop = scan();
      const push = vi.fn();
      const log = vi.fn();
      const sent = vi.fn();
      const agents = [{ pid: 42, instanceId: '42:1000', startTime: 1000 }];
      const conn = {
        ...file(context()),
        agent: custody ? 'fixture' : '',
        remoteIp: '127.0.0.1',
        remotePort: 443,
        domain: 'fixture.invalid',
        state: 'ESTABLISHED',
        flagged: false,
        httpUnencrypted: false,
      };
      loop.init({
        network: {
          isNetworkScanRunning: () => false,
          setNetworkScanRunning: vi.fn(),
          scanNetworkConnections: () => Promise.resolve([conn]),
        },
        baselines: { recordNetworkEndpoint: vi.fn() },
        audit: { log },
        securityEvents: { push },
        logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
        setLatestNetConnections: vi.fn(),
        getLatestAgents: () => agents,
        sendToRenderer: sent,
      });
      loop.doNetworkScan();
      await vi.waitFor(() => expect(sent).toHaveBeenCalledWith('network-update', [conn]));
      const saved = custody ? push.mock.calls[0][0].details : log.mock.calls[0][1];
      expect(saved.toolContext).toEqual(context());
      expect(conn.toolContext).toEqual(context());
      expect(saved.attribution.status).toBe('unattributed');
    },
  );
  it('keeps incomplete evidence downgraded and coercion payloads private through audit and disk replay', async () => {
    const partial = createToolContext(
      result({
        candidates: [
          candidate(1, {
            endMs: null,
            reasons: ['end-time-unavailable'],
          }),
        ],
      }),
    );
    let coerced = 0;
    const contradictoryHistorical = {
      ...context(),
      candidates: [candidate(1, { endMs: null, reasons: ['end-time-unavailable'] })],
    };
    const capsules = [partial, contradictoryHistorical];
    for (const key of ['source', 'toolName']) {
      const literal = key === 'source' ? 'claude-code' : 'Read';
      const hostile = {
        prompt: 'PRIVATE_COERCION',
        toString() {
          coerced++;
          return literal;
        },
      };
      const jsonObject = JSON.parse('{"prompt":"PRIVATE_JSON","toString":"' + literal + '"}');
      for (const value of [[literal], hostile, jsonObject])
        capsules.push({ ...context(), candidates: [candidate(1, { [key]: value })] });
    }
    const store = directory();
    const first = createSecurityBatcher({
      directory: store,
      capacity: 1,
      byteCapacity: 8192,
      intervalMs: 60000,
      consume: () => false,
    });
    pipelines.push(first);
    for (const capsule of capsules) expect(first.push(input(capsule))).toBe(true);
    first.destroy();
    pipelines.pop();
    const spilled = fs
      .readdirSync(store)
      .filter((n) => n.endsWith('.spill'))
      .sort()
      .map((n) => fs.readFileSync(path.join(store, n), 'utf8'))
      .join('\n');
    expect(spilled).not.toContain('PRIVATE');
    const pending = spillRecords(spilled);
    expect(pending).toHaveLength(8);
    const expectedIds = pending.map((r) => r.deliveryId);
    expect(new Set(expectedIds).size).toBe(8);
    expect(expectedIds.every((id) => /^[a-f0-9-]{36}$/.test(id))).toBe(true);
    delete require.cache[require.resolve('../../src/main/audit-logger')];
    const audit = require('../../src/main/audit-logger');
    audits.push(audit);
    audit.init({ userDataPath: directory() });
    await audit._awaitIndexForTest();
    for (const capsule of capsules) audit.log('file-access', input(capsule).details);
    audit.flush();
    const seen = [];
    const restart = createSecurityBatcher({
      directory: store,
      intervalMs: 60000,
      consume: (rows) => {
        seen.push(...rows);
        return audit.persistBatch(rows);
      },
    });
    pipelines.push(restart);
    restart.flush();
    expect(restart.getStats().spill.records).toBe(0);
    const expectedPartial = {
      ...expectedContext(1),
      strength: 'inferred',
      sessionBinding: 'unavailable',
      reasons: ['end-time-unavailable', 'exact-binding-object-and-interval'],
      candidates: [
        {
          ...expectedContext(1).candidates[0],
          strength: 'inferred',
          endMs: null,
          reasons: ['end-time-unavailable'],
        },
      ],
    };
    const expectedInvalid = {
      schemaVersion: 1,
      relation: 'preceded-by',
      strength: 'unattributed',
      reasons: ['context-invalid'],
      candidateCount: 0,
      candidatesTruncated: false,
      ambiguous: false,
      objectMatch: 'unavailable',
      sessionBinding: 'unavailable',
      candidates: [],
    };
    const expectedCapsules = [expectedPartial, ...Array(7).fill(expectedInvalid)];
    const delivered = seen.filter((r) => r.type === 'file-access');
    expect(delivered).toHaveLength(8);
    expect(delivered.map((r) => r.deliveryId)).toEqual(expectedIds);
    expect(delivered.map((r) => r.details.toolContext)).toEqual(expectedCapsules);
    const rows = audit.exportAll().filter((r) => r.type === 'file-access');
    expect(rows).toHaveLength(16);
    expect(rows.map((r) => r.toolContext)).toEqual([...expectedCapsules, ...expectedCapsules]);
    expect(rows.map((r) => r.path)).toEqual(Array(16).fill('/fixture'));
    expect(rows.slice(0, 8).map((r) => r.details)).toEqual(Array(8).fill(null));
    expect(rows.slice(8).map((r) => r.details.replayed)).toEqual(Array(8).fill(true));
    expect(rows.slice(8).map((r) => r.details.deliveryId)).toEqual(expectedIds);
    expect(coerced).toBe(0);
    expect(JSON.stringify({ seen, rows })).not.toContain('PRIVATE');
    const target = path.join(
      audit.getLogDir(),
      fs.readdirSync(audit.getLogDir()).find((n) => n.endsWith('.json')),
    );
    expect(audit.verifyChain(target).valid).toBe(true);
  });

  it('retains bounded context through actual disk spill/restart replay and canonical audit acknowledgement', async () => {
    const store = directory();
    const first = createSecurityBatcher({
      directory: store,
      capacity: 1,
      byteCapacity: 8192,
      intervalMs: 60000,
      consume: () => false,
    });
    pipelines.push(first);
    expect(first.push(input(context(1)))).toBe(true);
    expect(first.push(input(context(2)))).toBe(true);
    first.destroy();
    pipelines.pop();
    const spilled = fs
      .readdirSync(store)
      .filter((n) => n.endsWith('.spill'))
      .sort()
      .map((n) => fs.readFileSync(path.join(store, n), 'utf8'))
      .join('\n');
    expect(spilled).toContain('toolContext');
    expect(spilled).not.toContain('PRIVATE');
    const pending = spillRecords(spilled);
    const expectedCapsules = [expectedContext(1), expectedContext(2)];
    expect(pending).toHaveLength(2);
    const expectedIds = pending.map((r) => r.deliveryId);
    expect(new Set(expectedIds).size).toBe(2);
    expect(expectedIds.every((id) => /^[a-f0-9-]{36}$/.test(id))).toBe(true);
    expect(pending.map((r) => r.details.toolContext)).toEqual(expectedCapsules);
    delete require.cache[require.resolve('../../src/main/audit-logger')];
    const audit = require('../../src/main/audit-logger');
    audits.push(audit);
    audit.init({ userDataPath: directory() });
    await audit._awaitIndexForTest();
    const seen = [];
    const restart = createSecurityBatcher({
      directory: store,
      intervalMs: 60000,
      consume: (rows) => {
        seen.push(...rows);
        return audit.persistBatch(rows);
      },
    });
    pipelines.push(restart);
    restart.flush();
    expect(restart.getStats().spill.records).toBe(0);
    const delivered = seen.filter((r) => r.type === 'file-access');
    expect(delivered).toHaveLength(2);
    expect(delivered.map((r) => r.deliveryId)).toEqual(expectedIds);
    expect(delivered.map((r) => r.details.toolContext)).toEqual(expectedCapsules);
    const target = path.join(
      audit.getLogDir(),
      fs.readdirSync(audit.getLogDir()).find((n) => n.endsWith('.json')),
    );
    const original = fs.readFileSync(target, 'utf8');
    const rows = original.trim().split('\n').map(JSON.parse);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.type)).toEqual(['file-access', 'file-access']);
    expect(rows.map((r) => r.details.deliveryId)).toEqual(expectedIds);
    expect(rows.map((r) => r.toolContext)).toEqual(expectedCapsules);
    expect(rows.map((r) => r.details.replayed)).toEqual([true, true]);
    const exported = audit.exportAll();
    expect(exported).toHaveLength(2);
    expect(exported.map((r) => r.details.deliveryId)).toEqual(expectedIds);
    expect(exported.map((r) => r.toolContext)).toEqual(expectedCapsules);
    expect(audit.verifyChain(target).valid).toBe(true);
    // Alter just one persisted capsule value; ordinary OS evidence and stored hashes stay intact.
    const tampered = original.replace('"deltaMs":200', '"deltaMs":201');
    expect(tampered).not.toBe(original);
    fs.writeFileSync(target, tampered);
    const changed = fs.readFileSync(target, 'utf8').trim().split('\n').map(JSON.parse);
    const withoutContext = (r) => {
      const copy = { ...r };
      delete copy.toolContext;
      return copy;
    };
    expect(changed.map(withoutContext)).toEqual(rows.map(withoutContext));
    expect(changed.map((r) => r.path)).toEqual(['/fixture', '/fixture']);
    expect(changed[0].toolContext.candidates[0].deltaMs).toBe(201);
    expect(audit.verifyChain(target)).toEqual({
      valid: false,
      brokenAtSeq: 0,
      reason: 'hash mismatch at seq 0',
    });
  });
});
