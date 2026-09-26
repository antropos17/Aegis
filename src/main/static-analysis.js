'use strict';

const { TextDecoder } = require('node:util');
const { visitStaticFiles } = require('./static-analysis-files');
const {
  analyzeConfiguration,
  CONFIG_ITEMS,
  COMMANDS_PER_FILE,
} = require('./static-config-analysis');
const { commandFile, SCRIPT_LINES } = require('./static-command-file');
const { COMMAND_CHARS, COMMAND_TOKENS, COMMAND_REDIRECTIONS } = require('./static-command-parser');
const { analyzeJavaScript } = require('./static-javascript');
const { JAVASCRIPT_LIMITS } = require('./static-javascript-ast');
const { VALUE_STEPS } = require('./static-javascript-values');
const { analyzePython } = require('./static-python');
const { PYTHON_LIMITS } = require('./static-python-tree');
const { PYTHON_VALUE_STEPS } = require('./static-python-values');
const { createStaticCatalog, bindStaticFlow, FLOW_LIMITS } = require('./static-code-catalog');
const { analyzeInstructions, INSTRUCTION_LIMITS } = require('./static-instruction-analysis');
const { analyzeClaudeSkillFrontmatter } = require('./static-claude-permissions');
const {
  analyzeInstructionCatalog,
  INSTRUCTION_CATALOG_LIMITS,
} = require('./static-instruction-catalog');
const { staticRule, staticRuleSet } = require('./static-analysis-rules');
const { parseInventoryConfig, PARSE_DEPTH } = require('./inventory-config');
const { resolveSnapshotSubject, checkSnapshotSubject } = require('./inventory-snapshot-files');

const FINDING_LIMIT = 256;
const ISSUE_LIMIT = 1024;
function claudeSettingsSource(name, adapter, entry) {
  if (name === '.claude/settings.json' && adapter === 'user-home' && entry.agent === 'claude-code')
    return 'user';
  if (name === '.claude/settings.json' || name === '.claude/settings.local.json') return 'project';
  if (adapter === 'claude-user' && name === 'settings.json' && entry.agent === 'claude-code')
    return 'user';
  if (
    adapter === 'claude-managed' &&
    entry.agent === 'claude-code' &&
    (name === 'managed-settings.json' || /^managed-settings\.d\/[^/.][^/]*\.json$/.test(name))
  )
    return 'managed';
  return null;
}

function analyzeFile(name, data, entry, catalog, adapter) {
  const base = name.split(/[/\\]/).at(-1);
  const claudeSettings = claudeSettingsSource(name, adapter, entry);
  if (entry.kind === 'policy')
    return {
      mode: 'unsupported',
      findings: [],
      issues: ['policy-semantics-not-analyzed'],
      commands: 0,
    };
  if (base === 'package.json')
    return { mode: 'npm-manifest', ...analyzeConfiguration(data, 'json', true) };
  if (entry.format || claudeSettings)
    return {
      mode: 'agent-config',
      ...analyzeConfiguration(data, entry.format || 'json', false, claudeSettings),
    };
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
    return { mode: 'javascript-command-ast', ...analyzeJavaScript(text, name, catalog) };
  if (/\.py$/i.test(base))
    return { mode: 'python-command-syntax', ...analyzePython(text, name, catalog) };
  if (
    /\.(?:sh|bash|zsh|ps1)$/i.test(base) ||
    /^#![^\r\n]*(?:\/(?:ba|da|z)?sh|\benv\s+(?:ba|da|z)?sh)\b/.test(text)
  )
    return { mode: 'literal-shell', ...commandFile(text, false) };
  if (entry.kind === 'instruction' || /\.(?:md|mdx|txt)$/i.test(base) || base === '.cursorrules') {
    const commands = commandFile(text, true);
    const instructions = analyzeInstructions(text);
    const claudeSkill =
      base === 'SKILL.md' &&
      (/(?:^|\/)\.claude\/skills\/[^/]+\/SKILL\.md$/.test(name) ||
        (adapter === 'claude-user' && /^skills\/[^/]+\/SKILL\.md$/.test(name)))
        ? analyzeClaudeSkillFrontmatter(text)
        : { findings: [], issues: [] };
    return {
      mode: 'instruction-patterns-and-code',
      findings: [...commands.findings, ...instructions.findings, ...claudeSkill.findings],
      issues: [...new Set([...commands.issues, ...instructions.issues, ...claudeSkill.issues])],
      commands: commands.commands,
    };
  }
  return { mode: 'unsupported', findings: [], issues: ['file-type-not-analyzed'], commands: 0 };
}

