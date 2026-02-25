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

// ── Lazy path — resolved on first use (after app.whenReady) ──
let _settingsPath = null;
function settingsPath() {
  if (!_settingsPath) _settingsPath = path.join(app.getPath('userData'), 'settings.json');
  return _settingsPath;
}

const DEFAULT_SETTINGS = {
  scanIntervalSec: 10,
  notificationsEnabled: true,
  customSensitivePatterns: [],
  startMinimized: false,
  autoStartWithWindows: false,
  anthropicApiKey: '',
  darkMode: false,
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
      customSensitiveRules.push({ pattern: new RegExp(patternStr, 'i'), reason: `Custom: ${patternStr}` });
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
    } catch (_) {}
  }
}

/**
 * Return the current settings snapshot.
 * @returns {Object} Current settings
 * @since v0.1.0
 */
function getSettings() { return settings; }

/**
 * Return the compiled custom sensitive rules.
 * @returns {Array} Custom sensitive rules with pattern and reason
 * @since v0.1.0
 */
function getCustomSensitiveRules() { return customSensitiveRules; }

/**
 * Return the user's custom agents array.
 * @returns {Array} Custom agent objects
 * @since v0.2.0
 */
function getCustomAgents() { return settings.customAgents || []; }

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
  } catch (_) {}
}

const _exports = {
  init,
  loadSettings,
  saveSettings,
  applySettings,
  getDefaultPermissions,
  getAgentPermissions,
  trackSeenAgent,
  getSettings,
  getCustomSensitiveRules,
  getCustomAgents,
  saveCustomAgents,
};

// Lazy getter — keeps config.SETTINGS_PATH working for external callers
Object.defineProperty(_exports, 'SETTINGS_PATH', { get: settingsPath, enumerable: true });

module.exports = _exports;
