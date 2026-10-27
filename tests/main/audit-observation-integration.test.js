import { afterEach, beforeEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import Module from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createSecurityBatcher } = require('../../src/main/ipc-batcher');
const { createLiveToolContext } = require('../../src/main/live-tool-context');
const { auditOrigin } = require('../../src/main/audit-observation-identity');
const auditIndex = require('../../src/main/audit-index');
let root, audit, pipeline, scanLoop, custody;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-audit-integration-'));
  delete require.cache[require.resolve('../../src/main/audit-logger')];
  delete require.cache[require.resolve('../../src/main/scan-loop')];
  const originalLoad = Module._load;
  try {
    Module._load = function (name) {
      if (name === 'electron')
        return {
          app: { getPath: () => root },
          safeStorage: { isEncryptionAvailable: () => false },
        };
      return originalLoad.apply(this, arguments);
    };
    audit = require('../../src/main/audit-logger');
    scanLoop = require('../../src/main/scan-loop');
  } finally {
    Module._load = originalLoad;
  }
  audit.init({ userDataPath: root });
  await audit._awaitIndexForTest();
  pipeline = createSecurityBatcher({
    directory: path.join(root, 'spill'),
    capacity: 4,
    intervalMs: 60000,
    consume: audit.persistBatch,
  });
  custody = createLiveToolContext({ getAgents: () => [] });
  scanLoop.init({
    audit,
    securityEvents: pipeline,
    prepareFileObservation: custody.prepare,
  });
});

afterEach(() => {
  pipeline?.destroy();
  scanLoop?.stopScanIntervals();
  audit?.shutdown();
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
  fs.rmSync(root, { recursive: true, force: true });
});

const event = (id) => ({
  eventId: id,
  timestamp: Date.now(),
  pid: 123,
  instanceId: '123:100',
  agent: 'Claude Code',
  file: path.join(root, 'fixture.txt'),
  action: 'read',
  sensitive: true,
  attribution: { status: 'unattributed', evidence: [] },
  unrelatedPrivateData: 'DO_NOT_COPY_TO_AUDIT',
});

function rows() {
  pipeline.flush();
  const name = fs.readdirSync(audit.getLogDir()).find((item) => item.endsWith('.json'));
  const target = path.join(audit.getLogDir(), name);
  expect(audit.verifyChain(target).valid).toBe(true);
  expect(audit.getStats().index.state).toBe('ready');
  return audit.getEntriesBefore('2099-12-31T23:59:59.999Z', 100);
}

it('binds the exact sensitive ingress to its durable row while a distinct deduped observation remains unavailable', async () => {
  const first = event('11111111-1111-4111-8111-111111111111');
  const accepted = scanLoop.dedupFileEvent(first);
  expect(accepted).toBe(first);
  custody.record(accepted);
  scanLoop.logAuditForFile(accepted);
  const second = event('22222222-2222-4222-8222-222222222222');
  expect(scanLoop.dedupFileEvent(second)).toBeNull();
  const saved = rows();
  expect(saved).toHaveLength(2);
  expect(saved[0].details.auditIdentity.eventId).toBe(first.eventId);
  expect(saved[1].details.auditIdentity.eventId).toBe(second.eventId);
  expect(saved[0].details.deliveryId).not.toBe(first.eventId);
  expect(saved[0].details.deliveryId).not.toBe(saved[1].details.deliveryId);
  const proof = await audit.captureObservationProof(saved);
  expect(custody.auditLookup(saved[0], proof)).toBe('audit:' + saved[0].details.auditIdentity.token);
  expect(custody.auditLookup(saved[1], proof)).toBeNull();
  expect(createLiveToolContext({ getAgents: () => [] }).auditLookup(saved[0], proof)).toBeNull();
  expect(JSON.stringify(saved)).not.toContain('DO_NOT_COPY_TO_AUDIT');
});

it.each([
  ['a different valid token', '66666666-6666-4666-8666-666666666666', false],
  ['a malformed token', 'invalid-token', true],
])('rejects an indexed duplicate observation with %s', async (_description, token, malformed) => {
  const accepted = scanLoop.dedupFileEvent(event('55555555-5555-4555-8555-555555555555'));
  custody.record(accepted);
  const original = rows()[0];
  expect((await audit.captureObservationProof([original])).unique(original)).toBe(true);
  const duplicate = structuredClone(original);
  duplicate.details.auditIdentity.token = token;
  const name = 'aegis-audit-2000-01-01.json';
  const target = path.join(audit.getLogDir(), name);
  const line = JSON.stringify(duplicate);
  fs.writeFileSync(target, line + '\n');
  const stat = fs.statSync(target);
  auditIndex.writeBatch({ file: name, fileDate: '2000-01-01', firstLineNo: 0,
    lines: [line], indexedBytes: stat.size, sizeBytes: stat.size, mtimeMs: stat.mtimeMs });
  const proof = await audit.captureObservationProof([original]);
  if (malformed) expect(proof).toBeNull();
  else expect(proof.unique(original)).toBe(false);
  expect(custody.auditLookup(original, proof)).toBeNull();
});

