import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require_ = createRequire(import.meta.url);
const modulePath = require_.resolve('../../src/main/audit-logger.js');
const previous = require_.cache[modulePath];
let audit;
let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-counter-startup-'));
  fs.mkdirSync(path.join(root, 'audit-logs'));
  delete require_.cache[modulePath];
  audit = require_(modulePath);
});
afterEach(async () => {
  vi.restoreAllMocks();
  audit.shutdown();
  await audit._awaitIndexForTest();
  delete require_.cache[modulePath];
  if (previous) require_.cache[modulePath] = previous;
  expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(root)).toMatch(/^aegis-counter-startup-/);
  expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
  await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

it('yields between bounded historical reads without counting live appends twice', async () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const file = path.join(root, 'audit-logs', 'aegis-audit-2026-10-01.json');
  const line = JSON.stringify({ type: 'old', timestamp: now.toISOString() }) + '\n';
  fs.writeFileSync(file, line.repeat(2000));
  const wholeReads = vi.spyOn(fs, 'readFileSync');
  const reads = vi.spyOn(fs, 'readSync');
  audit.init({ userDataPath: root, now: () => now, loadSqlite: () => null });
  expect(wholeReads.mock.calls.filter(([name]) => String(name) === file)).toHaveLength(0);
  expect(audit.getStats().historyReadState).toBe('building');
  const initialReads = reads.mock.calls.length;
  audit.log('new', { agent: 'Synthetic' });
  audit.flush();
  await audit._awaitCountersForTest();
  expect(reads.mock.calls.length).toBeGreaterThan(initialReads);
  expect(Math.max(...reads.mock.calls.map((args) => args[3]))).toBeLessThanOrEqual(65536);
  expect(audit.getStats()).toMatchObject({
    historyReadState: 'ready',
    totalEntries: 2001,
    persistedEntries: 2001,
    bufferDepth: 0,
  });
});

it('applies retention before reading and excludes markers and malformed records', async () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const retained = path.join(root, 'audit-logs', 'aegis-audit-2026-10-01.json');
  const expired = path.join(root, 'audit-logs', 'aegis-audit-2020-01-01.json');
  fs.writeFileSync(expired, 'x'.repeat(70000));
  fs.writeFileSync(
    retained,
    [
      JSON.stringify({ type: 'old', timestamp: now.toISOString(), agent: 'Фикстура' }),
      JSON.stringify({ type: 'buffer-overflow-drop', timestamp: '2099-01-01T00:00:00Z' }),
      '{PRIVATE_CORRUPTION_SENTINEL',
    ].join('\n'),
  );
  const open = vi.spyOn(fs, 'openSync');
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  audit.init({ userDataPath: root, now: () => now, loadSqlite: () => null });
  await audit._awaitCountersForTest();
  expect(fs.existsSync(expired)).toBe(false);
  expect(open.mock.calls.some(([name]) => String(name) === expired)).toBe(false);
  expect(audit.getStats()).toMatchObject({
    historyReadState: 'unavailable',
    totalEntries: 1,
    persistedEntries: 1,
    firstEntry: now.toISOString(),
    lastEntry: now.toISOString(),
  });
  expect(JSON.stringify(errors.mock.calls)).not.toContain('PRIVATE_CORRUPTION_SENTINEL');
  expect(JSON.stringify(errors.mock.calls)).not.toContain(root);
});

it('bounds an oversized record and resumes counting valid UTF-8 events after its newline', async () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const file = path.join(root, 'audit-logs', 'aegis-audit-2026-10-01.json');
  const event = JSON.stringify({ type: 'old', timestamp: now.toISOString(), agent: 'Фикстура' });
  fs.writeFileSync(
    file,
    event +
      '\n' +
      JSON.stringify({ type: 'oversized', padding: 'x'.repeat(1100000) }) +
      '\n' +
      event,
  );
  const reads = vi.spyOn(fs, 'readSync');
  audit.init({ userDataPath: root, now: () => now, loadSqlite: () => null });
  await audit._awaitCountersForTest();
  expect(audit.getStats()).toMatchObject({
    historyReadState: 'unavailable',
    totalEntries: 2,
    persistedEntries: 2,
  });
  expect(Math.max(...reads.mock.calls.map((args) => args[3]))).toBeLessThanOrEqual(65536);
});

it('closes a pending seed on shutdown and cannot leak old counters into the next initialization', async () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const line = JSON.stringify({ type: 'old', timestamp: now.toISOString() }) + '\n';
  fs.writeFileSync(path.join(root, 'audit-logs', 'aegis-audit-2026-10-01.json'), line.repeat(2000));
  audit.init({ userDataPath: root, now: () => now, loadSqlite: () => null });
  expect(audit.getStats().historyReadState).toBe('building');
  const close = vi.spyOn(fs, 'closeSync');
  audit.shutdown();
  expect(close).toHaveBeenCalledOnce();
  await audit._awaitCountersForTest();
  const next = path.join(root, 'next');
  fs.mkdirSync(path.join(next, 'audit-logs'), { recursive: true });
  fs.writeFileSync(path.join(next, 'audit-logs', 'aegis-audit-2026-10-01.json'), line);
  audit.init({ userDataPath: next, now: () => now, loadSqlite: () => null });
  await audit._awaitIndexForTest();
  await audit._awaitCountersForTest();
  expect(audit.getStats()).toMatchObject({
    historyReadState: 'ready',
    totalEntries: 1,
    persistedEntries: 1,
  });
});
