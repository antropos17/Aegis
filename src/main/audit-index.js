/**
 * @file audit-index.js
 * @module main/audit-index
 * @description A rebuildable SQLite projection over the hash-chained audit JSONL
 *   (docs/roadmap/audit-index.md). The daily JSONL files are the ONLY source of truth: this
 *   index is written strictly after a flush has reached disk, can be thrown away at any time,
 *   and is rebuilt from the files by `audit-index-rebuild.js`. It never verifies the hash chain
 *   and the schema has no `hash` / `prev_hash` column, so it cannot be mistaken for the canon.
 *
 *   Engine: `node:sqlite` (`DatabaseSync`), resolved by {@link _loadSqlite} from {@link open}
 *   and never at module load — a runtime without the module gets `state: 'unavailable'` and
 *   nothing on disk, while the JSONL write path is untouched (the capability gate). Inside
 *   Electron 43 (Node 24.18) the module is present; the gate stays for vitest on an older
 *   system Node and for the day the Release Candidate API changes.
 *
 *   A corrupt or out-of-version database is REPORTED before it is discarded: `logger.warn` with
 *   the reason and the path precedes the close and the unlink, because a forensic tool must not
 *   silently recreate its own store.
 * @requires fs
 * @requires path
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.14.0
 */

'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { normalizeAuditEntry } = require('./audit-normalize');
const { normalizeToEcs } = require('../shared/ecs-normalizer');

/**
 * Schema version stored in `PRAGMA user_version`. NOT the record's `SCHEMA_VERSION` in
 * audit-logger.js — that one describes a JSONL line, this one the index tables. A database
 * whose `user_version` differs is discarded and rebuilt from the JSONL.
 * @type {number}
 */
const AUDIT_INDEX_SCHEMA_VERSION = 1;

/** @type {string} Directory under userData; separate from `audit-logs/` so exports see canon alone. */
const INDEX_DIR = 'audit-index';
/** @type {string} */
const INDEX_FILE = 'audit-index.sqlite';
/** @type {string[]} WAL side files, removed together with the database when it is discarded. */
const SIDE_FILES = ['-wal', '-shm'];

/**
 * Column names are the ECS paths of docs/ECS-MAPPING.md §4 with `.` → `_`; their values follow
 * the rules `src/shared/ecs-normalizer.js` enforces. `action` and `severity` are carried, not
 * mapped (§6), and keep their internal names. `raw` is the line as on disk — the answer a read
 * path builds is `normalizeAuditEntry(JSON.parse(raw))`, the typed columns exist for WHERE and
 * ORDER only. There is deliberately NO `hash` and NO `prev_hash` column.
 * @type {string}
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS audit_files (
  file            TEXT PRIMARY KEY,
  file_date       TEXT    NOT NULL,
  indexed_bytes   INTEGER NOT NULL,
  indexed_lines   INTEGER NOT NULL,
  size_bytes      INTEGER NOT NULL,
  mtime_ms        INTEGER NOT NULL,
  malformed_lines INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS audit_events (
  file                     TEXT    NOT NULL REFERENCES audit_files(file) ON DELETE CASCADE,
  line_no                  INTEGER NOT NULL,
  seq                      INTEGER,
  timestamp                TEXT    NOT NULL,
  type                     TEXT    NOT NULL,
  event_kind               TEXT,
  event_category           TEXT,
  event_type               TEXT,
  event_action             TEXT,
  aegis_schema_version     INTEGER,
  aegis_agent_name         TEXT,
  process_pid              INTEGER,
  process_entity_id        TEXT,
  file_path                TEXT,
  aegis_attribution_status TEXT,
  action                   TEXT    NOT NULL DEFAULT '',
  severity                 TEXT    NOT NULL DEFAULT 'normal',
  raw                      TEXT    NOT NULL,
  PRIMARY KEY (file, line_no)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS audit_events_ts      ON audit_events(timestamp, file, line_no);
CREATE INDEX IF NOT EXISTS audit_events_type_ts ON audit_events(type, timestamp);
CREATE INDEX IF NOT EXISTS audit_events_entity  ON audit_events(process_entity_id, timestamp);
`;

const INSERT_EVENT_SQL = `INSERT INTO audit_events (
  file, line_no, seq, timestamp, type, event_kind, event_category, event_type, event_action,
  aegis_schema_version, aegis_agent_name, process_pid, process_entity_id, file_path,
  aegis_attribution_status, action, severity, raw
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const UPSERT_FILE_SQL = `INSERT INTO audit_files
  (file, file_date, indexed_bytes, indexed_lines, size_bytes, mtime_ms, malformed_lines)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(file) DO UPDATE SET
    indexed_bytes = excluded.indexed_bytes,
    indexed_lines = excluded.indexed_lines,
    size_bytes = excluded.size_bytes,
    mtime_ms = excluded.mtime_ms,
    malformed_lines = audit_files.malformed_lines + excluded.malformed_lines`;

/** @type {import('node:sqlite').DatabaseSync|null} */
let _db = null;
/** @type {string} Absolute path of the database file; '' until open() resolved it. */
let _file = '';
/** @type {'closed'|'unavailable'|'building'|'ready'|'failed'} */
let _state = 'closed';
/** @type {string|null} */
let _lastError = null;
/** @type {Record<string, import('node:sqlite').StatementSync>|null} */
let _stmts = null;

