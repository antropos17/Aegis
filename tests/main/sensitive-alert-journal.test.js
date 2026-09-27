import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const require_ = createRequire(import.meta.url);
const { createSensitiveAlertJournal, MAX_BYTES } = require_(
  '../../src/main/sensitive-alert-journal.js',
);
const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    expect(path.dirname(path.resolve(directory))).toBe(path.resolve(os.tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function directory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-alerts-'));
  directories.push(dir);
  return dir;
}

function event(eventId = randomUUID(), file = 'C:\\private\\.env') {
  return {
    eventId,
    file,
    timestamp: Date.now(),
    sensitive: true,
    action: 'accessed',
    agent: 'Agent',
    attribution: { status: 'confirmed' },
  };
}

it('restores a bounded review summary by UUID and leaves a new same-path event unreviewed', async () => {
  const dir = directory();
  const first = event();
  const writer = createSensitiveAlertJournal(dir);
  writer.record(first);
  expect(await writer.setReviewed(first.eventId, true)).toMatchObject({ success: true });
  const restored = createSensitiveAlertJournal(dir);
  expect(restored.list().items).toMatchObject([{ eventId: first.eventId, reviewed: true }]);
  expect(JSON.stringify(restored.list())).not.toContain('private');
  const second = event(randomUUID(), first.file);
  restored.record(second);
  expect(await restored.flush()).toBe(true);
  expect(createSensitiveAlertJournal(dir).list().items).toMatchObject([
    { eventId: second.eventId, reviewed: false },
    { eventId: first.eventId, reviewed: true },
  ]);
});

it('keeps only the newest 100 summaries and a basename from a long path', async () => {
  const dir = directory();
  const journal = createSensitiveAlertJournal(dir);
  for (let i = 0; i < 105; i++) journal.record(event());
  const longPath = `${'p/'.repeat(3000)}secret.env`;
  const last = event(randomUUID(), longPath);
  journal.record(last);
  expect(await journal.flush()).toBe(true);
  const rows = createSensitiveAlertJournal(dir).list().items;
  expect(rows).toHaveLength(100);
  expect(rows[0]).toMatchObject({ eventId: last.eventId, basename: 'secret.env' });
  expect(fs.statSync(path.join(dir, 'sensitive-alerts.json')).size).toBeLessThan(MAX_BYTES);
});

it('treats corrupt and oversized files as fresh unreviewed state with an explicit status', () => {
  const dir = directory();
  const file = path.join(dir, 'sensitive-alerts.json');
  fs.writeFileSync(file, '{bad');
  expect(createSensitiveAlertJournal(dir).list()).toMatchObject({ status: 'corrupt', items: [] });
  fs.writeFileSync(file, 'x'.repeat(MAX_BYTES + 1));
  expect(createSensitiveAlertJournal(dir).list()).toMatchObject({ status: 'corrupt', items: [] });
});

it('removes only an old, bounded, exact journal temporary file', () => {
  const dir = directory();
  const orphan = path.join(dir, `.sensitive-alerts-${randomUUID()}.tmp`);
  const unrelated = path.join(dir, 'other.tmp');
  fs.writeFileSync(orphan, 'disposable');
  fs.writeFileSync(unrelated, 'preserve');
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  fs.utimesSync(orphan, old, old);
  createSensitiveAlertJournal(dir);
  expect(fs.existsSync(orphan)).toBe(false);
  expect(fs.readFileSync(unrelated, 'utf8')).toBe('preserve');
});

it('expires aged entries from a running journal before listing them', async () => {
  const journal = createSensitiveAlertJournal(directory());
  journal.record({ ...event(), timestamp: Date.now() - 31 * 24 * 60 * 60 * 1000 });
  expect(journal.list().items).toEqual([]);
  expect(await journal.flush()).toBe(true);
});

it('rejects concurrent review toggles while a save is pending', async () => {
  const dir = directory();
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const io = {
    statSync: fs.statSync,
    readFileSync: fs.readFileSync,
    renameSync: fs.renameSync,
    promises: {
      open: fs.promises.open,
      writeFile: async (...args) => {
        await barrier;
        return fs.promises.writeFile(...args);
      },
      rename: fs.promises.rename,
      unlink: fs.promises.unlink,
    },
  };
  const journal = createSensitiveAlertJournal(dir, io);
  const first = event();
  journal.record(first);
  const pending = journal.setReviewed(first.eventId, true);
  expect(await journal.setReviewed(first.eventId, false)).toMatchObject({
    success: false,
    error: 'Review is busy',
  });
  release();
  expect(await pending).toMatchObject({ success: true });
  expect(createSensitiveAlertJournal(dir).list().items[0].reviewed).toBe(true);
});

it('does not commit a delayed review after its renderer loses ownership', async () => {
  const dir = directory();
  let release;
  let owned = true;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const io = {
    statSync: fs.statSync,
    readFileSync: fs.readFileSync,
    renameSync: vi.fn(fs.renameSync),
    promises: {
      open: fs.promises.open,
      writeFile: async (...args) => {
        await barrier;
        return fs.promises.writeFile(...args);
      },
      rename: fs.promises.rename,
      unlink: fs.promises.unlink,
    },
  };
  const journal = createSensitiveAlertJournal(dir, io);
  const first = event();
  journal.record(first);
  const pending = journal.setReviewed(first.eventId, true, () => owned);
  await Promise.resolve();
  owned = false;
  release();
  expect(await pending).toMatchObject({ success: false, error: 'Renderer request denied' });
  expect(io.renameSync).not.toHaveBeenCalled();
  expect(journal.list().items[0].reviewed).toBe(false);
});

it('does not claim a review when the atomic write fails', async () => {
  const dir = directory();
  const io = {
    statSync: fs.statSync,
    readFileSync: fs.readFileSync,
    promises: {
      writeFile: vi.fn(async () => {
        throw new Error('disk full');
      }),
      rename: vi.fn(),
      unlink: vi.fn(async () => {}),
    },
  };
  const journal = createSensitiveAlertJournal(dir, io);
  const first = event();
  journal.record(first);
  expect(await journal.setReviewed(first.eventId, true)).toMatchObject({
    success: false,
    status: 'write-error',
  });
  expect(journal.list().items[0].reviewed).toBe(false);
  expect(io.promises.rename).not.toHaveBeenCalled();
});
