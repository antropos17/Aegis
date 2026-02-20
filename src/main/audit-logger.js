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

let _logDir = '';
let _buffer = [];
let _flushTimer = null;
const FLUSH_INTERVAL = 5000;
const FLUSH_THRESHOLD = 50;
const RETENTION_DAYS = 30;

/**
 * Initialise audit logger. Creates audit-logs directory if needed, starts flush timer,
 * and cleans up old log files.
 * @param {Object} opts
 * @param {string} opts.userDataPath - Electron app.getPath('userData')
 * @returns {void}
 * @since v0.2.0
 */
function init(opts) {
  _logDir = path.join(opts.userDataPath, 'audit-logs');
  try {
    if (!fs.existsSync(_logDir)) fs.mkdirSync(_logDir, { recursive: true });
  } catch (_) {}
  _flushTimer = setInterval(flush, FLUSH_INTERVAL);
  cleanOldLogs();
}

/**
 * Get the log file path for today.
 * @returns {string} Path to today's audit log file.
 * @since v0.2.0
 */
function getTodayLogPath() {
  const d = new Date();
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return path.join(_logDir, `aegis-audit-${dateStr}.json`);
}

/**
 * Log an audit event. Buffered — writes are flushed every 5s or at 50 events.
 * @param {string} type - Event type (file-access, network-connection, anomaly-alert, permission-deny, agent-enter, agent-exit, config-access)
 * @param {Object} details - Event details
 * @param {string} [details.agent] - Agent name
 * @param {string} [details.action] - Action performed
 * @param {string} [details.path] - File or network path
 * @param {string} [details.severity] - Event severity
 * @param {number} [details.riskScore] - Current risk score
 * @returns {void}
 * @since v0.2.0
 */
function log(type, details) {
  if (!_logDir) return;
  const entry = {
    timestamp: new Date().toISOString(),
    type,
    agent: details.agent || '',
    action: details.action || '',
    path: details.path || '',
    severity: details.severity || 'normal',
    riskScore: details.riskScore || 0,
    details: details.extra || null,
  };
  _buffer.push(entry);
  if (_buffer.length >= FLUSH_THRESHOLD) flush();
}

/**
 * Flush the buffer to disk, appending entries to today's log file.
 * @returns {void}
 * @since v0.2.0
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
          } catch (_) {}
        }
      }
    }
  } catch (_) {}
}

/**
 * Get audit log statistics.
 * @returns {{logDir: string, todayEntries: number, totalFiles: number, recordingSince: string}}
 * @since v0.2.0
 */
function getStats() {
  if (!_logDir) return { logDir: '', todayEntries: 0, totalFiles: 0, recordingSince: '' };
  let todayEntries = 0;
  let totalFiles = 0;
  let recordingSince = '';
  try {
    const files = fs
      .readdirSync(_logDir)
      .filter((f) => f.startsWith('aegis-audit-') && f.endsWith('.json'))
      .sort();
    totalFiles = files.length;
    if (files.length > 0) {
      const firstMatch = files[0].match(/aegis-audit-(\d{4}-\d{2}-\d{2})\.json/);
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
 * Export all audit logs into a single combined array.
 * @returns {Object[]} Array of all audit log entries.
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
          } catch (_) {}
        }
      }
    }
  } catch (_) {}
  return all;
}

/**
 * Stop the flush timer and flush remaining buffer.
 * @returns {void}
 * @since v0.2.0
 */
function shutdown() {
  if (_flushTimer) {
    clearInterval(_flushTimer);
    _flushTimer = null;
  }
  flush();
}

module.exports = { init, log, flush, shutdown, getStats, exportAll, getLogDir: () => _logDir };
