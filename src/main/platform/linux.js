/**
 * @file platform/linux.js
 * @description Linux platform implementation with /proc optimizations.
 * @since v0.3.0
 */
'use strict';

const { execFile: _origExecFile } = require('child_process');

let _execFile = _origExecFile;
/** @internal Override execFile (for tests). */
function _setExecFileForTest(fn) {
  _execFile = fn || _origExecFile;
}
const fs = require('fs');
const path = require('path');
const {
  parseLsofOutput,
  parseLsofFileHandles,
  parseLsofCwd,
  killProcess,
  suspendProcess,
  resumeProcess,
  parseParentProcessMapFromPs,
} = require('./posix-shared');

/** @type {RegExp[]} Linux-specific file-path patterns to ignore */
const IGNORE_FILE_PATTERNS = [
  /^\/proc\//,
  /^\/sys\//,
  /^\/dev\//,
  /^\/run\//,
  /^\/snap\//,
  /^\/usr\/lib\//,
  /^\/usr\/share\//,
  /\.so(\.\d+)*$/,
];

/**
 * List running processes via `ps`.
 * @returns {Promise<Array<{name: string, pid: number}>>}
 */
function listProcesses() {
  return new Promise((resolve, reject) => {
    _execFile('ps', ['-axo', 'comm=,pid='], { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        reject(err);
        return;
      }
      const results = [];
      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const lastSpace = trimmed.lastIndexOf(' ');
        if (lastSpace === -1) continue;
        const comm = trimmed.slice(0, lastSpace).trim();
        const pid = parseInt(trimmed.slice(lastSpace + 1), 10);
        if (isNaN(pid) || !comm) continue;
        let name = comm;
        const slashIdx = name.lastIndexOf('/');
        if (slashIdx !== -1) name = name.slice(slashIdx + 1);
        results.push({ name, pid });
      }
      resolve(results);
    });
  });
}

/**
 * Build a map of all processes with their parent PIDs.
 * Uses /proc directly for speed, falls back to `ps`.
 * @returns {Promise<Map<number, {name: string, ppid: number}>>}
 */
function getParentProcessMap() {
  const map = new Map();
  // Try /proc first (faster, no subprocess)
  try {
    const entries = fs.readdirSync('/proc').filter((e) => /^\d+$/.test(e));
    for (const pidStr of entries) {
      try {
        const stat = fs.readFileSync(path.join('/proc', pidStr, 'stat'), 'utf-8');
        // Format: pid (comm) state ppid ...
        const match = stat.match(/^(\d+)\s+\((.+?)\)\s+\S+\s+(\d+)/);
        if (match) {
          map.set(parseInt(match[1], 10), {
            name: match[2],
            ppid: parseInt(match[3], 10),
          });
        }
      } catch (_) {
        // Process may have exited
      }
    }
    if (map.size > 0) return Promise.resolve(map);
  } catch (_) {
    // /proc not available, fall back to ps
  }

  return new Promise((resolve) => {
    _execFile('ps', ['-axo', 'pid=,ppid=,comm='], { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        resolve(map);
        return;
      }
      const parsed = parseParentProcessMapFromPs(stdout);
      for (const [pid, info] of parsed) map.set(pid, info);
      resolve(map);
    });
  });
}

/**
 * Get raw TCP connections for given PIDs.
 * Tries `ss` first, falls back to `lsof`.
 * @param {number[]} pids
 * @returns {Promise<Array<{pid: number, ip: string, port: number, state: string}>>}
 */
function getRawTcpConnections(pids) {
  return new Promise((resolve) => {
    if (pids.length === 0) {
      resolve([]);
      return;
    }
    const pidSet = new Set(pids);

    // Try ss first
    _execFile('ss', ['-tnp'], { timeout: 10000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (!err) {
        resolve(parseSsOutput(stdout || '', pidSet));
        return;
      }
      // Fallback to lsof
      _execFile(
        'lsof',
        ['-i', 'TCP', '-n', '-P', '-F', 'pcnT'],
        { timeout: 10000, maxBuffer: 4 * 1024 * 1024 },
        (lsofErr, lsofStdout) => {
          if (lsofErr) {
            resolve([]);
            return;
          }
          resolve(parseLsofOutput(lsofStdout, pidSet));
        },
      );
    });
  });
}

/**
 * Parse `ss -tnp` output.
 * @param {string} stdout
 * @param {Set<number>} pidSet
 * @returns {Array<{pid: number, ip: string, port: number, state: string}>}
 */
function parseSsOutput(stdout, pidSet) {
  const results = [];
  const lines = stdout.trim().split('\n');
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // State  Recv-Q  Send-Q  Local Address:Port  Peer Address:Port  Process
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const state = parts[0];
    const peer = parts[4]; // e.g. "1.2.3.4:443" or "[::1]:443"
    const process = parts.slice(5).join(' ');

    // Extract pid from process field: users:(("name",pid=123,fd=4))
    const pidMatch = process.match(/pid=(\d+)/);
    if (!pidMatch) continue;
    const pid = parseInt(pidMatch[1], 10);
    if (!pidSet.has(pid)) continue;

    // Parse peer address
    let ip, port;
    if (peer.startsWith('[')) {
      // IPv6: [::1]:443
      const closeBracket = peer.indexOf(']');
      ip = peer.slice(1, closeBracket);
      port = parseInt(peer.slice(closeBracket + 2), 10);
    } else {
      const lastColon = peer.lastIndexOf(':');
      ip = peer.slice(0, lastColon);
      port = parseInt(peer.slice(lastColon + 1), 10);
    }
    if (isNaN(port)) continue;
    if (ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0' || ip === '::' || ip === '*')
      continue;

    results.push({ pid, ip, port, state });
  }
  return results;
}

/**
 * Get file handles for a process via /proc/PID/fd readlink, fallback to lsof.
 * @param {number} pid
 * @returns {Promise<string[]>}
 */
function getFileHandles(pid) {
  // Try /proc first
  try {
    const fdDir = path.join('/proc', String(pid), 'fd');
    const fds = fs.readdirSync(fdDir);
    const files = [];
    for (const fd of fds) {
      try {
        const target = fs.readlinkSync(path.join(fdDir, fd));
        if (target.startsWith('/')) files.push(target);
      } catch (_) {}
    }
    if (files.length > 0) return Promise.resolve(files);
  } catch (_) {}

  // Fallback to lsof
  return parseLsofFileHandles(pid);
}

/**
 * Get the working directory of a process.
 * Tries /proc/{pid}/cwd symlink first (fast), falls back to lsof.
 * @param {number} pid
 * @returns {Promise<string|null>}
 * @since v0.5.0
 */
function getProcessCwd(pid) {
  try {
    const target = fs.readlinkSync(path.join('/proc', String(pid), 'cwd'));
    if (target && target.startsWith('/')) return Promise.resolve(target);
  } catch (_) {
    // /proc not available or permission denied, fall back to lsof
  }
  return parseLsofCwd(pid);
}

module.exports = {
  listProcesses,
  getParentProcessMap,
  getRawTcpConnections,
  parseSsOutput,
  getFileHandles,
  getProcessCwd,
  killProcess,
  suspendProcess,
  resumeProcess,
  IGNORE_FILE_PATTERNS,
  _setExecFileForTest,
};
