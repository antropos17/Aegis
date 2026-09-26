'use strict';

/** @file Bounded configuration parsing. Only fixed section names and counts leave this module. */
const { TextDecoder } = require('node:util');
const jsonc = require('jsonc-parser');
const toml = require('smol-toml');

const PARSE_DEPTH = 64;
const DUPLICATE = Symbol('duplicate-key');
const DEPTH = Symbol('parse-depth-limit');
const INVALID = Symbol('invalid-json');

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function parseJson(text, comments, trailingCommas) {
  const stack = [];
  let result;
  function value(item) {
    const parent = stack.at(-1);
    if (!parent) result = item;
    else if (Array.isArray(parent.value)) parent.value.push(item);
    else parent.value[parent.key] = item;
  }
  function begin(item) {
    if (stack.length >= PARSE_DEPTH) throw DEPTH;
    value(item);
    stack.push({ value: item, key: null });
  }
  // The upstream visitor validates syntax; our builder rejects duplicate keys
  // and uses null prototypes so __proto__ remains ordinary untrusted data.
  jsonc.visit(
    text,
    {
      onObjectBegin: () => begin(Object.create(null)),
      onArrayBegin: () => begin([]),
      onObjectEnd: () => {
        stack.pop();
      },
      onArrayEnd: () => {
        stack.pop();
      },
      onObjectProperty: (key) => {
        const parent = stack.at(-1);
        if (Object.hasOwn(parent.value, key)) throw DUPLICATE;
        parent.key = key;
      },
      onLiteralValue: value,
      onError: () => {
        throw INVALID;
      },
    },
    { disallowComments: !comments, allowTrailingComma: trailingCommas, allowEmptyContent: false },
  );
  return result;
}

function countSection(config, key) {
  if (!Object.hasOwn(config, key)) return 0;
  if (!isRecord(config[key])) throw INVALID;
  return Object.keys(config[key]).length;
}

function countStringList(config, key) {
  if (!Object.hasOwn(config, key)) return { present: false, entries: 0 };
  const value = config[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw INVALID;
  return { present: true, entries: value.length };
}

function summarizeGeminiMcp(config) {
  const global = Object.hasOwn(config, 'mcp') ? config.mcp : Object.create(null);
  const servers = Object.hasOwn(config, 'mcpServers') ? config.mcpServers : Object.create(null);
  if (!isRecord(global) || !isRecord(servers)) throw INVALID;
  const summary = {
    allowed: countStringList(global, 'allowed'),
    excluded: countStringList(global, 'excluded'),
    trustTrueServers: 0,
    trustFalseServers: 0,
    includeToolsServers: 0,
    includeToolsEntries: 0,
    excludeToolsServers: 0,
    excludeToolsEntries: 0,
  };
  for (const server of Object.values(servers)) {
    if (!isRecord(server)) throw INVALID;
    if (Object.hasOwn(server, 'trust')) {
      if (typeof server.trust !== 'boolean') throw INVALID;
      if (server.trust) summary.trustTrueServers++;
      else summary.trustFalseServers++;
    }
    for (const [key, serverCount, entryCount] of [
      ['includeTools', 'includeToolsServers', 'includeToolsEntries'],
      ['excludeTools', 'excludeToolsServers', 'excludeToolsEntries'],
    ]) {
      const list = countStringList(server, key);
      if (list.present) summary[serverCount]++;
      summary[entryCount] += list.entries;
    }
  }
  return summary;
}

function checkTomlDepth(config) {
  // smol-toml bounds nested values while parsing. Dotted keys/table headers can
  // also create deep objects, so bound those iteratively before summarizing.
  const pending = [[config, 1]];
  while (pending.length) {
    const [value, depth] = pending.pop();
    if (!isRecord(value) && !Array.isArray(value)) continue;
    if (depth > PARSE_DEPTH) throw DEPTH;
    for (const child of Object.values(value)) {
      if (child !== null && typeof child === 'object') pending.push([child, depth + 1]);
    }
  }
}

/**
 * Parse bounded configuration for internal inventory consumers only.
 * The returned value is untrusted and may contain secrets: never log/export it.
 * @param {Buffer} data Original bytes already bounded by inventory-reader.
 * @param {string} format json, jsonc, json-comments or toml.
 * @returns {object} Fixed parse status and an INTERNAL parsed object on success.
 * @since v0.15.1
 */
function parseInventoryConfig(data, format) {
  if (!['json', 'jsonc', 'json-comments', 'toml'].includes(format))
    return { parseStatus: 'unsupported-format' };
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch (_) {
    return { parseStatus: 'invalid-encoding' };
  }
  let config;
  try {
    config =
      format === 'toml'
        ? toml.parse(text, { maxDepth: PARSE_DEPTH, integersAsBigInt: true })
        : parseJson(text, format !== 'json', format === 'jsonc');
    if (format === 'toml') checkTomlDepth(config);
  } catch (error) {
    const reason =
      error === DUPLICATE
        ? 'duplicate-key'
        : error === DEPTH
          ? 'parse-depth-limit'
          : `invalid-${format}`;
    return { parseStatus: reason };
  }
  if (!isRecord(config)) return { parseStatus: 'invalid-shape' };
  return { parseStatus: 'parsed', value: config };
}

/**
 * Count fixed sections without returning configuration values or parser errors.
 * @param {Buffer} data Original bytes bounded by inventory-reader.
 * @param {string} format json, jsonc, json-comments or toml.
 * @param {string[]} sections Fixed section names from a built-in adapter.
 * @param {boolean} [localProjects] Count Claude's project-local MCP declarations.
 * @param {boolean} [geminiMcp] Count selected-file Gemini MCP filter declarations.
 * @returns {object} JSON-safe parse status and structural counts.
 * @since v0.15.1
 */
function summarizeConfig(data, format, sections, localProjects = false, geminiMcp = false) {
  const parsed = parseInventoryConfig(data, format);
  if (parsed.parseStatus !== 'parsed') return parsed;
  const config = parsed.value;
  try {
    const declaredSections = Object.fromEntries(
      sections.map((key) => [key, countSection(config, key)]),
    );
    const summary = { parseStatus: 'parsed', declaredSections };
    if (sections.length) summary.declaredEntries = declaredSections[sections[0]];
    if (localProjects) {
      summary.projectScopedEntries = 0;
      if (Object.hasOwn(config, 'projects')) {
        if (!isRecord(config.projects)) throw INVALID;
        for (const project of Object.values(config.projects)) {
          if (!isRecord(project)) throw INVALID;
          summary.projectScopedEntries += countSection(project, 'mcpServers');
        }
      }
    }
    if (geminiMcp) summary.geminiMcpDeclarations = summarizeGeminiMcp(config);
    return summary;
  } catch (_) {
    return { parseStatus: 'invalid-shape' };
  }
}

module.exports = { summarizeConfig, parseInventoryConfig, PARSE_DEPTH };
