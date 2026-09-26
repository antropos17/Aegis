'use strict';

const yaml = require('js-yaml');

const FRONTMATTER_CHARS = 16384;
const FRONTMATTER_LINES = 256;
const ALLOWED_TOOLS = 128;

// Deliberately finite. Claude's permission matcher has more forms than this review recognizes.
const BROAD_COMMANDS = new Set([
  'bash',
  'sh',
  'zsh',
  'python',
  'python3',
  'node',
  'ruby',
  'perl',
  'pwsh',
  'powershell',
  'npx',
  'npm',
  'npm exec',
  'npm run',
  'uvx',
  'awk',
  'sed',
  'git',
  'docker',
]);

/** Recognize only clear unrestricted execution grants, without returning rule text.
 * @param {unknown} value Claude permission rule.
 * @returns {boolean} Whether this rule requests broad execution preapproval.
 * @since v0.16.0-alpha
 */
function isBroadClaudeExecutionGrant(value) {
  if (typeof value !== 'string') return false;
  if (value === 'Bash' || value === 'Bash(*)') return true;
  if (/^PowerShell(?:\(\*\))?$/i.test(value)) return true;
  let match = /^Bash\((.*)\)$/.exec(value);
  const powershell = !match;
  if (!match) match = /^PowerShell\((.*)\)$/i.exec(value);
  if (!match) return false;
  const specifier = match[1];
  const prefix = specifier.endsWith(':*')
    ? specifier.slice(0, -2)
    : specifier.endsWith(' *')
      ? specifier.slice(0, -2)
      : null;
  if (prefix === null) return false;
  const command = powershell ? prefix.toLowerCase() : prefix;
  return BROAD_COMMANDS.has(command) || /^python3\.\d+$/.test(command);
}

const normalized = (rule) => (rule.endsWith(':*)') ? rule.slice(0, -3) + ' *)' : rule);
const comparable = (rule) =>
  /^PowerShell/i.test(rule) ? normalized(rule).toLowerCase() : normalized(rule);

/** Check declared broad allows that are not covered by a same-file ask or deny rule.
 * Cross-file precedence and runtime permission mode remain unresolved.
 * @param {unknown} value Claude permissions object.
 * @returns {boolean} Whether the file declares a broad unmasked allow.
 * @since v0.16.0-alpha
 */
function hasBroadClaudeAllow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!Array.isArray(value.allow)) return false;
  const restrictions = [
    ...(Array.isArray(value.ask) ? value.ask : []),
    ...(Array.isArray(value.deny) ? value.deny : []),
  ];
  return value.allow.some((rule) => {
    if (!isBroadClaudeExecutionGrant(rule)) return false;
    const powershell = /^PowerShell/i.test(rule);
    return !restrictions.some((restrictive) => {
      if (typeof restrictive !== 'string') return false;
      if (
        powershell
          ? /^PowerShell(?:\(\*\))?$/i.test(restrictive)
          : restrictive === 'Bash' || restrictive === 'Bash(*)'
      )
        return true;
      return comparable(restrictive) === comparable(rule);
    });
  });
}

// Claude's CLI server names use letters, digits, hyphens and underscores.
// A double underscore in an exact rule is normally a tool separator. Only
// terminal __* forms are marked ambiguous: they could name a whole server
// containing __ or a wildcard over one server's tools.
const MCP_SERVER_ALLOW = /^mcp__([A-Za-z0-9_-]+)(?:__\*)?$/;

/** Identify only whole-server MCP allow declarations and unresolved restriction globs.
 * Tool-scoped ask/deny rules leave other tools on the server potentially allowed.
 * Cross-file precedence and runtime permission mode remain unresolved.
 * @param {unknown} value Claude permissions object.
 * @returns {{broad: boolean, unresolved: boolean, ambiguous: boolean}} Fixed signal and limitation flags.
 * @since v0.16.0-alpha
 */
