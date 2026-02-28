/**
 * @file config-manager.js
 * @module main/config-manager
 * @description Settings persistence, custom sensitive-pattern compilation,
 *   permission defaults, and agent tracking helpers.
 * @requires fs
 * @requires path
 * @requires electron
 * @requires ../shared/constants
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { PERMISSION_CATEGORIES } = require('../shared/constants');
const logger = require('./logger');

// ── Lazy path — resolved on first use (after app.whenReady) ──
let _settingsPath = null;
function settingsPath() {
  if (!_settingsPath) _settingsPath = path.join(app.getPath('userData'), 'settings.json');
  return _settingsPath;
}
/** @internal Override settings path (for tests). */
function _setSettingsPathForTest(p) { _settingsPath = p; }

const DEFAULT_SETTINGS = {
  scanIntervalSec: 10,
  notificationsEnabled: true,
  customSensitivePatterns: [],
  startMinimized: false,
  autoStartWithWindows: false,
  anthropicApiKey: '',
  darkMode: false,
  uiScale: 1,
  timelineZoom: 6,
  agentPermissions: {},
  seenAgents: [],
  customAgents: [],
};

let settings = { ...DEFAULT_SETTINGS };
let customSensitiveRules = [];
let _knownAgentNames = [];
let _applyCallback = null;

/**
 * Initialise the config manager with known agent names and an apply callback.
 * @param {{ knownAgentNames: string[], applyCallback: Function }} opts
 * @returns {void}
 * @since v0.1.0
 */
function init(opts) {
  _knownAgentNames = opts.knownAgentNames || [];
  _applyCallback = opts.applyCallback || null;
}

/**
 * Build RegExp rules from user-defined custom sensitive patterns.
 * @returns {void}
 * @since v0.1.0
 */
function buildCustomRules() {
  customSensitiveRules = [];
  for (const patternStr of settings.customSensitivePatterns) {
    try {
      customSensitiveRules.push({
        pattern: new RegExp(patternStr, 'i'),
        reason: `Custom: ${patternStr}`,
      });
    } catch (_) {}
  }
}

/**
 * Load settings from disk, merging with defaults.
 * @returns {void}
 * @since v0.1.0
 */
function loadSettings() {
  try {
    if (fs.existsSync(settingsPath())) {
      const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'));
      settings = { ...DEFAULT_SETTINGS, ...raw };
    }
  } catch (_) {
    settings = { ...DEFAULT_SETTINGS };
  }
  buildCustomRules();
}

/**
 * Persist updated settings to disk.
 * @param {Object} newSettings - Partial settings object merged with defaults
 * @returns {void}
 * @since v0.1.0
 */
function saveSettings(newSettings) {
  settings = { ...DEFAULT_SETTINGS, ...newSettings };
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  buildCustomRules();
}

/**
 * Re-apply settings (restart scan intervals via callback).
 * @returns {void}
 * @since v0.1.0
 */
function applySettings() {
  if (_applyCallback) _applyCallback();
}

/**
 * Return default permission map for an agent (monitor for known, block for unknown).
 * @param {string} agentName
 * @returns {Object.<string, string>} category-to-state map
 * @since v0.1.0
 */
function getDefaultPermissions(agentName) {
  const state = _knownAgentNames.includes(agentName) ? 'monitor' : 'block';
  const perms = {};
  for (const cat of PERMISSION_CATEGORIES) perms[cat] = state;
  return perms;
}

/**
 * Return saved or default permissions for an agent.
 * @param {string} agentName
 * @returns {Object.<string, string>} category-to-state map
 * @since v0.1.0
 */
function getAgentPermissions(agentName) {
  const saved = settings.agentPermissions[agentName];
  if (saved) return saved;
  return getDefaultPermissions(agentName);
}

