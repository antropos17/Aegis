/**
 * audit-index — block 1 of docs/roadmap/audit-index.md: the engine gate, the schema, the writer
 * that projects JSONL lines into the index at flush time, and the rebuild-from-JSONL path. No read
 * path is exercised here (block 2).
 *
 * Every integration case goes through the real `audit-logger`, which requires `./audit-index` and
 * `./audit-index-rebuild` natively — so the index instance the test inspects is reached through
 * `createRequire`, the same way `logger` is: an ESM import of the same path would be a second
 * instance that never sees the rows (memory-bank/ai-mistakes.md, the logger-spy lesson).
 *
 * `AEGIS_AI_UNDER_TEST` overrides the module path for the DIRECT cases (projection, schema shape)
 * on the pattern of `sequence-engine-gate.test.js`, so a scripted gate can be added later. The
 * integration cases run whatever `audit-logger` requires, which is the file on disk — a scripted
 * gate over those has to mutate in place (docs/roadmap/audit-index.md §10 q5: by hand for now).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import os from 'os';

const require_ = createRequire(import.meta.url);
const MODULE_UNDER_TEST = process.env.AEGIS_AI_UNDER_TEST || '../../src/main/audit-index.js';
const index = require_(MODULE_UNDER_TEST);
const logger = require_('../../src/main/logger.js');
const hashchain = require_('../../src/main/audit-hashchain.js');

/** The `YYYY-MM-DD` the logger names a file with — LOCAL date, the formula of _todayDateStr. */
function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A local date `days` back from now — inside retention for small values, outside for 60. */
function daysAgo(days) {
  return localDateStr(new Date(Date.now() - days * 86400000));
}

