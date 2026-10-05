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
 *   never approached). All groups run inside ONE helper or fallback PowerShell spawn per scan
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
const logger = require('../logger');
const { getAllRules } = require('../rule-loader');
const { AGENT_CONFIG_PATHS, SENSITIVE_AGENT_DIRS } = require('../../shared/constants');
const { RM_CSHARP } = require('./rm-csharp');
const {
  createWindowsObserver,
  parseNativeHolders,
  validCreateTime100ns,
} = require('./windows-observer');
const observer = createWindowsObserver({ execFile });

/**
 * Secret credential directories watched for held handles. Each existing dir
 * becomes ONE registration group → dir-level honest attribution ("holding a file
 * under ~/.ssh"), never a fabricated per-file claim RM cannot confirm.
 * @type {readonly string[]}
 */
const SECRET_DIRS = SENSITIVE_AGENT_DIRS;

/**
 * The crown-jewel credential roots scanned by the FAST hot read-detect cycle
 * (file-watcher.scanHotFileHolders, ~10s) — a strict subset of SECRET_DIRS, kept
 * small so each frequent spawn registers few files and stays cheap. `~/.env*` is
 * folded in via the includeEnv branch of buildSensitiveGroups, not listed here.
 * The full 30s scan still covers the broader SECRET_DIRS ∪ AGENT_CONFIG_PATHS set.
 * @type {string[]}
 */
const HOT_DIRS = ['.ssh', '.aws', '.gnupg'];

/**
 * Whether Restart Manager P/Invoke is usable. Optimistic default (true);
 * downgraded to false ONLY by probeRestartManager() failing — "can't tell" must
 * fail honest, not optimistic. The native helper or PowerShell fallback must
 * actually open and close a Restart Manager session.
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
 * Compile-and-run PowerShell body. Reads the group list (JSON) from an env var to
 * dodge path-quoting/injection in the script, invokes AegisRm.GetHolders per group,
 * and emits a compact JSON array of { group, reason, holders } back on stdout.
 * @type {string}
 */
const PS_BODY = [
  '$ErrorActionPreference="Stop"',
  '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)',
  `Add-Type -TypeDefinition @'\n${RM_CSHARP}\n'@`,
  '$groups = $env:AEGIS_RM_GROUPS | ConvertFrom-Json',
  '$out = @()',
  'foreach ($g in $groups) {',
  '  $holders = [AegisRm]::GetHolders([string[]]$g.files)',
  '  $out += [pscustomobject]@{ group = $g.group; reason = $g.reason; holders = @($holders) }',
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
 *
 * Parametrized so the FAST hot cycle can register a small subset. Defaults
 * reproduce the original full-scan behavior exactly (SECRET_DIRS ∪
 * AGENT_CONFIG_PATHS, env included) — existing callers are unaffected.
 * @param {string[]} [dirNames] - Directory basenames (under home) to enumerate.
 * @param {boolean} [includeEnv=true] - Whether to add ~/.env* single-file groups.
 * @returns {Array<{group: string, reason: string, files: string[]}>}
 */
function buildSensitiveGroups(
  dirNames = [...SECRET_DIRS, ...AGENT_CONFIG_PATHS],
  includeEnv = true,
) {
  const home = os.homedir();
  /** @type {Array<{group: string, reason: string, files: string[]}>} */
  const groups = [];
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
  if (includeEnv) {
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
  }
  return groups;
}

/**
 * Measure-only spawn-timing probe: log the Restart Manager scan's external
 * powershell.exe spawn round-trip duration to the operational log under
 * mod='perf' (one NDJSON line per spawn). The logger stamps `timestamp` (ts) and
 * `module` ('perf'); meta carries the spawn label and elapsed ms. Pure
 * instrumentation — never alters read-detect behavior.
 * @param {string} spawn - Spawn label (handle).
 * @param {number} t0 - performance.now() captured immediately before the spawn.
 * @returns {void}
 */
function logSpawnTax(spawn, t0) {
  logger.debug('perf', 'spawn', { spawn, ms: Math.round(performance.now() - t0) });
}

/**
 * Run the Restart Manager scan: one helper (or fallback PowerShell), one RM session per
 * group (sequentially opened/closed), returning every process holding a handle
 * to a registered sensitive resource. Holders are returned RAW (including
 * non-agent PIDs and possibly AEGIS itself) — the caller maps PIDs to agents and
 * applies the own-PID guard.
 *
 * Parametrized so the fast hot cycle can scan a small subset; default args
 * reproduce the original full scan exactly. `windowsHide:true` keeps the
 * frequent spawn from flashing a console window every ~10s.
 * @param {string[]} [dirNames] - Directory basenames to scan (see buildSensitiveGroups).
 * @param {boolean} [includeEnv=true] - Whether to include ~/.env* groups.
 * @returns {Promise<Array<{pid: number, createTime100ns: string, group: string, reason: string}>>}
 * @since v0.10.0
 */
async function getSensitiveHolders(dirNames, includeEnv) {
  if (!_rmAvailable) return Promise.resolve([]);
  const groups = buildSensitiveGroups(dirNames, includeEnv);
  if (groups.length === 0) return Promise.resolve([]);
  const native = await observer.tryRequest(
    'holders',
    { groups: groups.map((g) => g.files) },
    (rows) => parseNativeHolders(rows, groups),
  );
  if (native !== null) return native;
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', PS_BODY],
      {
        timeout: 15000,
        windowsHide: true,
        env: { ...process.env, AEGIS_RM_GROUPS: JSON.stringify(groups) },
      },
      (err, stdout) => {
        logSpawnTax('handle', t0);
        if (err) {
          reject(new Error('Restart Manager fallback failed'));
          return;
        }
        try {
          resolve(parseHolders(stdout, groups));
        } catch {
          reject(new Error('Invalid Restart Manager fallback response'));
        }
      },
    );
  });
}

