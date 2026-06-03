/**
 * @file ide-extension-detector.js
 * @module main/ide-extension-detector
 * @description Detects AI coding agents that ship as editor EXTENSIONS and have
 *   no standalone OS process (Kilo Code, Cline). Process-name scanning cannot
 *   see them — they run inside the editor's extension host. Instead we read the
 *   editor's `extensions/` directory for the known extension folder, and — only
 *   when the editor itself is running — surface a synthetic agent annotated
 *   "via <Editor>", the same way Copilot is annotated when hosted in VS Code.
 * @requires fs
 * @requires os
 * @requires path
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 * @since v0.11.0-alpha
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const _platform = require('./platform');

let _listProcesses = _platform.listProcesses;
let _readdir = (dir) => fs.promises.readdir(dir);
let _homedir = () => os.homedir();

/**
 * @internal Override dependencies (for tests).
 * @param {{ listProcesses?: Function, readdir?: Function, homedir?: Function }} overrides
 */
function _setDepsForTest(overrides) {
  if (overrides.listProcesses) _listProcesses = overrides.listProcesses;
  if (overrides.readdir) _readdir = overrides.readdir;
  if (overrides.homedir) _homedir = overrides.homedir;
}

/** @internal Reset to real dependencies and clear the cache (for tests). */
function _resetForTest() {
  _listProcesses = _platform.listProcesses;
  _readdir = (dir) => fs.promises.readdir(dir);
  _homedir = () => os.homedir();
  _cache = [];
  _lastRefresh = 0;
  _refreshing = false;
}

// ═══ SIGNATURES ═══

/**
 * @typedef {Object} EditorExtHost
 * @property {string[]} procNames - lowercase process names that mean this editor is running
 * @property {string} extDir - extensions dir relative to home (VS Code-family layout)
 * @property {string} label - human-readable editor label for "via <label>"
 */

/**
 * VS Code and its forks share the `<home>/<editorDir>/extensions/<publisher>.<name>-<ver>`
 * layout. Cursor and Windsurf are VS Code forks with their own extensions dir.
 * @type {readonly EditorExtHost[]}
 */
const EDITOR_EXT_HOSTS = [
  { procNames: ['code.exe', 'code'], extDir: '.vscode/extensions', label: 'VS Code' },
  {
    procNames: ['code - insiders.exe', 'code-insiders'],
    extDir: '.vscode-insiders/extensions',
    label: 'VS Code Insiders',
  },
  { procNames: ['cursor.exe', 'cursor'], extDir: '.cursor/extensions', label: 'Cursor' },
  { procNames: ['windsurf.exe', 'windsurf'], extDir: '.windsurf/extensions', label: 'Windsurf' },
];

/**
 * @typedef {Object} ExtSignature
 * @property {string} idPrefix - lowercase `publisher.name` prefix of the extension folder
 * @property {string} agent - display name to surface for the detected agent
 */

/**
 * AI coding agents distributed only as editor extensions (no standalone process).
 * @type {readonly ExtSignature[]}
 */
const AI_EXTENSIONS = [
  { idPrefix: 'kilocode.kilo-code', agent: 'Kilo Code' },
  { idPrefix: 'saoudrizwan.claude-dev', agent: 'Cline' },
];

// ═══ CACHE ═══

/** @type {number} How long a directory/process scan stays fresh (ms) */
const REFRESH_TTL_MS = 30000;

/** @type {Array<Object>} Last detected synthetic agents */
let _cache = [];
let _lastRefresh = 0;
let _refreshing = false;

// ═══ INTERNAL ═══

/**
 * Does an extensions-dir listing contain a folder for the given extension id?
 * Extension folders are named `publisher.name-<version>[-<platform>]`, so we
 * match the id prefix followed by a `-` boundary (or an exact, version-less id).
 * @param {string[]} entries - directory entry names
 * @param {string} idPrefix - lowercase `publisher.name`
 * @returns {boolean}
 */
function hasExtension(entries, idPrefix) {
  return entries.some((e) => {
    const lower = e.toLowerCase();
    return lower === idPrefix || lower.startsWith(idPrefix + '-');
  });
}

// ═══ PUBLIC API ═══

/**
 * Scan running editors and their extension directories for AI-agent extensions.
 * Only editors that are actually running yield agents — an installed-but-idle
 * extension is not an active agent. Each match becomes a synthetic agent with
 * `pid: 0` (it has no real OS process; pid 0 also keeps it inert for the
 * file-handle and TCP scanners, which guard `pid > 0`).
 * @returns {Promise<Array<Object>>} Synthetic agent objects
 * @since v0.11.0-alpha
 */
async function detectExtensionAgents() {
  let procs;
  try {
    procs = await _listProcesses();
  } catch (_) {
    return [];
  }
  const running = new Set(procs.map((p) => p.name.toLowerCase()));
  const home = _homedir();
  const detected = [];
  const seenAgents = new Set();

  for (const editor of EDITOR_EXT_HOSTS) {
    if (!editor.procNames.some((n) => running.has(n))) continue;
    let entries;
    try {
      entries = await _readdir(path.join(home, editor.extDir));
    } catch (_) {
      continue; // extensions dir absent for this editor
    }
    if (!Array.isArray(entries) || entries.length === 0) continue;
    for (const ext of AI_EXTENSIONS) {
      if (seenAgents.has(ext.agent)) continue;
      if (!hasExtension(entries, ext.idPrefix)) continue;
      seenAgents.add(ext.agent);
      detected.push({
        agent: ext.agent,
        process: editor.procNames[0],
        pid: 0,
        status: 'running',
        category: 'ai',
        parentEditor: editor.label,
        displayLabel: `${ext.agent} (via ${editor.label})`,
        detectionMethod: 'ide-extension',
        extensionId: ext.idPrefix,
      });
    }
  }
  return detected;
}

/**
 * Return the most recent detection synchronously, kicking off a throttled
 * background refresh when the cache is stale. Never blocks the caller — the hot
 * scan path reads cached results so a directory/process scan never delays the
 * batched IPC. First call returns `[]` until the first refresh completes.
 * @returns {Array<Object>} Cached synthetic agents
 * @since v0.11.0-alpha
 */
function getCachedExtensionAgents() {
  const now = Date.now();
  if (!_refreshing && (_lastRefresh === 0 || now - _lastRefresh > REFRESH_TTL_MS)) {
    _refreshing = true;
    detectExtensionAgents()
      .then((agents) => {
        _cache = agents;
      })
      .catch(() => {})
      .finally(() => {
        _lastRefresh = Date.now();
        _refreshing = false;
      });
  }
  return _cache;
}

module.exports = {
  detectExtensionAgents,
  getCachedExtensionAgents,
  EDITOR_EXT_HOSTS,
  AI_EXTENSIONS,
  _setDepsForTest,
  _resetForTest,
};
