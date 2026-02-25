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
  'asus',
  'armoury',
  'logitech',
  'logioptionsplus',
  'razer',
  'corsair',
  'steelseries',
  'realtek',
  'nvidia',
  'amd',
  'intel',
  'nahimic',
  'msi',
  'gigabyte',
];

/** @type {Array<{names: string[], label: string}>} Editor/IDE definitions with process names and labels */
const EDITORS = [
  { names: ['code.exe', 'code'], label: 'VS Code' },
  { names: ['code - insiders.exe'], label: 'VS Code Insiders' },
  { names: ['idea64.exe', 'idea'], label: 'IntelliJ IDEA' },
  { names: ['webstorm64.exe', 'webstorm'], label: 'WebStorm' },
  { names: ['pycharm64.exe', 'pycharm'], label: 'PyCharm' },
  { names: ['goland64.exe', 'goland'], label: 'GoLand' },
  { names: ['rider64.exe', 'rider'], label: 'Rider' },
  { names: ['phpstorm64.exe', 'phpstorm'], label: 'PhpStorm' },
  { names: ['rubymine64.exe', 'rubymine'], label: 'RubyMine' },
  { names: ['clion64.exe', 'clion'], label: 'CLion' },
  { names: ['datagrip64.exe', 'datagrip'], label: 'DataGrip' },
];

/** @type {string[]} Editor/IDE host processes — not agents, but scan their children for AI extensions */
const EDITOR_HOSTS = EDITORS.flatMap((e) => e.names);

/** @type {RegExp[]} Cross-platform file-path patterns treated as system noise and silently skipped.
 *  Platform-specific patterns live in src/main/platform/*.js (IGNORE_FILE_PATTERNS). */
const IGNORE_PATTERNS = [/\.tmp$/i];

/**
 * @type {string[]} AI agent config directories relative to home dir.
 * Monitored as critical targets — infostealers target these for API keys,
 * session tokens, and MCP server configs (ref: Hudson Rock, Feb 2026).
 * @since 0.2.0
 */
const AGENT_CONFIG_PATHS = [
  // Explicit high-priority targets
  '.claude',
  '.cursor',
  '.continue',
  '.copilot',
  '.codeium',
  '.tabnine',
  '.openclaw',
  '.aws', // Already monitored as credential dir
  '.config/github-copilot',
  '.config/aider',
  // Pulled from agent-database.json configPaths
  '.config/TabNine',
  '.supermaven',
  '.config/JetBrains',
  '.codex',
  '.config/goose',
  '.warp',
  '.gemini',
  '.config/shell_gpt',
  '.aish',
  '.mentat',
  '.tabby-client',
  '.metagpt',
  '.config/Claude',
  '.composio',
  '.semgrep',
  '.config/zed',
  '.config/configstore',
  // Container / VM / Local LLM config paths
  '.ollama',
  '.jan',
  '.cache/lm-studio',
  '.cache/gpt4all',
  '.docker',
];

/**
 * @type {Object<string, RegExp>} Map of agent name keywords to their own config directory patterns.
 * Used for self-access exemption: an agent accessing its OWN config is expected, not a threat.
 * @since 0.3.0
 */
const AGENT_SELF_CONFIG = {
  claude: /[\\\/]\.claude([\\\/]|\.json$)/i,
  copilot: /[\\\/](\.copilot[\\\/]|\.config[\\\/]github-copilot[\\\/])/i,
  cursor: /[\\\/](\.cursor[\\\/]|\.cursorrules$)/i,
  codeium: /[\\\/]\.codeium[\\\/]/i,
  continue: /[\\\/]\.continue[\\\/]/i,
  tabnine: /[\\\/](\.tabnine[\\\/]|\.config[\\\/]TabNine[\\\/])/i,
  aider: /[\\\/](\.config[\\\/]aider[\\\/]|\.aider\.conf\.yml$)/i,
  supermaven: /[\\\/]\.supermaven[\\\/]/i,
  codex: /[\\\/]\.codex[\\\/]/i,
  warp: /[\\\/]\.warp[\\\/]/i,
  gemini: /[\\\/]\.gemini[\\\/]/i,
  mentat: /[\\\/]\.mentat[\\\/]/i,
  metagpt: /[\\\/]\.metagpt[\\\/]/i,
  composio: /[\\\/]\.composio[\\\/]/i,
  semgrep: /[\\\/]\.semgrep[\\\/]/i,
  goose: /[\\\/]\.config[\\\/]goose[\\\/]/i,
  zed: /[\\\/]\.config[\\\/]zed[\\\/]/i,
  jetbrains: /[\\\/]\.config[\\\/]JetBrains[\\\/]/i,
  // Container / VM / Local LLM self-config
  docker: /[\\\/]\.docker[\\\/]/i,
  ollama: /[\\\/]\.ollama[\\\/]/i,
  'lm studio': /[\\\/](lm-studio[\\\/]|\.cache[\\\/]lm-studio[\\\/])/i,
  gpt4all: /[\\\/]\.cache[\\\/]gpt4all[\\\/]/i,
  jan: /[\\\/]\.jan[\\\/]/i,
};

