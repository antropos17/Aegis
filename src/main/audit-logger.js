/**
 * @file audit-logger.js
 * @module main/audit-logger
 * @description Persistent audit logging with daily rotation and buffered writes.
 *   Appends structured JSON events to daily log files in userData/audit-logs/.
 * @requires fs
 * @requires path
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.2.0
 */

'use strict';

const fs = require('fs');
const path = require('path');
const hashchain = require('./audit-hashchain');
const dropTracker = require('./audit-drop-tracker');
const { normalizeAuditEntry } = require('./audit-normalize');
const auditIndex = require('./audit-index');
const indexRebuild = require('./audit-index-rebuild');

let _logDir = '';
/** @type {string} userData root, kept for the index which lives beside `audit-logs/`. */
let _userDataPath = '';
/** @type {function|undefined} Test seam forwarded to `auditIndex.open` (docs/roadmap/audit-index.md §2). */
let _loadSqlite;
/**
 * Whether the deferred index open may still run. `init` arms it, `shutdown` disarms it: the open
 * sits on a `setImmediate`, and a shutdown before that tick must leave no database behind.
 * @type {boolean}
 */
let _indexArmed = false;
/** @type {Promise<void>} Settles when the deferred `cleanOldLogs` + index open of the last init ran. */
let _indexReady = Promise.resolve();
/** @type {Promise<void>|null} The reconcile in flight, if any. */
let _indexTask = null;
let _buffer = [];
let _flushTimer = null;
let _onFlushError = null;
const FLUSH_INTERVAL = 5000;
const FLUSH_THRESHOLD = 50;
const RETENTION_DAYS = 30;

/**
 * Hard ceiling on buffered entries. A permanently unwritable disk (full, or permissions
 * revoked) makes every flush fail and re-queue, so without a cap the buffer grows until
 * the process dies — the failure this replaces.
 *
 * 500 is 10x FLUSH_THRESHOLD, which makes it a safety valve rather than an operating
 * mode: a healthy disk flushes at 50 and never comes near it. It is a COUNT, not a byte
 * budget — a caller that puts a large blob in `details` can push real memory past the
 * ~140 KB a full buffer of ordinary entries occupies.
 * @type {number}
 */
const BUFFER_CAP = 500;

/**
 * Default page size for {@link getEntriesBefore} when the caller passes no usable limit.
 * @type {number}
 */
const DEFAULT_READ_LIMIT = 100;

/**
 * Hard ceiling on entries a single {@link getEntriesBefore} call can return. The limit
 * arrives over IPC straight from the renderer, so it is untrusted input: without a cap,
 * one call with `Infinity` (or any huge number) pulls the entire audit corpus into a
 * single IPC response. Like {@link BUFFER_CAP} it is a COUNT, not a byte budget.
 * @type {number}
 */
const MAX_READ_LIMIT = 500;

/**
 * Bounds on the optional `types` filter of {@link getEntriesBefore}. Like `limit` it
 * arrives over IPC raw, so its size is capped here: at most this many type names, each
 * at most {@link MAX_TYPE_LENGTH} characters. Both are COUNTS of what is kept, not
 * grounds for rejecting the call — see {@link _typeFilter}.
 * @type {number}
 */
const MAX_TYPE_FILTER_ENTRIES = 16;

/** @type {number} Longest type name a `types` filter entry may carry. */
const MAX_TYPE_LENGTH = 64;

/**
 * Event Schema version stamped on every record this module writes.
 *
 * Records without the field are v0 — but ONLY when they parse and their hash verifies. A
 * line that fails JSON.parse is a corrupt write, not a legacy record, and a reader must
 * never treat the two the same. The chain check, not this field, is the primary signal.
 *
 * A reader meeting `schemaVersion > 1` must NOT skip the record: seq is monotonic, so
 * dropping one breaks every subsequent hash. Read the fields it recognises, verify the
 * hash, and surface the rest as opaque.
 * @type {number}
 */
const SCHEMA_VERSION = 1;