it('distinguishes equal seq/hash rows in different files while repeated reads of one row remain stable', async () => {
  const accepted = scanLoop.dedupFileEvent(event('33333333-3333-4333-8333-333333333333'));
  custody.record(accepted);
  const first = rows()[0];
  const same = audit.getEntriesBefore('2099-12-31T23:59:59.999Z', 100)[0];
  expect(auditOrigin(first)).toBeTruthy();
  expect(auditOrigin(same)).toBe(auditOrigin(first));
  const initialProof = await audit.captureObservationProof([first, same]);
  expect(initialProof).not.toBeNull();
  expect(initialProof.unique(first)).toBe(true);
  expect(initialProof.unique(same)).toBe(true);
  expect(custody.auditLookup(first, initialProof)).toBe('audit:' + first.details.auditIdentity.token);
  expect(custody.auditLookup(same, initialProof)).toBe('audit:' + first.details.auditIdentity.token);
  expect(Object.getOwnPropertySymbols(first)).toEqual([]);
  expect(JSON.stringify(first)).not.toContain(auditOrigin(first));
  expect(auditOrigin(structuredClone(first))).toBeNull();
  expect(Object.keys(first)).not.toContain('file');
  expect(Object.keys(first)).not.toContain('line_no');

  const originalName = fs.readdirSync(audit.getLogDir()).find((name) => name.endsWith('.json'));
  const original = path.join(audit.getLogDir(), originalName);
  const copiedName = 'aegis-audit-2000-01-01.json';
  const copy = path.join(audit.getLogDir(), copiedName);
  fs.copyFileSync(original, copy, fs.constants.COPYFILE_EXCL);
  const line = fs.readFileSync(copy, 'utf8').trim();
  const stat = fs.statSync(copy);
  auditIndex.writeBatch({
    file: copiedName,
    fileDate: '2000-01-01',
    firstLineNo: 0,
    lines: [line],
    indexedBytes: stat.size,
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
  });
  const duplicates = audit.getEntriesBefore('2099-12-31T23:59:59.999Z', 100);
  expect(duplicates).toHaveLength(2);
  expect(duplicates[0].seq).toBe(duplicates[1].seq);
  expect(duplicates[0].hash).toBe(duplicates[1].hash);
  expect(auditOrigin(duplicates[0])).not.toBe(auditOrigin(duplicates[1]));
  const duplicateProof = await audit.captureObservationProof(duplicates);
  expect(duplicateProof).not.toBeNull();
  expect(duplicateProof.unique(duplicates[0])).toBe(false);
  expect(duplicateProof.unique(duplicates[1])).toBe(false);
  const other = duplicates.find((row) => auditOrigin(row) !== auditOrigin(first));
  expect(custody.auditLookup(other, duplicateProof)).toBeNull();
  expect(custody.auditLookup(first, duplicateProof)).toBeNull();
});

it('fails closed for JSONL fallback rows without inventing a physical origin', async () => {
  const accepted = scanLoop.dedupFileEvent(event('44444444-4444-4444-8444-444444444444'));
  custody.record(accepted);
  const indexed = rows()[0];
  const proof = await audit.captureObservationProof([indexed]);
  expect(custody.auditLookup(indexed, proof)).toBe('audit:' + indexed.details.auditIdentity.token);
  audit.shutdown();
  audit.init({ userDataPath: root, loadSqlite: () => null });
  await audit._awaitIndexForTest();
  expect(audit.getStats().index.state).toBe('unavailable');
  const fallback = audit.getEntriesBefore('2099-12-31T23:59:59.999Z', 100)[0];
  expect(fallback.details.auditIdentity).toEqual(indexed.details.auditIdentity);
  expect(auditOrigin(fallback)).toBeNull();
  expect(custody.auditLookup(fallback, proof)).toBeNull();
  expect(await audit.captureObservationProof([fallback])).toBeNull();
});