/**
 * The capability gate. `require('node:sqlite')` in a try/catch — the module is part of the
 * runtime (Node ≥ 22.13, Electron ≥ 35) and there is nothing to install, rebuild or audit.
 * @returns {typeof import('node:sqlite')|null} `null` when the runtime has no such module.
 */
function _loadSqlite() {
  try {
    return require('node:sqlite');
  } catch (_) {
    return null;
  }
}

/**
 * Open (or create) the index under `userDataPath/audit-index/`. Resets every piece of module
 * state first, the way `dropTracker.reset()` does from `audit-logger.init` — this module is
 * natively cached across a test's `vi.resetModules()`.
 *
 * Returns `'unavailable'` when the engine is absent (nothing touched on disk), `'failed'` when
 * the open threw twice, and `'building'` otherwise: a freshly opened index is never trusted as
 * complete until `audit-index-rebuild` has reconciled it against the directory.
 * @param {Object} opts
 * @param {string} opts.userDataPath - Electron app.getPath('userData')
 * @param {function} [opts.loadSqlite] - Test seam: replaces {@link _loadSqlite}
 * @returns {'unavailable'|'building'|'failed'}
 * @since v0.14.0
 */
function open(opts) {
  close();
  _lastError = null;
  const sqlite = (opts.loadSqlite || _loadSqlite)();
  if (!sqlite) {
    _state = 'unavailable';
    return _state;
  }
  const dir = path.join(opts.userDataPath, INDEX_DIR);
  _file = path.join(dir, INDEX_FILE);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    _db = _openChecked(sqlite);
    _prepare();
    _state = 'building';
  } catch (err) {
    _fail(err);
  }
  return _state;
}

/**
 * Open the file; when it already existed, inspect it and discard it on any doubt. The warn
 * goes out BEFORE the close and the unlink, with the reason and the path.
 * @param {typeof import('node:sqlite')} sqlite
 * @returns {import('node:sqlite').DatabaseSync}
 */
function _openChecked(sqlite) {
  const existed = fs.existsSync(_file);
  let db = new sqlite.DatabaseSync(_file, { enableForeignKeyConstraints: true });
  if (existed) {
    const reason = _inspect(db);
    if (reason !== null) {
      logger.warn('audit-index', 'index discarded, rebuilding from the audit JSONL', {
        reason,
        file: _file,
      });
      try {
        db.close();
      } catch (_) {
        /* a database that cannot be read may not close cleanly; the unlink is what matters */
      }
      _unlinkAll();
      db = new sqlite.DatabaseSync(_file, { enableForeignKeyConstraints: true });
    }
  }
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(SCHEMA_SQL);
  db.exec(`PRAGMA user_version = ${AUDIT_INDEX_SCHEMA_VERSION}`);
  return db;
}

/**
 * Why an existing database is not to be trusted, or `null` when it is. The constructor does
 * not throw on a file that is not a database — the first statement does — so `quick_check`
 * runs inside its own try.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {string|null}
 */
function _inspect(db) {
  let check;
  try {
    check = db.prepare('PRAGMA quick_check').get().quick_check;
  } catch (err) {
    return `quick_check threw: ${err.message}`;
  }
  if (check !== 'ok') return `quick_check: ${check}`;
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version !== AUDIT_INDEX_SCHEMA_VERSION) {
    return `user_version ${version}, expected ${AUDIT_INDEX_SCHEMA_VERSION}`;
  }
  return null;
}

/** Remove the database and its WAL side files; a missing file is not an error. */
function _unlinkAll() {
  for (const suffix of ['', ...SIDE_FILES]) {
    try {
      fs.unlinkSync(_file + suffix);
    } catch (_) {
      /* absent is fine */
    }
  }
}