/** @type {number} Effective cap; overridable via init({ bufferCap }) so tests can evict with a handful of entries. */
let _bufferCap = BUFFER_CAP;

/** Injectable clock — overridable via init({ now }) so day rotation is testable. */
let _now = () => new Date();

/** Hash-chain state for the current daily file (per-file chain; resets each day). */
let _prevHash = hashchain.GENESIS;
let _seq = 0;
let _chainDate = /** @type {string|null} */ (null);

/** In-memory counters — avoids re-reading all log files on every getStats() call */
let _totalEntries = 0;
let _firstEntry = /** @type {string|null} */ (null);
let _lastEntry = /** @type {string|null} */ (null);

/**
 * Entries CONFIRMED written to disk. Distinct from `_totalEntries`, which counts every
 * event handed to {@link log} and therefore includes entries still buffered — or evicted
 * before they were ever written. The gap between the two is the honest measure of how
 * much of the audit trail is not yet durable.
 * @type {number}
 */
let _persistedEntries = 0;

/**
 * Initialise audit logger. Creates audit-logs directory if needed, starts flush timer,
 * and cleans up old log files.
 * @param {Object} opts
 * @param {string} opts.userDataPath - Electron app.getPath('userData')
 * @param {function} [opts.onFlushError] - Called with the Error when a flush write fails
 * @param {function} [opts.now] - Test seam: returns the current Date (defaults to real clock)
 * @param {number} [opts.bufferCap] - Test seam: max buffered entries before drop-oldest
 *   eviction (defaults to {@link BUFFER_CAP})
 * @param {function} [opts.loadSqlite] - Test seam: replaces the index's `node:sqlite` loader,
 *   so a runtime without the engine can be simulated (`() => null`)
 * @returns {void}
 * @since v0.2.0
 */
function init(opts) {
  _onFlushError = opts.onFlushError || null;
  if (opts.now) _now = opts.now;
  _bufferCap = opts.bufferCap != null ? opts.bufferCap : BUFFER_CAP;
  _loadSqlite = opts.loadSqlite;
  // Drop counts describe THIS session — a new init must not inherit a previous one's.
  dropTracker.reset();
  _userDataPath = opts.userDataPath;
  _logDir = path.join(opts.userDataPath, 'audit-logs');
  try {
    if (!fs.existsSync(_logDir)) fs.mkdirSync(_logDir, { recursive: true });
  } catch (err) {
    console.error('[audit-logger] mkdirSync failed:', err.message);
  }
  _seedCounters();
  _flushTimer = setInterval(flush, FLUSH_INTERVAL);
  // Retention first, then the index: a file the sweep deletes is never indexed, and the
  // reconcile that follows the open drops the rows of any file a previous sweep removed.
  _indexArmed = true;
  _indexReady = new Promise((resolve) =>
    setImmediate(() => {
      cleanOldLogs();
      if (_indexArmed) _openIndex();
      resolve();
    }),
  );
}

/**
 * Open the index beside the log directory and, when it opened, reconcile it against the
 * directory. Its own try/catch: nothing here may reach the JSONL path.
 * @returns {void}
 */
function _openIndex() {
  try {
    const state = auditIndex.open({ userDataPath: _userDataPath, loadSqlite: _loadSqlite });
    if (state === 'building') _indexTask = indexRebuild.schedule(_logDir);
  } catch (err) {
    console.error('[audit-logger] index open failed:', err.message);
  }
}

/**
 * Hand the batch a successful flush just wrote to the index — after the JSONL write, the chain
 * state and the counters; inside its own try/catch. The index sees the SAME strings that went
 * to disk. `offsetBefore` is derived from one stat after the write, so a torn write or a file
 * the index does not account for shows up as a byte-offset mismatch and the file is re-read
 * from disk (audit-index.js `append`).
 * @param {string} fp - today's file path
 * @param {number} bytes - bytes the write added
 * @param {string[]} lines - the lines written
 * @returns {void}
 */
