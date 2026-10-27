import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { projectAuditIdentity } = require('../../src/main/audit-observation-identity');
const {
  projectRecord,
  replayRecord,
  MAX_RECORD_BYTES,
} = require('../../src/main/security-event-record');
const { createSecurityBatcher } = require('../../src/main/ipc-batcher');

const identity = {
  eventId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
  epoch: 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB',
  token: 'CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC',
};
const expected = Object.fromEntries(
  Object.entries(identity).map(([key, value]) => [key, value.toLowerCase()]),
);
const file = (details = {}) => ({
  type: 'file-access',
  sensor: 'file-watch',
  timestamp: 1700000000000,
  details: {
    agent: 'test',
    pid: 12,
    instanceId: '12:100',
    action: 'read',
    path: '/fixture/file',
    severity: 'sensitive',
    attribution: null,
    ...details,
  },
});
let root, audit;
const pipelines = [];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-audit-observation-'));
  delete require.cache[require.resolve('../../src/main/audit-logger')];
  audit = require('../../src/main/audit-logger');
});
afterEach(() => {
  for (const pipeline of pipelines.splice(0)) pipeline.destroy();
  audit.shutdown();
  vi.restoreAllMocks();
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
  fs.rmSync(root, { recursive: true, force: true });
});

describe('closed audit observation metadata', () => {
  it('normalizes a complete UUID tuple and detaches it from caller state', () => {
    const input = { ...identity };
    const result = projectAuditIdentity(input);
    input.eventId = 'changed';
    expect(result).toEqual(expected);
  });

  it('omits invalid, incomplete, extra, proxy and accessor values without invoking them', () => {
    const accessed = vi.fn();
    const getter = { epoch: identity.epoch, token: identity.token };
    Object.defineProperty(getter, 'eventId', { enumerable: true, get: accessed });
    const proxy = new Proxy(identity, { ownKeys: accessed });
    const inputs = [
      null,
      {},
      { ...identity, eventId: 'invalid' },
      { ...identity, epoch: 'aaaaaaaa-aaaa-0aaa-8aaa-aaaaaaaaaaaa' },
      { ...identity, token: 'cccccccc-cccc-4ccc-0ccc-cccccccccccc' },
      { ...identity, privateText: 'do not store' },
      getter,
      proxy,
    ];
    for (const input of inputs) expect(projectAuditIdentity(input)).toBeNull();
    expect(accessed).not.toHaveBeenCalled();
  });

  it('retains valid metadata across reprojection with delivery identity separate', () => {
    const projected = projectRecord(file({ auditIdentity: identity }));
    expect(projected.details.extra.auditIdentity).toEqual(expected);
    expect(projected.deliveryId).not.toBe(expected.eventId);
    const replay = replayRecord(projected);
    expect(replay.details.extra.auditIdentity).toEqual(expected);
    expect(replay.deliveryId).toBe(projected.deliveryId);
    expect(replay.replayed).toBe(true);
  });

  it('omits malformed or accessor metadata while keeping the security event', () => {
    const getter = vi.fn();
    const input = file();
    Object.defineProperty(input.details, 'auditIdentity', { enumerable: true, get: getter });
    expect(projectRecord(input).details.extra).not.toHaveProperty('auditIdentity');
    expect(
      projectRecord(file({ auditIdentity: { ...identity, token: 'invalid' } })).details.extra,
    ).not.toHaveProperty('auditIdentity');
    expect(getter).not.toHaveBeenCalled();
  });

  it('does not invoke an identity descriptor trap on proxy event details', () => {
    const identityTrap = vi.fn(() => {
      throw new Error('unexpected');
    });
    const details = new Proxy(file().details, {
      getOwnPropertyDescriptor(target, key) {
        return key === 'auditIdentity'
          ? identityTrap()
          : Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const projected = projectRecord(file({ ...details }));
    expect(projected.details.path).toBe('/fixture/file');
    const proxyProjected = projectRecord({ ...file(), details });
    expect(proxyProjected.details.path).toBe('/fixture/file');
    expect(proxyProjected.details.extra).not.toHaveProperty('auditIdentity');
    expect(identityTrap).not.toHaveBeenCalled();
  });

  it('drops invalid persisted optional metadata during replay without discarding the event', () => {
    const projected = projectRecord(file({ auditIdentity: identity }));
    projected.details.extra.auditIdentity = { ...expected, token: 'invalid' };
    const replay = replayRecord(projected);
    expect(replay.details.path).toBe('/fixture/file');
    expect(replay.details.extra).not.toHaveProperty('auditIdentity');
    expect(replay.deliveryId).toBe(projected.deliveryId);
  });

  it('drops only the optional identity when it would exceed the security record limit', () => {
    const input = file();
    let projected;
    for (let n = 32000; n < 32768; n++) {
      input.details.path = 'é'.repeat(n);
      try {
        const candidate = projectRecord(input);
        const remaining = MAX_RECORD_BYTES - Buffer.byteLength(JSON.stringify(candidate));
        if (remaining < 160) {
          projected = candidate;
          break;
        }
      } catch {
        break;
      }
    }
    expect(projected).toBeDefined();
    input.details.auditIdentity = identity;
    const retained = projectRecord(input);
    expect(retained.details.path).toBe(input.details.path);
    expect(retained.details.extra).not.toHaveProperty('auditIdentity');
  });

  it('keeps old and new normal and security records on one valid chain', async () => {
    const now = new Date('2026-10-01T12:00:00Z');
    audit.init({ userDataPath: root, now: () => now });
    await audit._awaitIndexForTest();
    const chain = require('../../src/main/audit-hashchain');
    const old = { type: 'file-access', timestamp: now.toISOString(), details: { path: '/legacy' } };
    const oldLine =
      JSON.stringify({ ...old, seq: 0, hash: chain.computeHash(chain.GENESIS, old) }) + '\n';
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const target = path.join(audit.getLogDir(), `aegis-audit-${date}.json`);
    fs.writeFileSync(target, oldLine);
    audit.log('file-access', { action: 'read', path: '/ordinary', auditIdentity: identity });
    audit.log('file-access', {
      action: 'read',
      path: '/invalid',
      auditIdentity: { ...identity, token: 'bad' },
    });
    audit.flush();
    const projected = projectRecord(file({ auditIdentity: identity }));
    expect(audit.persistBatch([projected])).toBe(true);
    const text = fs.readFileSync(target, 'utf8');
    expect(text.startsWith(oldLine)).toBe(true);
    const rows = text.trim().split('\n').map(JSON.parse);
    expect(rows).toHaveLength(4);
    expect(rows[0].details).toEqual({ path: '/legacy' });
    expect(rows[1].details.auditIdentity).toEqual(expected);
    expect(rows[2].details).toBeNull();
    expect(rows[3].details.auditIdentity).toEqual(expected);
    expect(rows[3].details.deliveryId).toBe(projected.deliveryId);
    expect(rows[3]).not.toHaveProperty('eventId');
    expect(audit.verifyChain(target)).toEqual({ valid: true, brokenAtSeq: null, reason: 'ok' });
  });

  it('preserves array and non-plain extras instead of forcing optional identity into them', () => {
    audit.init({ userDataPath: root });
    const date = new Date('2026-01-02T03:04:05Z');
    audit.log('file-access', { action: 'read', extra: ['existing', 'evidence'] });
    audit.log('file-access', { action: 'read', extra: date, auditIdentity: identity });
    audit.flush();
    const name = fs.readdirSync(audit.getLogDir()).find((item) => item.endsWith('.json'));
    const rows = fs
      .readFileSync(path.join(audit.getLogDir(), name), 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse);
    expect(rows[0].details).toEqual(['existing', 'evidence']);
    expect(rows[1].details).toBe(date.toISOString());
  });

  it('omits array-owned and non-plain metadata at the direct batch boundary', () => {
    audit.init({ userDataPath: root });
    const record = projectRecord(file());
    const extra = ['existing', 'evidence'];
    extra.auditIdentity = { ...identity };
    record.details.extra = extra;
    const second = projectRecord(file());
    const date = new Date('2026-01-02T03:04:05Z');
    date.auditIdentity = { ...identity };
    second.details.extra = date;
    const third = projectRecord(file());
    const getter = vi.fn(() => {
      throw new Error('unexpected');
    });
    const plain = { evidence: 'retained' };
    Object.defineProperty(plain, 'auditIdentity', { enumerable: true, get: getter });
    third.details.extra = plain;
    expect(audit.persistBatch([record, second, third])).toBe(true);
    const name = fs.readdirSync(audit.getLogDir()).find((item) => item.endsWith('.json'));
    const [entry, other, accessor] = fs
      .readFileSync(path.join(audit.getLogDir(), name), 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse);
    expect(entry.details['0']).toBe('existing');
    expect(entry.details['1']).toBe('evidence');
    expect(entry.details).not.toHaveProperty('auditIdentity');
    expect(entry.details.deliveryId).toBe(record.deliveryId);
    expect(other.details).not.toHaveProperty('auditIdentity');
    expect(other.details.deliveryId).toBe(second.deliveryId);
    expect(accessor.details.evidence).toBe('retained');
    expect(accessor.details).not.toHaveProperty('auditIdentity');
    expect(getter).not.toHaveBeenCalled();
  });

  it('refuses a proxy extra without invoking traps so batch ownership remains with its caller', () => {
    audit.init({ userDataPath: root });
    const record = projectRecord(file());
    const trap = vi.fn(() => {
      throw new Error('unexpected');
    });
    record.details.extra = new Proxy({}, { ownKeys: trap });
    expect(audit.persistBatch([record])).toBe(false);
    expect(trap).not.toHaveBeenCalled();
    expect(fs.readdirSync(audit.getLogDir()).filter((name) => name.endsWith('.json'))).toEqual([]);
  });

  it('preserves the exact metadata across failed storage, spill and restart replay', () => {
    const directory = path.join(root, 'spill');
    const first = createSecurityBatcher({
      directory,
      capacity: 1,
      byteCapacity: 4096,
      intervalMs: 60000,
      consume: () => false,
    });
    pipelines.push(first);
    expect(first.push(file({ auditIdentity: identity }))).toBe(true);
    expect(first.push(file({ auditIdentity: identity, path: '/fixture/second' }))).toBe(true);
    first.flush();
    expect(first.getStats().spill.records).toBeGreaterThan(0);
    first.destroy();
    const received = [];
    const second = createSecurityBatcher({
      directory,
      intervalMs: 60000,
      consume: (rows) => {
        received.push(...rows);
        return true;
      },
    });
    pipelines.push(second);
    second.flush();
    const rows = received.filter((row) => row.type === 'file-access');
    expect(rows).toHaveLength(2);
    expect(
      rows.every(
        (row) =>
          row.replayed &&
          JSON.stringify(row.details.extra.auditIdentity) === JSON.stringify(expected),
      ),
    ).toBe(true);
    expect(new Set(rows.map((row) => row.deliveryId)).size).toBe(2);
    expect(rows.every((row) => row.deliveryId !== expected.eventId)).toBe(true);
  });

  it('retains metadata and delivery identity when a failed audit fsync is retried', async () => {
    audit.init({ userDataPath: root });
    await audit._awaitIndexForTest();
    const projected = projectRecord(file({ auditIdentity: identity }));
    const fsync = vi.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => {
      throw new Error('injected audit sync failure');
    });
    expect(audit.persistBatch([projected])).toBe(false);
    fsync.mockRestore();
    expect(audit.persistBatch([projected])).toBe(true);
    const name = fs.readdirSync(audit.getLogDir()).find((item) => item.endsWith('.json'));
    const target = path.join(audit.getLogDir(), name);
    const rows = fs.readFileSync(target, 'utf8').trim().split('\n').map(JSON.parse);
    expect(rows).toHaveLength(1);
    expect(rows[0].details.auditIdentity).toEqual(expected);
    expect(rows[0].details.deliveryId).toBe(projected.deliveryId);
    expect(audit.verifyChain(target).valid).toBe(true);
  });
});
