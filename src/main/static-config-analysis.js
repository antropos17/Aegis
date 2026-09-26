'use strict';

const { parseInventoryConfig } = require('./inventory-config');
const { analyzeCommand, analyzeInvocation } = require('./static-command-analysis');
const { hasBroadClaudeAllow, reviewBroadClaudeMcpAllow } = require('./static-claude-permissions');
const CONFIG_ITEMS = 2048;
const COMMANDS_PER_FILE = 256;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const LIFECYCLE = new Set([
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'preprepare',
  'prepare',
  'postprepare',
]);

/**
 * Inspect known configuration and npm manifest fields. All values remain internal.
 * @param {Buffer} data Bounded original bytes.
 * @param {string} format Strict json/jsonc/toml parser selection.
 * @param {boolean} [packageManifest] Select npm manifest semantics.
 * @param {'project'|'user'|'managed'|null} [claudeSettings] Selected Claude settings source.
 * @returns {object} Fixed findings, coverage issues and command count.
 * @since v0.15.1
 */
function analyzeConfiguration(data, format, packageManifest = false, claudeSettings = null) {
  const parsed = parseInventoryConfig(data, format);
  if (parsed.parseStatus !== 'parsed')
    return { findings: [], issues: [parsed.parseStatus], commands: 0 };
  const findings = new Map();
  const issues = new Set();
  let items = 0;
  let commands = 0;
  const finding = (ruleId, context) => findings.set(ruleId + ':' + context, { ruleId, context });
  function take() {
    if (++items <= CONFIG_ITEMS) return true;
    issues.add('config-entry-limit');
    return false;
  }
  function command(value, args, context) {
    if (commands >= COMMANDS_PER_FILE) {
      issues.add('command-count-limit');
      return;
    }
    commands++;
    const result =
      context === 'mcp-command' ? analyzeInvocation(value, args) : analyzeCommand(value);
    result.rules.forEach((ruleId) => finding(ruleId, context));
    result.issues.forEach((issue) => issues.add(issue));
  }
  function environment(value) {
    if (!record(value)) {
      issues.add('invalid-env-shape');
      return;
    }
    if (Object.hasOwn(value, 'ANTHROPIC_BASE_URL')) {
      if (typeof value.ANTHROPIC_BASE_URL !== 'string') issues.add('invalid-env-shape');
      else if (value.ANTHROPIC_BASE_URL.trim()) finding('STA009', 'provider-endpoint');
    }
  }
  function endpoint(value) {
    if (typeof value !== 'string' || !value || /\$\{|%[\w]+%/.test(value)) {
      issues.add('unresolved-mcp-url');
      return;
    }
    let url;
    try {
      url = new URL(value);
    } catch (_) {
      issues.add('unresolved-mcp-url');
      return;
    }
    if (!['http:', 'https:'].includes(url.protocol)) issues.add('unsupported-mcp-transport');
    const local =
      url.hostname === 'localhost' ||
      url.hostname === '[::1]' ||
      /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
    if (url.protocol === 'http:' && !local) finding('STA007', 'mcp-url');
    if (
      url.username ||
      url.password ||
      [...url.searchParams.keys()].some((key) =>
        /^(?:access_token|token|api_key|apikey|key|authorization|auth)$/i.test(key),
      )
    )
      finding('STA008', 'mcp-url');
  }
  function servers(value) {
    if (!record(value)) {
      issues.add('invalid-mcp-shape');
      return;
    }
    for (const server of Object.values(value)) {
      if (!take()) break;
      if (!record(server)) {
        issues.add('invalid-mcp-shape');
        continue;
      }
      if (Object.hasOwn(server, 'command'))
        command(server.command, Object.hasOwn(server, 'args') ? server.args : [], 'mcp-command');
      if (Object.hasOwn(server, 'url')) endpoint(server.url);
      if (Object.hasOwn(server, 'httpUrl')) endpoint(server.httpUrl);
      if (
        !Object.hasOwn(server, 'command') &&
        !Object.hasOwn(server, 'url') &&
        !Object.hasOwn(server, 'httpUrl')
      )
        issues.add('unsupported-mcp-transport');
      if (Object.hasOwn(server, 'env')) environment(server.env);
    }
  }
  function hooks(value) {
    const pending = [value];
    while (pending.length) {
      if (!take()) break;
      const entry = pending.pop();
      if (Array.isArray(entry)) {
        if (entry.length + pending.length > CONFIG_ITEMS) {
          issues.add('config-entry-limit');
          break;
        }
        pending.push(...entry);
      } else if (record(entry)) {
        if (Object.hasOwn(entry, 'command')) {
          if (entry.type !== undefined && entry.type !== 'command')
            issues.add('unsupported-hook-type');
          else command(entry.command, null, 'hook-command');
        } else if (Object.hasOwn(entry, 'type')) issues.add('unsupported-hook-type');
        else {
          // Event names and matchers are private. Traverse only hook containers.
          const values = Object.hasOwn(entry, 'hooks') ? [entry.hooks] : Object.values(entry);
          if (values.length + pending.length > CONFIG_ITEMS) {
            issues.add('config-entry-limit');
            break;
          }
          pending.push(...values.filter((child) => child !== undefined));
        }
      } else issues.add('invalid-hook-shape');
    }
  }
  function config(value) {
    if (!record(value)) {
      issues.add('invalid-config-shape');
      return;
    }
    for (const key of ['mcpServers', 'mcp_servers', 'servers']) {
      if (Object.hasOwn(value, key)) servers(value[key]);
    }
    if (Object.hasOwn(value, 'hooks')) {
      if (!record(value.hooks)) issues.add('invalid-hook-shape');
      else hooks(value.hooks);
    }
    if (Object.hasOwn(value, 'env')) environment(value.env);
  }
  if (claudeSettings) {
    const settings = record(parsed.value) ? parsed.value : null;
    if (
      claudeSettings === 'project' &&
      record(settings?.sandbox) &&
      record(settings.sandbox.network) &&
      settings.sandbox.network.strictAllowlist === true
    )
      finding('STA019', 'claude-settings-strict-allowlist-scope');
    const permissions = settings?.permissions;
    if (permissions !== undefined) {
      if (record(permissions) && permissions.defaultMode === 'bypassPermissions') {
        if (permissions.disableBypassPermissionsMode !== 'disable') {
          if (claudeSettings === 'project') issues.add('claude-bypass-mode-version-unknown');
          else finding('STA018', 'claude-settings-default-mode');
        }
      }
      const supported =
        record(permissions) &&
        ['allow', 'ask', 'deny'].every(
          (key) =>
            !Object.hasOwn(permissions, key) ||
            (Array.isArray(permissions[key]) &&
              permissions[key].length <= CONFIG_ITEMS &&
              permissions[key].every((rule) => typeof rule === 'string')),
        );
      if (!supported) issues.add('claude-permissions-unparsed');
      else {
        if (hasBroadClaudeAllow(permissions)) finding('STA016', 'claude-settings-permission');
        const mcp = reviewBroadClaudeMcpAllow(permissions);
        if (mcp.broad) finding('STA020', 'claude-settings-mcp-server-allow');
        if (mcp.unresolved) issues.add('claude-mcp-restriction-unresolved');
        if (mcp.ambiguous) issues.add('claude-mcp-server-name-ambiguous');
      }
    }
  }
  function manifest(value) {
    if (Object.hasOwn(value, 'scripts')) {
      if (!record(value.scripts)) issues.add('invalid-package-shape');
      else
        for (const [name, script] of Object.entries(value.scripts)) {
          if (!take()) break;
          if (typeof script !== 'string') {
            issues.add('invalid-package-shape');
            continue;
          }
          if (script.trim() && LIFECYCLE.has(name)) finding('STA010', 'package-lifecycle');
          command(script, null, 'package-script');
        }
    }
    for (const key of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ]) {
      if (!Object.hasOwn(value, key)) continue;
      if (!record(value[key])) {
        issues.add('invalid-package-shape');
        continue;
      }
      for (const selector of Object.values(value[key])) {
        if (!take()) break;
        if (typeof selector !== 'string') {
          issues.add('invalid-package-shape');
          continue;
        }
        const remote =
          /^(?:git(?:\+[^:]+)?:|https?:|github:|gitlab:|bitbucket:)/i.test(selector) ||
          /^[\w.-]+\/[\w.-]+(?:#.*)?$/.test(selector);
        const pinnedGit =
          !/^https?:/i.test(selector) && /#[a-f0-9]{40}(?:[a-f0-9]{24})?$/i.test(selector);
        if (remote && !pinnedGit) finding('STA011', 'package-dependency');
      }
    }
  }
  if (packageManifest) manifest(parsed.value);
  else {
    config(parsed.value);
    for (const key of ['projects', 'profiles']) {
      if (!Object.hasOwn(parsed.value, key)) continue;
      if (!record(parsed.value[key])) issues.add('invalid-config-shape');
      else
        for (const entry of Object.values(parsed.value[key])) {
          if (!take()) break;
          config(entry);
        }
    }
  }
  return { findings: [...findings.values()], issues: [...issues].sort(), commands };
}

module.exports = { analyzeConfiguration, CONFIG_ITEMS, COMMANDS_PER_FILE };
