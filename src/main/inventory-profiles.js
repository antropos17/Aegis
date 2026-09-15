'use strict';

/** @file Explicit directory layouts; never infer a home, expand env, or follow config references. */
const config = (path, agent, scope, kind, format, sections, extra = {}) => ({
  path,
  agent,
  scope,
  kind,
  format,
  sections,
  ...extra,
});
const location = (path, agent, scope) => ({ path, agent, scope });
const codexConfig = (path, scope) =>
  config(path, 'codex', scope, 'agent-config', 'toml', ['mcp_servers', 'hooks']);
const hooks = (path, agent, scope) => config(path, agent, scope, 'hooks', 'json', ['hooks']);
const mcp = (path, agent, scope) => config(path, agent, scope, 'mcp', 'json', ['mcpServers']);
const skills = (scope) => [
  location('.agents/skills', 'shared', scope),
  location('.claude/skills', 'claude-code', scope),
  location('.codex/skills', 'codex', scope),
  location('.cursor/skills', 'cursor', scope),
];
const namedCodex = (directory, scope) => ({
  directory,
  match: 'codex-named-config',
  template: codexConfig('', scope),
});

const PROFILES = {
  project: {
    configs: [
      mcp('.mcp.json', 'shared', 'project'),
      mcp('.cursor/mcp.json', 'cursor', 'project'),
      config('.vscode/mcp.json', 'vscode', 'project', 'mcp', 'jsonc', ['servers']),
      hooks('.claude/settings.json', 'claude-code', 'project'),
      hooks('.claude/settings.local.json', 'claude-code', 'project-local'),
      hooks('.codex/hooks.json', 'codex', 'project'),
      codexConfig('.codex/config.toml', 'project'),
    ],
    instructions: [
      location('AGENTS.md', 'shared', 'project'),
      location('AGENTS.override.md', 'codex', 'project'),
      location('CLAUDE.md', 'claude-code', 'project'),
      location('.cursorrules', 'cursor', 'project'),
    ],
    skillRoots: skills('project'),
  },
  'user-home': {
    configs: [
      { ...mcp('.claude.json', 'claude-code', 'user-and-project-local'), localProjects: true },
      hooks('.claude/settings.json', 'claude-code', 'user'),
      mcp('.cursor/mcp.json', 'cursor', 'user'),
      hooks('.codex/hooks.json', 'codex', 'user'),
      codexConfig('.codex/config.toml', 'user'),
      codexConfig('.codex/managed_config.toml', 'legacy-managed'),
    ],
    instructions: [
      location('.claude/CLAUDE.md', 'claude-code', 'user'),
      location('.codex/AGENTS.md', 'codex', 'user'),
      location('.codex/AGENTS.override.md', 'codex', 'user'),
    ],
    skillRoots: skills('user'),
    configPatterns: [namedCodex('.codex', 'user-profile')],
  },
  'codex-user': {
    configs: [
      codexConfig('config.toml', 'user'),
      hooks('hooks.json', 'codex', 'user'),
      codexConfig('managed_config.toml', 'legacy-managed'),
    ],
    instructions: [
      location('AGENTS.md', 'codex', 'user'),
      location('AGENTS.override.md', 'codex', 'user'),
    ],
    skillRoots: [location('skills', 'codex', 'user')],
    configPatterns: [namedCodex('', 'user-profile')],
  },
  'claude-user': {
    configs: [hooks('settings.json', 'claude-code', 'user')],
    instructions: [location('CLAUDE.md', 'claude-code', 'user')],
    skillRoots: [location('skills', 'claude-code', 'user')],
  },
  'cursor-user': {
    configs: [mcp('mcp.json', 'cursor', 'user')],
    skillRoots: [location('skills', 'cursor', 'user')],
  },
  'vscode-user': {
    configs: [config('mcp.json', 'vscode', 'user-profile', 'mcp', 'jsonc', ['servers'])],
  },
  'claude-managed': {
    configs: [
      mcp('managed-mcp.json', 'claude-code', 'managed'),
      hooks('managed-settings.json', 'claude-code', 'managed'),
    ],
    configPatterns: [
      {
        directory: 'managed-settings.d',
        match: 'visible-json',
        template: hooks('', 'claude-code', 'managed'),
      },
    ],
  },
  'codex-managed': {
    configs: [
      codexConfig('config.toml', 'system'),
      config('requirements.toml', 'codex', 'managed', 'policy', 'toml', ['mcp_servers', 'hooks']),
      codexConfig('managed_config.toml', 'legacy-managed'),
    ],
  },
};

/**
 * Return a fresh built-in layout for an explicit directory selection.
 * @param {string} id Built-in layout ID; unknown IDs fail before filesystem access.
 * @returns {object} Layout and adapter provenance, without an absolute user path.
 * @since v0.15.1
 */
function getInventoryProfile(id) {
  if (typeof id !== 'string' || !Object.hasOwn(PROFILES, id))
    throw new Error('unsupported-profile');
  return structuredClone({
    id,
    adapterVersion: 1,
    referenceDate: '2026-09-15',
    configs: [],
    instructions: [],
    skillRoots: [],
    configPatterns: [],
    ...PROFILES[id],
  });
}

/**
 * Match direct children of a declared directory, without walking other state.
 * @param {string} pattern Built-in matcher ID.
 * @param {string} name Single directory entry name.
 * @returns {boolean} Whether this entry belongs to the selected config scope.
 * @since v0.15.1
 */
function matchesInventoryConfig(pattern, name) {
  if (pattern === 'codex-named-config') return /^[A-Za-z0-9_-]+\.config\.toml$/.test(name);
  return pattern === 'visible-json' && !name.startsWith('.') && name.endsWith('.json');
}

module.exports = { getInventoryProfile, matchesInventoryConfig };
