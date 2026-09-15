'use strict';

const { TextDecoder } = require('node:util');
const { visitStaticFiles } = require('./static-analysis-files');
const {
  analyzeConfiguration,
  CONFIG_ITEMS,
  COMMANDS_PER_FILE,
} = require('./static-config-analysis');
const { analyzeCommand } = require('./static-command-analysis');
const { COMMAND_CHARS, COMMAND_TOKENS } = require('./static-command-parser');
const { analyzeJavaScript } = require('./static-javascript');
const { JAVASCRIPT_LIMITS } = require('./static-javascript-ast');
const { VALUE_STEPS } = require('./static-javascript-values');
const { analyzePython } = require('./static-python');
const { PYTHON_LIMITS } = require('./static-python-tree');
const { PYTHON_VALUE_STEPS } = require('./static-python-values');
const { staticRule, staticRuleSet } = require('./static-analysis-rules');
const { parseInventoryConfig, PARSE_DEPTH } = require('./inventory-config');
const { resolveSnapshotSubject, checkSnapshotSubject } = require('./inventory-snapshot-files');

const FINDING_LIMIT = 256;
const ISSUE_LIMIT = 1024;
const SCRIPT_LINES = 8192;
const FENCE_LANGUAGES = new Set([
  'sh',
  'bash',
  'shell',
  'zsh',
  'console',
  'powershell',
  'pwsh',
  'ps1',
]);

function commandFile(text, markdown) {
  const findings = [];
  const issues = new Set();
  const lines = text.split(/\r\n|\n|\r/);
  let commands = 0;
  let fence = null;
  let pending = '';
  let startLine = 1;
  let stopped = false;
  function inspect(command, line) {
    if (!command.trim() || command.trimStart().startsWith('#')) return;
    if (commands >= COMMANDS_PER_FILE) {
      issues.add('command-count-limit');
      return;
    }
    commands++;
    const result = analyzeCommand(command);
    if (
      result.issues.some((issue) =>
        ['multiline-shell-not-analyzed', 'unclosed-command-quote'].includes(issue),
      )
    )
      stopped = true;
    result.rules.forEach((ruleId) =>
      findings.push({ ruleId, line, context: markdown ? 'instruction-code' : 'script-command' }),
    );
    result.issues.forEach((issue) => issues.add(issue));
  }
  if (lines.length > SCRIPT_LINES) issues.add('script-line-limit');
  for (let index = 0; index < Math.min(lines.length, SCRIPT_LINES); index++) {
    if (stopped) break;
    let line = lines[index];
    if (markdown) {
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (marker) {
        if (!fence) {
          const language = marker[2].trim().toLowerCase();
          fence = {
            char: marker[1][0],
            length: marker[1].length,
            language,
            supported: FENCE_LANGUAGES.has(language),
          };
          if (!fence.supported) issues.add('unsupported-code-block');
          continue;
        }
        if (marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) {
          if (pending) issues.add('unfinished-command');
          pending = '';
          fence = null;
          continue;
        }
      }
      if (!fence?.supported) continue;
      if (fence.language === 'console') line = line.replace(/^\s*\$ /, '');
    }
    if (!pending) startLine = index + 1;
    const continuation =
      /(?:^|[^\\])(?:\\\\)*\\$/.test(line) || line.endsWith(String.fromCharCode(96));
    pending += continuation ? line.slice(0, -1) : line;
    if (continuation) continue;
    inspect(pending, startLine);
    pending = '';
  }
  if (pending) issues.add('unfinished-command');
  if (fence) issues.add('unclosed-code-block');
  return { findings, issues: [...issues], commands };
}

