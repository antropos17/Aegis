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

let _logDir = '';
let _isDev = false;
let _minLevel = 0;
let _buffer = [];
let _flushTimer = null;
const FLUSH_INTERVAL = 5000;
const FLUSH_THRESHOLD = 50;
const RETENTION_DAYS = 30;

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
  } catch (_) {}
  _flushTimer = setInterval(flush, FLUSH_INTERVAL);
  cleanOldLogs();
}

/**
 * @returns {string} Path to today's log file.
 */
function getTodayLogPath() {
  const d = new Date();
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return path.join(_logDir, `aegis-${dateStr}.log`);
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

  const timestamp = new Date().toISOString();
  const entry = { timestamp, level, module: mod, message };
  if (meta !== undefined) entry.meta = meta;

  if (_isDev) {
    const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
    process.stderr.write(`[${timestamp}] ${LEVEL_LABELS[level]} [${mod}] ${message}${metaStr}\n`);
  }

  if (!_logDir) return;
  _buffer.push(entry);
  if (_buffer.length >= FLUSH_THRESHOLD) flush();
}

function debug(mod, message, meta) { _write('debug', mod, message, meta); }
function info(mod, message, meta) { _write('info', mod, message, meta); }
function warn(mod, message, meta) { _write('warn', mod, message, meta); }
function error(mod, message, meta) { _write('error', mod, message, meta); }

/**
 * Flush the buffer to disk.
 * @returns {void}
 */
function flush() {
  if (_buffer.length === 0 || !_logDir) return;
  const entries = _buffer.splice(0);
  const fp = getTodayLogPath();
  try {
    const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
    fs.appendFileSync(fp, lines, 'utf-8');
  } catch (_) {}
}

/**
 * Delete log files older than RETENTION_DAYS.
 * @returns {void}
 */
function cleanOldLogs() {
  if (!_logDir) return;
  try {
    const files = fs
      .readdirSync(_logDir)
      .filter((f) => f.startsWith('aegis-') && f.endsWith('.log'));
    const cutoff = Date.now() - RETENTION_DAYS * 86400000;
    for (const f of files) {
      const match = f.match(/aegis-(\d{4}-\d{2}-\d{2})\.log/);
      if (match) {
        const fileDate = new Date(match[1]).getTime();
        if (fileDate < cutoff) {
          try {
            fs.unlinkSync(path.join(_logDir, f));
          } catch (_) {}
        }
      }
    }
  } catch (_) {}
}

/**
 * Stop the flush timer and flush remaining buffer.
 * @returns {void}
 */
function shutdown() {
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
  let todayEntries = 0;
  let totalFiles = 0;
  let recordingSince = '';
  try {
    const files = fs
      .readdirSync(_logDir)
      .filter((f) => f.startsWith('aegis-') && f.endsWith('.log'))
      .sort();
    totalFiles = files.length;
    if (files.length > 0) {
      const firstMatch = files[0].match(/aegis-(\d{4}-\d{2}-\d{2})\.log/);
      if (firstMatch) recordingSince = firstMatch[1];
    }
    const todayPath = getTodayLogPath();
    if (fs.existsSync(todayPath)) {
      const content = fs.readFileSync(todayPath, 'utf-8');
      todayEntries = content.split('\n').filter((l) => l.trim().length > 0).length;
    }
  } catch (_) {}
  todayEntries += _buffer.length;
  return { logDir: _logDir, todayEntries, totalFiles, recordingSince };
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
    const files = fs
      .readdirSync(_logDir)
      .filter((f) => f.startsWith('aegis-') && f.endsWith('.log'))
      .sort();
    for (const f of files) {
      const content = fs.readFileSync(path.join(_logDir, f), 'utf-8');
      for (const line of content.split('\n')) {
        if (line.trim()) {
          try {
            all.push(JSON.parse(line));
          } catch (_) {}
        }
      }
    }
  } catch (_) {}
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