function _indexAppend(fp, bytes, lines) {
  try {
    const st = fs.statSync(fp);
    const applied = auditIndex.append({
      file: path.basename(fp),
      offsetBefore: st.size - bytes,
      bytes,
      lines,
    });
    if (!applied && auditIndex.status().state === 'building') {
      _indexTask = indexRebuild.schedule(_logDir);
    }
  } catch (err) {
    console.error('[audit-logger] index append failed:', err.message);
  }
}

/**
 * One-time scan of existing log files to seed in-memory counters.
 * @returns {void}
 */
function _seedCounters() {
  _totalEntries = 0;
  _persistedEntries = 0;
  _firstEntry = null;
  _lastEntry = null;
  if (!_logDir) return;
  try {
    const files = fs
      .readdirSync(_logDir)
      .filter((f) => f.startsWith('aegis-audit-') && f.endsWith('.json'))
      .sort();
    for (const f of files) {
      const fp = path.join(_logDir, f);
      const content = fs.readFileSync(fp, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim().length > 0);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          // Count inside the try, so a malformed line that JSON.parse rejects is not
          // counted as an entry — the previous `+= lines.length` counted it anyway.
          // Loss markers are internal bookkeeping, not audit events, so they are excluded
          // from both counters or every recovered drop would inflate the totals.
          // A marker's timestamp is the wall-clock time of the flush that recovered it,
          // not an event time, so it is excluded from the observed range too — otherwise
          // the date range shown in the UI would extend past the last real event.
          if (entry.type !== dropTracker.MARKER_TYPE) {
            _totalEntries += 1;
            _persistedEntries += 1;
            if (entry.timestamp) {
              if (!_firstEntry || entry.timestamp < _firstEntry) _firstEntry = entry.timestamp;
              if (!_lastEntry || entry.timestamp > _lastEntry) _lastEntry = entry.timestamp;
            }
          }
        } catch (_) {
          /* skip malformed line */
        }
      }
    }
  } catch (err) {
    console.error('[audit-logger] seed counters failed:', err.message);
  }
}

/**
 * Today's date as YYYY-MM-DD (local time, via the injectable clock). Used both
 * for the file name and to detect day rotation in flush().
 * @returns {string}
 */