function _prepare() {
  _stmts = {
    insertEvent: _db.prepare(INSERT_EVENT_SQL),
    upsertFile: _db.prepare(UPSERT_FILE_SQL),
    // The parent row must exist before the first event row: the foreign key is enforced.
    ensureFile: _db.prepare('INSERT OR IGNORE INTO audit_files VALUES (?, ?, 0, 0, 0, 0, 0)'),
    fileRow: _db.prepare('SELECT * FROM audit_files WHERE file = ?'),
    allFiles: _db.prepare('SELECT * FROM audit_files ORDER BY file'),
    deleteFile: _db.prepare('DELETE FROM audit_files WHERE file = ?'),
    countRows: _db.prepare('SELECT count(*) AS n FROM audit_events'),
    countFiles: _db.prepare(
      'SELECT count(*) AS n, coalesce(sum(malformed_lines), 0) AS m FROM audit_files',
    ),
  };
}

/**
 * Record a failure: the database is closed, nothing is unlinked (a failure is not corruption
 * evidence), and `status()` carries the message.
 * @param {Error} err
 */
function _fail(err) {
  _lastError = err && err.message ? err.message : String(err);
  try {
    if (_db) _db.close();
  } catch (_) {
    /* already unusable */
  }
  _db = null;
  _stmts = null;
  _state = 'failed';
}

/**
 * A usable string or null. `''` is absent throughout the internal schema.
 * @param {unknown} v @returns {string|null}
 */
function _text(v) {
  return typeof v === 'string' && v !== '' ? v : null;
}

/** @param {unknown} v @returns {string|null} JSON of an array, or null. */
function _list(v) {
  return Array.isArray(v) ? JSON.stringify(v) : null;
}

/**
 * Project one JSONL line into the column values of `audit_events`, or `null` when the line is
 * not a JSON object (a malformed line is COUNTED, never stored). The ECS columns come from
 * `normalizeToEcs` over the v1 view; a record the normalizer refuses (no `type`) gets NULLs
 * there and is still a row, found by its timestamp.
 * @param {string} line - the line as on disk, without its terminating newline
 * @returns {Array<string|number|null>|null} values in `INSERT_EVENT_SQL` order after `file, line_no`
 * @since v0.14.0
 */
function projectLine(line) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch (_) {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const rec = normalizeAuditEntry(parsed);
  let ecs;
  try {
    ecs = normalizeToEcs(rec);
  } catch (_) {
    ecs = null;
  }
  const ev = (ecs && ecs.event) || {};
  const aegis = (ecs && ecs.aegis) || {};
  const proc = (ecs && ecs.process) || {};
  const agent = aegis.agent || {};
  const attribution = aegis.attribution || {};
  return [
    Number.isSafeInteger(rec.seq) ? rec.seq : null,
    typeof rec.timestamp === 'string' ? rec.timestamp : '',
    typeof rec.type === 'string' ? rec.type : '',
    _text(ev.kind),
    _list(ev.category),
    _list(ev.type),
    _text(ev.action),
    Number.isSafeInteger(aegis.schema_version) ? aegis.schema_version : null,
    _text(agent.name),
    Number.isSafeInteger(proc.pid) ? proc.pid : null,
    _text(proc.entity_id),
    ecs && ecs.file ? _text(ecs.file.path) : null,
    _text(attribution.status),
    typeof rec.action === 'string' ? rec.action : '',
    typeof rec.severity === 'string' ? rec.severity : 'normal',
    line,
  ];
}

/**
 * Write one batch of lines for one file in ONE transaction together with the `audit_files`
 * accounting, so a crash mid-batch leaves the accounting exact. Used by the live `append` and
 * by the rebuild alike.
 * @param {Object} batch
 * @param {string} batch.file - `aegis-audit-YYYY-MM-DD.json`
 * @param {string} batch.fileDate
 * @param {number} batch.firstLineNo - ordinal of `lines[0]` among the file's non-empty lines
 * @param {string[]} batch.lines - non-empty lines, newline stripped
 * @param {number} batch.indexedBytes - byte offset AFTER the last line of this batch
 * @param {number} batch.sizeBytes - file size as observed
 * @param {number} batch.mtimeMs - file mtime as observed
 * @returns {number} lines JSON.parse rejected in this batch (added to `malformed_lines`)
 * @throws when the database is closed or the transaction fails (rolled back first)
 * @since v0.14.0
 */
function writeBatch(batch) {
  if (!_db || !_stmts) throw new Error('audit-index: database is not open');
  let malformed = 0;
  _db.exec('BEGIN');
  try {
    _stmts.ensureFile.run(batch.file, batch.fileDate);
    let lineNo = batch.firstLineNo;
    for (const line of batch.lines) {
      const values = projectLine(line);
      if (values === null) malformed += 1;
      else _stmts.insertEvent.run(batch.file, lineNo, ...values);
      lineNo += 1;
    }
    _stmts.upsertFile.run(
      batch.file,
      batch.fileDate,
      batch.indexedBytes,
      batch.firstLineNo + batch.lines.length,
      batch.sizeBytes,
      batch.mtimeMs,
      malformed,
    );
    _db.exec('COMMIT');
  } catch (err) {
    try {
      _db.exec('ROLLBACK');
    } catch (_) {
      /* the transaction is already gone */
    }
    throw err;
  }
  return malformed;
}

