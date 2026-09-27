/**
 * @file logger.js
 * @module main/logger
 * @description Operational structured logger with buffered NDJSON writes, daily
 *   rotation, and 30-day retention. Mirrors audit-logger.js pattern but targets
 *   app diagnostics rather than security events.
 * @requires fs
 * @requires path
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 */

'use strict';

const fs = require('fs');
const path = require('path');
const logFiles = require('./log-files');

let _logDir = '';
let _isDev = false;
let _minLevel = 0;
let _buffer = [];
let _flushTimer = null;
let _cleanImmediate = null;
let _seedGeneration = 0;
let _seedDone = true;
const FLUSH_INTERVAL = 5000;
const FLUSH_THRESHOLD = 50;
const RETENTION_DAYS = 30;

/** In-memory counter — avoids re-reading today's log file on every getStats() call */
let _todayEntries = 0;
let _todayDate = '';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LEVEL_LABELS = { debug: 'DEBUG', info: 'INFO ', warn: 'WARN ', error: 'ERROR' };

/**
 * Initialise the operational logger.
 * @param {Object} opts
 * @param {string} opts.userDataPath - Electron app.getPath('userData')
 * @param {boolean} [opts.isDev=false] - Write to stderr when true
 * @param {string} [opts.minLevel='debug'] - Minimum log level
 * @returns {void}
 */
function init(opts) {
  _logDir = path.join(opts.userDataPath, 'logs');
  _isDev = !!opts.isDev;
  _minLevel = LEVELS[opts.minLevel] || 0;
  try {
    if (!fs.existsSync(_logDir)) fs.mkdirSync(_logDir, { recursive: true });
  } catch {
    console.error('[logger] mkdirSync failed');
  }
  _seedTodayCount();
  _flushTimer = setInterval(flush, FLUSH_INTERVAL);
  _cleanImmediate = setImmediate(() => {
    _cleanImmediate = null;
    cleanOldLogs();
  });
}

/**
 * Restore a small durable count, or stream legacy logs without blocking startup.
 * @param {string} [day] Local date key.
 * @returns {void}
 */
function _seedTodayCount(day = logFiles.dateKey(new Date())) {
  _todayEntries = 0;
  _todayDate = day;
  _seedDone = false;
  const generation = ++_seedGeneration;
  if (!_logDir) return;
  try {
    const saved = logFiles.readCount(_logDir, day);
    if (saved !== null) {
      _todayEntries = saved;
      _seedDone = true;
      return;
    }
    const hasLogs = logFiles.listLogFiles(_logDir).some((name) => name.startsWith(`aegis-${day}`));
    if (!hasLogs) {
      _seedDone = true;
      return;
    }
    void logFiles
      .scanCount(_logDir, day)
      .then((count) => {
        if (generation !== _seedGeneration || day !== _todayDate) return;
        _todayEntries += count;
        _seedDone = true;
        try {
          logFiles.writeCount(_logDir, day, _todayEntries);
        } catch {
          console.error('[logger] seed count persistence failed');
        }
      })
      .catch(() => {
        if (generation === _seedGeneration) console.error('[logger] seed today count failed');
      });
  } catch {
    console.error('[logger] seed today count failed');
  }
}

/**
 * Internal write — buffers entry and optionally writes to stderr.
 * @param {string} level
 * @param {string} mod
 * @param {string} message
 * @param {Object} [meta]
 */
function _write(level, mod, message, meta) {
  if (LEVELS[level] < _minLevel) return;

  const now = new Date();
  const timestamp = now.toISOString();
  const entry = { timestamp, level, module: mod, message };
  if (meta !== undefined) entry.meta = meta;
  let line;
  try {
    line = JSON.stringify(entry);
  } catch {
    line = '';
  }
  const omitted = !line || Buffer.byteLength(line, 'utf-8') + 1 > logFiles.MAX_ENTRY_BYTES;
  if (omitted) {
    line = JSON.stringify({
      timestamp,
      level,
      module: 'logger',
      message: 'Operational log entry omitted because it exceeded the size limit',
    });
  }

  if (_isDev) {
    const metaStr = !omitted && meta ? ' ' + JSON.stringify(meta) : '';
    process.stderr.write(
      `[${timestamp}] ${LEVEL_LABELS[level]} [${omitted ? 'logger' : mod}] ${omitted ? 'Operational log entry omitted because it exceeded the size limit' : message}${metaStr}\n`,
    );
  }

  if (!_logDir) return;
  const dateStr = logFiles.dateKey(now);
  if (dateStr !== _todayDate) {
    _seedTodayCount(dateStr);
  }
  _buffer.push({ day: dateStr, line });
  _todayEntries++;
  if (_buffer.length >= FLUSH_THRESHOLD) flush();
}

function debug(mod, message, meta) {
  _write('debug', mod, message, meta);
}
function info(mod, message, meta) {
  _write('info', mod, message, meta);
}
function warn(mod, message, meta) {
  _write('warn', mod, message, meta);
}
function error(mod, message, meta) {
  _write('error', mod, message, meta);
}

/**
 * Flush the buffer to disk.
 * @returns {void}
 */
function flush() {
  if (_buffer.length === 0 || !_logDir) return;
  const entries = _buffer.splice(0);
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.day)) groups.set(entry.day, []);
    groups.get(entry.day).push(entry.line);
  }
  try {
    for (const [day, lines] of groups) logFiles.appendLines(_logDir, day, lines);
  } catch {
    console.error('[logger] flush write failed');
    return;
  }
  if (groups.has(_todayDate) && _seedDone) {
    try {
      logFiles.writeCount(_logDir, _todayDate, _todayEntries);
    } catch {
      console.error('[logger] count persistence failed');
    }
  }
}

/**
 * Delete log files older than RETENTION_DAYS.
 * @returns {void}
 */
function cleanOldLogs() {
  if (!_logDir) return;
  try {
    logFiles.cleanOldLogs(_logDir, RETENTION_DAYS);
  } catch {
    console.error('[logger] cleanOldLogs failed');
  }
}

/**
 * Stop the flush timer and flush remaining buffer.
 * @returns {void}
 */
function shutdown() {
  _seedGeneration++;
  if (_cleanImmediate) {
    clearImmediate(_cleanImmediate);
    _cleanImmediate = null;
  }
  if (_flushTimer) {
    clearInterval(_flushTimer);
    _flushTimer = null;
  }
  flush();
}

/**
 * Get operational log statistics.
 * @returns {{logDir: string, todayEntries: number, totalFiles: number, recordingSince: string}}
 */
function getStats() {
  if (!_logDir) return { logDir: '', todayEntries: 0, totalFiles: 0, recordingSince: '' };
  let totalFiles = 0;
  let recordingSince = '';
  try {
    const files = logFiles.listLogFiles(_logDir);
    totalFiles = files.length;
    if (files.length > 0) {
      recordingSince = files[0].slice(6, 16);
    }
  } catch {
    console.error('[logger] getStats failed');
  }
  return { logDir: _logDir, todayEntries: _todayEntries, totalFiles, recordingSince };
}

/**
 * Export all operational logs into a single combined array.
 * @returns {Object[]}
 */
function exportAll() {
  flush();
  const all = [];
  if (!_logDir) return all;
  try {
    const files = logFiles.listLogFiles(_logDir);
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
  } catch {
    console.error('[logger] exportAll failed');
  }
  return all;
}

module.exports = {
  init,
  debug,
  info,
  warn,
  error,
  flush,
  shutdown,
  getStats,
  exportAll,
  getLogDir: () => _logDir,
};