function _todayDateStr() {
  const d = _now();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Get the log file path for today.
 * @returns {string} Path to today's audit log file.
 * @since v0.2.0
 */
function getTodayLogPath() {
  return path.join(_logDir, `aegis-audit-${_todayDateStr()}.json`);
}

/**
 * Log an audit event. Buffered — writes are flushed every 5s or at 50 events.
 *
 * The buffer is bounded at {@link BUFFER_CAP} entries; past that the OLDEST buffered
 * entry is evicted, which only happens when flushes are failing. Eviction is counted in
 * `getStats().droppedEntries`, and a `buffer-overflow-drop` marker records it on disk at
 * the next successful flush *if one happens before the process exits* — if the disk never
 * recovers, no on-disk trace of the loss exists and the file verifies as valid.
 *
 * Calling this NEVER guarantees durability — compare `totalEntries` against
 * `persistedEntries` for what actually reached disk.
 * Records are written in Event Schema v1: `schemaVersion: 1` plus `pid`, `instanceId` and
 * `attribution` as TOP-LEVEL fields. Earlier code hid those inside `details` believing a
 * changed field set would break the hash chain — it does not. `verifyChain()` rebuilds each
 * record's preimage from that record's own stored fields, so a daily file holding both v0
 * and v1 records verifies end to end. See src/shared/types/events.ts `AuditRecordV1`.
 *
 * `type` is not validated here on purpose: the union in events.ts is the enforced boundary
 * for typed consumers, and this module's own tests pass arbitrary type strings.
 * @param {string} type - One of the `AuditEventType` union in src/shared/types/events.ts
 * @param {Object} details - Event details
 * @param {string} [details.agent] - Agent display name; omit or `''` when unattributed
 * @param {number|null} [details.pid] - OS pid. Omitted becomes `null`, NEVER 0 — pid 0 is a
 *   real value meaning a synthetic (pid-less) agent
 * @param {string|null} [details.instanceId] - Process identity; `null` when the call site
 *   has none. Never derive one by joining on a name
 * @param {Object|null} [details.attribution] - `{status, evidence[]}`, or omitted when the
 *   ownership question does not APPLY to this event type — which is not the same as
 *   `status: 'unattributed'` (question applies, owner unknown)
 * @param {string} [details.action] - Action performed
 * @param {string} [details.path] - File or network path
 * @param {string} [details.severity] - Event severity
 * @param {number} [details.riskScore] - Vestigial; always 0 in v1
 * @param {Object} [details.extra] - Event-specific extras, stored as the `details` field
 * @returns {void}
 * @since v0.2.0
 */
function log(type, details) {
  if (!_logDir) return;
  const entry = {
    schemaVersion: SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    type,
    agent: details.agent || '',
    // `??` not `||`: pid 0 is a REAL value (synthetic agent), so `|| null` would erase it
    // and `|| 0` would turn a missing pid into a false synthetic-agent claim.
    pid: details.pid ?? null,
    instanceId: details.instanceId ?? null,
    action: details.action || '',
    path: details.path || '',
    severity: details.severity || 'normal',
    riskScore: details.riskScore || 0,
    attribution: details.attribution ?? null,
    details: details.extra || null,
  };
  // Whether the buffer was ALREADY at the cap before this push. Once it is, the
  // FLUSH_THRESHOLD auto-flush is suppressed and only the 5s timer drives writes:
  // at the cap every log() would otherwise re-hash the whole buffer, so a broken disk
  // would turn each event into hundreds of wasted SHA-256 computations.
  const atCapBefore = _buffer.length >= _bufferCap;

  _buffer.push(entry);
  _totalEntries++;
  if (!_firstEntry || entry.timestamp < _firstEntry) _firstEntry = entry.timestamp;
  if (!_lastEntry || entry.timestamp > _lastEntry) _lastEntry = entry.timestamp;
  _trimToCap();
  if (!atCapBefore && _buffer.length >= FLUSH_THRESHOLD) flush();
}

/**
 * Enforce {@link BUFFER_CAP} by evicting from the FRONT of the buffer (drop-oldest).
 *
 * Both policies are chain-safe — seq is assigned in {@link flush}, so nothing in the
 * buffer owns a seq yet. The choice is operational: AEGIS is a monitor, and when the disk
 * is failing the useful records are the ones describing what an agent is doing NOW.
 * Drop-newest would preserve stale history while silencing live anomaly alerts.
 *
 * Called from {@link log} after a push, and from {@link flush}'s failure path after the
 * pristine batch is re-queued.
 * @returns {void}
 * @since v0.11.0
 */
function _trimToCap() {
  while (_buffer.length > _bufferCap) {
    const evicted = _buffer.shift();
    dropTracker.record(evicted.timestamp);
  }
}

/**
 * Flush the buffer to disk, appending entries to today's log file.
 *
 * Each entry is hash-chained: it gains a per-file `seq` and a `hash` binding it to
 * the previous record (see audit-hashchain.js). The chain state (_prevHash/_seq/
 * _chainDate) advances ONLY after a successful write, so a failed flush re-queues
 * the pristine entries without consuming seq numbers — the next flush renumbers
 * from the same point, keeping the chain gap-free (C-03 recovery).
 *
 * If entries were evicted since the last successful flush, a `buffer-overflow-drop`
 * marker leads the batch and is chained like any record. See audit-drop-tracker.js for
 * why the file needs it and why it is best-effort.
 * @returns {void}
 * @since v0.2.0
 */
function flush() {
  // Gate on pending drops too: after eviction the buffer can be empty while a marker is
  // still owed, and returning early there would discard the only record of the loss.
  if ((_buffer.length === 0 && dropTracker.pendingCount() === 0) || !_logDir) return;
  const entries = _buffer.splice(0);
  const fp = getTodayLogPath();
  const todayDate = _todayDateStr();

  // Seed the chain: continue the in-memory state for the same day, otherwise
  // (process start or day rollover) resume from the tail of today's file.
  let prevHash;
  let seq;
  if (_chainDate === todayDate) {
    prevHash = _prevHash;
    seq = _seq;
  } else {
    const seed = hashchain.seedFromTail(fp);
    prevHash = seed.prevHash;
    seq = seed.seq;
  }

  const out = [];

  // A loss marker leads the batch so it sits at the START of the window whose records
  // are missing. It is deliberately NOT pushed into `entries`: that array must stay
  // pristine for the C-03 re-queue below, and a marker baked into it would be written
  // twice once the disk recovered.
  //
  // Best-effort by construction: the marker is only written by the NEXT SUCCESSFUL
  // flush. If the disk never recovers and the process exits, it never reaches disk and
  // the file verifies clean with no on-disk trace of the loss.
  if (dropTracker.pendingCount() > 0) {
    const marker = dropTracker.buildMarker(_now().toISOString(), SCHEMA_VERSION);
    const markerHash = hashchain.computeHash(prevHash, marker);
    out.push(JSON.stringify({ ...marker, seq, hash: markerHash }));
    prevHash = markerHash;
    seq += 1;
  }

  for (const e of entries) {
    const hash = hashchain.computeHash(prevHash, e);
    out.push(JSON.stringify({ ...e, seq, hash }));
    prevHash = hash;
    seq += 1;
  }

  const text = out.join('\n') + '\n';
  let written = false;
  try {
    fs.appendFileSync(fp, text, 'utf-8');
    written = true;
    _prevHash = prevHash;
    _seq = seq;
    _chainDate = todayDate;
    // Only now is anything durable. `entries.length`, not `out.length` — the marker is
    // bookkeeping, not an audit event.
    _persistedEntries += entries.length;
    dropTracker.clearPending();
  } catch (err) {
    if (_onFlushError) _onFlushError(err);
    // Re-queue PRISTINE entries (no seq/hash baked in) and leave chain state
    // unadvanced so the retry produces an unbroken chain. Pending drops are
    // deliberately NOT cleared: the marker written on recovery must cover every drop
    // across all failed attempts, not just the last batch.
    _buffer = entries.concat(_buffer);
    // The onFlushError callback runs before this and may itself call log(), so the
    // concatenation can exceed the cap. A no-op in the normal case.
    _trimToCap();
  }
  // Canon first, projection last: the index is fed only once the lines are on disk and the
  // chain has advanced, outside the write's try/catch so it can neither fail this write nor
  // re-queue the batch, and it never touches the counters above.
  if (written) _indexAppend(fp, Buffer.byteLength(text, 'utf-8'), out);
}

/**
 * Delete audit log files older than RETENTION_DAYS.
 * @returns {void}
 * @since v0.2.0
 */
function cleanOldLogs() {
  if (!_logDir) return;
  try {
    const files = fs
      .readdirSync(_logDir)
      .filter((f) => f.startsWith('aegis-audit-') && f.endsWith('.json'));
    const cutoff = Date.now() - RETENTION_DAYS * 86400000;
    for (const f of files) {
      const match = f.match(/aegis-audit-(\d{4}-\d{2}-\d{2})\.json/);
      if (match) {
        const fileDate = new Date(match[1]).getTime();
        if (fileDate < cutoff) {
          try {
            fs.unlinkSync(path.join(_logDir, f));
          } catch (err) {
            console.error('[audit-logger] unlink old log failed:', err.message);
          }
        }
      }
    }
  } catch (err) {
    console.error('[audit-logger] cleanOldLogs failed:', err.message);
  }
}

/**
 * Get audit log statistics, including durability counters.
 *
 * The counters answer different questions and are meant to be read together. The one that
 * matters when something is wrong is `droppedEntries + bufferDepth`: that is how many
 * events would be missing from the audit file if the process stopped right now. Buffered
 * entries are only "pending" while the disk is writable — under a full disk they are just
 * as lost as evicted ones, they simply have not been counted as lost yet.
 *
 * `firstEntry`/`lastEntry` are the earliest and latest timestamps OBSERVED this session,
 * including entries still buffered and entries evicted before they reached disk — so they
 * are not necessarily the bounds of what the files contain.
 * @returns {{totalEntries: number, persistedEntries: number, droppedEntries: number,
 *   bufferDepth: number, totalSize: number, currentSize: number, firstEntry: string|null,
 *   lastEntry: string|null, index: {state: string, files: number, rows: number,
 *   malformedLines: number, lastError: string|null}}}
 *   `index` — the audit index (docs/roadmap/audit-index.md): `state` is `unavailable` on a
 *   runtime without `node:sqlite`, `building` until the reconcile finishes, `ready`, `failed`
 *   (with `lastError`) or `closed`; counts are read live from the tables. Additive, and not a
 *   sensor: nothing about the app's health reads it.
 *   `totalEntries` — events handed to {@link log} this session plus records found on disk
 *   at init. It counts entries still in the buffer AND entries evicted under a full
 *   buffer that will never reach disk, so under overflow it permanently exceeds the real
 *   record count by `droppedEntries`; it is not a measure of what was retained.
 *   `persistedEntries` — entries confirmed written (markers excluded). `droppedEntries` —
 *   evictions this session, reset on restart; the cross-restart record is the on-disk
 *   marker, which is best-effort and absent if the process exited with the disk still
 *   full. `bufferDepth` — entries buffered right now.
 * @since v0.2.0
 */
function getStats() {
  if (!_logDir)
    return {
      totalEntries: 0,
      persistedEntries: 0,
      droppedEntries: 0,
      bufferDepth: 0,
      totalSize: 0,
      currentSize: 0,
      firstEntry: null,
      lastEntry: null,
      index: auditIndex.status(),
    };
  let totalSize = 0;
  let currentSize = 0;
  try {
    const files = fs
      .readdirSync(_logDir)
      .filter((f) => f.startsWith('aegis-audit-') && f.endsWith('.json'));
    const todayPath = getTodayLogPath();
    for (const f of files) {
      const fp = path.join(_logDir, f);
      const stat = fs.statSync(fp);
      totalSize += stat.size;
      if (fp === todayPath) currentSize = stat.size;
    }
  } catch (err) {
    console.error('[audit-logger] getStats failed:', err.message);
  }
  return {
    totalEntries: _totalEntries,
    persistedEntries: _persistedEntries,
    droppedEntries: dropTracker.totalDropped(),
    bufferDepth: _buffer.length,
    totalSize,
    currentSize,
    firstEntry: _firstEntry,
    lastEntry: _lastEntry,
    index: auditIndex.status(),
  };
}

/**
 * Export all audit logs into a single combined array.
 *
 * Records are returned RAW, exactly as stored — deliberately not passed through
 * {@link normalizeAuditEntry}. This is the forensic path: a reader must be able to see the
 * real field set each version wrote, and must receive every line (including
 * `buffer-overflow-drop` markers) so the hash chain can be replayed. Use
 * `normalizeAuditEntry` on the caller side if a uniform shape is wanted.
 * @returns {Object[]} Array of all audit log entries, mixed schema versions possible.
 * @since v0.2.0
 */
function exportAll() {
  flush();
  const all = [];
  if (!_logDir) return all;
  try {
    const files = fs
      .readdirSync(_logDir)
      .filter((f) => f.startsWith('aegis-audit-') && f.endsWith('.json'))
      .sort();
    for (const f of files) {
      const content = fs.readFileSync(path.join(_logDir, f), 'utf-8');
      for (const line of content.split('\n')) {
        if (line.trim()) {
          try {
            all.push(JSON.parse(line));
          } catch (_) {
            /* skip malformed line */
          }
        }
      }
    }
  } catch (err) {
    console.error('[audit-logger] exportAll failed:', err.message);
  }
  return all;
}

/**
 * Stop the flush timer, flush the remaining buffer, then close the index — after the flush,
 * so the last batch reaches the tables; disarmed first, so an open still pending on its
 * `setImmediate` never runs after this.
 * @returns {void}
 * @since v0.2.0
 */
function shutdown() {
  _indexArmed = false;
  if (_flushTimer) {
    clearInterval(_flushTimer);
    _flushTimer = null;
  }
  flush();
  auditIndex.close();
}

/**
 * Read lines from the end of a file without loading the whole thing.
 * Reads in reverse chunks and yields complete lines newest-first.
 * @param {string} filePath
 * @param {function} onLine - Called with each line string (newest first). Return false to stop.
 * @param {number} [chunkSize=4096]
 */
function readLinesReverse(filePath, onLine, chunkSize = 4096) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    let pos = stat.size;
    let trailing = '';
    while (pos > 0) {
      const readSize = Math.min(chunkSize, pos);
      pos -= readSize;
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, pos);
      const chunk = buf.toString('utf-8') + trailing;
      const lines = chunk.split('\n');
      // First element is a partial line (or empty) — carry it over
      trailing = lines.shift();
      // Process lines from end to start (newest first)
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim()) {
          if (onLine(lines[i]) === false) return;
        }
      }
    }
    // Handle the final remaining fragment
    if (trailing.trim()) onLine(trailing);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Normalise the `types` argument of {@link getEntriesBefore} into a Set, or `null` for
 * "no filter". Not an array, or empty → no filter; entries that are not strings, or are
 * longer than {@link MAX_TYPE_LENGTH}, are dropped; the first
 * {@link MAX_TYPE_FILTER_ENTRIES} survivors are kept. Nothing surviving is no filter —
 * the same shape as an unusable `limit` falling back to the default instead of rejecting
 * the call.
 * @param {unknown} types
 * @returns {Set<string>|null}
 */