/**
 * `YYYY-MM-DD` out of a daily file name, or '' for a name outside the pattern.
 * @param {string} file @returns {string}
 */
function fileDateOf(file) {
  const m = file.match(/aegis-audit-(\d{4}-\d{2}-\d{2})\.json/);
  return m ? m[1] : '';
}

/**
 * The live path: the batch `flush()` just appended, strictly after `appendFileSync` succeeded.
 * Continuity is checked on BYTES — `indexed_bytes` must equal the file size the write started
 * at — never on the record's `seq`: a file with a repeated seq range (an interrupted write
 * then its retry, which verifyChain documents) would fail a seq check on every later flush and
 * re-index itself once per flush. A mismatch, or a file the index has no row for that is not
 * being written from byte 0, drops that file's rows and puts the index back to `'building'`;
 * the caller schedules the reconcile that re-reads the file from disk.
 * @param {Object} b
 * @param {string} b.file - base name of the daily file
 * @param {number} b.offsetBefore - file size before the write
 * @param {number} b.bytes - bytes the write added
 * @param {string[]} b.lines - the lines written, newline stripped
 * @returns {boolean} `true` when the batch was applied; `false` when it was skipped (index not
 *   ready) or the file was found out of step (index now `'building'`)
 * @since v0.14.0
 */
function append(b) {
  if (_state !== 'ready' || !_db || !_stmts) return false;
  try {
    const row = _stmts.fileRow.get(b.file);
    const known = row ? row.indexed_bytes : 0;
    if (known !== b.offsetBefore) {
      _stmts.deleteFile.run(b.file);
      _state = 'building';
      return false;
    }
    writeBatch({
      file: b.file,
      fileDate: fileDateOf(b.file),
      firstLineNo: row ? row.indexed_lines : 0,
      lines: b.lines,
      indexedBytes: b.offsetBefore + b.bytes,
      sizeBytes: b.offsetBefore + b.bytes,
      mtimeMs: Date.now(),
    });
    return true;
  } catch (err) {
    _fail(err);
    return false;
  }
}

/**
 * Drop a file and, through the foreign key, its rows. A no-op that answers `false` while the
 * database is not open.
 * @param {string} file
 * @returns {boolean}
 * @since v0.14.0
 */
function forget(file) {
  if (!_db || !_stmts) return false;
  _stmts.deleteFile.run(file);
  return true;
}

/**
 * Every `audit_files` row, for the reconcile.
 * @returns {Array<{file: string, file_date: string, indexed_bytes: number, indexed_lines: number,
 *   size_bytes: number, mtime_ms: number, malformed_lines: number}>}
 * @since v0.14.0
 */
function files() {
  if (!_db || !_stmts) throw new Error('audit-index: database is not open');
  return _stmts.allFiles.all();
}

/**
 * State transitions owned by the rebuild: it marks the index `'building'` when it starts and
 * `'ready'` when the directory and the tables agree. `'failed'` carries the error.
 * @param {'building'|'ready'|'failed'} state
 * @param {Error} [err]
 * @since v0.14.0
 */
function setState(state, err) {
  if (!_db) return;
  if (state === 'failed') {
    _fail(err || new Error('rebuild failed'));
    return;
  }
  _state = state;
}

/**
 * What `getStats().index` publishes. Counts are read live while the database is open.
 * @returns {{state: string, files: number, rows: number, malformedLines: number,
 *   lastError: string|null}}
 * @since v0.14.0
 */
function status() {
  let filesCount = 0;
  let rows = 0;
  let malformedLines = 0;
  if (_db && _stmts) {
    try {
      const f = _stmts.countFiles.get();
      filesCount = f.n;
      malformedLines = f.m;
      rows = _stmts.countRows.get().n;
    } catch (err) {
      _fail(err);
    }
  }
  return { state: _state, files: filesCount, rows, malformedLines, lastError: _lastError };
}

/**
 * Close the database. Committed batches are exact, so the next open resumes.
 * @returns {void}
 * @since v0.14.0
 */
function close() {
  if (_db) {
    try {
      _db.close();
    } catch (_) {
      /* already closed */
    }
  }
  _db = null;
  _stmts = null;
  _state = 'closed';
}

/** @internal The open handle, for tests to inspect the tables. `null` when closed. */
function _dbForTest() {
  return _db;
}

module.exports = {
  open,
  close,
  append,
  writeBatch,
  forget,
  files,
  setState,
  status,
  projectLine,
  fileDateOf,
  AUDIT_INDEX_SCHEMA_VERSION,
  INDEX_DIR,
  _dbForTest,
};
