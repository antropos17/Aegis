/**
 * @file platform/win32.js
 * @description Windows platform implementation — extracted from existing modules.
 * @since v0.3.0
 */
'use strict';

const { execFile } = require('child_process');

/** @type {RegExp[]} Windows-specific file-path patterns to ignore */
const IGNORE_FILE_PATTERNS = [
  /^C:\\Windows\\/i,
  /^C:\\Program Files\\Windows/i,
  /\\pagefile\.sys$/i,
  /\\swapfile\.sys$/i,
  /\\\$Extend/i,
  /\\System Volume Information/i,
  /^\\Device\\/i,
];

/**
 * List running processes via tasklist CSV output.
 * @returns {Promise<Array<{name: string, pid: number}>>}
 */
function listProcesses() {
  return new Promise((resolve, reject) => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], (err, stdout) => {
      if (err) {
        reject(err);
        return;
      }
      const results = [];
      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        const match = line.match(/"([^"]+)","(\d+)"/);
        if (!match) continue;
        results.push({ name: match[1], pid: parseInt(match[2], 10) });
      }
      resolve(results);
    });
  });
}

/**
 * Build a map of all processes with their parent PIDs via PowerShell Get-CimInstance.
 * @returns {Promise<Map<number, {name: string, ppid: number}>>}
 */
function getParentProcessMap() {
  return new Promise((resolve) => {
    const psScript = [
      '$ErrorActionPreference="SilentlyContinue"',
      '$r=@{}',
      'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name|ForEach-Object{$r[[string]$_.ProcessId]=@{n=$_.Name;p=[int]$_.ParentProcessId}}',
      '$r|ConvertTo-Json -Compress',
    ].join('\n');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { timeout: 8000 },
      (err, stdout) => {
        const map = new Map();
        if (!err && stdout.trim()) {
          try {
            const parsed = JSON.parse(stdout.trim());
            for (const [pidStr, info] of Object.entries(parsed)) {
              const pid = parseInt(pidStr, 10);
              if (!isNaN(pid)) {
                map.set(pid, { name: info.n, ppid: info.p });
              }
            }
          } catch (_) {}
        }
        resolve(map);
      },
    );
  });
}

/**
 * Get raw TCP connections for given PIDs via PowerShell Get-NetTCPConnection.
 * @param {number[]} pids
 * @returns {Promise<Array<{pid: number, ip: string, port: number, state: string}>>}
 */
function getRawTcpConnections(pids) {
  return new Promise((resolve) => {
    const validPids = pids.filter((p) => Number.isInteger(p) && p > 0);
    if (validPids.length === 0) {
      resolve([]);
      return;
    }
    const pidStr = validPids.join(',');
    const psScript = [
      '$ErrorActionPreference="SilentlyContinue"',
      `$pids=@(${pidStr})`,
      '$conns=Get-NetTCPConnection -OwningProcess $pids -EA SilentlyContinue|Where-Object{$_.State -ne "Listen" -and $_.State -ne "Bound" -and $_.RemoteAddress -ne "0.0.0.0" -and $_.RemoteAddress -ne "::" -and $_.RemoteAddress -ne "127.0.0.1" -and $_.RemoteAddress -ne "::1"}',
      '$r=@()',
      'foreach($c in $conns){$r+=@{pid=[int]$c.OwningProcess;ip=$c.RemoteAddress;port=[int]$c.RemotePort;state=$c.State.ToString()}}',
      'if($r.Count -gt 0){$r|ConvertTo-Json -Compress}else{"[]"}',
    ].join('\n');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { timeout: 10000 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        try {
          const raw = stdout.trim();
          if (!raw || raw === '[]') {
            resolve([]);
            return;
          }
          let conns = JSON.parse(raw);
          if (!Array.isArray(conns)) conns = [conns];
          resolve(conns);
        } catch (_) {
          resolve([]);
        }
      },
    );
  });
}