/**
 * @typedef {Object} SensitiveRule
 * @property {RegExp} pattern - Regex tested against file paths
 * @property {string} reason  - Human-readable classification label
 * @property {string} [category] - Rule category (e.g. 'agent-config')
 * @property {string} [severity] - Severity level (e.g. 'critical')
 */

/** @type {SensitiveRule[]} Rules that classify a file path as sensitive */
const SENSITIVE_RULES = [
  // ── AI Agent Config Files — critical targets (Hudson Rock, Feb 2026) ──
  {
    pattern: /[\\\/]\.claude[\\\/]/i,
    reason: 'AI agent config — Claude Code',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.claude\.json$/i,
    reason: 'AI agent config — Claude Code',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.copilot[\\\/]/i,
    reason: 'AI agent config — GitHub Copilot',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.cursor[\\\/]/i,
    reason: 'AI agent config — Cursor',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.cursorrules$/i,
    reason: 'AI agent config — Cursor',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.codeium[\\\/]/i,
    reason: 'AI agent config — Codeium',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.continue[\\\/]/i,
    reason: 'AI agent config — Continue',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.tabnine[\\\/]/i,
    reason: 'AI agent config — Tabnine',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.config[\\\/]TabNine[\\\/]/i,
    reason: 'AI agent config — Tabnine',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.config[\\\/]github-copilot[\\\/]/i,
    reason: 'AI agent config — GitHub Copilot',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.config[\\\/]aider[\\\/]/i,
    reason: 'AI agent config — Aider',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.aider\.conf\.yml$/i,
    reason: 'AI agent config — Aider',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.openclaw[\\\/]/i,
    reason: 'AI agent config — OpenClaw',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.supermaven[\\\/]/i,
    reason: 'AI agent config — Supermaven',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.config[\\\/]JetBrains[\\\/]/i,
    reason: 'AI agent config — JetBrains AI',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.codex[\\\/]/i,
    reason: 'AI agent config — OpenAI Codex',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.config[\\\/]goose[\\\/]/i,
    reason: 'AI agent config — Goose',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.warp[\\\/]/i,
    reason: 'AI agent config — Warp',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.gemini[\\\/]/i,
    reason: 'AI agent config — Gemini',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.config[\\\/]shell_gpt[\\\/]/i,
    reason: 'AI agent config — ShellGPT',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.aish[\\\/]/i,
    reason: 'AI agent config — AIsh',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.mentat[\\\/]/i,
    reason: 'AI agent config — Mentat',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.tabby-client[\\\/]/i,
    reason: 'AI agent config — Tabby',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.metagpt[\\\/]/i,
    reason: 'AI agent config — MetaGPT',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.config[\\\/]Claude[\\\/]/i,
    reason: 'AI agent config — Claude Desktop',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.composio[\\\/]/i,
    reason: 'AI agent config — Composio',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.semgrep[\\\/]/i,
    reason: 'AI agent config — Semgrep',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.config[\\\/]zed[\\\/]/i,
    reason: 'AI agent config — Zed',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.config[\\\/]configstore[\\\/]/i,
    reason: 'AI agent config — Config Store',
    category: 'agent-config',
    severity: 'critical',
  },
  // ── Container / VM / Local LLM configs ──
  {
    pattern: /[\\\/]\.ollama[\\\/]/i,
    reason: 'Local LLM config — Ollama',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.jan[\\\/]/i,
    reason: 'Local LLM config — Jan',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]lm-studio[\\\/]/i,
    reason: 'Local LLM config — LM Studio',
    category: 'agent-config',
    severity: 'critical',
  },
  {
    pattern: /[\\\/]\.cache[\\\/]gpt4all[\\\/]/i,
    reason: 'Local LLM config — GPT4All',
    category: 'agent-config',
    severity: 'critical',
  },
  // ── Environment variables ──
  { pattern: /[\\\/]\.env$/i, reason: 'Environment variables' },
  { pattern: /[\\\/]\.env\.[^\\\/]+$/i, reason: 'Environment variables' },
  { pattern: /[\\\/]\.ssh[\\\/]/i, reason: 'SSH keys/config' },
  { pattern: /id_rsa/i, reason: 'SSH private key' },
  { pattern: /id_ed25519/i, reason: 'SSH private key' },
  { pattern: /id_ecdsa/i, reason: 'SSH private key' },
  { pattern: /known_hosts/i, reason: 'SSH known hosts' },
  { pattern: /authorized_keys/i, reason: 'SSH authorized keys' },
  { pattern: /password/i, reason: 'Password file' },
  { pattern: /credential/i, reason: 'Credentials' },
  { pattern: /[\\\/]secret/i, reason: 'Secret file' },
  { pattern: /[\\\/][^\\\/]*token[^\\\/]*$/i, reason: 'API token' },
  { pattern: /api_key/i, reason: 'API key file' },
  { pattern: /[\\\/]\.git-credentials$/i, reason: 'Git credentials' },
  { pattern: /\.pem$/i, reason: 'Private key (PEM)' },
  { pattern: /\.key$/i, reason: 'Private key' },
  { pattern: /\.pfx$/i, reason: 'Certificate (PFX)' },
  { pattern: /\.p12$/i, reason: 'Certificate (P12)' },
  { pattern: /[\\\/]\.aws[\\\/]/i, reason: 'AWS credentials' },
  { pattern: /[\\\/]\.azure[\\\/]/i, reason: 'Azure credentials' },
  { pattern: /[\\\/]\.gcloud[\\\/]/i, reason: 'GCloud credentials' },
  { pattern: /[\\\/]\.gnupg[\\\/]/i, reason: 'GPG keys' },
  { pattern: /Chrome[\\\/]User Data[\\\/].*Login Data/i, reason: 'Chrome passwords' },
  { pattern: /Chrome[\\\/]User Data[\\\/].*Cookies/i, reason: 'Chrome cookies' },
  { pattern: /Chrome[\\\/]User Data[\\\/].*Web Data/i, reason: 'Chrome autofill data' },
  { pattern: /Chrome[\\\/]User Data[\\\/].*History/i, reason: 'Chrome browsing history' },
  { pattern: /Firefox[\\\/]Profiles[\\\/].*logins\.json/i, reason: 'Firefox passwords' },
  { pattern: /Firefox[\\\/]Profiles[\\\/].*cookies\.sqlite/i, reason: 'Firefox cookies' },
  { pattern: /Firefox[\\\/]Profiles[\\\/].*key[34]\.db/i, reason: 'Firefox key database' },
  { pattern: /Edge[\\\/]User Data[\\\/].*Login Data/i, reason: 'Edge passwords' },
  { pattern: /Edge[\\\/]User Data[\\\/].*Cookies/i, reason: 'Edge cookies' },
  { pattern: /[\\\/]\.npmrc$/i, reason: 'NPM config (may contain tokens)' },
  { pattern: /[\\\/]\.pypirc$/i, reason: 'PyPI config (may contain tokens)' },
  { pattern: /[\\\/]\.docker[\\\/]config\.json/i, reason: 'Docker credentials' },
  { pattern: /[\\\/]\.kube[\\\/]/i, reason: 'Kubernetes config' },
];

/** @type {string[]} The six permission category identifiers */
const PERMISSION_CATEGORIES = [
  'filesystem',
  'sensitive',
  'network',
  'terminal',
  'clipboard',
  'screen',
];

module.exports = {
  IGNORE_PROCESS_PATTERNS,
  EDITORS,
  EDITOR_HOSTS,
  IGNORE_PATTERNS,
  AGENT_CONFIG_PATHS,
  AGENT_SELF_CONFIG,
  SENSITIVE_RULES,
  PERMISSION_CATEGORIES,
};
