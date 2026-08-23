// @ts-check
/**
 * @file constants.js
 * @module shared/constants
 * @description Shared constant arrays used across AEGIS main-process modules:
 *   process ignore patterns, file ignore patterns, agent config paths,
 *   and permission categories.
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 */

'use strict';

/**
 * @typedef {import('./types/config').PermissionCategory} PermissionCategory
 * @typedef {{ readonly names: string[]; readonly label: string }} EditorDef
 */

/** @type {readonly string[]} Hardware/driver process name fragments to never flag as AI agents */
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

/** @type {readonly EditorDef[]} Editor/IDE definitions with process names and labels */
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

/** @type {readonly string[]} Editor/IDE host processes — not agents, but scan their children for AI extensions */
const EDITOR_HOSTS = EDITORS.flatMap((e) => e.names);

/** @type {readonly RegExp[]} Cross-platform file-path patterns treated as system noise and silently skipped.
 *  Platform-specific patterns live in src/main/platform/*.js (IGNORE_FILE_PATTERNS). */
const IGNORE_PATTERNS = [/\.tmp$/i];

/**
 * @type {readonly string[]} AI agent config directories relative to home dir.
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
  // Kilo Code — VS Code extension (ide-extension-detector.js). Global config dir
  // ~/.config/kilo/kilo.jsonc. NOTE: the API key is NOT here — Kilo stores it in
  // the OS keychain (VS Code SecretStorage), outside file-watching reach; the
  // JSON only holds a "<removed>" placeholder. This watches the config, not the key.
  '.config/kilo',
  // Container / VM / Local LLM config paths
  '.ollama',
  '.jan',
  '.cache/lm-studio',
  '.cache/gpt4all',
  '.docker',
  // WSL-inner agents (grok, opencode) — passive fallback signal when WSL process
  // enumeration is unavailable. NOTE: resolved against the WINDOWS home dir, so
  // this watches a NATIVE install (e.g. C:\Users\you\.opencode), NOT the
  // WSL-inner ~/.opencode. The primary signal is wsl-detector.js enumeration.
  '.grok-build',
  '.opencode',
];

/**
 * @type {readonly string[]} Secret credential directories (relative to home dir)
 * watched for sensitive-file access. Single source of truth shared by
 * file-watcher.setupFileWatchers (the credential roots + the Set that dedupes
 * them out of the agent-config watch) and restart-manager (held-handle scan).
 * Order and membership are load-bearing — keep byte-identical across consumers.
 * @since 0.10.0
 */
const SENSITIVE_AGENT_DIRS = ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.azure'];

/**
 * @type {Readonly<Record<string, RegExp>>} Map of agent name keywords to their own config directory patterns.
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
  // WSL-inner & extension agents (Gate ③). Keys match the names the detectors
  // emit — wsl-detector.js → 'opencode'/'grok', ide-extension-detector.js →
  // 'Kilo Code' — so isSelfAccess (agentName.includes(keyword)) resolves them.
  kilo: /[\\\/]\.config[\\\/]kilo[\\\/]/i,
  opencode: /[\\\/]\.opencode[\\\/]/i,
  grok: /[\\\/]\.grok-build[\\\/]/i,
  // Container / VM / Local LLM self-config
  docker: /[\\\/]\.docker[\\\/]/i,
  ollama: /[\\\/]\.ollama[\\\/]/i,
  'lm studio': /[\\\/](lm-studio[\\\/]|\.cache[\\\/]lm-studio[\\\/])/i,
  gpt4all: /[\\\/]\.cache[\\\/]gpt4all[\\\/]/i,
  jan: /[\\\/]\.jan[\\\/]/i,
};

/**
 * @type {readonly string[]} Endpoint hosts Anthropic publishes as required for Claude Code.
 * Source: https://code.claude.com/docs/en/network-config (retrieved 2026-08-04).
 *
 * This is an allowlist of NAMED SERVICES, not of infrastructure. A suffix that any tenant of
 * a cloud provider can obtain in its reverse-DNS name (`googleusercontent.com`, `1e100.net`,
 * `amazonaws.com`, `cloudfront.net`, `akamai.net`) must never appear here: matching it proves
 * only that someone rents the machine, which is exactly what an exfiltration host also does.
 * Entries are matched as an exact host or a subdomain of it — see network-monitor.isKnownDomain.
 * @since 0.10.0
 */
const ALLOWLIST_DOMAINS = [
  'api.anthropic.com',
  'claude.ai',
  'claude.com',
  'platform.claude.com',
  'mcp-proxy.anthropic.com',
  'downloads.claude.ai',
  'storage.googleapis.com',
  'bridge.claudeusercontent.com',
  'raw.githubusercontent.com',
  'http-intake.logs.us5.datadoghq.com',
  'browser-intake-us5-datadoghq.com',
  'formulae.brew.sh',
  'code.claude.com',
  'registry.npmjs.org',
];

/**
 * @type {readonly string[]} IP ranges (CIDR) Anthropic publishes for its API endpoints.
 * Source: https://platform.claude.com/docs/en/api/ip-addresses (retrieved 2026-08-04).
 *
 * Checked numerically and BEFORE any DNS work: `api.anthropic.com` resolves into these ranges
 * to addresses that carry no PTR record at all, so a name-based check can never confirm them.
 * Membership in a published range is verifiable evidence; the presence of a PTR record is not.
 *
 * Both entries are the INBOUND ranges — the addresses where Anthropic RECEIVES connections,
 * which is what an agent on this machine dials. The page also publishes an outbound range,
 * `160.79.104.0/21`, used when Anthropic itself calls out (MCP connector, web search); it is
 * a superset of the inbound /23 and would allowlist four times the address space for traffic
 * this monitor never observes, so it is deliberately NOT here.
 *  - `160.79.104.0/23` — inbound IPv4.
 *  - `2607:6bc0::/48`  — inbound IPv6. Required on its own: an IPv6-preferring host reaches
 *    the API over v6, where the v4 range can never match.
 * @since 0.10.0
 */
const ALLOWLIST_IP_RANGES = ['160.79.104.0/23', '2607:6bc0::/48'];

/** @type {readonly PermissionCategory[]} The six permission category identifiers */
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
  SENSITIVE_AGENT_DIRS,
  AGENT_SELF_CONFIG,
  PERMISSION_CATEGORIES,
  ALLOWLIST_DOMAINS,
  ALLOWLIST_IP_RANGES,
};
