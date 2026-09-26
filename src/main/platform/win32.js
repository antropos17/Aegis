/**
 * @file platform/win32.js
 * @description Windows platform implementation — extracted from existing modules.
 * @since v0.3.0
 */
'use strict';

const { execFile } = require('child_process');
const logger = require('../logger');
const restartManager = require('./restart-manager');
const snapshot = require('./process-snapshot');
const { buildTcpQuery, parseTcpRows } = require('./windows-tcp');
const { createWindowsObserver, validateCwds } = require('./windows-observer');
const observer = createWindowsObserver({ execFile });

/**
 * Whether the handle.exe/handle64.exe binary is on PATH — the LEGACY read-detect
 * mechanism (getFileHandles). Optimistic default (true): downgraded to false ONLY
 * by probeReadDetection() finding no binary or erroring. "Can't tell" fails honest
 * (false). When false, getFileHandles() short-circuits to [] (no spawn) rather
 * than fabricating handles from loaded modules.
 *
 * NOTE: this is now only ONE of two read-detect capabilities. Restart Manager
 * (restart-manager.js) is the PRIMARY mechanism and does NOT need this binary;
 * its availability lives in restart-manager._rmAvailable. Overall read-detection
 * is available when EITHER works — see isReadDetectionAvailable().
 * @type {boolean}
 */
let _handleBinaryAvailable = true;
/** @type {boolean} One-shot guard so the degraded warning logs at most once. */
let _readDetectionWarned = false;

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
 * Measure-only spawn-timing probe: log one external spawn's round-trip duration
 * to the operational log under mod='perf' (one NDJSON line per spawn). The logger
 * stamps `timestamp` (ts) and `module` ('perf'); meta carries the spawn label and
 * elapsed ms. Pure instrumentation — never alters collection behavior.
 * @param {string} spawn - Spawn label (tasklist|cim-parent|cim-cwd).
 * @param {number} t0 - performance.now() captured immediately before the spawn.
 * @returns {void}
 */
function logSpawnTax(spawn, t0) {
  logger.debug('perf', 'spawn', { spawn, ms: Math.round(performance.now() - t0) });
}

/**
 * List running processes via tasklist CSV output.
 * @returns {Promise<Array<{name: string, pid: number}>>}
 */
function listProcesses() {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    execFile(
      'tasklist',
      ['/FO', 'CSV', '/NH'],
      { timeout: 10000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        logSpawnTax('tasklist', t0);
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
      },
    );
  });
}

/**
 * Build a map of all processes with their parent PIDs via PowerShell Get-CimInstance.
 * `startTime` is the OS process creation time (epoch-ms). Get-CimInstance returns
 * CreationDate as a System.DateTime (Kind=Local), NOT a DMTF string (that is the
 * legacy Get-WmiObject shape) — so the [DateTimeOffset] cast is a direct, correct
 * UTC-epoch conversion. Null when the OS withholds CreationDate (rare/access).
 *
 * EMERGENCY FALLBACK ONLY since v0.12.0. This is the observation whose cost was
 * measured at p50 1284 / p95 1459 / max 1657 ms (N=32, 486 processes, one machine
 * and one sample) — the tax the snapshot sidecar exists to remove. It stays because
 * a sidecar that is missing, incompatible or dead must not take identity down with
 * it; it is not the hot path any more. Entries carry no generation witness, so
 * process-utils derives one from `startTime` (see its `_witnessOf`).
 * @returns {Promise<Map<number, {name: string, ppid: number, startTime: number|null}>>}
 */
