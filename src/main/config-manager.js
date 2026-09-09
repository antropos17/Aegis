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
const { buildInstanceKey } = require('../shared/instance-key');
const logger = require('./logger');
const safeStore = require('./safe-storage');

/**
 * Accept a conservative regex subset for synchronous path matching.
 * Repeated groups, backreferences, lookarounds and multiple variable repetitions
 * are unsupported because observed paths must not cause excessive backtracking.
 * @param {string} pattern - Raw regex string
 * @returns {boolean} Whether the pattern is supported
 * @since v0.9.1
 */
function isSafeRegex(pattern) {
  if (typeof pattern !== 'string' || !pattern.length || pattern.length > 256) return false;
  try {
    new RegExp(pattern);
  } catch {
    return false;
  }
  let inClass = false;
  let variableRepeats = 0;
  let previousGroup = false;
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === '\\') {
      const escaped = pattern[++index];
      if (!inClass && (/[1-9]/.test(escaped) || escaped === 'k')) return false;
      previousGroup = false;
      continue;
    }
    if (char === '[' && !inClass) {
      inClass = true;
      continue;
    }
    if (char === ']' && inClass) {
      inClass = false;
      previousGroup = false;
      continue;
    }
    if (inClass) continue;
    if (char === '(' && pattern[index + 1] === '?') {
      if (pattern[index + 2] !== ':') return false;
      index += 2;
      previousGroup = false;
      continue;
    }
    if (char === '*' || char === '+' || char === '?') {
      if (previousGroup || ++variableRepeats > 1) return false;
      previousGroup = false;
      continue;
    }
    if (char === '{') {
      const repetition = pattern.slice(index).match(/^\{(\d+)(?:,(\d*))?\}/);
      if (repetition) {
        const min = Number(repetition[1]);
        const max =
          repetition[2] === undefined
            ? min
            : repetition[2] === ''
              ? Infinity
              : Number(repetition[2]);
        if (previousGroup || min > 1024 || (Number.isFinite(max) && max > 1024)) return false;
        if (min !== max && ++variableRepeats > 1) return false;
        index += repetition[0].length - 1;
        previousGroup = false;
        continue;
      }
    }
    previousGroup = char === ')';
  }
  return true;
}

// ── Lazy path — resolved on first use (after app.whenReady) ──
let _settingsPath = null;
function settingsPath() {
  if (!_settingsPath) _settingsPath = path.join(app.getPath('userData'), 'settings.json');
  return _settingsPath;
}
/** @internal Override settings path (for tests). */
function _setSettingsPathForTest(p) {
  _settingsPath = p;
}

const DEFAULT_SETTINGS = {
  scanIntervalSec: 10,
  notificationsEnabled: true,
  customSensitivePatterns: [],
  startMinimized: false,
  autoStartWithWindows: false,
  automaticUpdatesEnabled: false,
  anthropicApiKey: '',
  darkMode: false,
  uiScale: 1,
  timelineZoom: 6,
  agentPermissions: {},
  ignoredDirectories: [],
  ignoreCommonBuildDirs: true,
  seenAgents: [],
  customAgents: [],
  hardwareAcceleration: true,
  falsePositivePatterns: [],
  watchlist: [],
};

/**
 * Fresh deep copy of the defaults. A shallow `{ ...DEFAULT_SETTINGS }` would
 * share the mutable array/object values (watchlist, seenAgents, customAgents,
 * agentPermissions, …) by reference, so an in-place `push` by a caller would
 * silently pollute DEFAULT_SETTINGS itself and leak across every later reset.
 * @returns {Object} an independent copy of DEFAULT_SETTINGS
 * @since v0.10.0-alpha
 */
function freshDefaults() {
  return structuredClone(DEFAULT_SETTINGS);
}

let settings = freshDefaults();
let encryptedApiKey = null;
let storedPlainApiKey = '';
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
    if (!isSafeRegex(patternStr)) {
      logger.warn('config-manager', `Skipped unsafe/invalid regex: ${patternStr}`);
      continue;
    }
    customSensitiveRules.push({
      pattern: new RegExp(patternStr, 'i'),
      reason: `Custom: ${patternStr}`,
    });
  }
}

/**
 * Write the in-memory settings to disk.
 * Strips plaintext anthropicApiKey and persists the encrypted blob instead.
 * @returns {void}
 * @since v0.8.3
 */
function _writeSettings() {
  const disk = { ...settings };
  // Never persist the plaintext key — store encrypted blob only
  const plainKey = disk.anthropicApiKey || '';
  delete disk.anthropicApiKey;
  if (plainKey) {
    const blob =
      encryptedApiKey && plainKey === storedPlainApiKey
        ? encryptedApiKey
        : safeStore.encrypt(plainKey);
    if (!blob)
      throw new Error('Secure key storage is unavailable. Unlock the OS keychain and retry.');
    disk._encryptedApiKey = blob;
  } else if (encryptedApiKey) {
    disk._encryptedApiKey = encryptedApiKey;
  } else {
    delete disk._encryptedApiKey;
  }
  const target = settingsPath();
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(disk, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, target);
    encryptedApiKey = disk._encryptedApiKey || null;
    storedPlainApiKey = plainKey;
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error.code !== 'ENOENT')
        logger.warn('config-manager', 'Could not remove settings temporary file', {
          error: error.message,
        });
    }
  }
}

/**
 * Load settings from disk, merging with defaults.
 * Migrates plaintext API key to encrypted storage on first load.
 * @returns {void}
 * @since v0.1.0
 */