/**
 * Build the instance permission key for an agent.
 * CWD takes priority (most specific), then parentEditor, then name only.
 * @param {string} agentName
 * @param {string|null} parentEditor
 * @param {string|null} cwd
 * @returns {string} e.g. "Claude Code::/path/to/project" or "Claude Code::VS Code" or "Claude Code"
 * @since v0.4.0
 */
function getInstanceKey(agentName, parentEditor, cwd) {
  if (cwd) return `${agentName}::${cwd}`;
  if (parentEditor) return `${agentName}::${parentEditor}`;
  return agentName;
}

/**
 * Return permissions for a specific instance using the fallback chain:
 * cwd override → parentEditor override → agent default → global default.
 * @param {string} agentName
 * @param {string|null} parentEditor
 * @param {string|null} cwd
 * @returns {Object.<string, string>} category-to-state map
 * @since v0.4.0
 */
function getInstancePermissions(agentName, parentEditor, cwd) {
  if (cwd) {
    const cwdKey = getInstanceKey(agentName, null, cwd);
    const cwdPerms = settings.agentPermissions[cwdKey];
    if (cwdPerms) return cwdPerms;
  }
  if (parentEditor) {
    const editorKey = getInstanceKey(agentName, parentEditor);
    const editorPerms = settings.agentPermissions[editorKey];
    if (editorPerms) return editorPerms;
  }
  return getAgentPermissions(agentName);
}

/**
 * Save permissions for a specific instance.
 * @param {string} agentName
 * @param {string|null} parentEditor
 * @param {Object.<string, string>} perms - category-to-state map
 * @param {string|null} cwd
 * @returns {void}
 * @since v0.4.0
 */
function saveInstancePermissions(agentName, parentEditor, perms, cwd) {
  const key = getInstanceKey(agentName, parentEditor, cwd);
  settings.agentPermissions[key] = perms;
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (err) {
    logger.warn('config-manager', 'Failed to persist instance permissions', { key, error: err.message });
  }
}

/**
 * Record a newly-seen agent and persist its default permissions.
 * @param {string} agentName
 * @returns {void}
 * @since v0.1.0
 */
function trackSeenAgent(agentName) {
  if (!settings.seenAgents.includes(agentName)) {
    settings.seenAgents.push(agentName);
    if (!settings.agentPermissions[agentName]) {
      settings.agentPermissions[agentName] = getDefaultPermissions(agentName);
    }
    try {
      fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
    } catch (err) {
      logger.warn('config-manager', 'Failed to persist seen agent', { agentName, error: err.message });
    }
  }
}

/**
 * Return the current settings snapshot.
 * @returns {Object} Current settings
 * @since v0.1.0
 */
function getSettings() {
  return settings;
}

/**
 * Return the compiled custom sensitive rules.
 * @returns {Array} Custom sensitive rules with pattern and reason
 * @since v0.1.0
 */
function getCustomSensitiveRules() {
  return customSensitiveRules;
}

/**
 * Return the user's custom agents array.
 * @returns {Array} Custom agent objects
 * @since v0.2.0
 */
function getCustomAgents() {
  return settings.customAgents || [];
}

/**
 * Replace the custom agents array and persist.
 * @param {Array} agents - Full custom agents array
 * @returns {void}
 * @since v0.2.0
 */
function saveCustomAgents(agents) {
  settings.customAgents = agents;
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (err) {
    logger.warn('config-manager', 'Failed to persist custom agents', { error: err.message });
  }
}

const _exports = {
  init,
  loadSettings,
  saveSettings,
  applySettings,
  getDefaultPermissions,
  getAgentPermissions,
  getInstanceKey,
  getInstancePermissions,
  saveInstancePermissions,
  trackSeenAgent,
  getSettings,
  getCustomSensitiveRules,
  getCustomAgents,
  saveCustomAgents,
  _setSettingsPathForTest,
};

// Lazy getter — keeps config.SETTINGS_PATH working for external callers
Object.defineProperty(_exports, 'SETTINGS_PATH', { get: settingsPath, enumerable: true });

module.exports = _exports;
