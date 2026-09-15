'use strict';

const crypto = require('node:crypto');
const FORMATS = Object.freeze({
  'cisco-skill-json': {
    provider: 'cisco-skill-scanner',
    encoding: 'json',
    compatibilityRevision: '431cb58a5ac333bc0bb9aaa23f7c30ac628f59f8',
  },
  'cisco-skill-sarif': {
    provider: 'cisco-skill-scanner',
    encoding: 'sarif-2.1.0',
    compatibilityRevision: '431cb58a5ac333bc0bb9aaa23f7c30ac628f59f8',
  },
  'cisco-mcp-json': {
    provider: 'cisco-mcp-scanner',
    encoding: 'raw-envelope-json',
    compatibilityRevision: '16e684d8bd8faa0f0bb15e04ba2d2089dff42196',
  },
});
const LIMITS = Object.freeze({
  entries: 1024,
  findings: 256,
  locations: 16,
  analyzers: 16,
  runs: 16,
  issues: 128,
});
const CATEGORIES = new Set([
  'prompt_injection',
  'command_injection',
  'data_exfiltration',
  'unauthorized_tool_use',
  'obfuscation',
  'hardcoded_secrets',
  'social_engineering',
  'resource_abuse',
  'policy_violation',
  'malware',
  'harmful_content',
  'skill_discovery_abuse',
  'transitive_trust_abuse',
  'autonomy_abuse',
  'tool_chaining_abuse',
  'unicode_steganography',
  'supply_chain_attack',
  'code_execution',
]);
const ANALYZERS = new Set([
  'static',
  'bytecode',
  'pipeline',
  'correlation',
  'behavioral',
  'llm',
  'meta',
  'virustotal',
  'aidefense',
  'api',
  'yara',
  'readiness',
  'prompt_defense',
  'trigger',
]);

/** Check an internal parsed object. @param {unknown} value @returns {boolean} @since v0.15.1 */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Hash an untrusted string without disclosing it. @param {string} value @returns {string} @since v0.15.1 */
function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Check a SHA-256 value. @param {unknown} value @returns {boolean} @since v0.15.1 */
function isHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

/** Normalize only safe relative references; never resolve them on disk. @param {unknown} value @param {boolean} [uri] @returns {string|null} @since v0.15.1 */
function relativeReference(value, uri = false) {
  if (typeof value !== 'string' || !value || value.length > 4096) return null;
  let name = value;
  if (uri) {
    if (/[?#]/.test(name)) return null;
    try {
      name = decodeURIComponent(name);
    } catch (_) {
      return null;
    }
  }
  name = name.replaceAll('\\', '/');
  if (
    name.includes(':') ||
    Array.from(name).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    name.split('/').some((part) => !part || part === '.' || part === '..')
  )
    return null;
  return name;
}

/** Reduce a claimed severity to fixed text. @param {unknown} value @returns {string} @since v0.15.1 */
function severity(value) {
  const name = typeof value === 'string' ? value.toLowerCase() : '';
  return ['critical', 'high', 'medium', 'low', 'info'].includes(name) ? name : 'unknown';
}

/** Reduce a claimed category to a fixed vocabulary. @param {unknown} value @returns {string} @since v0.15.1 */
function category(value) {
  return CATEGORIES.has(value) ? value : 'unknown';
}

/** Reduce a claimed analyzer to a fixed vocabulary. @param {unknown} value @returns {string} @since v0.15.1 */
function analyzer(value) {
  const name = typeof value === 'string' ? value.replace(/_analyzer$/, '') : '';
  return ANALYZERS.has(name) ? name : 'unknown';
}

/** Read a bounded array, recording structural gaps without exposing input. @param {unknown} value @param {number} maximum @param {object} collector @returns {unknown[]} @since v0.15.1 */
function bounded(value, maximum, collector) {
  if (!Array.isArray(value)) {
    collector.issue('invalid-report-array');
    return [];
  }
  if (value.length > maximum) collector.issue('report-entry-limit');
  return value.slice(0, maximum);
}

module.exports = {
  FORMATS,
  LIMITS,
  record,
  digest,
  isHash,
  relativeReference,
  severity,
  category,
  analyzer,
  bounded,
};