/**
 * Fast hot-cycle variant: scans ONLY the crown-jewel credential roots (HOT_DIRS)
 * plus ~/.env*, for the ~10s read-detect poll that shrinks the 30s read-blind
 * window. Same RM mechanism and same HOLDS-AT-TICK honesty as getSensitiveHolders
 * — it catches a handle held at the tick, NEVER a transient open→read→close.
 * @returns {Promise<Array<{pid: number, createTime100ns: string, group: string, reason: string}>>}
 * @since v0.11.0-alpha
 */
function getHotSensitiveHolders() {
  return getSensitiveHolders(HOT_DIRS, true);
}

/**
 * Parse the PowerShell JSON ({ group, reason, holders[] }[]) into a flat holder list.
 * @param {string} stdout
 * @param {Array<{group: string, reason?: string}>} [expectedGroups]
 * @returns {Array<{pid: number, createTime100ns: string, group: string, reason: string}>}
 */
function parseHolders(stdout, expectedGroups) {
  const raw = (stdout || '').trim();
  if (!raw) throw new Error('Empty Restart Manager response');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid Restart Manager response');
  }
  if (!Array.isArray(parsed)) parsed = [parsed];
  if (expectedGroups && parsed.length !== expectedGroups.length)
    throw new Error('Incomplete Restart Manager response');
  /** @type {Array<{pid: number, createTime100ns: string, group: string, reason: string}>} */
  const holders = [];
  for (let i = 0; i < parsed.length; i++) {
    const g = parsed[i];
    if (!g || typeof g.group !== 'string' || !g.group)
      throw new Error('Invalid Restart Manager group');
    if (expectedGroups && g.group !== expectedGroups[i].group)
      throw new Error('Unexpected Restart Manager group');
    let groupHolders = g.holders;
    if (groupHolders == null) throw new Error('Missing Restart Manager holders');
    if (!Array.isArray(groupHolders)) groupHolders = [groupHolders];
    for (const holder of groupHolders) {
      if (
        !holder ||
        !Number.isInteger(holder.pid) ||
        holder.pid <= 0 ||
        holder.pid > 0xffffffff ||
        !validCreateTime100ns(holder.createTime100ns)
      )
        throw new Error('Invalid Restart Manager holder identity');
      holders.push({
        pid: holder.pid,
        createTime100ns: holder.createTime100ns,
        group: g.group,
        reason: expectedGroups ? expectedGroups[i].reason || '' : g.reason || '',
      });
    }
  }
  return holders;
}

/**
 * One-time startup probe: can the native helper or PowerShell fallback open and
 * close a Restart Manager session? Sets _rmAvailable. Errors/timeouts → unavailable
 * (fail honest). Result is consumed by win32.probeReadDetection to drive the
 * combined read-detection capability flag.
 * @returns {Promise<{available: boolean}>}
 * @since v0.10.0
 */
async function probeRestartManager() {
  const native = await observer.tryRequest('rm-probe', {}, (rows) => {
    if (rows.length !== 1 || rows[0]?.available !== true)
      throw new Error('Invalid Restart Manager probe');
    return true;
  });
  if (native !== null) {
    _rmAvailable = true;
    return { available: true };
  }
  return new Promise((resolve) => {
    const probeBody = [
      '$ErrorActionPreference="Stop"',
      `Add-Type -TypeDefinition @'\n${RM_CSHARP}\n'@`,
      'try { [AegisRm]::Probe(); "OK" } catch { "FAIL" }',
    ].join('\n');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', probeBody],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => {
        const ok = !err && (stdout || '').trim() === 'OK';
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
  getHotSensitiveHolders,
  probeRestartManager,
  isRestartManagerAvailable,
  buildSensitiveGroups,
  // Exposed for testing only
  _parseHolders: parseHolders,
};
