'use strict';

/** @file Project component inventory. No execution, network, persistence or risk verdict. */
const { createInventoryReader } = require('./inventory-reader');

const CONFIGS = Object.freeze([
  ['.mcp.json', 'mcp', 'json', 'mcpServers'],
  ['.cursor/mcp.json', 'mcp', 'json', 'mcpServers'],
  ['.vscode/mcp.json', 'mcp', 'jsonc', 'servers'],
  ['.claude/settings.json', 'hooks', 'json', 'hooks'],
  ['.claude/settings.local.json', 'hooks', 'json', 'hooks'],
  ['.codex/hooks.json', 'hooks', 'json', 'hooks'],
  ['.codex/config.toml', 'agent-config', 'toml', null],
]);
const INSTRUCTIONS = ['AGENTS.md', 'CLAUDE.md', '.cursorrules'];
const SKILL_ROOTS = ['.agents/skills', '.claude/skills', '.codex/skills', '.cursor/skills'];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function summarizeConfig(data, format, key) {
  // JSONC/TOML are fingerprinted only until their own adapters are implemented.
  if (format !== 'json') return { parseStatus: 'unsupported-format' };
  let config;
  try {
    config = JSON.parse(data.toString('utf8').replace(/^\uFEFF/, ''));
  } catch (_) {
    return { parseStatus: 'invalid-json' };
  }
  if (!isRecord(config)) return { parseStatus: 'invalid-shape' };
  if (!Object.hasOwn(config, key)) return { parseStatus: 'parsed', declaredEntries: 0 };
  if (!isRecord(config[key])) return { parseStatus: 'invalid-shape' };
  // Count declarations, not installed/active/valid tools. Never emit names,
  // command strings, URL credentials, env values or arbitrary configuration data.
  return { parseStatus: 'parsed', declaredEntries: Object.keys(config[key]).length };
}

/**
 * Inventory recognized locations within one explicit project directory.
 * `complete` means the declared scan scope was read and summarized; it does not
 * attest complete discovery of the machine or security of any component.
 * @param {string} directory Project to inspect (no implicit home/profile scan).
 * @param {{limits?: object}} [options] Optional lower filesystem budgets.
 * @returns {Promise<object>} Versioned JSON-safe snapshot with fingerprints only.
 * @since v0.15.1
 */
async function inventoryProject(directory, options = {}) {
  const reader = await createInventoryReader(directory, options.limits);
  const components = [];
  function record(relativePath, file, kind, metadata = {}) {
    components.push({
      path: relativePath,
      kind,
      size: file.size,
      sha256: file.sha256,
      ...metadata,
    });
  }
  for (const [relativePath, kind, format, key] of CONFIGS) {
    await reader.visit(relativePath, (name, file) => {
      const metadata = summarizeConfig(file.data, format, key);
      record(name, file, kind, { format, ...metadata });
      if (metadata.parseStatus !== 'parsed') {
        reader.issues.push({ path: name, reason: metadata.parseStatus });
      }
    });
  }
  for (const relativePath of INSTRUCTIONS) {
    await reader.visit(relativePath, (name, file) => record(name, file, 'instruction'));
  }
  for (const relativePath of SKILL_ROOTS) {
    await reader.visit(
      relativePath,
      (name, file) => {
        record(name, file, name.split('/').at(-1) === 'SKILL.md' ? 'skill-manifest' : 'skill-file');
      },
      true,
    );
  }
  return {
    schemaVersion: 1,
    mode: 'project-inventory',
    assessment: 'not-performed',
    complete: reader.issues.length === 0,
    scope: {
      configs: CONFIGS.map(([name]) => name),
      instructions: [...INSTRUCTIONS],
      skillRoots: [...SKILL_ROOTS],
      links: 'skipped-below-selected-root',
      snapshot: 'best-effort',
    },
    limits: reader.limits,
    usage: reader.usage(),
    components: components.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    issues: reader.issues,
  };
}

module.exports = { inventoryProject };