function _typeFilter(types) {
  if (!Array.isArray(types) || types.length === 0) return null;
  const kept = types
    .filter((t) => typeof t === 'string' && t.length <= MAX_TYPE_LENGTH)
    .slice(0, MAX_TYPE_FILTER_ENTRIES);
  return kept.length > 0 ? new Set(kept) : null;
}

/**
 * The calendar day after `dateStr` (`YYYY-MM-DD`), computed in UTC so that no local
 * zone or DST step can move it. `dateStr` has passed the shape check in
 * {@link getEntriesBefore} but may still be no calendar date (`2026-13-45`): `Date` is
 * then invalid and `toISOString` would throw, so the input comes back unchanged — the
 * plain "skip files after the cursor date" rule — rather than surfacing through the
 * generic read-failure catch as what looks like an empty log.
 * @param {string} dateStr
 * @returns {string}
 */
function _nextDateStr(dateStr) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Return up to `limit` audit entries with timestamps strictly before `beforeTs`.
 * Reads log files in reverse-chronological order for efficiency.
 *
 * All three parameters cross the IPC boundary raw (ipc-handlers.js passes them through),
 * so all three are validated HERE rather than at the handler — every caller gets the same
 * guarantees:
 * - `limit` is clamped to an integer in [1, {@link MAX_READ_LIMIT}]; anything
 *   non-numeric (including missing) falls back to {@link DEFAULT_READ_LIMIT}. The
 *   function is structurally unable to return more than {@link MAX_READ_LIMIT} entries.
 * - a `beforeTs` that is not a `YYYY-MM-DD`-prefixed string returns `[]` via an explicit
 *   early return that logs the reason. That path is deliberately distinct from the
 *   generic read-failure catch below: a rejected cursor must never read as an empty log.
 * - `types`, when given, keeps only entries whose `type` is in it, and the filter is
 *   applied while reading so a page holds `limit` MATCHING entries: a caller that filtered
 *   after the fetch would see an empty page across any run of `limit` unwanted records and
 *   could not tell it from the end of the log. Normalised by {@link _typeFilter}.
 *
 * Which files are opened: every file dated up to and including the day AFTER the
 * cursor's UTC date. A file is named with the LOCAL date of the flush that wrote it
 * ({@link getTodayLogPath}) while a record's timestamp is UTC at log() time, so a record
 * whose UTC date is D can sit in the file of D+1 — flushed after local midnight by the
 * 5 s timer, or, for any zone east of UTC, logged between local 00:00 and UTC 00:00. It
 * cannot sit in D+2 while the disk is writable: the flush lag needs the record logged at
 * the end of a local day, where local date and UTC date are one day apart at most in the
 * direction that keeps the file at D+1. What this bound does NOT cover is a batch
 * re-queued by a failing flush and written on a later day (see {@link flush}). The cost is
 * one extra reverse read of the D+1 file per call — its mislaid lines sit at the HEAD,
 * where a reverse read meets them last — measured at ~12 ms for a 7.3k-line day.
 * @param {string} beforeTs - ISO timestamp upper bound (exclusive)
 * @param {number} [limit=100] - Max entries to return (clamped, see above)
 * @param {string[]} [types] - Event types to keep; omitted or unusable → every type
 * @returns {Object[]} Entries sorted oldest-first
 * @since v0.5.0
 */