describe('audit-index', () => {
  let auditLogger;
  let tmpDir;

  const auditDir = () => path.join(tmpDir, 'audit-logs');
  const indexDir = () => path.join(tmpDir, 'audit-index');
  const indexFile = () => path.join(indexDir(), 'audit-index.sqlite');
  const dayFile = (dateStr) => path.join(auditDir(), `aegis-audit-${dateStr}.json`);

  /** Raw lines straight into a daily file, bypassing log(): the rebuild reads what is on disk. */
  function writeDay(dateStr, lines) {
    fs.mkdirSync(auditDir(), { recursive: true });
    fs.writeFileSync(dayFile(dateStr), lines.join('\n') + '\n', 'utf-8');
  }

  /** A chained v1 line the way flush() writes one, so hand-written fixtures verify too. */
  function chained(prevHash, seq, fields) {
    const e = {
      schemaVersion: 1,
      timestamp: '2026-07-30T09:00:00.000Z',
      type: 'file-access',
      agent: 'claude',
      pid: 1234,
      instanceId: '1234:1700000000000',
      action: 'modified',
      path: '/tmp/x',
      severity: 'normal',
      riskScore: 0,
      attribution: { status: 'confirmed', evidence: [] },
      details: null,
      ...fields,
    };
    const hash = hashchain.computeHash(prevHash, e);
    return { line: JSON.stringify({ ...e, seq, hash }), hash };
  }

  /** init() and wait for the deferred open + reconcile to settle. */
  async function bringUp(opts = {}) {
    auditLogger.init({ userDataPath: tmpDir, ...opts });
    await auditLogger._awaitIndexForTest();
  }

  /** A fresh module instance, the way a process restart gives one. */
  async function restart() {
    auditLogger.shutdown();
    vi.resetModules();
    auditLogger = (await import('../../src/main/audit-logger.js')).default;
  }

  const db = () => index._dbForTest();
  const rowCount = () => db().prepare('SELECT count(*) AS n FROM audit_events').get().n;
  const fileRow = (name) => db().prepare('SELECT * FROM audit_files WHERE file = ?').get(name);
  const eventRows = (name) =>
    db().prepare('SELECT * FROM audit_events WHERE file = ? ORDER BY line_no').all(name);

  /** Non-empty lines across every daily file — the quantity the index may never exceed. */
  function linesOnDisk() {
    if (!fs.existsSync(auditDir())) return 0;
    return fs
      .readdirSync(auditDir())
      .filter((f) => f.startsWith('aegis-audit-') && f.endsWith('.json'))
      .reduce(
        (n, f) =>
          n +
          fs
            .readFileSync(path.join(auditDir(), f), 'utf-8')
            .split('\n')
            .filter((l) => l.trim().length > 0).length,
        0,
      );
  }

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-audit-index-'));
    vi.resetModules();
    auditLogger = (await import('../../src/main/audit-logger.js')).default;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    auditLogger.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  // --- T1: the capability gate --------------------------------------------------------------

  it('T1: without node:sqlite the index is unavailable and the JSONL write path is untouched', async () => {
    await bringUp({ loadSqlite: () => null });
    expect(index.status().state).toBe('unavailable');
    expect(fs.existsSync(indexDir())).toBe(false);

    auditLogger.log('file-access', { agent: 'A', action: 'read', path: '/x' });
    auditLogger.flush();
    expect(linesOnDisk()).toBe(1);
    expect(auditLogger.getStats().index.state).toBe('unavailable');
    expect(db()).toBeNull();
  });

  // --- T2: rebuild from a directory of mixed lines ------------------------------------------

  it('T2: builds from v0 lines, a marker and a malformed line — counts per file, v0 marked by absence', async () => {
    const day = daysAgo(1);
    const v0 = {
      timestamp: `${day}T09:00:00.000Z`,
      type: 'file-access',
      agent: 'legacy',
      action: 'read',
      path: '/tmp/old',
      severity: 'normal',
      riskScore: 0,
      details: { attribution: 'confirmed', pid: 77 },
    };
    const marker = {
      schemaVersion: 1,
      timestamp: `${day}T09:00:01.000Z`,
      type: 'buffer-overflow-drop',
      droppedCount: 3,
      firstDropTs: `${day}T08:59:00.000Z`,
      lastDropTs: `${day}T08:59:59.000Z`,
    };
    const v1 = chained(hashchain.GENESIS, 0, { timestamp: `${day}T09:00:02.000Z` });
    writeDay(day, [JSON.stringify(v0), JSON.stringify(marker), '{not json', v1.line]);

    await bringUp();

    expect(index.status()).toMatchObject({ state: 'ready', files: 1, rows: 3, malformedLines: 1 });
    const file = `aegis-audit-${day}.json`;
    // Four non-empty lines on disk: `line_no` is the ordinal verifyChain calls `seq`, so the
    // malformed third line owns ordinal 2 and is counted, not stored.
    expect(fileRow(file)).toMatchObject({
      file_date: day,
      indexed_lines: 4,
      malformed_lines: 1,
      indexed_bytes: fs.statSync(dayFile(day)).size,
    });
    const rows = eventRows(file);
    expect(rows.map((r) => r.line_no)).toEqual([0, 1, 3]);
    // v0: the ABSENCE of schemaVersion is what marks it; pid came from the normalized view.
    expect(rows[0]).toMatchObject({
      type: 'file-access',
      seq: null,
      aegis_schema_version: null,
      process_pid: 77,
      aegis_attribution_status: 'confirmed',
    });
    // The marker is an ordinary row on the unknown-type branch; its counters stay in raw.
    expect(rows[1]).toMatchObject({
      type: 'buffer-overflow-drop',
      event_action: 'buffer-overflow-drop',
      event_category: null,
    });
    expect(
      db()
        .prepare(
          "SELECT json_extract(raw, '$.droppedCount') AS d FROM audit_events WHERE line_no = 1",
        )
        .get().d,
    ).toBe(3);
    expect(rows[2]).toMatchObject({ seq: 0, aegis_schema_version: 1, raw: v1.line });
  });

  // --- T5': the live append at flush time ---------------------------------------------------

  it("T5': flush() appends the batch to the index; a marker lands; a byte-offset mismatch drops the file and rebuilds", async () => {
    await bringUp({ bufferCap: 2 });
    expect(index.status().state).toBe('ready');

    auditLogger.log('file-access', { agent: 'A', action: 'read', path: '/a' });
    auditLogger.log('file-access', { agent: 'B', action: 'read', path: '/b' });
    auditLogger.flush();
    expect(rowCount()).toBe(2);
    const file = fs.readdirSync(auditDir()).find((f) => f.endsWith('.json'));
    expect(fileRow(file)).toMatchObject({
      indexed_lines: 2,
      indexed_bytes: fs.statSync(path.join(auditDir(), file)).size,
    });

    // Three entries under a cap of two: one eviction, so a marker leads the next batch.
    auditLogger.log('file-access', { agent: 'C', action: 'read', path: '/c' });
    auditLogger.log('file-access', { agent: 'D', action: 'read', path: '/d' });
    auditLogger.log('file-access', { agent: 'E', action: 'read', path: '/e' });
    auditLogger.flush();
    expect(rowCount()).toBe(5);
    expect(
      db()
        .prepare("SELECT count(*) AS n FROM audit_events WHERE type = 'buffer-overflow-drop'")
        .get().n,
    ).toBe(1);
    expect(rowCount()).toBe(linesOnDisk());

    // Someone (or a torn write) put bytes in the file the index does not account for.
    db()
      .prepare('UPDATE audit_files SET indexed_bytes = indexed_bytes - 1 WHERE file = ?')
      .run(file);
    auditLogger.log('file-access', { agent: 'F', action: 'read', path: '/f' });
    auditLogger.flush();
    // Synchronously after the flush: the file's rows are gone and a rebuild is pending.
    expect(rowCount()).toBe(0);
    expect(index.status().state).toBe('building');

    await auditLogger._awaitIndexForTest();
    expect(index.status().state).toBe('ready');
    expect(rowCount()).toBe(linesOnDisk());
    expect(fileRow(file).indexed_bytes).toBe(fs.statSync(path.join(auditDir(), file)).size);
  });

  it('rows in the index never exceed lines on disk when the JSONL write fails', async () => {
    await bringUp({ onFlushError: vi.fn() });
    fs.rmSync(auditDir(), { recursive: true, force: true });
    auditLogger.log('file-access', { agent: 'lost', action: 'read', path: '/x' });
    auditLogger.flush();
    expect(linesOnDisk()).toBe(0);
    expect(rowCount()).toBe(0);
    expect(rowCount()).toBeLessThanOrEqual(linesOnDisk());
  });

  // --- T6: resume from indexed_bytes, full re-index on a changed prefix ---------------------

  it('T6: a grown file is resumed from indexed_bytes; a shrunk or rewritten file is re-indexed in full', async () => {
    const day = daysAgo(1);
    const file = `aegis-audit-${day}.json`;
    const lines = [];
    let prev = hashchain.GENESIS;
    for (let i = 0; i < 5; i++) {
      const c = chained(prev, i, { timestamp: `${day}T09:00:0${i}.000Z` });
      lines.push(c.line);
      prev = c.hash;
    }
    writeDay(day, lines);
    await bringUp();
    expect(fileRow(file).indexed_lines).toBe(5);

    // Mark an already-indexed row: a resume keeps it, a full re-index would restore it.
    db()
      .prepare("UPDATE audit_events SET raw = 'kept-by-resume' WHERE file = ? AND line_no = 0")
      .run(file);
    const more = [];
    for (let i = 5; i < 8; i++) {
      const c = chained(prev, i, { timestamp: `${day}T09:00:0${i}.000Z` });
      more.push(c.line);
      prev = c.hash;
    }
    fs.appendFileSync(dayFile(day), more.join('\n') + '\n', 'utf-8');

    await restart();
    await bringUp();
    expect(fileRow(file).indexed_lines).toBe(8);
    expect(eventRows(file)[0].raw).toBe('kept-by-resume');
    expect(eventRows(file).map((r) => r.line_no)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    // Same size, different bytes, later mtime: the prefix changed → full re-index.
    const content = fs.readFileSync(dayFile(day), 'utf-8');
    fs.writeFileSync(
      dayFile(day),
      content.replace('"agent":"claude"', '"agent":"CLAUDE"'),
      'utf-8',
    );
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(dayFile(day), later, later);
    await restart();
    await bringUp();
    expect(eventRows(file)[0].raw).not.toBe('kept-by-resume');
    expect(eventRows(file)[0].raw).toContain('"agent":"CLAUDE"');
    expect(fileRow(file).indexed_lines).toBe(8);

    // Shrunk: fewer bytes than recorded → full re-index, rows follow the file.
    fs.writeFileSync(dayFile(day), lines.slice(0, 3).join('\n') + '\n', 'utf-8');
    await restart();
    await bringUp();
    expect(fileRow(file).indexed_lines).toBe(3);
    expect(rowCount()).toBe(3);
  });

  // --- T7: a corrupted database is reported, discarded and rebuilt ---------------------------

  it('T7: a corrupt index file is warned about with the reason and path, then removed and rebuilt', async () => {
    const day = daysAgo(1);
    writeDay(day, [chained(hashchain.GENESIS, 0, { timestamp: `${day}T09:00:00.000Z` }).line]);
    await bringUp();
    expect(rowCount()).toBe(1);

    auditLogger.shutdown();
    fs.writeFileSync(indexFile(), Buffer.alloc(4096, 0x41));
    for (const side of ['-wal', '-shm']) fs.rmSync(indexFile() + side, { force: true });

    const warn = vi.spyOn(logger, 'warn');
    await restart();
    await bringUp();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('audit-index');
    expect(warn.mock.calls[0][2]).toMatchObject({ file: indexFile() });
    expect(warn.mock.calls[0][2].reason).toMatch(/quick_check/);
    expect(index.status().state).toBe('ready');
    expect(rowCount()).toBe(1);
    expect(fs.existsSync(indexFile())).toBe(true);
  });

  // --- T8: retention — the rows of a deleted file disappear ---------------------------------

  it('T8: a file removed by retention loses its rows at the next reconcile', async () => {
    await bringUp();
    auditLogger.log('file-access', { agent: 'A', action: 'read', path: '/a' });
    auditLogger.flush();
    const todayName = fs.readdirSync(auditDir()).find((f) => f.endsWith('.json'));
    expect(fileRow(todayName).indexed_lines).toBe(1);

    // A file older than retention appears AFTER the sweep, and a mismatch on TODAY's file
    // triggers the reconcile that indexes it — the organic route to "rows for a file
    // retention will delete".
    const old = daysAgo(60);
    writeDay(old, [chained(hashchain.GENESIS, 0, { timestamp: `${old}T09:00:00.000Z` }).line]);
    db()
      .prepare('UPDATE audit_files SET indexed_bytes = indexed_bytes - 1 WHERE file = ?')
      .run(todayName);
    auditLogger.log('file-access', { agent: 'B', action: 'read', path: '/b' });
    auditLogger.flush();
    await auditLogger._awaitIndexForTest();
    expect(fileRow(`aegis-audit-${old}.json`)).toBeDefined();
    expect(index.status().files).toBe(2);

    await restart();
    await bringUp();
    await new Promise((r) => setImmediate(r));
    expect(fs.existsSync(dayFile(old))).toBe(false);
    expect(fileRow(`aegis-audit-${old}.json`)).toBeUndefined();
    expect(
      db()
        .prepare('SELECT count(*) AS n FROM audit_events WHERE file = ?')
        .get(`aegis-audit-${old}.json`).n,
    ).toBe(0);
    expect(rowCount()).toBe(linesOnDisk());
  });

  it('CASCADE: deleting a file row removes its event rows (foreign keys are enforced)', async () => {
    const day = daysAgo(1);
    const file = `aegis-audit-${day}.json`;
    writeDay(day, [
      chained(hashchain.GENESIS, 0, { timestamp: `${day}T09:00:00.000Z` }).line,
      chained(hashchain.GENESIS, 1, { timestamp: `${day}T09:00:01.000Z` }).line,
    ]);
    await bringUp();
    expect(rowCount()).toBe(2);
    db().prepare('DELETE FROM audit_files WHERE file = ?').run(file);
    expect(rowCount()).toBe(0);
  });

  // --- T10 / T11: the projection ------------------------------------------------------------

  it('T10: process_pid is only a real OS pid; process_entity_id is verbatim', async () => {
    const day = daysAgo(1);
    const at = (s) => `${day}T09:00:0${s}.000Z`;
    writeDay(day, [
      JSON.stringify({
        schemaVersion: 1,
        timestamp: at(0),
        type: 'agent-enter',
        pid: 0,
        instanceId: '0:local-llm',
      }),
      JSON.stringify({
        schemaVersion: 1,
        timestamp: at(1),
        type: 'agent-enter',
        pid: null,
        instanceId: null,
      }),
      JSON.stringify({
        schemaVersion: 1,
        timestamp: at(2),
        type: 'agent-enter',
        pid: 1234,
        instanceId: '1234:u',
      }),
    ]);
    await bringUp();
    const rows = eventRows(`aegis-audit-${day}.json`);
    expect(rows.map((r) => r.process_pid)).toEqual([null, null, 1234]);
    expect(rows.map((r) => r.process_entity_id)).toEqual(['0:local-llm', null, '1234:u']);
  });

  it('T11: ECS columns follow the normalizer; an unknown type keeps its name; no type → NULLs but still a row', async () => {
    const day = daysAgo(1);
    const at = (s) => `${day}T09:00:0${s}.000Z`;
    writeDay(day, [
      JSON.stringify({
        schemaVersion: 1,
        timestamp: at(0),
        type: 'file-access',
        action: 'modified',
        path: '/p',
        agent: 'A',
      }),
      JSON.stringify({ schemaVersion: 1, timestamp: at(1), type: 'zzz-unknown', agent: '' }),
      JSON.stringify({ schemaVersion: 1, timestamp: at(2), agent: 'no-type' }),
      JSON.stringify({
        schemaVersion: 1,
        timestamp: at(3),
        type: 'network-connection',
        path: '1.2.3.4:443',
      }),
    ]);
    await bringUp();
    const rows = eventRows(`aegis-audit-${day}.json`);
    expect(rows[0]).toMatchObject({
      event_kind: 'event',
      event_category: '["file"]',
      event_type: '["change"]',
      event_action: 'file-modified',
      file_path: '/p',
      aegis_agent_name: 'A',
      action: 'modified',
    });
    expect(rows[1]).toMatchObject({
      type: 'zzz-unknown',
      event_action: 'zzz-unknown',
      event_category: null,
      aegis_agent_name: null,
    });
    expect(rows[2]).toMatchObject({
      type: '',
      timestamp: at(2),
      event_kind: null,
      event_category: null,
      event_action: null,
    });
    expect(rows[3]).toMatchObject({ event_category: '["network"]', file_path: null });
    expect(rows).toHaveLength(4);
  });

  // --- T12 / T13 / T14: the schema, the close, the version -----------------------------------

  it('T12: the schema carries neither hash nor prev_hash — the chain is never verified against the index', async () => {
    await bringUp();
    const cols = db()
      .prepare('PRAGMA table_info(audit_events)')
      .all()
      .map((c) => c.name);
    expect(cols).not.toContain('hash');
    expect(cols).not.toContain('prev_hash');
    expect(cols).toEqual(
      expect.arrayContaining([
        'file',
        'line_no',
        'seq',
        'timestamp',
        'type',
        'raw',
        'process_entity_id',
      ]),
    );
    expect(db().prepare('PRAGMA user_version').get().user_version).toBe(
      index.AUDIT_INDEX_SCHEMA_VERSION,
    );
  });

  it('T13: shutdown closes the database', async () => {
    await bringUp();
    auditLogger.log('file-access', { agent: 'A', action: 'read', path: '/a' });
    auditLogger.shutdown();
    expect(index.status().state).toBe('closed');
    expect(db()).toBeNull();
    expect(fs.existsSync(indexFile() + '-wal')).toBe(false);
    expect(auditLogger.getStats().index.state).toBe('closed');
  });

  it('T14: a user_version other than the schema version is warned about and the index rebuilt', async () => {
    const day = daysAgo(1);
    writeDay(day, [chained(hashchain.GENESIS, 0, { timestamp: `${day}T09:00:00.000Z` }).line]);
    await bringUp();
    auditLogger.shutdown();

    const sqlite = require_('node:sqlite');
    const raw = new sqlite.DatabaseSync(indexFile());
    raw.exec('PRAGMA user_version = 0');
    raw.close();

    const warn = vi.spyOn(logger, 'warn');
    await restart();
    await bringUp();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][2]).toMatchObject({ file: indexFile() });
    expect(warn.mock.calls[0][2].reason).toMatch(/user_version 0/);
    expect(db().prepare('PRAGMA user_version').get().user_version).toBe(
      index.AUDIT_INDEX_SCHEMA_VERSION,
    );
    expect(rowCount()).toBe(1);
    expect(index.status().state).toBe('ready');
  });

  it('a healthy reopen emits no warning', async () => {
    await bringUp();
    const warn = vi.spyOn(logger, 'warn');
    await restart();
    await bringUp();
    expect(warn).not.toHaveBeenCalled();
    expect(index.status().state).toBe('ready');
  });
});
