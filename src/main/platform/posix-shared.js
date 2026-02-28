/**
 * @file platform/posix-shared.js
 * @description Shared POSIX utilities used by both darwin.js and linux.js.
 * @since v0.3.0
 */
'use strict';

const { execFile: _origExecFile } = require('child_process');

let _execFile = _origExecFile;
/** @internal Override execFile (for tests). */
function _setExecFileForTest(fn) { _execFile = fn || _origExecFile; }

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
 * Get file handles for a process via `lsof -p PID -F n`.
 * @param {number} pid
 * @returns {Promise<string[]>}
 */
function parseLsofFileHandles(pid) {
  return new Promise((resolve) => {
    _execFile(
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
    _execFile('kill', ['-9', String(pid)], (err) => {
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
    _execFile('kill', ['-STOP', String(pid)], (err) => {
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
    _execFile('kill', ['-CONT', String(pid)], (err) => {
      resolve(err ? { success: false, error: err.message } : { success: true });
    });
  });
}

/**
 * Parse `ps -axo pid=,ppid=,comm=` output into a Map.
 * @param {string} stdout
 * @returns {Map<number, {name: string, ppid: number}>}
 */
function parseParentProcessMapFromPs(stdout) {
  const map = new Map();
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
  return map;
}

/**
 * Resolve a process's working directory via `lsof -d cwd -a -p PID -F n`.
 * @param {number} pid
 * @returns {Promise<string|null>}
 * @since v0.5.0
 */
function parseLsofCwd(pid) {
  return new Promise((resolve) => {
    _execFile(
      'lsof',
      ['-d', 'cwd', '-a', '-p', String(pid), '-F', 'n'],
      { timeout: 5000 },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        for (const line of stdout.split('\n')) {
          if (line.startsWith('n/')) {
            resolve(line.slice(1));
            return;
          }
        }
        resolve(null);
      },
    );
  });
}

module.exports = {
  parseLsofOutput,
  parseLsofFileHandles,
  parseLsofCwd,
  killProcess,
  suspendProcess,
  resumeProcess,
  parseParentProcessMapFromPs,
  _setExecFileForTest,
};