function getEntriesBefore(beforeTs, limit = DEFAULT_READ_LIMIT, types) {
  if (typeof beforeTs !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(beforeTs)) {
    const got =
      typeof beforeTs === 'string'
        ? `malformed string ${JSON.stringify(beforeTs.slice(0, 40))}`
        : typeof beforeTs;
    console.warn(`[audit-logger] getEntriesBefore: invalid beforeTs (${got}) — returning []`);
    return [];
  }
  limit =
    typeof limit === 'number' && !Number.isNaN(limit)
      ? Math.min(MAX_READ_LIMIT, Math.max(1, Math.floor(limit)))
      : DEFAULT_READ_LIMIT;
  const typeFilter = _typeFilter(types);
  flush();
  if (!_logDir) return [];
  const results = [];
  try {
    // The last file worth opening: the day after the cursor's UTC date (see the JSDoc).
    const lastDate = _nextDateStr(beforeTs.slice(0, 10)); // 'YYYY-MM-DD'
    const files = fs
      .readdirSync(_logDir)
      .filter((f) => f.startsWith('aegis-audit-') && f.endsWith('.json'))
      .sort()
      .reverse();
    for (const f of files) {
      const match = f.match(/aegis-audit-(\d{4}-\d{2}-\d{2})\.json/);
      if (!match) continue;
      // Skip files for days strictly after the cursor date's successor
      if (match[1] > lastDate) continue;
      const fp = path.join(_logDir, f);
      readLinesReverse(fp, (line) => {
        try {
          const entry = JSON.parse(line);
          // Loss markers are excluded here — this feeds the paginated activity view,
          // which shows agent events. exportAll() keeps them: a forensic export must
          // carry the evidence that records are missing, and verifyChain needs every
          // line to replay the chain.
          if (
            entry.timestamp &&
            entry.timestamp < beforeTs &&
            entry.type !== dropTracker.MARKER_TYPE &&
            (typeFilter === null || typeFilter.has(entry.type))
          ) {
            // Normalized so the UI sees one field set regardless of which app version
            // wrote the line. exportAll() deliberately does NOT do this: an export is
            // forensic and must show exactly what is on disk.
            results.push(normalizeAuditEntry(entry));
            if (results.length >= limit) return false;
          }
        } catch (_) {
          /* skip malformed line */
        }
      });
      if (results.length >= limit) break;
    }
  } catch (err) {
    console.error('[audit-logger] getEntriesBefore failed:', err.message);
  }
  // Return oldest-first
  results.reverse();
  return results;
}

module.exports = {
  init,
  log,
  flush,
  shutdown,
  getStats,
  exportAll,
  getEntriesBefore,
  verifyChain: hashchain.verifyChain,
  getLogDir: () => _logDir,
  normalizeAuditEntry,
  SCHEMA_VERSION,
  MAX_READ_LIMIT,
  /**
   * @internal Settles once the deferred open of the last `init` and any reconcile in flight
   * have finished, so a test can inspect the tables (for tests).
   * @returns {Promise<void>}
   */
  _awaitIndexForTest: async () => {
    await _indexReady;
    if (_indexTask) await _indexTask;
  },
};