function cimParentProcessMap() {
  return new Promise((resolve) => {
    const psScript = [
      '$ErrorActionPreference="SilentlyContinue"',
      '$r=@{}',
      'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,CreationDate|ForEach-Object{$r[[string]$_.ProcessId]=@{n=$_.Name;p=[int]$_.ParentProcessId;t=$(if($_.CreationDate){([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()}else{$null})}}',
      '$r|ConvertTo-Json -Compress',
    ].join('\n');
    const t0 = performance.now();
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { timeout: 8000 },
      (err, stdout) => {
        logSpawnTax('cim-parent', t0);
        const map = new Map();
        if (!err && stdout.trim()) {
          try {
            const parsed = JSON.parse(stdout.trim());
            for (const [pidStr, info] of Object.entries(parsed)) {
              const pid = parseInt(pidStr, 10);
              if (!isNaN(pid)) {
                map.set(pid, {
                  name: info.n,
                  ppid: info.p,
                  startTime: typeof info.t === 'number' ? info.t : null,
                });
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
 * The ONE process-table observation a scan pass makes on Windows.
 *
 * Delegates the provider choice to process-snapshot.js — sidecar first, this
 * module's CIM call as the emergency fallback, an empty map when neither can
 * observe. The CIM function is passed IN rather than imported there, so the
 * platform module stays the only place that knows how to talk to PowerShell and no
 * require cycle (win32 → process-snapshot → win32) is created.
 *
 * The returned entries keep the shape callers already consume and may additionally
 * carry `witness` / `witnessSource` when the sidecar served the pass.
 * @returns {Promise<Map<number, {name: string, ppid: number, startTime: number|null,
 *   witness?: string|null, witnessSource?: string|null}>>}
 * @since v0.3.0
 */
function getParentProcessMap() {
  return snapshot.getParentProcessMap({ cimFallback: cimParentProcessMap });
}

/**
 * Get raw TCP connections via the native observer, with direct CIM fallback.
 * @param {number[]} pids
 * @returns {Promise<import("../../shared/types/process").RawTcpConnection[]>}
 */
async function getRawTcpConnections(pids) {
  const validPids = pids.filter((p) => Number.isInteger(p) && p > 0 && p <= 0xffffffff);
  if (!validPids.length) return [];
  const native = await observer.tryRequest('tcp', { pids: validPids }, (rows) =>
    parseTcpRows(JSON.stringify(rows), validPids),
  );
  if (native !== null) return native;
  return new Promise((resolve, reject) => {
    const psScript = buildTcpQuery(validPids);
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      // CIM property names are longer than the former short aliases; retain a
      // bounded response budget with room for the same connection population.
      { timeout: 10000, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => {
        // B-S05: hard provider failure must reject so network health can mark FAILED.
        // True empty tables ("[]" / blank stdout with success) still resolve [].
        if (err) {
          reject(err);
          return;
        }
        try {
          resolve(parseTcpRows(stdout, validPids));
        } catch (parseErr) {
          reject(parseErr instanceof Error ? parseErr : new Error('tcp-provider-parse-error'));
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
  // Honest zero: when no handle binary exists we cannot read open file handles.
  // Return [] without spawning rather than reporting loaded modules as handles.
  // (Restart Manager is the primary path; this legacy handle.exe path only runs
  // when the binary is genuinely present.)
  if (!_handleBinaryAvailable) return Promise.resolve([]);
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
 * Probe whether a handle binary (handle64.exe/handle.exe) is on PATH. Sets the
 * module-level _handleBinaryAvailable flag. Errors/timeouts → false (fail honest).
 * @returns {Promise<{available: boolean, path: string|null}>}
 */
function _probeHandleBinary() {
  return new Promise((resolve) => {
    const psScript = [
      '$ErrorActionPreference="SilentlyContinue"',
      '$h=Get-Command handle64.exe -EA SilentlyContinue',
      'if(!$h){$h=Get-Command handle.exe -EA SilentlyContinue}',
      'if($h){$h.Source}else{""}',
    ].join('\n');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { timeout: 8000 },
      (err, stdout) => {
        const sourcePath = !err && stdout ? stdout.trim() : '';
        _handleBinaryAvailable = sourcePath.length > 0;
        resolve({
          available: _handleBinaryAvailable,
          path: _handleBinaryAvailable ? sourcePath : null,
        });
      },
    );
  });
}

/**
 * One-time startup probe for read-detection. Probes BOTH capabilities in
 * parallel: the legacy handle.exe binary AND the Windows Restart Manager (the
 * primary path, no binary needed). Read-detection is available when EITHER works.
 * Warns (once) ONLY when BOTH are absent. Errors/timeouts → unavailable (fail
 * honest, not optimistic). darwin/linux do NOT define this method (their
 * lsof//proc read-detection is always available), so main.js calls it via
 * optional chaining.
 * @returns {Promise<{available: boolean, handle: string|null, rm: boolean}>}
 * @since v0.10.0
 */
async function probeReadDetection() {
  const [handle, rm] = await Promise.all([
    _probeHandleBinary(),
    restartManager.probeRestartManager(),
  ]);
  const available = handle.available || rm.available;
  if (!available && !_readDetectionWarned) {
    _readDetectionWarned = true;
    logger.warn(
      'platform',
      'File read-detection degraded: neither a handle binary (handle64.exe/' +
        'handle.exe) nor the Windows Restart Manager is available — file-hold ' +
        '(holding) events disabled',
    );
  }
  return { available, handle: handle.path, rm: rm.available };
}

/**
 * @returns {boolean} Whether read-detection is available via EITHER mechanism
 *   (handle.exe binary OR Restart Manager).
 * @since v0.10.0
 */
function isReadDetectionAvailable() {
  return _handleBinaryAvailable || restartManager.isRestartManagerAvailable();
}

// The PowerShell worker opens a single process HANDLE, reads its creation
// FILETIME, acts through that HANDLE, and closes it in a finally block. The
// action rights are narrower than PROCESS_ALL_ACCESS.
const BOUND_CONTROL_TYPE = [
  'using System;using System.Runtime.InteropServices;',
  'public static class AegisBoundProcessControl {',
  '[DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);',
  '[DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] public static extern bool GetProcessTimes(IntPtr handle,out long creation,out long exitTime,out long kernel,out long user);',
  '[DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] public static extern bool TerminateProcess(IntPtr handle,uint exitCode);',
  '[DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] public static extern bool CloseHandle(IntPtr handle);',
  '[DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr handle);',
  '[DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr handle);',
  '}',
].join('');

/**
 * Act only if the process opened by PID has the expected raw creation FILETIME.
 * @param {number} pid
 * @param {string} createTime100ns
 * @param {'kill'|'suspend'|'resume'} operation
 * @returns {Promise<{success: boolean, error?: string}>}
 * @since v0.16.0
 */
function controlProcessOnHandle(pid, createTime100ns, operation) {
  pid = Number(pid);
  if (!Number.isInteger(pid) || pid <= 0 || pid > 0xffffffff)
    return Promise.resolve({ success: false, error: 'Invalid PID' });
  if (typeof createTime100ns !== 'string' || !/^[1-9]\d{0,18}$/.test(createTime100ns))
    return Promise.resolve({ success: false, error: 'Invalid process instance' });

  const action = {
    kill: '$ok=[AegisBoundProcessControl]::TerminateProcess($handle,1);if(-not $ok){throw "action"}',
    suspend:
      '$status=[AegisBoundProcessControl]::NtSuspendProcess($handle);if($status -ne 0){throw "action"}',
    resume:
      '$status=[AegisBoundProcessControl]::NtResumeProcess($handle);if($status -ne 0){throw "action"}',
  }[operation];
  const access = operation === 'kill' ? 0x1001 : 0x1800;
  const script = [
    "$ErrorActionPreference='Stop'",
    `Add-Type -TypeDefinition '${BOUND_CONTROL_TYPE}' -ErrorAction Stop | Out-Null`,
    `$handle=[AegisBoundProcessControl]::OpenProcess(${access},$false,${pid})`,
    'if($handle -eq [IntPtr]::Zero){throw "open"}',
    'try{',
    '[long]$created=0;[long]$exited=0;[long]$kernel=0;[long]$user=0',
    'if(-not [AegisBoundProcessControl]::GetProcessTimes($handle,[ref]$created,[ref]$exited,[ref]$kernel,[ref]$user)){throw "times"}',
    `if($created.ToString([Globalization.CultureInfo]::InvariantCulture) -ne '${createTime100ns}'){'STALE'}else{${action};'OK'}`,
    '}finally{[void][AegisBoundProcessControl]::CloseHandle($handle)}',
  ].join(';');
  return new Promise((resolve) => {
    try {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { timeout: 10000, maxBuffer: 64 * 1024 },
        (err, stdout) => {
          if (err) return resolve({ success: false, error: 'Process control failed' });
          const answer = typeof stdout === 'string' ? stdout.trim() : '';
          if (answer === 'OK') return resolve({ success: true });
          if (answer === 'STALE')
            return resolve({
              success: false,
              error: 'Process instance changed or is no longer observed',
            });
          return resolve({ success: false, error: 'Process control failed' });
        },
      );
    } catch (_) {
      resolve({ success: false, error: 'Process control failed' });
    }
  });
}

/**
 * @param {number} pid
 * @param {string} createTime100ns
 * @returns {Promise<{success: boolean, error?: string}>}
 * @since v0.16.0
 */
function killProcess(pid, createTime100ns) {
  return controlProcessOnHandle(pid, createTime100ns, 'kill');
}

/**
 * @param {number} pid
 * @param {string} createTime100ns
 * @returns {Promise<{success: boolean, error?: string}>}
 * @since v0.16.0
 */
function suspendProcess(pid, createTime100ns) {
  return controlProcessOnHandle(pid, createTime100ns, 'suspend');
}

/**
 * @param {number} pid
 * @param {string} createTime100ns
 * @returns {Promise<{success: boolean, error?: string}>}
 * @since v0.16.0
 */
function resumeProcess(pid, createTime100ns) {
  return controlProcessOnHandle(pid, createTime100ns, 'resume');
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
    const psScript = `$ErrorActionPreference="SilentlyContinue";[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}";if($p -and $p.CommandLine){$m=$p.CommandLine -match '(?:--cwd|--project)\\s+"?([^"]+)"?';if($m){$Matches[1]}else{""}}else{""}`;
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

/**
 * Extract CWD from a process CommandLine string.
 * Looks for --cwd or --project flags followed by a path.
 * @param {string|null} commandLine
 * @returns {string|null}
 */
function extractCwdFromCommandLine(commandLine) {
  if (!commandLine) return null;
  const m = commandLine.match(/(?:--cwd|--project)\s+"?([^"]+)"?/);
  return m ? m[1] : null;
}

/**
 * Batch CWD lookup — one native observation or PowerShell fallback for multiple PIDs.
 * Returns a Map<number, string|null> of pid → cwd.
 * @param {number[]} pids
 * @returns {Promise<Map<number, string|null>>}
 * @since v0.5.0
 */
async function getProcessCwds(pids) {
  const validPids = pids.map(Number).filter((p) => Number.isInteger(p) && p > 0 && p <= 0xffffffff);
  if (validPids.length === 0) return Promise.resolve(new Map());
  const native = await observer.tryRequest('cwd', { pids: validPids }, (rows) =>
    validateCwds(rows, validPids),
  );
  if (native !== null)
    return new Map(
      native.map((row) => [row.ProcessId, extractCwdFromCommandLine(row.CommandLine)]),
    );
  return new Promise((resolve) => {
    const pidFilter = validPids.map((p) => `ProcessId=${p}`).join(' OR ');
    const psScript = `$ErrorActionPreference="SilentlyContinue";[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);Get-CimInstance Win32_Process -Filter '${pidFilter}' -Property ProcessId,CommandLine | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`;
    const t0 = performance.now();
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { timeout: 8000 },
      (err, stdout) => {
        logSpawnTax('cim-cwd', t0);
        const map = new Map();
        if (err || !stdout.trim()) {
          resolve(map);
          return;
        }
        try {
          let entries = JSON.parse(stdout.trim());
          if (!Array.isArray(entries)) entries = [entries];
          for (const proc of entries) {
            const pid = proc.ProcessId;
            const cwd = extractCwdFromCommandLine(proc.CommandLine);
            map.set(pid, cwd);
          }
        } catch (_) {
          // parse failure — return empty map
        }
        resolve(map);
      },
    );
  });
}

module.exports = {
  /**
   * `getParentProcessMap` entries carry `startTime`, the OS process birth time,
   * and — when the snapshot sidecar served the pass — a stronger `witness`.
   * process-utils reads the witness as the GENERATION of a pid: the proof that a
   * cached parent chain or working directory still belongs to the process living
   * under that pid. Only win32 supplies either — see the matching `false` in
   * linux.js and darwin.js, which is why neither pays a per-scan map observation.
   * @type {boolean}
   */
  providesStartTime: true,
  listProcesses,
  getParentProcessMap,
  /**
   * The `proc-snapshot` leaf's health record, published through the façade because
   * this module already owns the only path to it: `getParentProcessMap` above
   * delegates the provider choice to process-snapshot.js, so the leaf describes an
   * observation made on THIS module's behalf and belongs on THIS module's surface.
   *
   * A plain reference, not a wrapper: `getSnapshotHealth` reads the submodule's own
   * `_health` binding and takes no receiver, so re-exporting it keeps reporting the
   * live record — including after that module's `_resetForTest` rebinds it.
   *
   * win32 only. linux.js and darwin.js publish no snapshot leaf and must not grow a
   * null-returning stub for one: they also set `providesStartTime: false`, and
   * process-scanner's `getIdentityQuality` answers on that flag before it ever asks
   * for a witness.
   * @type {() => import('../sensor-health').SensorHealth}
   */
  getSnapshotHealth: snapshot.getSnapshotHealth,
  cimParentProcessMap,
  getRawTcpConnections,
  getFileHandles,
  getSensitiveHolders: restartManager.getSensitiveHolders,
  getHotSensitiveHolders: restartManager.getHotSensitiveHolders,
  isRestartManagerAvailable: restartManager.isRestartManagerAvailable,
  probeReadDetection,
  isReadDetectionAvailable,
  getProcessCwd,
  getProcessCwds,
  killProcess,
  suspendProcess,
  resumeProcess,
  IGNORE_FILE_PATTERNS,
};
