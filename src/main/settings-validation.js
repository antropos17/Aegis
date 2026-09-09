/**
 * @file settings-validation.js
 * @description Validation shared by IPC and canonical settings persistence.
 * @since v0.10.0-alpha
 */
'use strict';
const { PERMISSION_CATEGORIES } = require('../shared/constants');

const BOOLEAN_FIELDS = new Set([
  'notificationsEnabled',
  'startMinimized',
  'autoStartWithWindows',
  'automaticUpdatesEnabled',
  'darkMode',
  'ignoreCommonBuildDirs',
  'hardwareAcceleration',
]);
const SETTINGS_WHITELIST = new Set([
  ...BOOLEAN_FIELDS,
  'scanIntervalSec',
  'customSensitivePatterns',
  'anthropicApiKey',
  'uiScale',
  'timelineZoom',
  'agentPermissions',
  'ignoredDirectories',
  'seenAgents',
  'customAgents',
  'falsePositivePatterns',
  'watchlist',
]);
const PERMISSION_STATES = new Set(['allow', 'monitor', 'block']);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const CATCHALL_PATTERNS = ['.*', '.+', '^.*$', '^.+$', '[\\s\\S]*', '[\\s\\S]+'];
const AGENT_CATEGORIES = new Set([
  'coding-assistant',
  'ai-ide',
  'cli-tool',
  'autonomous-agent',
  'desktop-agent',
  'browser-agent',
  'agent-framework',
  'security-devops',
  'ide-extension',
  'container-runtime',
  'local-llm-runtime',
]);
const AGENT_FIELDS = new Set([
  'id',
  'displayName',
  'names',
  'vendor',
  'category',
  'icon',
  'color',
  'defaultTrust',
  'website',
  'description',
  'knownDomains',
  'knownPorts',
  'configPaths',
  'parentEditors',
  'riskProfile',
]);

function invalid(error) {
  return { valid: false, error };
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function nonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringArray(value, maxLength = Infinity) {
  return (
    Array.isArray(value) &&
    Array.from(value).every((item) => nonemptyString(item) && item.length <= maxLength)
  );
}

function finiteRange(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function positive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function onlyKeys(value, allowed) {
  return Reflect.ownKeys(value).every(
    (key) => typeof key === 'string' && allowed.has(key) && !UNSAFE_KEYS.has(key),
  );
}

function safeRegex(pattern) {
  // Lazy lookup: config-manager also uses this module for disk/save validation.
  // Loading config at module scope would capture its incomplete circular export.
  return require('./config-manager').isSafeRegex(pattern);
}

function validatePermissions(value) {
  if (!plainObject(value)) return invalid('agentPermissions must be a plain object');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !key.trim() || UNSAFE_KEYS.has(key))
      return invalid('agentPermissions contains an invalid agent key');
    const permissions = value[key];
    if (!plainObject(permissions))
      return invalid('Each agent permission map must be a plain object');
    for (const category of Reflect.ownKeys(permissions)) {
      if (typeof category !== 'string' || !PERMISSION_CATEGORIES.includes(category))
        return invalid('Unknown permission category');
      if (!PERMISSION_STATES.has(permissions[category]))
        return invalid('Permission states must be allow, monitor or block');
    }
  }
  return { valid: true };
}

/**
 * Validate a catalog signature, including optional supported metadata.
 * @param {Object} entry Candidate signature
 * @returns {{valid: boolean, error?: string}} Validation result
 * @since 0.14.1
 */
