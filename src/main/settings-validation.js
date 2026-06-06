/**
 * @file settings-validation.js
 * @description Pure validation helpers for settings objects and false-positive
 *   entries, extracted from ipc-handlers.js. No IPC, no side effects.
 * @since v0.10.0-alpha
 */
'use strict';
const config = require('./config-manager');

/** @type {Set<string>} Whitelist of allowed settings keys */
const SETTINGS_WHITELIST = new Set([
  'scanIntervalSec',
  'notificationsEnabled',
  'customSensitivePatterns',
  'startMinimized',
  'autoStartWithWindows',
  'anthropicApiKey',
  'darkMode',
  'uiScale',
  'timelineZoom',
  'agentPermissions',
  'ignoredDirectories',
  'ignoreCommonBuildDirs',
  'seenAgents',
  'customAgents',
  'hardwareAcceleration',
  'falsePositivePatterns',
  'watchlist',
]);

/** @type {string[]} Catch-all regex patterns to reject as false positives */
const CATCHALL_PATTERNS = ['.*', '.+', '^.*$', '^.+$', '[\\s\\S]*', '[\\s\\S]+'];

/**
 * Validate a settings object against the whitelist and type rules.
 * @param {Object} obj - Settings to validate
 * @returns {{ valid: boolean, error?: string }} Validation result
 */
function validateSettings(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { valid: false, error: 'Settings must be a plain object' };
  }
  const unknownKeys = Object.keys(obj).filter((k) => !SETTINGS_WHITELIST.has(k));
  if (unknownKeys.length > 0) {
    return { valid: false, error: `Unknown settings keys: ${unknownKeys.join(', ')}` };
  }
  if ('scanIntervalSec' in obj) {
    if (typeof obj.scanIntervalSec !== 'number' || obj.scanIntervalSec <= 0) {
      return { valid: false, error: 'scanIntervalSec must be a positive number' };
    }
  }
  if ('customSensitivePatterns' in obj) {
    if (!Array.isArray(obj.customSensitivePatterns)) {
      return { valid: false, error: 'customSensitivePatterns must be an array' };
    }
    for (const p of obj.customSensitivePatterns) {
      if (typeof p !== 'string') {
        return { valid: false, error: 'Each custom pattern must be a string' };
      }
      if (!config.isSafeRegex(p)) {
        return { valid: false, error: `Unsafe or invalid regex pattern: ${p}` };
      }
    }
  }
  if ('uiScale' in obj) {
    if (typeof obj.uiScale !== 'number' || obj.uiScale < 0.5 || obj.uiScale > 3) {
      return { valid: false, error: 'uiScale must be a number between 0.5 and 3' };
    }
  }
  if ('timelineZoom' in obj) {
    if (typeof obj.timelineZoom !== 'number' || obj.timelineZoom < 1 || obj.timelineZoom > 24) {
      return { valid: false, error: 'timelineZoom must be a number between 1 and 24' };
    }
  }
  return { valid: true };
}

/**
 * Validate a false positive entry shape.
 * @param {Object} entry
 * @returns {{ valid: boolean, error?: string }}
 */
function validateFalsePositive(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { valid: false, error: 'Entry must be a plain object' };
  }
  if (typeof entry.agentName !== 'string' || entry.agentName.length === 0) {
    return { valid: false, error: 'agentName must be a non-empty string' };
  }
  if (typeof entry.pattern !== 'string' || entry.pattern.length === 0) {
    return { valid: false, error: 'pattern must be a non-empty string' };
  }
  if (entry.pattern.length > 256) {
    return { valid: false, error: 'pattern exceeds max length of 256 characters' };
  }
  if (CATCHALL_PATTERNS.includes(entry.pattern)) {
    return { valid: false, error: 'Catch-all patterns are not allowed' };
  }
  if (typeof entry.timestamp !== 'number' || entry.timestamp <= 0) {
    return { valid: false, error: 'timestamp must be a positive number' };
  }
  return { valid: true };
}

module.exports = { validateSettings, validateFalsePositive };
