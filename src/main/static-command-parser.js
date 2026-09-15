'use strict';

const COMMAND_CHARS = 16384;
const COMMAND_TOKENS = 256;

/**
 * Tokenize a bounded literal shell subset, preserving quoted arguments and pipelines.
 * Substitutions, grouping, heredocs and backticks remain visible coverage gaps.
 * @param {string} text Untrusted command text; never executed or expanded.
 * @returns {object} Internal argv segments and fixed issue codes.
 * @since v0.15.1
 */
function parseLiteralCommands(text) {
  if (typeof text !== 'string') return { segments: [], issues: ['invalid-command-shape'] };
  if (text.length > COMMAND_CHARS) return { segments: [], issues: ['command-size-limit'] };
  const segments = [];
  const issues = new Set();
  let argv = [];
  let expanded = [];
  let token = '';
  let started = false;
  let dynamic = false;
  let quote = null;
  let count = 0;
  function word() {
    if (!started) return;
    argv.push(token);
    expanded.push(dynamic);
    token = '';
    started = false;
    dynamic = false;
    count++;
  }
  function segment(separator) {
    word();
    if (argv.length) segments.push({ argv, expanded, separator });
    argv = [];
    expanded = [];
  }
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    if (count >= COMMAND_TOKENS) return { segments: [], issues: ['command-token-limit'] };
    if (char.charCodeAt(0) === 0) return { segments: [], issues: ['invalid-command-shape'] };
    if (quote !== "'" && (char === '$' || char === '%' || (char === '~' && !quote && !started)))
      dynamic = true;
    if (quote !== "'" && (char.charCodeAt(0) === 96 || (char === '$' && next === '(')))
      issues.add('shell-syntax-not-resolved');
    if (quote) {
      if (char === quote) quote = null;
      else if (quote === '"' && char === '\\' && ['"', '\\', '$', '\n'].includes(next)) {
        if (next !== '\n') token += next;
        index++;
      } else token += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (char === '\\' && next === '\r' && text[index + 2] === '\n') index += 2;
    else if (char === '\\' && next && /[\s'"|;&#]/.test(next)) {
      if (next !== '\n') {
        token += next;
        started = true;
      }
      index++;
    } else if (char === '#' && !started) {
      while (index < text.length && text[index] !== '\n') index++;
      segment(';');
    } else if ('|;&\n\r'.includes(char)) {
      const separator = (char === '|' || char === '&') && next === char ? char + next : char;
      if (separator.length === 2) index++;
      segment(separator);
    } else if (/\s/.test(char)) word();
    else {
      if (char === '<' && (next === '<' || next === '#'))
        issues.add('multiline-shell-not-analyzed');
      if ('(){}^\\'.includes(char)) issues.add('shell-syntax-not-resolved');
      token += char;
      started = true;
    }
  }
  if (quote) issues.add('unclosed-command-quote');
  segment(null);
  if (count > COMMAND_TOKENS) return { segments: [], issues: ['command-token-limit'] };
  return { segments, issues: [...issues] };
}

module.exports = { parseLiteralCommands, COMMAND_CHARS, COMMAND_TOKENS };
