'use strict';

const { analyzeCommand } = require('./static-command-analysis');
const { COMMANDS_PER_FILE } = require('./static-config-analysis');

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

/**
 * Review literal script commands or fenced Markdown code without executing them.
 * @param {string} text Original decoded file text.
 * @param {boolean} markdown Restrict commands to supported fenced blocks.
 * @returns {object} Fixed findings, coverage issues and command count.
 * @since v0.15.1
 */
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

module.exports = { commandFile, SCRIPT_LINES };
