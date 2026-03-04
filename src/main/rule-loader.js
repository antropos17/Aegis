// @ts-check
'use strict';

/**
 * @file rule-loader.js
 * @module main/rule-loader
 * @description Loads YAML ruleset files from rules/, validates against JSON Schema,
 *   and compiles pattern strings into RegExp objects. Provides the same contract
 *   as SENSITIVE_RULES in constants.js: { pattern: RegExp, reason: string }.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const Ajv = require('ajv');

/**
 * @typedef {import('../shared/types/config').SensitiveRule} SensitiveRule
 */

/**
 * @typedef {object} LoadedRule
 * @property {string}   id       - Unique rule ID (e.g. "AI001")
 * @property {string}   name     - Human-readable rule name
 * @property {RegExp}   pattern  - Compiled regex pattern
 * @property {string}   reason   - Why the file is sensitive
 * @property {string}   category - Rule category
 * @property {string}   risk     - Risk level (critical/high/medium/low)
 * @property {string[]} tags     - Optional tags
 * @property {boolean}  enabled  - Whether the rule is active
 * @property {string}   platform - Target platform
 */

/** @type {string} */
const DEFAULT_RULES_DIR = path.join(__dirname, '..', '..', 'rules');

/** @type {Map<string, LoadedRule>} */
let ruleCache = new Map();

/** @type {import('ajv').ValidateFunction | null} */
let validateFn = null;

/**
 * Initializes the Ajv validator from _schema.json.
 * @param {string} schemaPath - Path to the JSON Schema file
 * @returns {import('ajv').ValidateFunction}
 */
function initValidator(schemaPath) {
  const schemaText = fs.readFileSync(schemaPath, 'utf8');
  const schema = JSON.parse(schemaText);
  const ajv = new Ajv({ useDefaults: true });
  return ajv.compile(schema);
}

/**
 * Compiles a pattern string into a case-insensitive RegExp.
 * @param {string} patternStr - Regex pattern as string (no slashes)
 * @returns {RegExp}
 * @throws {SyntaxError} If the pattern is invalid regex
 */
function compilePattern(patternStr) {
  return new RegExp(patternStr, 'i');
}

/**
 * Loads all YAML ruleset files from a directory, validates them, and
 * compiles pattern strings into RegExp objects.
 *
 * @param {string} [rulesDir] - Directory to scan (defaults to project rules/)
 * @returns {Map<string, LoadedRule>} Map of rule ID to loaded rule
 */
function loadRules(rulesDir = DEFAULT_RULES_DIR) {
  /** @type {Map<string, LoadedRule>} */
  const rules = new Map();

  if (!fs.existsSync(rulesDir)) {
    return rules;
  }

  const schemaPath = path.join(rulesDir, '_schema.json');
  if (!validateFn) {
    if (!fs.existsSync(schemaPath)) {
      console.warn(`[rule-loader] Schema not found: ${schemaPath}`);
      return rules;
    }
    try {
      validateFn = initValidator(schemaPath);
    } catch (/** @type {*} */ err) {
      console.warn(`[rule-loader] Failed to load schema: ${/** @type {Error} */ (err).message}`);
      return rules;
    }
  }

  /** @type {string[]} */
  let files;
  try {
    files = fs.readdirSync(rulesDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  } catch (/** @type {*} */ err) {
    console.warn(`[rule-loader] Failed to read directory: ${/** @type {Error} */ (err).message}`);
    return rules;
  }

  for (const file of files) {
    const filePath = path.join(rulesDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      /** @type {{ rules: Array<{ id: string; name: string; pattern: string; reason: string; category: string; risk?: string; tags?: string[]; enabled?: boolean; platform?: string }> }} */
      const doc = /** @type {*} */ (yaml.load(content));

      if (!validateFn(doc)) {
        const errors = validateFn.errors?.map((e) => `${e.dataPath} ${e.message}`).join('; ');
        console.warn(`[rule-loader] Invalid ruleset ${file}: ${errors}`);
        continue;
      }

      for (const rawRule of doc.rules) {
        if (rules.has(rawRule.id)) {
          console.warn(`[rule-loader] Duplicate rule ID "${rawRule.id}" in ${file} — skipping`);
          continue;
        }

        try {
          /** @type {LoadedRule} */
          const loaded = {
            id: rawRule.id,
            name: rawRule.name,
            pattern: compilePattern(rawRule.pattern),
            reason: rawRule.reason,
            category: rawRule.category,
            risk: rawRule.risk || 'medium',
            tags: rawRule.tags || [],
            enabled: rawRule.enabled !== undefined ? rawRule.enabled : true,
            platform: rawRule.platform || 'all',
          };
          rules.set(loaded.id, loaded);
        } catch (/** @type {*} */ err) {
          console.warn(
            `[rule-loader] Invalid pattern in rule "${rawRule.id}" (${file}): ${/** @type {Error} */ (err).message}`,
          );
        }
      }
    } catch (/** @type {*} */ err) {
      console.warn(`[rule-loader] Failed to parse ${file}: ${/** @type {Error} */ (err).message}`);
    }
  }

  return rules;
}

/**
 * Returns all loaded rules.
 * Loads from disk on first call (lazy init).
 * @param {string} [rulesDir] - Optional custom rules directory
 * @returns {Map<string, LoadedRule>}
 */
function getAllRules(rulesDir) {
  if (ruleCache.size === 0) {
    ruleCache = loadRules(rulesDir);
  }
  return ruleCache;
}

/**
 * Returns rules filtered by category.
 * @param {string} category - Category to filter by
 * @param {string} [rulesDir] - Optional custom rules directory
 * @returns {LoadedRule[]}
 */
function getRulesByCategory(category, rulesDir) {
  const all = getAllRules(rulesDir);
  /** @type {LoadedRule[]} */
  const result = [];
  for (const rule of all.values()) {
    if (rule.category === category) {
      result.push(rule);
    }
  }
  return result;
}

/**
 * Returns a single rule by ID, or undefined if not found.
 * @param {string} id - Rule ID (e.g. "AI001")
 * @param {string} [rulesDir] - Optional custom rules directory
 * @returns {LoadedRule | undefined}
 */
function getRuleById(id, rulesDir) {
  return getAllRules(rulesDir).get(id);
}

/**
 * Clears the cache and reloads all rules from disk.
 * @param {string} [rulesDir] - Optional custom rules directory
 * @returns {Map<string, LoadedRule>}
 */
function reloadRules(rulesDir) {
  ruleCache.clear();
  validateFn = null;
  ruleCache = loadRules(rulesDir);
  return ruleCache;
}

module.exports = {
  getAllRules,
  getRulesByCategory,
  getRuleById,
  reloadRules,
  // Exposed for testing only
  _loadRules: loadRules,
};
