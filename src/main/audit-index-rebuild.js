/**
 * @file audit-index-rebuild.js
 * @module main/audit-index-rebuild
 * @description Rebuilds and reconciles the audit index (`audit-index.js`) from the daily JSONL
 *   files — the canon. Runs after `cleanOldLogs` on every `init`, and again whenever the live
 *   `append` finds a file out of step. Each daily file is streamed in ~2000-line batches, one
 *   transaction per batch, with a `setImmediate` yield between batches so the main thread is
 *   never held for a whole rebuild.
 *
 *   Resume, not restart: `audit_files.indexed_bytes` is the offset after the last line the
 *   index holds, so a file that only grew is read from there. A file that shrank, or whose
 *   size is unchanged while its mtime moved, is re-indexed in full. An in-place edit of the
 *   same length inside the same millisecond is invisible here BY DESIGN — content integrity is
 *   the hash chain's job (`verifyChain`), the projection's job is to mirror the lines. A chain
 *   break is never repaired: every parseable line becomes a row with its own `seq` as written,
 *   a malformed line is counted in `malformed_lines` and not stored.
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
const index = require('./audit-index');

/** @type {number} Lines per transaction; a batch is what one main-thread turn spends. */
const BATCH_LINES = 2000;
/** @type {number} */
const CHUNK_BYTES = 64 * 1024;
/**
 * Rounds of "re-stat everything and resume what grew" after the main pass. Lines flushed while
 * a batch was yielding are on disk but not in the tables; the rounds close that gap before the
 * index is declared ready and the live `append` takes over.
 * @type {number}
 */
const TAIL_ROUNDS = 3;

/** @type {Promise<void>|null} The reconcile in flight, so a second request joins it. */
let _pending = null;

/**
 * Daily files under `logDir` with the stat the decision needs.
 * @param {string} logDir
 * @returns {Map<string, {size: number, mtimeMs: number}>}
 */
function listDayFiles(logDir) {
  const out = new Map();
  for (const f of fs.readdirSync(logDir)) {
    if (!f.startsWith('aegis-audit-') || !f.endsWith('.json')) continue;
    const st = fs.statSync(path.join(logDir, f));
    out.set(f, { size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
  }
  return out;
}

/**
 * Where to start reading a file, or `null` to leave it alone.
 * @param {{indexed_bytes: number, indexed_lines: number, mtime_ms: number}|undefined} row
 * @param {{size: number, mtimeMs: number}} stat
 * @param {string} fp
 * @returns {{bytes: number, lineNo: number}|null}
 */
function decide(row, stat, fp) {
  if (!row) return { bytes: 0, lineNo: 0 };
  if (stat.size < row.indexed_bytes) return { bytes: 0, lineNo: 0 };
  if (stat.size === row.indexed_bytes) {
    return stat.mtimeMs === row.mtime_ms ? null : { bytes: 0, lineNo: 0 };
  }
  if (row.indexed_bytes === 0) return { bytes: 0, lineNo: 0 };
  // Grown: the byte before the resume point must be the newline that closed the last
  // indexed line, or the file was rewritten under the same prefix length.
  const fd = fs.openSync(fp, 'r');
  try {
    const one = Buffer.alloc(1);
    fs.readSync(fd, one, 0, 1, row.indexed_bytes - 1);
    if (one[0] !== 0x0a) return { bytes: 0, lineNo: 0 };
  } finally {
    fs.closeSync(fd);
  }
  return { bytes: row.indexed_bytes, lineNo: row.indexed_lines };
}

/** @returns {Promise<void>} */
function yieldTick() {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Stream one file from `start` into the index, batch by batch. A trailing fragment without a
 * newline is a write in progress and is not consumed: `indexed_bytes` stops at the last newline.
 * @param {string} logDir
 * @param {string} file
 * @param {{size: number, mtimeMs: number}} stat
 * @param {{bytes: number, lineNo: number}} start
 * @returns {Promise<void>}
 */
async function indexFile(logDir, file, stat, start) {
  if (start.bytes === 0) index.forget(file);
  const fileDate = index.fileDateOf(file);
  const fd = fs.openSync(path.join(logDir, file), 'r');
  try {
    const chunk = Buffer.alloc(CHUNK_BYTES);
    let carry = Buffer.alloc(0);
    let pos = start.bytes;
    let consumed = start.bytes;
    let lineNo = start.lineNo;
    let lines = [];
    const commit = () => {
      index.writeBatch({
        file,
        fileDate,
        firstLineNo: lineNo,
        lines,
        indexedBytes: consumed,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
      });
      lineNo += lines.length;
      lines = [];
    };
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, CHUNK_BYTES, pos);
      if (n === 0) break;
      pos += n;
      const data =
        carry.length > 0 ? Buffer.concat([carry, chunk.subarray(0, n)]) : chunk.subarray(0, n);
      const base = consumed;
      let from = 0;
      for (;;) {
        const nl = data.indexOf(0x0a, from);
        if (nl === -1) break;
        const text = data.subarray(from, nl).toString('utf-8').replace(/\r$/, '');
        consumed = base + nl + 1;
        from = nl + 1;
        if (text.trim().length > 0) lines.push(text);
        if (lines.length >= BATCH_LINES) {
          commit();
          await yieldTick();
        }
      }
      carry = Buffer.from(data.subarray(from));
    }
    // Always commit once: a file with no complete line still needs its row.
    commit();
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * One pass over the directory: index what the decision says. Answers whether anything was read.
 * @param {string} logDir
 * @param {Map<string, {size: number, mtimeMs: number}>} onDisk
 * @returns {Promise<boolean>}
 */
async function settle(logDir, onDisk) {
  const rows = new Map(index.files().map((r) => [r.file, r]));
  let touched = false;
  for (const [file, stat] of onDisk) {
    const start = decide(rows.get(file), stat, path.join(logDir, file));
    if (start === null) continue;
    await indexFile(logDir, file, stat, start);
    await yieldTick();
    touched = true;
  }
  return touched;
}

/**
 * Bring the tables in line with the directory: rows for a file that no longer exists
 * (retention) go; a file with no rows is indexed; a file that grew is resumed; a file that
 * shrank or was rewritten is re-indexed. Ends by marking the index ready.
 * @param {string} logDir
 * @returns {Promise<void>}
 * @since v0.14.0
 */
async function reconcile(logDir) {
  const onDisk = listDayFiles(logDir);
  for (const row of index.files()) {
    if (!onDisk.has(row.file)) index.forget(row.file);
  }
  await settle(logDir, onDisk);
  for (let round = 0; round < TAIL_ROUNDS; round++) {
    if (!(await settle(logDir, listDayFiles(logDir)))) break;
  }
  index.setState('ready');
}

/**
 * Run {@link reconcile} on the next `setImmediate`, once: a request while one is in flight
 * joins it. The index is `'building'` from this call until the reconcile marks it ready; a
 * throw marks it `'failed'` with the error — unless the database was closed underneath it
 * (shutdown), which is not a failure.
 * @param {string} logDir - the `audit-logs` directory
 * @returns {Promise<void>} settles when the reconcile has finished either way
 * @since v0.14.0
 */
function schedule(logDir) {
  if (_pending) return _pending;
  index.setState('building');
  _pending = yieldTick()
    .then(() => reconcile(logDir))
    .catch((err) => {
      if (index.status().state === 'closed') return;
      logger.error('audit-index', 'rebuild failed', { error: err.message, logDir });
      index.setState('failed', err);
    })
    .finally(() => {
      _pending = null;
    });
  return _pending;
}

module.exports = { schedule, reconcile, BATCH_LINES };
