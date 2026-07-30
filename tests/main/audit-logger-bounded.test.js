/**
 * @file audit-logger-bounded.test.js
 * @description Bounded write buffer, drop-oldest eviction, and the durability counters
 *   that make the loss visible. Split from audit-logger.test.js the way the file-watcher
 *   suites are split, so the buffer-cap concern reads on its own.
 *
 *   `init({ bufferCap })` is what makes these tests cheap: without the seam, provoking an
 *   eviction would need 500+ log() calls and hundreds of wasted SHA-256 computations.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('audit-logger bounded buffer', () => {
  let auditLogger;
  let tmpDir;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-audit-cap-'));
    vi.resetModules();
    const mod = await import('../../src/main/audit-logger.js');
    auditLogger = mod.default;
  });

  afterEach(() => {
    auditLogger.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const auditDir = () => path.join(tmpDir, 'audit-logs');

  /** @returns {string} Path to today's log file. */
  function todayFile() {
    const name = fs.readdirSync(auditDir()).find((f) => f.endsWith('.json'));
    return path.join(auditDir(), name);
  }

  /** @returns {Object[]} Every line of today's file, parsed, in write order. */
  function readLines() {
    return fs
      .readFileSync(todayFile(), 'utf-8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
  }

  const MARKER = 'buffer-overflow-drop';

  it('evicts the OLDEST buffered entry when the cap is exceeded', () => {
    auditLogger.init({ userDataPath: tmpDir, bufferCap: 3 });
    for (const agent of ['A', 'B', 'C', 'D']) auditLogger.log('t', { agent });
    auditLogger.flush();

    const lines = readLines();
    // 1 marker + the 3 survivors.
    expect(lines).toHaveLength(4);
    // Identity matters, not just the count: 'A' was oldest, so 'A' is the one gone.
    expect(lines.filter((l) => l.type !== MARKER).map((l) => l.agent)).toEqual(['B', 'C', 'D']);
  });

  it('counts one drop per evicted entry', () => {
    auditLogger.init({ userDataPath: tmpDir, bufferCap: 2 });
    for (let i = 0; i < 5; i++) auditLogger.log('t', { agent: `a${i}` });
    expect(auditLogger.getStats().droppedEntries).toBe(3);
  });

  it('persistedEntries counts only what reached disk, excluding the marker', () => {
    auditLogger.init({ userDataPath: tmpDir, bufferCap: 10 });
    auditLogger.log('t', { agent: 'A' });
    auditLogger.log('t', { agent: 'B' });
    auditLogger.log('t', { agent: 'C' });
    auditLogger.flush();
    // Two more stay in the buffer — logged, but not durable.
    auditLogger.log('t', { agent: 'D' });
    auditLogger.log('t', { agent: 'E' });

    const stats = auditLogger.getStats();
    expect(stats.persistedEntries).toBe(3);
    expect(stats.totalEntries).toBe(5);
    expect(stats.droppedEntries).toBe(0);
  });

  it('keeps the hash chain valid through a marker record', () => {
    auditLogger.init({ userDataPath: tmpDir, bufferCap: 2 });
    for (const agent of ['A', 'B', 'C']) auditLogger.log('t', { agent });
    auditLogger.flush();

    expect(auditLogger.verifyChain(todayFile())).toEqual({
      valid: true,
      brokenAtSeq: null,
      reason: 'ok',
    });
  });

  it('numbers the marker in sequence with the surviving entries — no gap', () => {
    auditLogger.init({ userDataPath: tmpDir, bufferCap: 2 });
    for (const agent of ['A', 'B', 'C']) auditLogger.log('t', { agent });
    auditLogger.flush();

    const lines = readLines();
    expect(lines.map((l) => l.seq)).toEqual([0, 1, 2]);
    // The marker leads: it sits at the start of the window whose records are missing.
    expect(lines[0].type).toBe(MARKER);
  });

  it('accumulates the drop count across eviction cycles before any flush', () => {
    auditLogger.init({ userDataPath: tmpDir, bufferCap: 2 });
    // First two fill the buffer without evicting; each of the next four evicts one.
    for (let i = 0; i < 6; i++) auditLogger.log('t', { agent: `a${i}` });
    auditLogger.flush();

    const marker = readLines().find((l) => l.type === MARKER);
    expect(marker.details.droppedCount).toBe(4);
    expect(auditLogger.getStats().droppedEntries).toBe(4);
  });

  it('reports both ends of the loss window in the marker', () => {
    auditLogger.init({ userDataPath: tmpDir, bufferCap: 2 });
    for (const agent of ['A', 'B', 'C', 'D']) auditLogger.log('t', { agent });
    auditLogger.flush();

    const { details } = readLines().find((l) => l.type === MARKER);
    expect(details.reason).toBe('buffer-cap-exceeded');
    // Timestamps come from the EVICTED entries, so they describe when the lost events
    // happened rather than when the marker was written.
    expect(Number.isNaN(Date.parse(details.firstDropTs))).toBe(false);
    expect(Number.isNaN(Date.parse(details.lastDropTs))).toBe(false);
    expect(Date.parse(details.firstDropTs)).toBeLessThanOrEqual(Date.parse(details.lastDropTs));
  });

  it('holds the pending drop across a failed flush and reports it once on recovery', () => {
    auditLogger.init({ userDataPath: tmpDir, bufferCap: 2, onFlushError: vi.fn() });
    for (const agent of ['A', 'B', 'C']) auditLogger.log('t', { agent });

    fs.rmSync(auditDir(), { recursive: true, force: true });
    auditLogger.flush(); // fails; drop bookkeeping must NOT be cleared
    fs.mkdirSync(auditDir(), { recursive: true });
    auditLogger.flush(); // succeeds

    const lines = readLines();
    const markers = lines.filter((l) => l.type === MARKER);
    expect(markers).toHaveLength(1);
    expect(markers[0].details.droppedCount).toBe(1);
    // Written exactly once — the pristine re-queue must not duplicate it.
    expect(lines.filter((l) => l.type !== MARKER).map((l) => l.agent)).toEqual(['B', 'C']);
    expect(auditLogger.verifyChain(todayFile()).valid).toBe(true);
  });

  it('keeps the re-queued batch within the cap', () => {
    auditLogger.init({ userDataPath: tmpDir, bufferCap: 3, onFlushError: vi.fn() });
    for (const agent of ['A', 'B', 'C']) auditLogger.log('t', { agent });

    fs.rmSync(auditDir(), { recursive: true, force: true });
    auditLogger.flush(); // fails; [A,B,C] re-queued, exactly at cap
    fs.mkdirSync(auditDir(), { recursive: true });
    auditLogger.log('t', { agent: 'D' }); // pushes to 4 -> evicts A
    auditLogger.flush();

    const lines = readLines();
    expect(lines.filter((l) => l.type !== MARKER).map((l) => l.agent)).toEqual(['B', 'C', 'D']);
    expect(auditLogger.getStats().droppedEntries).toBe(1);
    expect(auditLogger.verifyChain(todayFile()).valid).toBe(true);
  });

  it('hides markers from the paginated view but keeps them in a full export', () => {
    auditLogger.init({ userDataPath: tmpDir, bufferCap: 2 });
    for (const agent of ['A', 'B', 'C']) auditLogger.log('t', { agent });
    auditLogger.flush();

    const paginated = auditLogger.getEntriesBefore('9999-01-01T00:00:00.000Z', 100);
    expect(paginated).toHaveLength(2);
    expect(paginated.some((e) => e.type === MARKER)).toBe(false);

    // The forensic export must carry the evidence that records are missing.
    const all = auditLogger.exportAll();
    expect(all).toHaveLength(3);
    expect(all.some((e) => e.type === MARKER)).toBe(true);
  });

  it('does not count markers or malformed lines when seeding from disk', async () => {
    auditLogger.init({ userDataPath: tmpDir, bufferCap: 2 });
    for (const agent of ['A', 'B', 'C']) auditLogger.log('t', { agent });
    auditLogger.flush(); // marker + 2 user records on disk
    auditLogger.shutdown();

    // A truncated write leaves a line JSON.parse cannot read; it must not be counted.
    fs.appendFileSync(todayFile(), '{"timestamp":"broken', 'utf-8');

    vi.resetModules();
    const mod = await import('../../src/main/audit-logger.js');
    auditLogger = mod.default;
    auditLogger.init({ userDataPath: tmpDir });

    const stats = auditLogger.getStats();
    expect(stats.totalEntries).toBe(2);
    expect(stats.persistedEntries).toBe(2);
    // Drop counts are session-scoped: the durable record of loss is the on-disk marker.
    expect(stats.droppedEntries).toBe(0);
  });

  it('writes nothing when the buffer is empty and no drop is pending', () => {
    auditLogger.init({ userDataPath: tmpDir });
    auditLogger.flush();
    expect(fs.readdirSync(auditDir()).filter((f) => f.endsWith('.json'))).toHaveLength(0);
  });

  it('reports how many entries are still waiting', () => {
    auditLogger.init({ userDataPath: tmpDir, bufferCap: 10 });
    auditLogger.log('t', { agent: 'A' });
    auditLogger.log('t', { agent: 'B' });
    expect(auditLogger.getStats().bufferDepth).toBe(2);
    auditLogger.flush();
    expect(auditLogger.getStats().bufferDepth).toBe(0);
  });

  it('accounts for every unwritten entry as dropped + buffered', () => {
    // The number that matters during an outage: buffered entries are only "pending"
    // while the disk is writable. If the process dies here they are as lost as the
    // evicted ones, so droppedEntries alone understates the damage.
    auditLogger.init({ userDataPath: tmpDir, bufferCap: 3, onFlushError: vi.fn() });
    fs.rmSync(auditDir(), { recursive: true, force: true });
    for (let i = 0; i < 5; i++) {
      auditLogger.log('t', { agent: `a${i}` });
      auditLogger.flush(); // every one fails
    }

    const s = auditLogger.getStats();
    expect(s.persistedEntries).toBe(0);
    expect(s.droppedEntries).toBe(2);
    expect(s.bufferDepth).toBe(3);
    expect(s.droppedEntries + s.bufferDepth).toBe(s.totalEntries);
  });

  it('writes a pending marker when a READ triggers the flush', () => {
    // exportAll() and getEntriesBefore() both flush first, so opening the export dialog
    // is enough to land the marker — it is not only the 5s timer that writes it.
    auditLogger.init({ userDataPath: tmpDir, bufferCap: 2 });
    for (const agent of ['A', 'B', 'C']) auditLogger.log('t', { agent });

    const all = auditLogger.exportAll();
    expect(all.some((e) => e.type === MARKER)).toBe(true);
    expect(auditLogger.verifyChain(todayFile()).valid).toBe(true);
  });

  it('does not let a marker timestamp widen the observed date range', async () => {
    // A marker is stamped with the wall-clock time of the flush that recovered it, which
    // can be long after the last real event. Counting it would push the date range shown
    // in the UI past the newest actual record.
    const future = new Date('2099-06-01T12:00:00.000Z');
    auditLogger.init({ userDataPath: tmpDir, bufferCap: 2, now: () => future });
    for (const agent of ['A', 'B', 'C']) auditLogger.log('t', { agent });
    auditLogger.flush();
    auditLogger.shutdown();

    vi.resetModules();
    const mod = await import('../../src/main/audit-logger.js');
    auditLogger = mod.default;
    auditLogger.init({ userDataPath: tmpDir, now: () => future });

    const { lastEntry } = auditLogger.getStats();
    expect(lastEntry).not.toBe(future.toISOString());
    expect(new Date(lastEntry).getUTCFullYear()).toBeLessThan(2099);
  });

  it('leaves the default cap far above the flush threshold, so healthy runs never evict', () => {
    // 60 entries is above FLUSH_THRESHOLD (50) but far below BUFFER_CAP (500): the
    // threshold flush fires and nothing is dropped. Guards against a future cap value
    // that would silently start discarding audit data during normal operation.
    auditLogger.init({ userDataPath: tmpDir });
    for (let i = 0; i < 60; i++) auditLogger.log('t', { agent: `a${i}` });
    auditLogger.flush();

    const stats = auditLogger.getStats();
    expect(stats.droppedEntries).toBe(0);
    expect(stats.persistedEntries).toBe(60);
    expect(readLines().some((l) => l.type === MARKER)).toBe(false);
    expect(auditLogger.verifyChain(todayFile()).valid).toBe(true);
  });
});