function loadSettings() {
  settings = freshDefaults();
  encryptedApiKey = null;
  storedPlainApiKey = '';
  try {
    if (fs.existsSync(settingsPath())) {
      const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new Error('Invalid settings object');
      const { validateSettings } = require('./settings-validation');
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(raw, key)) continue;
        const value =
          key === 'customSensitivePatterns' && Array.isArray(raw[key])
            ? raw[key].filter(isSafeRegex)
            : raw[key];
        if (validateSettings({ [key]: value }).valid) settings[key] = value;
      }
      // Decrypt API key into memory
      if (typeof raw._encryptedApiKey === 'string' && raw._encryptedApiKey) {
        encryptedApiKey = raw._encryptedApiKey;
        settings.anthropicApiKey = safeStore.decrypt(encryptedApiKey);
        storedPlainApiKey = settings.anthropicApiKey;
      }
      // Migrate plaintext key → encrypted on first load
      if (raw.anthropicApiKey && !raw._encryptedApiKey && safeStore.isAvailable()) {
        logger.info('config-manager', 'Migrating API key to encrypted storage');
        try {
          _writeSettings();
        } catch {
          logger.warn(
            'config-manager',
            'API key migration deferred until secure storage is available',
          );
        }
      }
    }
  } catch (_) {
    settings = freshDefaults();
  }
  buildCustomRules();
}

/**
 * Persist updated settings to disk.
 * @param {Object} newSettings - Partial settings object merged with defaults
 * @param {{clearAnthropicApiKey?: boolean}} [options] - Explicit credential removal
 * @returns {void}
 * @since v0.1.0
 */
function saveSettings(newSettings, options = {}) {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => key !== 'clearAnthropicApiKey') ||
    (Object.hasOwn(options, 'clearAnthropicApiKey') &&
      typeof options.clearAnthropicApiKey !== 'boolean')
  )
    throw new Error('Invalid settings save options');
  const { validateSettings } = require('./settings-validation');
  const check = validateSettings(newSettings);
  if (!check.valid) throw new Error(check.error);
  const previous = settings;
  const previousBlob = encryptedApiKey;
  settings = { ...freshDefaults(), anthropicApiKey: previous.anthropicApiKey, ...newSettings };
  if (options.clearAnthropicApiKey === true) {
    encryptedApiKey = null;
    settings.anthropicApiKey = '';
  } else if (
    previous.anthropicApiKey &&
    Object.hasOwn(newSettings, 'anthropicApiKey') &&
    !newSettings.anthropicApiKey
  ) {
    encryptedApiKey = null;
  }
  try {
    _writeSettings();
  } catch (error) {
    settings = previous;
    encryptedApiKey = previousBlob;
    throw error;
  }
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
  const saved = Object.hasOwn(settings.agentPermissions, agentName)
    ? settings.agentPermissions[agentName]
    : null;
  if (saved) return saved;
  return getDefaultPermissions(agentName);
}

/**
 * Build the durable permission key for an agent workspace context.
 * Delegates to the single shared definition — never derives from pid/instanceId.
 * @param {string} agentName
 * @param {string|null} [parentEditor]
 * @param {string|null} [cwd]
 * @returns {string} e.g. "Claude Code::/path/to/project" or "Claude Code::VS Code" or "Claude Code"
 * @since v0.4.0
 * @see shared/instance-key.js
 */
function getInstanceKey(agentName, parentEditor, cwd) {
  return buildInstanceKey(agentName, parentEditor, cwd);
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
    const cwdPerms = Object.hasOwn(settings.agentPermissions, cwdKey)
      ? settings.agentPermissions[cwdKey]
      : null;
    if (cwdPerms) return cwdPerms;
  }
  if (parentEditor) {
    const editorKey = getInstanceKey(agentName, parentEditor);
    const editorPerms = Object.hasOwn(settings.agentPermissions, editorKey)
      ? settings.agentPermissions[editorKey]
      : null;
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
  saveSettings({ ...settings, agentPermissions: { ...settings.agentPermissions, [key]: perms } });
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
      _writeSettings();
    } catch (err) {
      logger.warn('config-manager', 'Failed to persist seen agent', {
        agentName,
        error: err.message,
      });
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
  saveSettings({ ...settings, customAgents: agents });
}

/**
 * Return the false positive patterns array.
 * @returns {Array<{agentName: string, pattern: string, timestamp: number}>}
 * @since v0.4.0
 */
function getFalsePositives() {
  return settings.falsePositivePatterns || [];
}

/**
 * Add a false positive entry and persist.
 * @param {{agentName: string, pattern: string, timestamp: number}} entry
 * @returns {void}
 * @since v0.4.0
 */
function addFalsePositive(entry) {
  saveSettings({
    ...settings,
    falsePositivePatterns: [...(settings.falsePositivePatterns || []), entry],
  });
}

const _exports = {
  init,
  isSafeRegex,
  loadSettings,
  saveSettings,
  applySettings,
  getDefaultPermissions,
  getAgentPermissions,
  getInstancePermissions,
  saveInstancePermissions,
  trackSeenAgent,
  getSettings,
  getCustomSensitiveRules,
  getCustomAgents,
  saveCustomAgents,
  getFalsePositives,
  addFalsePositive,
  _setSettingsPathForTest,
};

// Lazy getter — keeps config.SETTINGS_PATH working for external callers
Object.defineProperty(_exports, 'SETTINGS_PATH', { get: settingsPath, enumerable: true });

module.exports = _exports;
