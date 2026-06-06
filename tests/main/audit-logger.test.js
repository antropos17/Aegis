import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('audit-logger', () => {
  let auditLogger;
  let tmpDir;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-audit-test-'));
    vi.resetModules();
    const mod = await import('../../src/main/audit-logger.js');
    auditLogger = mod.default;
  });

  afterEach(() => {
    auditLogger.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('init() creates audit-logs dir', () => {
    const auditDir = path.join(tmpDir, 'audit-logs');
    auditLogger.init({ userDataPath: tmpDir });
    expect(fs.existsSync(auditDir)).toBe(true);
  });

  it('log() creates structured entry with all fields', () => {
    auditLogger.init({ userDataPath: tmpDir });
    auditLogger.log('file-access', {
      agent: 'Claude',
      action: 'read',
      path: '/test/file.js',
      severity: 'high',
      riskScore: 42,
    });
    auditLogger.flush();

    const auditDir = path.join(tmpDir, 'audit-logs');
    const files = fs.readdirSync(auditDir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    const content = fs.readFileSync(path.join(auditDir, files[0]), 'utf-8');
    const entry = JSON.parse(content.trim().split('\n')[0]);
    expect(entry).toMatchObject({
      type: 'file-access',
      agent: 'Claude',
      action: 'read',
      path: '/test/file.js',
      severity: 'high',
      riskScore: 42,
    });
    expect(entry.timestamp).toBeDefined();
  });

  it('buffered writes accumulate until flush', () => {
    auditLogger.init({ userDataPath: tmpDir });
    auditLogger.log('test', { agent: 'A' });
    auditLogger.log('test', { agent: 'B' });

    const auditDir = path.join(tmpDir, 'audit-logs');
    const filesBefore = fs.readdirSync(auditDir).filter((f) => f.endsWith('.json'));
    expect(filesBefore).toHaveLength(0);

    auditLogger.flush();
    const filesAfter = fs.readdirSync(auditDir).filter((f) => f.endsWith('.json'));
    expect(filesAfter).toHaveLength(1);
    const content = fs.readFileSync(path.join(auditDir, filesAfter[0]), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('auto-flush at threshold', () => {
    auditLogger.init({ userDataPath: tmpDir });
    for (let i = 0; i < 50; i++) {
      auditLogger.log('test', { agent: `A${i}` });
    }
    const auditDir = path.join(tmpDir, 'audit-logs');
    const files = fs.readdirSync(auditDir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    const content = fs.readFileSync(path.join(auditDir, files[0]), 'utf-8');
    expect(content.trim().split('\n')).toHaveLength(50);
  });

  it('getStats() returns correct stats', () => {
    auditLogger.init({ userDataPath: tmpDir });
    auditLogger.log('test', { agent: 'A' });
    auditLogger.log('test', { agent: 'B' });
    auditLogger.flush();
    auditLogger.log('test', { agent: 'C' });

    const stats = auditLogger.getStats();
    expect(stats.totalEntries).toBe(3);
    expect(stats.totalSize).toBeGreaterThan(0);
    expect(stats.firstEntry).toBeDefined();
    expect(stats.lastEntry).toBeDefined();
  });

  it('exportAll() reads all audit files', () => {
    auditLogger.init({ userDataPath: tmpDir });
    auditLogger.log('t1', { agent: 'A' });
    auditLogger.log('t2', { agent: 'B' });

    const all = auditLogger.exportAll();
    expect(all).toHaveLength(2);
    expect(all[0].type).toBe('t1');
    expect(all[1].type).toBe('t2');
  });

  it('cleanOldLogs() removes old files', async () => {
    auditLogger.init({ userDataPath: tmpDir });
    const auditDir = path.join(tmpDir, 'audit-logs');

    const oldDate = new Date(Date.now() - 60 * 86400000);
    const oldStr = `${oldDate.getFullYear()}-${String(oldDate.getMonth() + 1).padStart(2, '0')}-${String(oldDate.getDate()).padStart(2, '0')}`;
    const oldFile = path.join(auditDir, `aegis-audit-${oldStr}.json`);
    fs.writeFileSync(oldFile, '{"test":"old"}\n');

    const recentDate = new Date(Date.now() - 86400000);
    const recentStr = `${recentDate.getFullYear()}-${String(recentDate.getMonth() + 1).padStart(2, '0')}-${String(recentDate.getDate()).padStart(2, '0')}`;
    const recentFile = path.join(auditDir, `aegis-audit-${recentStr}.json`);
    fs.writeFileSync(recentFile, '{"test":"recent"}\n');

    auditLogger.shutdown();
    vi.resetModules();
    const mod2 = await import('../../src/main/audit-logger.js');
    auditLogger = mod2.default;
    auditLogger.init({ userDataPath: tmpDir });
    await new Promise((r) => setImmediate(r));

    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(recentFile)).toBe(true);
  });

  it('shutdown() flushes and stops timer', () => {
    auditLogger.init({ userDataPath: tmpDir });
    auditLogger.log('test', { agent: 'shutdown-test' });
    auditLogger.shutdown();

    const auditDir = path.join(tmpDir, 'audit-logs');
    const files = fs.readdirSync(auditDir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    const content = fs.readFileSync(path.join(auditDir, files[0]), 'utf-8');
    expect(content).toContain('shutdown-test');
  });

  it('onFlushError callback fires on write failure', () => {
    const errorCb = vi.fn();
    auditLogger.init({ userDataPath: tmpDir, onFlushError: errorCb });

    const auditDir = path.join(tmpDir, 'audit-logs');
    fs.rmSync(auditDir, { recursive: true, force: true });

    auditLogger.log('test', { agent: 'err' });
    auditLogger.flush();
    expect(errorCb).toHaveBeenCalledTimes(1);
    expect(errorCb.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('re-queues events on write failure so a later flush persists them', () => {
    auditLogger.init({ userDataPath: tmpDir, onFlushError: vi.fn() });
    const auditDir = path.join(tmpDir, 'audit-logs');

    auditLogger.log('test', { agent: 'requeue-me' });

    // Force the first flush to fail: remove the dir so appendFileSync throws ENOENT.
    fs.rmSync(auditDir, { recursive: true, force: true });
    auditLogger.flush();

    // Restore writability and flush again — a re-queue fix must persist the event
    // that the failed flush had drained from the buffer.
    fs.mkdirSync(auditDir, { recursive: true });
    auditLogger.flush();

    const files = fs.readdirSync(auditDir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    const content = fs.readFileSync(path.join(auditDir, files[0]), 'utf-8');
    expect(content).toContain('requeue-me');
  });

  // --- tamper-evident hash chain (per-file) ---------------------------------

  function todayFile() {
    const auditDir = path.join(tmpDir, 'audit-logs');
    const name = fs.readdirSync(auditDir).find((f) => f.endsWith('.json'));
    return path.join(auditDir, name);
  }

  it('hash-chain: log x3 -> flush -> verifyChain valid with seq 0/1/2', () => {
    auditLogger.init({ userDataPath: tmpDir });
    auditLogger.log('t', { agent: 'A' });
    auditLogger.log('t', { agent: 'B' });
    auditLogger.log('t', { agent: 'C' });
    auditLogger.flush();

    const fp = todayFile();
    const seqs = fs
      .readFileSync(fp, 'utf-8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l).seq);
    expect(seqs).toEqual([0, 1, 2]);
    expect(auditLogger.verifyChain(fp)).toEqual({ valid: true, brokenAtSeq: null, reason: 'ok' });
  });

  it('hash-chain: details carrying undefined-valued keys still verify clean', () => {
    auditLogger.init({ userDataPath: tmpDir });
    // details.extra becomes the persisted `details` field; the undefined key is
    // dropped by JSON.stringify on disk but must not break the chain.
    auditLogger.log('t', { agent: 'A', extra: { foo: undefined, bar: 1 } });
    auditLogger.flush();

    expect(auditLogger.verifyChain(todayFile()).valid).toBe(true);
  });

  it('hash-chain: rotation — each day-file verifies, day 2 restarts at seq 0', () => {
    let fakeNow = new Date(2026, 5, 5, 12, 0, 0); // 2026-06-05 (local, TZ-safe)
    auditLogger.init({ userDataPath: tmpDir, now: () => fakeNow });
    const auditDir = path.join(tmpDir, 'audit-logs');

    auditLogger.log('day1', { agent: 'A' });
    auditLogger.log('day1', { agent: 'B' });
    auditLogger.flush();

    fakeNow = new Date(2026, 5, 6, 12, 0, 0); // roll over to 2026-06-06
    auditLogger.log('day2', { agent: 'C' });
    auditLogger.flush();

    const day1 = path.join(auditDir, 'aegis-audit-2026-06-05.json');
    const day2 = path.join(auditDir, 'aegis-audit-2026-06-06.json');
    expect(fs.existsSync(day1)).toBe(true);
    expect(fs.existsSync(day2)).toBe(true);

    expect(auditLogger.verifyChain(day1).valid).toBe(true);
    expect(auditLogger.verifyChain(day2).valid).toBe(true);

    const day2first = JSON.parse(fs.readFileSync(day2, 'utf-8').trim().split('\n')[0]);
    expect(day2first.seq).toBe(0); // fresh chain, GENESIS-seeded
  });

  it('hash-chain: C-03 re-queue after a failed flush keeps the chain valid (no seq gap)', () => {
    auditLogger.init({ userDataPath: tmpDir, onFlushError: vi.fn() });
    const auditDir = path.join(tmpDir, 'audit-logs');

    auditLogger.log('c03', { agent: 'first' });
    auditLogger.log('c03', { agent: 'second' });

    // First flush fails (dir gone) — entries must re-queue WITHOUT consuming seq.
    fs.rmSync(auditDir, { recursive: true, force: true });
    auditLogger.flush();

    // Recover and flush again.
    fs.mkdirSync(auditDir, { recursive: true });
    auditLogger.flush();

    const fp = todayFile();
    const seqs = fs
      .readFileSync(fp, 'utf-8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l).seq);
    expect(seqs).toEqual([0, 1]); // contiguous, no gap from the failed flush
    expect(auditLogger.verifyChain(fp).valid).toBe(true);
  });

  it('hash-chain: resumes the chain from the file tail after a same-day restart', async () => {
    const now = () => new Date(2026, 5, 5, 12, 0, 0);
    auditLogger.init({ userDataPath: tmpDir, now });
    auditLogger.log('t', { agent: 'A' });
    auditLogger.log('t', { agent: 'B' });
    auditLogger.flush();
    auditLogger.shutdown();

    // Simulate a process restart: fresh module instance, same dir + same day.
    vi.resetModules();
    auditLogger = (await import('../../src/main/audit-logger.js')).default;
    auditLogger.init({ userDataPath: tmpDir, now });
    auditLogger.log('t', { agent: 'C' });
    auditLogger.flush();

    const fp = todayFile();
    const seqs = fs
      .readFileSync(fp, 'utf-8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l).seq);
    expect(seqs).toEqual([0, 1, 2]); // continued from the tail, NOT restarted at 0
    expect(auditLogger.verifyChain(fp).valid).toBe(true);
  });

  it('hash-chain: continues the in-memory chain across multiple same-day flushes', () => {
    auditLogger.init({ userDataPath: tmpDir });
    auditLogger.log('t', { agent: 'A' });
    auditLogger.flush(); // seeds _chainDate
    auditLogger.log('t', { agent: 'B' });
    auditLogger.flush(); // hits the _chainDate === todayDate continuation branch

    const fp = todayFile();
    const seqs = fs
      .readFileSync(fp, 'utf-8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l).seq);
    expect(seqs).toEqual([0, 1]);
    expect(auditLogger.verifyChain(fp).valid).toBe(true);
  });
});
