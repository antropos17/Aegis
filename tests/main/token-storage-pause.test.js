import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const adapter = require('../../src/main/token-adapters/claude-code');
const feed = require('../../src/main/token-feed');
const tracker = require('../../src/main/token-tracker');
const collector = require('../../src/main/token-cost-collector');
const { createLedger } = require('../../src/main/token-dedup-ledger');
const MAX_BYTES = 64 * 1024;
const BIRTH = 1_700_000_000_000;
let directory, file, clock, inspect, rangeRead, warn;

const line = (id, input = 1) =>
  JSON.stringify({
    type: 'assistant',
    message: {
      id,
      model: 'claude-haiku-4-5-20251001',
      usage: { input_tokens: input, output_tokens: 2 },
    },
  }) + '\n';
const proc = (pid) => ({ pid, startTime: BIRTH, agent: 'Claude Code', instanceId: `${pid}:birth` });
function source(pid, rows) {
  const session = `session-${pid}`;
  const project = path.join(directory, '.claude', 'projects', adapter._encodeCwd(directory));
  const registry = path.join(directory, '.claude', 'sessions', `${pid}.json`);
  fs.mkdirSync(path.dirname(registry), { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(
    registry,
    JSON.stringify({
      sessionId: session,
      cwd: directory,
      startedAt: BIRTH,
      procStart: '639162008149103680',
      status: 'idle',
    }),
  );
  const transcript = path.join(project, `${session}.jsonl`);
  fs.writeFileSync(transcript, rows.join(''));
  return { session, transcript, project, registry };
}
function openInspection() {
  inspect = new DatabaseSync(file);
  inspect.exec(`PRAGMA max_page_count=${MAX_BYTES / 4096}`);
  return inspect;
}
function occupyFreePages() {
  const db = inspect || openInspection();
  db.exec('CREATE TABLE padding (n INTEGER PRIMARY KEY, data BLOB)');
  const add = db.prepare('INSERT INTO padding (data) VALUES (zeroblob(3500))');
  let full;
  for (let i = 0; i < 32; i++) {
    try {
      add.run();
    } catch (error) {
      full = error;
      break;
    }
  }
  expect(full?.errcode & 0xff).toBe(13);
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-token-pause-'));
  file = path.join(directory, 'dedup.sqlite');
  clock = 1000;
  feed._resetForTest();
  tracker._resetForTest();
  adapter._setHomedirForTest(() => directory);
  adapter._setNowForTest(() => clock);
  adapter._setLedgerFactoryForTest(() => createLedger({ file, maxBytes: MAX_BYTES }));
  rangeRead = vi.fn((filePath, start, length) => {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const count = fs.readSync(fd, buffer, 0, length, start);
      return buffer.subarray(0, count);
    } finally {
      fs.closeSync(fd);
    }
  });
  adapter._setFsForTest({
    existsSync: fs.existsSync,
    statSync: fs.statSync,
    readdirSync: fs.readdirSync,
    readRange: rangeRead,
  });
  warn = vi.fn();
  adapter._setLoggerForTest({ warn });
});
afterEach(() => {
  inspect?.close();
  inspect = null;
  adapter._resetForTest();
  // Exact disposable fixture directory; no user files or reparse points exist here.
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('real-file SQLite capacity and truthful collection status', () => {
  it('keeps committed IDs/cursors at the permanent cap and backs off thousands of scans', async () => {
    const fixture = source(1, [line('oldest')]);
    expect(await adapter.readUsage([proc(1)])).toHaveLength(1);
    const committedOffset = fs.statSync(fixture.transcript).size;
    fs.appendFileSync(
      fixture.transcript,
      Array.from({ length: 2000 }, (_, i) => line(`backlog-${i}`)).join(''),
    );
    expect(await adapter.readUsage([proc(1)])).toEqual([]);
    expect(adapter.getCollectionStatus()).toEqual({
      state: 'storage-paused',
      reason: 'capacity',
      retryAt: 31000,
    });
    openInspection();
    expect(inspect.prepare('SELECT offset FROM sessions').get().offset).toBe(committedOffset);
    expect(inspect.prepare('SELECT count(*) AS n FROM messages').get().n).toBe(1);
    expect(inspect.prepare('PRAGMA max_page_count').get().max_page_count).toBe(16);
    expect(fs.statSync(file).size).toBeLessThanOrEqual(MAX_BYTES);
    const reads = rangeRead.mock.calls.length;
    for (let i = 0; i < 3000; i++) expect(await adapter.readUsage([proc(1)])).toEqual([]);
    expect(rangeRead).toHaveBeenCalledTimes(reads);
    clock = 31000;
    expect(await adapter.readUsage([proc(1)])).toEqual([]);
    expect(adapter.getCollectionStatus()).toMatchObject({
      state: 'storage-paused',
      retryAt: 61000,
    });
    expect(inspect.prepare('SELECT offset FROM sessions').get().offset).toBe(committedOffset);
    expect(inspect.prepare('SELECT count(*) AS n FROM messages').get().n).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('commits healthy processes around a failing process, then resumes oldest main/subagent records exactly once', async () => {
    const healthy = source(1, [line('healthy-old')]);
    const blocked = source(2, [line('blocked-old')]);
    await collector.collectTokenCosts([proc(1), proc(2)]);
    const oldOffset = fs.statSync(blocked.transcript).size;
    occupyFreePages();
    fs.appendFileSync(healthy.transcript, line('healthy-new', 7));
    fs.appendFileSync(
      blocked.transcript,
      Array.from({ length: 400 }, (_, i) => line(`pending-${i}`)).join(''),
    );
    const subDir = path.join(blocked.project, blocked.session, 'subagents');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'agent-a.jsonl'), line('pending-0') + line('sub-new', 9));
    const tick = await collector.collectTokenCosts([proc(1), proc(2)]);
    expect(tick.map((row) => row.pid)).toEqual([1]);
    expect(tick[0].inputTokens).toBe(7);
    const paused = collector.getTokenCostDelivery();
    expect(paused.collection).toMatchObject([
      { adapter: 'claude-code', state: 'storage-paused', reason: 'capacity' },
    ]);
    expect(paused.records.find((row) => row.pid === 1).inputTokens).toBe(8);
    expect(paused.records.find((row) => row.pid === 2).inputTokens).toBe(1);
    expect(
      inspect
        .prepare('SELECT offset FROM sessions ORDER BY offset')
        .all()
        .some((row) => row.offset === oldOffset),
    ).toBe(true);
    // Give the same bounded index space back, preserving every accepted ID.
    inspect.exec('DELETE FROM padding');
    expect(await collector.collectTokenCosts([proc(1), proc(2)])).toEqual([]);
    expect(collector.getTokenCostDelivery().collection[0].state).toBe('storage-paused');
    clock = 31000;
    const recovered = await collector.collectTokenCosts([proc(1), proc(2)]);
    expect(recovered).toHaveLength(401);
    expect(recovered.every((row) => row.pid === 2)).toBe(true);
    expect(recovered[0].inputTokens).toBe(1);
    expect(recovered.filter((row) => row.inputTokens === 9)).toHaveLength(1);
    expect(collector.getTokenCostDelivery().collection[0].state).toBe('ready');
    expect(await collector.collectTokenCosts([proc(1), proc(2)])).toEqual([]);
    // Truncate back to the oldest IDs: their evidence must still be deduplicated.
    fs.writeFileSync(blocked.transcript, line('blocked-old') + line('pending-0') + line('sub-new'));
    expect(await collector.collectTokenCosts([proc(1), proc(2)])).toEqual([]);
    expect(tracker.getAllCosts().find((row) => row.pid === 1).inputTokens).toBe(8);
    expect(tracker.getAllCosts().find((row) => row.pid === 2).inputTokens).toBe(410);
    expect(fs.statSync(file).size).toBeLessThanOrEqual(MAX_BYTES);
  });

  it('cannot let a large first process discard a later healthy process or silently clear its pause', async () => {
    source(
      1,
      Array.from({ length: 2000 }, (_, i) => line(`full-${i}`)),
    );
    source(2, [line('small')]);
    const rows = await adapter.readUsage([proc(1), proc(2)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].pid).toBe(2);
    expect(adapter.getCollectionStatus().state).toBe('storage-paused');
    clock = 31000;
    expect(await adapter.readUsage([proc(1), proc(2)])).toEqual([]);
    expect(adapter.getCollectionStatus().state).toBe('storage-paused');
    expect(await adapter.readUsage([])).toEqual([]);
    expect(adapter.getCollectionStatus().state).toBe('storage-paused');
  });

  it('preserves an unavailable-index pause until an actual commit, without exposing errors or paths', async () => {
    const fixture = source(1, [line('first')]);
    let available = false;
    adapter._setLedgerFactoryForTest(() => {
      if (!available) throw new Error(`private path: ${file}`);
      return createLedger({ file, maxBytes: MAX_BYTES });
    });
    expect(await adapter.readUsage([proc(1)])).toEqual([]);
    expect(feed.getCollectionStatus()).toEqual([
      { adapter: 'claude-code', state: 'storage-paused', reason: 'unavailable', retryAt: 31000 },
    ]);
    expect(JSON.stringify(feed.getCollectionStatus())).not.toContain(directory);
    const registry = fs.readFileSync(fixture.registry);
    fs.unlinkSync(fixture.registry);
    clock = 31000;
    available = true;
    expect(await adapter.readUsage([proc(1)])).toEqual([]);
    expect(adapter.getCollectionStatus().state).toBe('storage-paused');
    fs.writeFileSync(fixture.registry, registry);
    expect(await adapter.readUsage([proc(1)])).toHaveLength(1);
    expect(adapter.getCollectionStatus()).toEqual({ state: 'ready', reason: null, retryAt: null });
  });
});