function analyzeFile(name, data, entry) {
  const base = name.split(/[/\\]/).at(-1);
  if (entry.kind === 'policy')
    return {
      mode: 'unsupported',
      findings: [],
      issues: ['policy-semantics-not-analyzed'],
      commands: 0,
    };
  if (base === 'package.json')
    return { mode: 'npm-manifest', ...analyzeConfiguration(data, 'json', true) };
  if (entry.format) return { mode: 'agent-config', ...analyzeConfiguration(data, entry.format) };
  if (['.mcp.json', 'mcp.json', 'hooks.json'].includes(base))
    return {
      mode: 'agent-config',
      ...analyzeConfiguration(data, name.includes('.vscode/') ? 'jsonc' : 'json'),
    };
  if (['package-lock.json', 'npm-shrinkwrap.json'].includes(base)) {
    const parsed = parseInventoryConfig(data, 'json');
    return {
      mode: 'lock-metadata-only',
      findings: [],
      issues: parsed.parseStatus === 'parsed' ? [] : [parsed.parseStatus],
      commands: 0,
    };
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch (_) {
    return { mode: 'unsupported', findings: [], issues: ['invalid-encoding'], commands: 0 };
  }
  if (text.includes('\0'))
    return { mode: 'unsupported', findings: [], issues: ['binary-not-analyzed'], commands: 0 };
  if (/\.(?:js|mjs|cjs)$/i.test(base))
    return { mode: 'javascript-command-ast', ...analyzeJavaScript(text, name) };
  if (/\.py$/i.test(base)) return { mode: 'python-command-syntax', ...analyzePython(text) };
  if (
    /\.(?:sh|bash|zsh|ps1)$/i.test(base) ||
    /^#![^\r\n]*(?:\/(?:ba|da|z)?sh|\benv\s+(?:ba|da|z)?sh)\b/.test(text)
  )
    return { mode: 'literal-shell', ...commandFile(text, false) };
  if (entry.kind === 'instruction' || /\.(?:md|mdx|txt)$/i.test(base) || base === '.cursorrules')
    return { mode: 'instruction-code-blocks', ...commandFile(text, true) };
  return { mode: 'unsupported', findings: [], issues: ['file-type-not-analyzed'], commands: 0 };
}

/**
 * Review an explicit directory with bounded built-in static patterns.
 * Completeness concerns the declared subset; no result certifies safety or grants trust.
 * @param {string} adapter Built-in inventory adapter or package for a whole directory tree.
 * @param {string} directory Caller-selected directory, with no implicit discovery.
 * @param {{limits?: object}} [options] Optional lower filesystem limits.
 * @returns {Promise<object>} Versioned redacted findings, file hashes and coverage gaps.
 * @since v0.15.1
 */
async function scanStaticDirectory(adapter, directory, options = {}) {
  const subject = await resolveSnapshotSubject(directory);
  const files = [];
  const findings = [];
  const issues = [];
  const issueKeys = new Set();
  let issueOverflow = false;
  function issue(path, reason) {
    const key = JSON.stringify([path, reason]);
    if (issueKeys.has(key)) return;
    if (issues.length >= ISSUE_LIMIT - 1) {
      issueOverflow = true;
      return;
    }
    issueKeys.add(key);
    issues.push({ path, reason });
  }
  const visit = await visitStaticFiles(
    adapter,
    subject.root,
    (name, file, entry) => {
      let analysis;
      try {
        analysis = analyzeFile(name, file.data, entry);
      } catch (_) {
        analysis = { mode: 'unsupported', findings: [], issues: ['analysis-failed'], commands: 0 };
      }
      files.push({
        path: name,
        sha256: file.sha256,
        size: file.size,
        analysis: analysis.mode,
        commands: analysis.commands,
        complete: analysis.issues.length === 0,
      });
      analysis.issues.forEach((reason) => issue(name, reason));
      for (const finding of analysis.findings) {
        if (findings.length >= FINDING_LIMIT) {
          issue('', 'finding-limit');
          break;
        }
        findings.push({
          ...staticRule(finding.ruleId),
          path: name,
          sha256: file.sha256,
          line: finding.line ?? null,
          context: finding.context,
        });
      }
    },
    options.limits,
  );
  visit.issues.forEach(({ path, reason }) => issue(path, reason));
  await checkSnapshotSubject(subject);
  if (issueOverflow) issues.push({ path: '', reason: 'analysis-issue-limit' });
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  findings.sort((a, b) =>
    a.path < b.path
      ? -1
      : a.path > b.path
        ? 1
        : (a.line ?? 0) - (b.line ?? 0) || a.ruleId.localeCompare(b.ruleId),
  );
  issues.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : a.reason.localeCompare(b.reason),
  );
  const complete = issues.length === 0;
  return {
    schemaVersion: 1,
    mode: 'static-analysis',
    assessment: 'static-patterns',
    safety: 'not-determined',
    status: findings.length ? 'findings' : complete ? 'no-findings' : 'incomplete',
    reviewRequired: findings.length > 0 || !complete,
    complete,
    subjectSha256: subject.rootSha256,
    adapter: visit.adapter,
    ruleSet: staticRuleSet(),
    scope: visit.scope,
    limits: {
      ...visit.limits,
      parseDepth: PARSE_DEPTH,
      configItems: CONFIG_ITEMS,
      commandsPerFile: COMMANDS_PER_FILE,
      commandChars: COMMAND_CHARS,
      commandTokens: COMMAND_TOKENS,
      scriptLines: SCRIPT_LINES,
      ...JAVASCRIPT_LIMITS,
      javascriptValueSteps: VALUE_STEPS,
      ...PYTHON_LIMITS,
      pythonValueSteps: PYTHON_VALUE_STEPS,
      findings: FINDING_LIMIT,
      issues: ISSUE_LIMIT,
    },
    usage: visit.usage,
    summary: {
      filesRead: files.length,
      unsupportedFiles: files.filter((file) => file.analysis === 'unsupported').length,
      commands: files.reduce((sum, file) => sum + file.commands, 0),
      findings: findings.length,
      issues: issues.length,
    },
    files,
    findings,
    issues,
  };
}

module.exports = { scanStaticDirectory };
