/**
 * @file constants.js
 * @module shared/constants
 * @description Shared constant arrays used across AEGIS main-process modules:
 *   process ignore patterns, file ignore patterns, sensitive file rules,
 *   and permission categories.
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 */

'use strict';

/** @type {string[]} Hardware/driver process name fragments to never flag as AI agents */
const IGNORE_PROCESS_PATTERNS = [
  'asus', 'armoury', 'logitech', 'logioptionsplus',
  'razer', 'corsair', 'steelseries',
  'realtek', 'nvidia', 'amd', 'intel',
  'nahimic', 'msi', 'gigabyte',
];

/** @type {RegExp[]} File-path patterns treated as system noise and silently skipped */
const IGNORE_PATTERNS = [
  /^C:\\Windows\\/i,
  /^C:\\Program Files\\Windows/i,
  /\\pagefile\.sys$/i,
  /\\swapfile\.sys$/i,
  /\\\$Extend/i,
  /\\System Volume Information/i,
  /^\\Device\\/i,
  /\\\.tmp$/i,
];

/**
 * @typedef {Object} SensitiveRule
 * @property {RegExp} pattern - Regex tested against file paths
 * @property {string} reason  - Human-readable classification label
 */

/** @type {SensitiveRule[]} Rules that classify a file path as sensitive */
const SENSITIVE_RULES = [
  { pattern: /[\\\/]\.env$/i,              reason: 'Environment variables' },
  { pattern: /[\\\/]\.env\.local$/i,       reason: 'Environment variables' },
  { pattern: /[\\\/]\.env\.production$/i,  reason: 'Environment variables' },
  { pattern: /[\\\/]\.env\.development$/i, reason: 'Environment variables' },
  { pattern: /[\\\/]\.env\.staging$/i,     reason: 'Environment variables' },
  { pattern: /[\\\/]\.env\.[^\\\/]+$/i,    reason: 'Environment variables' },
  { pattern: /[\\\/]\.ssh[\\\/]/i,    reason: 'SSH keys/config' },
  { pattern: /id_rsa/i,               reason: 'SSH private key' },
  { pattern: /id_ed25519/i,           reason: 'SSH private key' },
  { pattern: /id_ecdsa/i,             reason: 'SSH private key' },
  { pattern: /known_hosts/i,          reason: 'SSH known hosts' },
  { pattern: /authorized_keys/i,      reason: 'SSH authorized keys' },
  { pattern: /password/i,                       reason: 'Password file' },
  { pattern: /credential/i,                     reason: 'Credentials' },
  { pattern: /[\\\/]secret/i,                   reason: 'Secret file' },
  { pattern: /[\\\/][^\\\/]*token[^\\\/]*$/i,   reason: 'API token' },
  { pattern: /api_key/i,                        reason: 'API key file' },
  { pattern: /[\\\/]\.git-credentials$/i,       reason: 'Git credentials' },
  { pattern: /\.pem$/i, reason: 'Private key (PEM)' },
  { pattern: /\.key$/i, reason: 'Private key' },
  { pattern: /\.pfx$/i, reason: 'Certificate (PFX)' },
  { pattern: /\.p12$/i, reason: 'Certificate (P12)' },
  { pattern: /[\\\/]\.aws[\\\/]/i,   reason: 'AWS credentials' },
  { pattern: /[\\\/]\.azure[\\\/]/i, reason: 'Azure credentials' },
  { pattern: /[\\\/]\.gcloud[\\\/]/i, reason: 'GCloud credentials' },
  { pattern: /[\\\/]\.gnupg[\\\/]/i, reason: 'GPG keys' },
  { pattern: /Chrome[\\\/]User Data[\\\/].*Login Data/i,  reason: 'Chrome passwords' },
  { pattern: /Chrome[\\\/]User Data[\\\/].*Cookies/i,     reason: 'Chrome cookies' },
  { pattern: /Chrome[\\\/]User Data[\\\/].*Web Data/i,    reason: 'Chrome autofill data' },
  { pattern: /Chrome[\\\/]User Data[\\\/].*History/i,     reason: 'Chrome browsing history' },
  { pattern: /Firefox[\\\/]Profiles[\\\/].*logins\.json/i,     reason: 'Firefox passwords' },
  { pattern: /Firefox[\\\/]Profiles[\\\/].*cookies\.sqlite/i,  reason: 'Firefox cookies' },
  { pattern: /Firefox[\\\/]Profiles[\\\/].*key[34]\.db/i,      reason: 'Firefox key database' },
  { pattern: /Edge[\\\/]User Data[\\\/].*Login Data/i, reason: 'Edge passwords' },
  { pattern: /Edge[\\\/]User Data[\\\/].*Cookies/i,    reason: 'Edge cookies' },
  { pattern: /[\\\/]\.npmrc$/i,                  reason: 'NPM config (may contain tokens)' },
  { pattern: /[\\\/]\.pypirc$/i,                 reason: 'PyPI config (may contain tokens)' },
  { pattern: /[\\\/]\.docker[\\\/]config\.json/i, reason: 'Docker credentials' },
  { pattern: /[\\\/]\.kube[\\\/]/i,                reason: 'Kubernetes config' },
];

/** @type {string[]} The six permission category identifiers */
const PERMISSION_CATEGORIES = ['filesystem', 'sensitive', 'network', 'terminal', 'clipboard', 'screen'];

module.exports = {
  IGNORE_PROCESS_PATTERNS,
  IGNORE_PATTERNS,
  SENSITIVE_RULES,
  PERMISSION_CATEGORIES,
};
