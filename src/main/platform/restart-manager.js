/**
 * @file platform/restart-manager.js
 * @module main/platform/restart-manager
 * @description Honest Windows read-detection via the Windows Restart Manager
 *   (rstrtmgr.dll), the replacement for the absent handle.exe. Restart Manager
 *   inverts the handle.exe model: instead of asking "what files does PID X hold?"
 *   it asks "which processes hold these registered resources?" — exactly what we
 *   need to attribute a held sensitive file to an agent PID, cross-process,
 *   asInvoker, WITHOUT admin (spike-proven).
 *
 *   IMPORTANT — this catches a handle HELD AT THE SCAN TICK, never a transient
 *   open→read→close. A `.env` that an agent opens, reads, and closes is already
 *   closed by the next scan → missed. This is point-in-time "holding open",
 *   exactly like handle.exe — NOT a read/access stream. Callers must label the
 *   resulting events "holding", never "read"/"accessed".
 *
 *   Grouping: one Restart Manager SESSION per directory group, opened and CLOSED
 *   before the next (so only one session is ever live — the 64-session/user cap is
 *   never approached). All groups run inside ONE powershell.exe spawn per scan
 *   (the spawn COUNT is the cost we cut, not the in-process RM session count).
 *
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.10.0
 */
'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getAllRules } = require('../rule-loader');
const { AGENT_CONFIG_PATHS } = require('../../shared/constants');

/**
 * Secret credential directories watched for held handles (mirror of the roots in
 * file-watcher.setupFileWatchers). Each existing dir becomes ONE registration
 * group → dir-level honest attribution ("holding a file under ~/.ssh"), never a
 * fabricated per-file claim RM cannot confirm.
 * @type {string[]}
 */
const SECRET_DIRS = ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.azure'];

/**
 * Whether Restart Manager P/Invoke is usable. Optimistic default (true);
 * downgraded to false ONLY by probeRestartManager() failing — "can't tell" must
 * fail honest, not optimistic. rstrtmgr.dll ships on every Windows Vista+, so the
 * probe really tests "does Add-Type + RmStartSession succeed in this runtime".
 * @type {boolean}
 */
let _rmAvailable = true;

/**
 * Max file paths registered per group — a defensive bound so a pathological dir
 * (thousands of files) cannot bloat one RmRegisterResources call.
 * @type {number}
 */
const MAX_FILES_PER_GROUP = 64;

/**
 * The C# Restart Manager wrapper compiled once per spawn via Add-Type. Exposes
 * a single static GetHolders(string[] files) → int[] of holder PIDs. Uses the
 * two-call RmGetList protocol and branches on pnProcInfoNeeded > 0 (the holder
 * count) — NOT on a 234/ERROR_MORE_DATA return code, which does not arrive here.
 * @type {string}
 */
const RM_CSHARP = [
  'using System;',
  'using System.Collections.Generic;',
  'using System.Runtime.InteropServices;',
  'using System.Text;',
  'public static class AegisRm {',
  '  [StructLayout(LayoutKind.Sequential)] struct RM_UNIQUE_PROCESS { public int dwProcessId; public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime; }',
  '  const int RM_INVALID_SESSION = -1;',
  '  const int CCH_RM_SESSION_KEY = 32;',
  '  const int CCH_RM_MAX_APP_NAME = 255;',
  '  const int CCH_RM_MAX_SVC_NAME = 63;',
  '  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct RM_PROCESS_INFO {',
  '    public RM_UNIQUE_PROCESS Process;',
  '    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_APP_NAME + 1)] public string strAppName;',
  '    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_SVC_NAME + 1)] public string strServiceShortName;',
  '    public int ApplicationType; public uint AppStatus; public uint TSSessionId;',
  '    [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;',
  '  }',
  '  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, StringBuilder strSessionKey);',
  '  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames, uint nApplications, IntPtr rgApplications, uint nServices, string[] rgsServiceNames);',
  '  [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, out uint lpdwRebootReasons);',
  '  [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint pSessionHandle);',
  '  public static int[] GetHolders(string[] files) {',
  '    var pids = new List<int>();',
  '    if (files == null || files.Length == 0) return pids.ToArray();',
  '    uint session; var key = new StringBuilder(CCH_RM_SESSION_KEY + 1);',
  '    if (RmStartSession(out session, 0, key) != 0) return pids.ToArray();',
  '    try {',
  '      if (RmRegisterResources(session, (uint)files.Length, files, 0, IntPtr.Zero, 0, null) != 0) return pids.ToArray();',
  '      uint needed = 0, count = 0, reason = 0;',
  '      RmGetList(session, out needed, ref count, null, out reason);',
  '      if (needed > 0) {',
  '        var info = new RM_PROCESS_INFO[needed]; count = needed;',
  '        if (RmGetList(session, out needed, ref count, info, out reason) == 0) {',
  '          for (uint i = 0; i < count; i++) pids.Add(info[i].Process.dwProcessId);',
  '        }',
  '      }',
  '    } finally { RmEndSession(session); }',
  '    return pids.ToArray();',
  '  }',
  '}',
].join('\n');

/**
 * Compile-and-run PowerShell body. Reads the group list (JSON) from an env var to
 * dodge path-quoting/injection in the script, invokes AegisRm.GetHolders per group,
 * and emits a compact JSON array of { group, reason, pids } back on stdout.
 * @type {string}
 */
