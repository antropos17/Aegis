/**
 * @file platform/darwin.js
 * @description macOS platform implementation.
 * @since v0.3.0
 */
'use strict';

const { execFile } = require('child_process');

/** @type {RegExp[]} macOS-specific file-path patterns to ignore */
const IGNORE_FILE_PATTERNS = [
  /^\/System\//,
  /^\/Library\/Caches\//,
  /^\/private\/var\//,
  /\/\.DS_Store$/,
  /^\/dev\//,
  /^\/usr\/share\//,
  /^\/usr\/lib\//,
  /\.dylib$/,
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
        // pid is the last whitespace-separated token
        const lastSpace = trimmed.lastIndexOf(' ');
        if (lastSpace === -1) continue;
        const comm = trimmed.slice(0, lastSpace).trim();
        const pid = parseInt(trimmed.slice(lastSpace + 1), 10);
        if (isNaN(pid) || !comm) continue;
        // Extract basename from full path; map .app bundle paths to app name
        let name = comm;
        const slashIdx = name.lastIndexOf('/');
        if (slashIdx !== -1) name = name.slice(slashIdx + 1);
        // Handle macOS .app bundles: /Applications/Foo.app/Contents/MacOS/Foo → Foo
        const appMatch = comm.match(/\/([^/]+)\.app\//);
        if (appMatch) name = appMatch[1];
        results.push({ name, pid });
      }
      resolve(results);
    });
  });
}

/**
 * Build a map of all processes with their parent PIDs via `ps`.
 * @returns {Promise<Map<number, {name: string, ppid: number}>>}
 */
function getParentProcessMap() {
  return new Promise((resolve) => {
    execFile(
      'ps',
      ['-axo', 'pid=,ppid=,comm='],
      { maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        const map = new Map();
        if (err) {
          resolve(map);
          return;
        }
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          // Format: "  PID  PPID /full/path/to/comm"
          const parts = trimmed.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
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
 * Get raw TCP connections for given PIDs via `lsof`.
 * @param {number[]} pids
 * @returns {Promise<Array<{pid: number, ip: string, port: number, state: string}>>}
 */
function getRawTcpConnections(pids) {
  return new Promise((resolve) => {
    if (pids.length === 0) {
      resolve([]);
      return;
    }
    // lsof -i TCP -n -P -F pcnT — machine-readable output with pid, command, connection, TCP state
    execFile(
      'lsof',
      ['-i', 'TCP', '-n', '-P', '-F', 'pcnT'],
      { timeout: 10000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        const pidSet = new Set(pids);
        const results = [];
        let currentPid = -1;

        const lines = stdout.split('\n');
        for (const line of lines) {
          if (!line) continue;
          const code = line[0];
          const value = line.slice(1);
          if (code === 'p') {
            currentPid = parseInt(value, 10);
          } else if (code === 'n' && pidSet.has(currentPid)) {
            // n field for TCP: "host:port->remotehost:remoteport"
            const arrow = value.indexOf('->');
            if (arrow === -1) continue;
            const remote = value.slice(arrow + 2);
            const lastColon = remote.lastIndexOf(':');
            if (lastColon === -1) continue;
            const ip = remote.slice(0, lastColon);
            const port = parseInt(remote.slice(lastColon + 1), 10);
            if (isNaN(port)) continue;
            // Skip loopback / unspecified
            if (
              ip === '127.0.0.1' ||
              ip === '::1' ||
              ip === '0.0.0.0' ||
              ip === '::' ||
              ip === '*'
            )
              continue;
            results.push({ pid: currentPid, ip, port, state: 'Established' });
          } else if (code === 'T' && value.startsWith('ST=')) {
            // Update state of last entry for this pid
            const state = value.slice(3);
            if (results.length > 0 && results[results.length - 1].pid === currentPid) {
              results[results.length - 1].state = state;
            }
          }
        }
        resolve(results);
      },
    );
  });
}

/**
 * Get file handles for a process via `lsof -p PID -F n`.
 * @param {number} pid
 * @returns {Promise<string[]>}
 */
function getFileHandles(pid) {
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
          // n field contains file path; skip non-file entries
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