/**
 * Get file handles for a process via handle64.exe or Get-Process fallback.
 * @param {number} pid
 * @returns {Promise<string[]>}
 */
function getFileHandles(pid) {
  pid = Number(pid);
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve([]);
  return new Promise((resolve) => {
    const psScript = [
      '$ErrorActionPreference="SilentlyContinue"',
      '$files=[System.Collections.ArrayList]@()',
      '$h=Get-Command handle64.exe -EA SilentlyContinue',
      'if(!$h){$h=Get-Command handle.exe -EA SilentlyContinue}',
      'if($h){',
      `  $out=& $h.Source -p ${pid} -nobanner -accepteula 2>$null`,
      '  foreach($l in $out){',
      '    if($l -match "File\\s+.*?\\s+([A-Z]:\\\\.+)$"){',
      '      [void]$files.Add($Matches[1].Trim())',
      '    }',
      '  }',
      '}else{',
      `  $p=Get-Process -Id ${pid} -EA SilentlyContinue`,
      '  if($p -and $p.Modules){',
      '    foreach($m in $p.Modules){',
      '      if($m.FileName){[void]$files.Add($m.FileName)}',
      '    }',
      '  }',
      '}',
      'if($files.Count -gt 0){$files|ConvertTo-Json -Compress}else{"[]"}',
    ].join('\n');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { timeout: 15000 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        try {
          const raw = stdout.trim();
          if (!raw || raw === '[]') {
            resolve([]);
            return;
          }
          let files = JSON.parse(raw);
          if (typeof files === 'string') files = [files];
          if (!Array.isArray(files)) {
            resolve([]);
            return;
          }
          resolve(files);
        } catch (_) {
          resolve([]);
        }
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
    execFile('taskkill', ['/PID', String(pid), '/F'], (err) => {
      resolve(err ? { success: false, error: err.message } : { success: true });
    });
  });
}

/**
 * @param {number} pid
 * @returns {Promise<{success: boolean, error?: string}>}
 */
function suspendProcess(pid) {
  const script = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class Ntdll{[DllImport("ntdll.dll")]public static extern int NtSuspendProcess(IntPtr h);}' -PassThru | Out-Null;$h=(Get-Process -Id ${Number(pid)}).Handle;[Ntdll]::NtSuspendProcess($h)`;
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 5000 },
      (err) => {
        resolve(err ? { success: false, error: err.message } : { success: true });
      },
    );
  });
}

/**
 * @param {number} pid
 * @returns {Promise<{success: boolean, error?: string}>}
 */
function resumeProcess(pid) {
  const script = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class Ntdll2{[DllImport("ntdll.dll")]public static extern int NtResumeProcess(IntPtr h);}' -PassThru | Out-Null;$h=(Get-Process -Id ${Number(pid)}).Handle;[Ntdll2]::NtResumeProcess($h)`;
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 5000 },
      (err) => {
        resolve(err ? { success: false, error: err.message } : { success: true });
      },
    );
  });
}

/**
 * Get the working directory of a process via PowerShell.
 * Windows has limited support for this — gracefully returns null on failure.
 * @param {number} pid
 * @returns {Promise<string|null>}
 * @since v0.5.0
 */
function getProcessCwd(pid) {
  pid = Number(pid);
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    const psScript = `$ErrorActionPreference="SilentlyContinue";$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}";if($p -and $p.CommandLine){$m=$p.CommandLine -match '(?:--cwd|--project)\\s+"?([^"]+)"?';if($m){$Matches[1]}else{""}}else{""}`;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { timeout: 5000 },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const result = stdout.trim();
        resolve(result || null);
      },
    );
  });
}

module.exports = {
  listProcesses,
  getParentProcessMap,
  getRawTcpConnections,
  getFileHandles,
  getProcessCwd,
  killProcess,
  suspendProcess,
  resumeProcess,
  IGNORE_FILE_PATTERNS,
};