it('refuses uniqueness proof when the canonical log changes outside its ready index', async () => {
  const accepted = scanLoop.dedupFileEvent(event('55555555-5555-4555-8555-555555555555'));
  custody.record(accepted);
  const indexed = rows()[0];
  expect((await audit.captureObservationProof([indexed]))?.unique(indexed)).toBe(true);
  const name = fs.readdirSync(audit.getLogDir()).find((item) => item.endsWith('.json'));
  const target = path.join(audit.getLogDir(), name);
  fs.appendFileSync(target, '{"partial":');
  expect(audit.getStats().index.state).toBe('ready');
  expect(await audit.captureObservationProof([indexed])).toBeNull();
});

it('refuses uniqueness proof when indexed raw data disagrees with canonical bytes', async () => {
  const accepted = scanLoop.dedupFileEvent(event('66666666-6666-4666-8666-666666666666'));
  custody.record(accepted);
  const indexed = rows()[0];
  expect((await audit.captureObservationProof([indexed]))?.unique(indexed)).toBe(true);
  const db = auditIndex._dbForTest();
  db.prepare('UPDATE audit_events SET raw = ?').run('{"type":"file-access"}');
  expect(await audit.captureObservationProof([indexed])).toBeNull();
});

it('streams more than 20,000 rows and four MiB with bounded requested targets', async () => {
  const accepted = scanLoop.dedupFileEvent(event('77777777-7777-4777-8777-777777777777'));
  custody.record(accepted);
  const indexed = rows()[0];
  const lines = Array.from({ length: 20000 }, (_, i) => JSON.stringify({
    type: 'ordinary', timestamp: '2000-01-01T00:00:00.000Z', details: { i, text: 'é' + 'x'.repeat(250) },
  }));
  const name = 'aegis-audit-2000-01-01.json';
  const target = path.join(audit.getLogDir(), name);
  fs.writeFileSync(target, ' \r\n' + lines.join('\r\n') + '\r\n\n');
  const stat = fs.statSync(target);
  expect(stat.size).toBeGreaterThan(4 * 1024 * 1024);
  auditIndex.writeBatch({ file: name, fileDate: '2000-01-01', firstLineNo: 0,
    lines, indexedBytes: stat.size, sizeBytes: stat.size, mtimeMs: stat.mtimeMs });
  const started = performance.now();
  const proof = await audit.captureObservationProof([indexed]);
  const elapsed = Math.round(performance.now() - started);
  expect(proof?.unique(indexed)).toBe(true);
  expect(await audit.captureObservationProof(Array(101).fill(indexed))).toBeNull();
  console.log(`streaming proof: ${lines.length + 1} rows, ${stat.size} bytes, ${elapsed} ms`);
}, 15000);

it.each(['invalid UTF-8', 'oversized line'])('fails unavailable for %s anywhere in history', async (kind) => {
  const accepted = scanLoop.dedupFileEvent(event('88888888-8888-4888-8888-888888888888'));
  custody.record(accepted);
  const indexed = rows()[0];
  const name = 'aegis-audit-2000-01-01.json';
  const target = path.join(audit.getLogDir(), name);
  const line = JSON.stringify({ type: 'ordinary', details: { text: kind === 'oversized line' ? 'x'.repeat(65536) : 'z' } });
  const bytes = Buffer.from(line + '\n');
  if (kind === 'invalid UTF-8') bytes[bytes.indexOf(Buffer.from('z'))] = 0xff;
  fs.writeFileSync(target, bytes);
  const stat = fs.statSync(target);
  auditIndex.writeBatch({ file: name, fileDate: '2000-01-01', firstLineNo: 0,
    lines: [line], indexedBytes: stat.size, sizeBytes: stat.size, mtimeMs: stat.mtimeMs });
  expect(await audit.captureObservationProof([indexed])).toBeNull();
});

it('revokes both rows when a second sensitive observation reuses an ID before dedup', async () => {
  const first = event('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA');
  const accepted = scanLoop.dedupFileEvent(first);
  custody.record(accepted);
  const duplicate = event('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  expect(scanLoop.dedupFileEvent(duplicate)).toBeNull();
  const saved = rows();
  expect(saved).toHaveLength(2);
  expect(saved[0].details.auditIdentity.eventId).toBe(saved[1].details.auditIdentity.eventId);
  expect(saved[0].details.auditIdentity.token).not.toBe(saved[1].details.auditIdentity.token);
  const proof = await audit.captureObservationProof(saved);
  expect(custody.auditLookup(saved[0], proof)).toBeNull();
  expect(custody.auditLookup(saved[1], proof)).toBeNull();
});