function validateCustomAgent(entry) {
  if (!plainObject(entry) || !onlyKeys(entry, AGENT_FIELDS))
    return invalid('Each custom agent must be a plain object with supported signature fields');
  if (
    typeof entry.id !== 'string' ||
    !/^[\w.-]{1,128}$/.test(entry.id) ||
    UNSAFE_KEYS.has(entry.id)
  )
    return invalid('Each custom agent needs a valid ID');
  if (!nonemptyString(entry.displayName) || entry.displayName.length > 200)
    return invalid('Each custom agent needs a display name up to 200 characters');
  if (!stringArray(entry.names, 256) || !entry.names.length)
    return invalid('Each custom agent needs non-empty process names up to 256 characters');
  for (const key of ['vendor', 'icon', 'color', 'description']) {
    if (Object.hasOwn(entry, key) && typeof entry[key] !== 'string')
      return invalid('Custom agent ' + key + ' must be a string');
  }
  if (
    Object.hasOwn(entry, 'website') &&
    (typeof entry.website !== 'string' ||
      (entry.website !== '' && !/^https?:\/\//i.test(entry.website)))
  )
    return invalid('Custom agent website must use HTTP or HTTPS');
  if (Object.hasOwn(entry, 'category') && !AGENT_CATEGORIES.has(entry.category))
    return invalid('Unknown custom agent category');
  if (Object.hasOwn(entry, 'riskProfile') && !['low', 'medium', 'high'].includes(entry.riskProfile))
    return invalid('Custom agent riskProfile must be low, medium or high');
  if (Object.hasOwn(entry, 'defaultTrust') && !finiteRange(entry.defaultTrust, 0, 100))
    return invalid('Custom agent defaultTrust must be between 0 and 100');
  for (const key of ['knownDomains', 'configPaths', 'parentEditors']) {
    if (Object.hasOwn(entry, key) && !stringArray(entry[key]))
      return invalid('Custom agent ' + key + ' must contain non-empty strings');
  }
  if (
    Object.hasOwn(entry, 'knownPorts') &&
    (!Array.isArray(entry.knownPorts) ||
      Array.from(entry.knownPorts).some(
        (port) => !Number.isInteger(port) || !finiteRange(port, 1, 65535),
      ))
  )
    return invalid('Custom agent knownPorts must contain valid port numbers');
  return { valid: true };
}

/**
 * Validate a persisted advisory watchlist entry.
 * @param {Object} entry Candidate entry
 * @returns {{valid: boolean, error?: string}} Validation result
 * @since 0.14.1
 */
function validateWatchEntry(entry) {
  if (
    !plainObject(entry) ||
    !onlyKeys(entry, new Set(['signature', 'pid', 'reason', 'known', 'addedAt']))
  )
    return invalid('Each watchlist entry must be a plain object with supported fields');
  if (!nonemptyString(entry.signature))
    return invalid('Watchlist signature must be a non-empty string');
  if (entry.pid !== null && (!Number.isSafeInteger(entry.pid) || entry.pid <= 0))
    return invalid('Watchlist pid must be null or a positive integer');
  if (typeof entry.reason !== 'string') return invalid('Watchlist reason must be a string');
  if (typeof entry.known !== 'boolean') return invalid('Watchlist known must be a boolean');
  if (!positive(entry.addedAt)) return invalid('Watchlist addedAt must be a positive number');
  return { valid: true };
}

/**
 * Validate a false-positive entry before persistence or suppression matching.
 * @param {Object} entry Candidate entry
 * @returns {{valid: boolean, error?: string}} Validation result
 * @since v0.10.0-alpha
 */
function validateFalsePositive(entry) {
  if (!plainObject(entry)) return invalid('Entry must be a plain object');
  if (!onlyKeys(entry, new Set(['agentName', 'pattern', 'timestamp'])))
    return invalid('Unknown false-positive entry fields');
  if (!nonemptyString(entry.agentName)) return invalid('agentName must be a non-empty string');
  if (!nonemptyString(entry.pattern)) return invalid('pattern must be a non-empty string');
  if (entry.pattern.length > 256) return invalid('pattern exceeds max length of 256 characters');
  if (CATCHALL_PATTERNS.includes(entry.pattern))
    return invalid('Catch-all patterns are not allowed');
  if (!safeRegex(entry.pattern)) return invalid('Unsafe or invalid false-positive pattern');
  if (!positive(entry.timestamp)) return invalid('timestamp must be a positive number');
  return { valid: true };
}

/**
 * Validate a partial or complete settings object against all persisted contracts.
 * @param {Object} obj Settings to validate
 * @returns {{valid: boolean, error?: string}} Validation result
 * @since v0.10.0-alpha
 */
function validateSettings(obj) {
  if (!plainObject(obj)) return invalid('Settings must be a plain object');
  const unknownKeys = Reflect.ownKeys(obj).filter(
    (key) => typeof key !== 'string' || !SETTINGS_WHITELIST.has(key),
  );
  if (unknownKeys.length)
    return invalid('Unknown settings keys: ' + unknownKeys.map(String).join(', '));
  for (const key of BOOLEAN_FIELDS) {
    if (Object.hasOwn(obj, key) && typeof obj[key] !== 'boolean')
      return invalid(key + ' must be a boolean');
  }
  if (Object.hasOwn(obj, 'scanIntervalSec') && !positive(obj.scanIntervalSec))
    return invalid('scanIntervalSec must be a positive number');
  if (Object.hasOwn(obj, 'uiScale') && !finiteRange(obj.uiScale, 0.5, 3))
    return invalid('uiScale must be a number between 0.5 and 3');
  if (Object.hasOwn(obj, 'timelineZoom') && !finiteRange(obj.timelineZoom, 1, 24))
    return invalid('timelineZoom must be a number between 1 and 24');
  if (Object.hasOwn(obj, 'anthropicApiKey') && typeof obj.anthropicApiKey !== 'string')
    return invalid('anthropicApiKey must be a string');
  for (const key of ['ignoredDirectories', 'seenAgents']) {
    if (Object.hasOwn(obj, key) && !stringArray(obj[key]))
      return invalid(key + ' must be an array of non-empty strings');
  }
  if (Object.hasOwn(obj, 'agentPermissions')) {
    const result = validatePermissions(obj.agentPermissions);
    if (!result.valid) return result;
  }
  if (Object.hasOwn(obj, 'customSensitivePatterns')) {
    if (!Array.isArray(obj.customSensitivePatterns))
      return invalid('customSensitivePatterns must be an array');
    for (const pattern of obj.customSensitivePatterns) {
      if (typeof pattern !== 'string') return invalid('Each custom pattern must be a string');
      if (!safeRegex(pattern)) return invalid('Unsafe or invalid regex pattern: ' + pattern);
    }
  }
  for (const [key, validate] of [
    ['customAgents', validateCustomAgent],
    ['falsePositivePatterns', validateFalsePositive],
    ['watchlist', validateWatchEntry],
  ]) {
    if (!Object.hasOwn(obj, key)) continue;
    if (!Array.isArray(obj[key])) return invalid(key + ' must be an array');
    if (key === 'customAgents' && obj[key].length > 2000)
      return invalid('Expected up to 2000 agent definitions');
    const ids = new Set();
    for (const entry of obj[key]) {
      const result = validate(entry);
      if (!result.valid) return result;
      if (key === 'customAgents') {
        if (ids.has(entry.id)) return invalid('Custom agent IDs must be unique');
        ids.add(entry.id);
      }
    }
  }
  return { valid: true };
}

module.exports = {
  validateSettings,
  validateFalsePositive,
  validateCustomAgent,
  validateWatchEntry,
};