const PS_BODY = [
  '$ErrorActionPreference="Stop"',
  `Add-Type -TypeDefinition @'\n${RM_CSHARP}\n'@`,
  '$groups = $env:AEGIS_RM_GROUPS | ConvertFrom-Json',
  '$out = @()',
  'foreach ($g in $groups) {',
  '  try { $pids = [AegisRm]::GetHolders([string[]]$g.files) } catch { $pids = @() }',
  '  $out += [pscustomobject]@{ group = $g.group; reason = $g.reason; pids = @($pids) }',
  '}',
  'if ($out.Count -gt 0) { $out | ConvertTo-Json -Compress -Depth 4 } else { "[]" }',
].join('\n');

/**
 * Classify a path against the loaded rules; returns the first matching reason or
 * null. A standalone copy of file-watcher.classifySensitive's built-in path —
 * restart-manager must NOT require file-watcher (that would close a require cycle
 * win32 → restart-manager → file-watcher → platform → win32).
 * @param {string} filePath
 * @returns {string|null}
 */
function classify(filePath) {
  for (const rule of getAllRules().values()) {
    if (rule.enabled !== false && rule.pattern.test(filePath)) return rule.reason;
  }
  return null;
}

/**
 * Shallow-enumerate concrete sensitive files under the watched secret/config dirs
 * plus home ~/.env* files, grouped for registration. A directory becomes one group
 * keyed by the dir path (dir-level naming); each ~/.env* file is its own group
 * keyed by the file path (single confirmed file → file-level naming is honest).
 * @returns {Array<{group: string, reason: string, files: string[]}>}
 */
function buildSensitiveGroups() {
  const home = os.homedir();
  /** @type {Array<{group: string, reason: string, files: string[]}>} */
  const groups = [];
  const dirNames = [...SECRET_DIRS, ...AGENT_CONFIG_PATHS];
  const seen = new Set();
  for (const name of dirNames) {
    const dir = path.join(home, name);
    if (seen.has(dir)) continue;
    seen.add(dir);
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue; // dir absent or unreadable
    }
    const files = [];
    for (const e of entries) {
      if (!e.isFile()) continue;
      files.push(path.join(dir, e.name));
      if (files.length >= MAX_FILES_PER_GROUP) break;
    }
    if (files.length === 0) continue;
    const reason = classify(files[0]) || classify(dir + path.sep);
    if (!reason) continue; // not rule-sensitive → skip
    groups.push({ group: dir, reason, files });
  }
  // ~/.env* — each file its own single-file group (confirmed file-level naming).
  try {
    for (const e of fs.readdirSync(home, { withFileTypes: true })) {
      if (!e.isFile() || !/^\.env(\.|$)/i.test(e.name)) continue;
      const file = path.join(home, e.name);
      const reason = classify(file);
      if (reason) groups.push({ group: file, reason, files: [file] });
    }
  } catch (_) {
    // home unreadable — skip env group
  }
  return groups;
}

/**
 * Run the Restart Manager scan: ONE powershell.exe spawn, one RM session per
 * group (sequentially opened/closed), returning every process holding a handle
 * to a registered sensitive resource. Holders are returned RAW (including
 * non-agent PIDs and possibly AEGIS itself) — the caller maps PIDs to agents and
 * applies the own-PID guard.
 * @returns {Promise<Array<{pid: number, group: string, reason: string}>>}
 * @since v0.10.0
 */
function getSensitiveHolders() {
  if (!_rmAvailable) return Promise.resolve([]);
  const groups = buildSensitiveGroups();
  if (groups.length === 0) return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', PS_BODY],
      { timeout: 15000, env: { ...process.env, AEGIS_RM_GROUPS: JSON.stringify(groups) } },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        resolve(parseHolders(stdout));
      },
    );
  });
}

/**
 * Parse the PowerShell JSON ({ group, reason, pids[] }[]) into a flat holder list.
 * @param {string} stdout
 * @returns {Array<{pid: number, group: string, reason: string}>}
 */
function parseHolders(stdout) {
  const raw = (stdout || '').trim();
  if (!raw || raw === '[]') return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    return [];
  }
  if (!Array.isArray(parsed)) parsed = [parsed];
  /** @type {Array<{pid: number, group: string, reason: string}>} */
  const holders = [];
  for (const g of parsed) {
    if (!g || !g.group) continue;
    let pids = g.pids;
    if (pids == null) continue;
    if (!Array.isArray(pids)) pids = [pids];
    for (const p of pids) {
      const pid = Number(p);
      if (Number.isInteger(pid) && pid > 0) {
        holders.push({ pid, group: g.group, reason: g.reason || '' });
      }
    }
  }
  return holders;
}

/**
 * One-time startup probe: can this runtime Add-Type the RM wrapper and open a
 * Restart Manager session? Sets _rmAvailable. Errors/timeouts → unavailable
 * (fail honest). Result is consumed by win32.probeReadDetection to drive the
 * combined read-detection capability flag.
 * @returns {Promise<{available: boolean}>}
 * @since v0.10.0
 */
function probeRestartManager() {
  return new Promise((resolve) => {
    const probeBody = [
      '$ErrorActionPreference="Stop"',
      `Add-Type -TypeDefinition @'\n${RM_CSHARP}\n'@`,
      'try { [void][AegisRm]::GetHolders(@()); "OK" } catch { "FAIL" }',
    ].join('\n');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', probeBody],
      { timeout: 8000 },
      (err, stdout) => {
        const ok = !err && /OK/.test(stdout || '');
        _rmAvailable = ok;
        resolve({ available: ok });
      },
    );
  });
}

/**
 * @returns {boolean} Whether Restart Manager read-detection is currently usable.
 * @since v0.10.0
 */
function isRestartManagerAvailable() {
  return _rmAvailable;
}

module.exports = {
  getSensitiveHolders,
  probeRestartManager,
  isRestartManagerAvailable,
  buildSensitiveGroups,
  // Exposed for testing only
  _parseHolders: parseHolders,
};
