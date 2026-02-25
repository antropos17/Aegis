/**
 * @file platform/linux.js
 * @description Linux platform implementation with /proc optimizations.
 * @since v0.3.0
 */
'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

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
    execFile('ps', ['-axo', 'comm=,pid='], { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
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
    execFile(
      'ps',
      ['-axo', 'pid=,ppid=,comm='],
      { maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve(map);
          return;
        }
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
          const parts = line.trim().match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
          if (!parts) continue;
          const pid = parseInt(parts[1], 10);
          const ppid = parseInt(parts[2], 10);
          let name = parts[3].trim();
          const slashIdx = name.lastIndexOf('/');
          if (slashIdx !== -1) name = name.slice(slashIdx + 1);
          map.set(pid, { name, ppid });
        }
        resolve(map);
      },
    );
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
    execFile(
      'ss',
      ['-tnp'],
      { timeout: 10000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (!err && stdout) {
          const results = parseSsOutput(stdout, pidSet);
          if (results.length > 0 || !err) {
            resolve(results);
            return;
          }
        }
        // Fallback to lsof
        execFile(
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
      },
    );
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
 * Parse `lsof -i TCP -n -P -F pcnT` output.
 * @param {string} stdout
 * @param {Set<number>} pidSet
 * @returns {Array<{pid: number, ip: string, port: number, state: string}>}
 */
function parseLsofOutput(stdout, pidSet) {
  const results = [];
  let currentPid = -1;

  for (const line of stdout.split('\n')) {
    if (!line) continue;
    const code = line[0];
    const value = line.slice(1);
    if (code === 'p') {
      currentPid = parseInt(value, 10);
    } else if (code === 'n' && pidSet.has(currentPid)) {
      const arrow = value.indexOf('->');
      if (arrow === -1) continue;
      const remote = value.slice(arrow + 2);
      const lastColon = remote.lastIndexOf(':');
      if (lastColon === -1) continue;
      const ip = remote.slice(0, lastColon);
      const port = parseInt(remote.slice(lastColon + 1), 10);
      if (isNaN(port)) continue;
      if (ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0' || ip === '::' || ip === '*')
        continue;
      results.push({ pid: currentPid, ip, port, state: 'Established' });
    } else if (code === 'T' && value.startsWith('ST=')) {
      const state = value.slice(3);
      if (results.length > 0 && results[results.length - 1].pid === currentPid) {
        results[results.length - 1].state = state;
      }
    }
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
  return new Promise((resolve) => {
    execFile(
      'lsof',
      ['-p', String(pid), '-F', 'n'],
      { timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        const files = [];
        for (const line of stdout.split('\n')) {
          if (line.startsWith('n/')) {
            files.push(line.slice(1));
          }
        }
        resolve(files);
      },
    );
  });
}

/**
 * @param {number} pid
 * @returns {Promise<{success: boolean, error?: string}>}
 */
function killProcess(pid) {
  return new Promise((resolve) => {
    execFile('kill', ['-9', String(pid)], (err) => {
      resolve(err ? { success: false, error: err.message } : { success: true });
    });
  });
}

/**
 * @param {number} pid
 * @returns {Promise<{success: boolean, error?: string}>}
 */
function suspendProcess(pid) {
  return new Promise((resolve) => {
    execFile('kill', ['-STOP', String(pid)], (err) => {
      resolve(err ? { success: false, error: err.message } : { success: true });
    });
  });
}

/**
 * @param {number} pid
 * @returns {Promise<{success: boolean, error?: string}>}
 */
function resumeProcess(pid) {
  return new Promise((resolve) => {
    execFile('kill', ['-CONT', String(pid)], (err) => {
      resolve(err ? { success: false, error: err.message } : { success: true });
    });
  });
}

module.exports = {
  listProcesses,
  getParentProcessMap,
  getRawTcpConnections,
  getFileHandles,
  killProcess,
  suspendProcess,
  resumeProcess,
  IGNORE_FILE_PATTERNS,
};