/**
 * Review an explicit directory with bounded built-in static patterns.
 * Completeness concerns the declared subset; no result certifies safety or grants trust.
 * @param {string} adapter Built-in inventory adapter or package for a whole directory tree.
 * @param {string} directory Caller-selected directory, with no implicit discovery.
 * @param {{limits?: object, toolsFile?: string}} [options] Lower tree limits and an explicit offline tools/list file.
 * @returns {Promise<object>} Versioned redacted findings, file hashes and coverage gaps.
 * @since v0.15.1
 */
async function scanStaticDirectory(adapter, directory, options = {}) {
  const subject = await resolveSnapshotSubject(directory);
  const mcpCatalog =
    options.toolsFile !== undefined ? await analyzeInstructionCatalog(options.toolsFile) : null;
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
  const snapshots = [];
  const visit = await visitStaticFiles(
    adapter,
    subject.root,
    (name, file, entry) => snapshots.push({ path: name, file, entry }),
    options.limits,
  );
  snapshots.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const catalog = createStaticCatalog(snapshots, visit.issues);
  const excludedFlowFiles = new Set(catalog.issues.map(({ path }) => path));
  catalog.issues.forEach(({ path, reason }) => issue(path, reason));
  for (const { path: name, file, entry } of snapshots) {
    let analysis;
    try {
      analysis = analyzeFile(name, file.data, entry, catalog, visit.adapter.id);
    } catch (_) {
      analysis = { mode: 'unsupported', findings: [], issues: ['analysis-failed'], commands: 0 };
    }
    files.push({
      path: name,
      sha256: file.sha256,
      size: file.size,
      analysis: analysis.mode,
      commands: analysis.commands,
      complete: analysis.issues.length === 0 && !excludedFlowFiles.has(name),
    });
    analysis.issues.forEach((reason) => issue(name, reason));
    for (const finding of analysis.findings) {
      if (findings.length >= FINDING_LIMIT) {
        issue('', 'finding-limit');
        break;
      }
      let flow = null;
      try {
        if (finding.flow) flow = bindStaticFlow(finding.flow, name, catalog);
      } catch (_) {
        flow = { issue: 'flow-evidence-invalid' };
      }
      if (flow?.issue) {
        issue(name, flow.issue);
        files.at(-1).complete = false;
        continue;
      }
      findings.push({
        ...staticRule(finding.ruleId),
        path: name,
        sha256: file.sha256,
        line: finding.line ?? null,
        context: finding.context,
        ...(finding.instruction ? { instruction: { signal: finding.instruction.signal } } : {}),
        ...(flow ? { flow: flow.value } : {}),
      });
    }
  }
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
  const complete = issues.length === 0 && (!mcpCatalog || mcpCatalog.complete);
  const findingCount = findings.length + (mcpCatalog?.findings.length ?? 0);
  return {
    schemaVersion: 1,
    mode: 'static-analysis',
    assessment: 'static-patterns',
    safety: 'not-determined',
    status: findingCount ? 'findings' : complete ? 'no-findings' : 'incomplete',
    reviewRequired: findingCount > 0 || !complete,
    complete,
    subjectSha256: subject.rootSha256,
    adapter: visit.adapter,
    ruleSet: staticRuleSet(),
    scope: {
      ...visit.scope,
      mcpToolDescriptions: mcpCatalog ? 'explicit-offline-catalog' : 'not-selected',
      claudePreapproval: 'selected-settings-and-claude-skill-frontmatter-only',
      otherSkillPreapprovals: 'not-analyzed',
    },
    limits: {
      ...visit.limits,
      parseDepth: PARSE_DEPTH,
      configItems: CONFIG_ITEMS,
      commandsPerFile: COMMANDS_PER_FILE,
      commandChars: COMMAND_CHARS,
      commandTokens: COMMAND_TOKENS,
      commandRedirections: COMMAND_REDIRECTIONS,
      scriptLines: SCRIPT_LINES,
      ...JAVASCRIPT_LIMITS,
      javascriptValueSteps: VALUE_STEPS,
      ...PYTHON_LIMITS,
      pythonValueSteps: PYTHON_VALUE_STEPS,
      ...FLOW_LIMITS,
      ...INSTRUCTION_LIMITS,
      ...INSTRUCTION_CATALOG_LIMITS,
      findings: FINDING_LIMIT,
      issues: ISSUE_LIMIT,
    },
    usage: { ...visit.usage, ...catalog.usage() },
    summary: {
      filesRead: files.length,
      unsupportedFiles: files.filter((file) => file.analysis === 'unsupported').length,
      commands: files.reduce((sum, file) => sum + file.commands, 0),
      findings: findingCount,
      issues: issues.length + (mcpCatalog?.issues.length ?? 0),
      mcpTools: mcpCatalog?.summary.tools ?? 0,
      mcpDescriptions: mcpCatalog?.summary.descriptions ?? 0,
    },
    files,
    findings,
    issues,
    mcpCatalog,
  };
}

module.exports = { scanStaticDirectory };