function reviewBroadClaudeMcpAllow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.allow))
    return { broad: false, unresolved: false, ambiguous: false };
  const restrictions = [
    ...(Array.isArray(value.ask) ? value.ask : []),
    ...(Array.isArray(value.deny) ? value.deny : []),
  ];
  let broad = false;
  let unresolved = false;
  let ambiguous = false;
  for (const rule of value.allow) {
    if (typeof rule !== 'string') continue;
    const match = MCP_SERVER_ALLOW.exec(rule);
    if (!match) continue;
    if (match[1].includes('__')) {
      if (rule.endsWith('__*')) ambiguous = true;
      continue;
    }
    const server = `mcp__${match[1]}`;
    if (
      restrictions.some(
        (restriction) =>
          restriction === '*' ||
          restriction === 'mcp__*' ||
          restriction === server ||
          restriction === `${server}__*`,
      )
    )
      continue;
    broad = true;
    // Other globs may cover a whole server, but their effective tool set is not
    // proven here. Keep the finding and mark the same-file limitation.
    const toolPrefix = `${server}__`;
    if (
      restrictions.some((restriction) => {
        if (typeof restriction !== 'string') return false;
        const firstGlob = restriction.search(/[*?\[]/);
        return firstGlob >= 0 && toolPrefix.startsWith(restriction.slice(0, firstGlob));
      })
    )
      unresolved = true;
  }
  return { broad, unresolved, ambiguous };
}

function splitAllowedTools(value) {
  if (Array.isArray(value))
    return value.length <= ALLOWED_TOOLS && value.every((item) => typeof item === 'string')
      ? value
      : null;
  if (typeof value !== 'string') return null;
  const tools = [];
  let current = '';
  let depth = 0;
  for (const char of value) {
    if (char === '(') depth++;
    if (char === ')') {
      depth--;
      if (depth < 0) return null;
    }
    if (depth === 0 && (char === ',' || /\s/.test(char))) {
      if (current) tools.push(current);
      current = '';
    } else current += char;
    if (tools.length > ALLOWED_TOOLS) return null;
  }
  if (depth !== 0) return null;
  if (current) tools.push(current);
  return tools.length <= ALLOWED_TOOLS ? tools : null;
}

/** Inspect only leading Claude skill YAML metadata, leaving the body and raw grants private.
 * @param {string} text Bounded UTF-8 skill text.
 * @returns {{findings: object[], issues: string[]}} Fixed findings and coverage issues.
 * @since v0.16.0-alpha
 */
function analyzeClaudeSkillFrontmatter(text) {
  const empty = { findings: [], issues: [] };
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return empty;
  const lines = text.slice(0, FRONTMATTER_CHARS + 1).split(/\r?\n/);
  const closing = lines.findIndex((line, index) => index > 0 && line === '---');
  if (closing < 0 || closing > FRONTMATTER_LINES)
    return { findings: [], issues: ['claude-skill-frontmatter-unparsed'] };
  let metadata;
  try {
    metadata = yaml.load(lines.slice(1, closing).join('\n'), { schema: yaml.JSON_SCHEMA });
  } catch (_) {
    return { findings: [], issues: ['claude-skill-frontmatter-unparsed'] };
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    return { findings: [], issues: ['claude-skill-frontmatter-unparsed'] };
  if (!Object.hasOwn(metadata, 'allowed-tools')) return empty;
  const tools = splitAllowedTools(metadata['allowed-tools']);
  if (!tools) return { findings: [], issues: ['claude-skill-allowed-tools-unparsed'] };
  if (!tools.some(isBroadClaudeExecutionGrant)) return empty;
  const fieldLine = lines.findIndex((line) => /^allowed-tools\s*:/.test(line));
  return {
    findings: [
      {
        ruleId: 'STA017',
        context: 'claude-skill-preapproval',
        line: fieldLine < 0 ? null : fieldLine + 1,
      },
    ],
    issues: [],
  };
}

module.exports = {
  isBroadClaudeExecutionGrant,
  hasBroadClaudeAllow,
  reviewBroadClaudeMcpAllow,
  analyzeClaudeSkillFrontmatter,
};
