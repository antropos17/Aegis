'use strict';

const COMMAND_CHARS = 16384;
const COMMAND_TOKENS = 256;
const COMMAND_REDIRECTIONS = 64;

/**
 * Tokenize a bounded literal shell subset, preserving quotes, pipelines and redirection order.
 * Substitutions, grouping, heredocs and backticks remain visible coverage gaps.
 * @param {string} text Untrusted command text; never executed or expanded.
 * @returns {object} Internal argv segments and fixed issue codes.
 * @since v0.15.1
 */
function parseLiteralCommands(text) {
  if (typeof text !== 'string') return { segments: [], issues: ['invalid-command-shape'] };
  if (text.length > COMMAND_CHARS) return { segments: [], issues: ['command-size-limit'] };
  if (text.includes('\0')) return { segments: [], issues: ['invalid-command-shape'] };
  const segments = [];
  const issues = new Set();
  let argv = [];
  let expanded = [];
  let redirections = [];
  let pending = null;
  let token = '';
  let started = false;
  let dynamic = false;
  let unquoted = true;
  let quote = null;
  let count = 0;
  let redirectCount = 0;
  let failure = null;
  const fail = (reason) => ({ segments: [], issues: [...new Set([...issues, reason])] });
  function resetWord() {
    token = '';
    started = false;
    dynamic = false;
    unquoted = true;
  }
  function word() {
    if (!started) return;
    if (pending) {
      redirections.push({ ...pending, target: token, expanded: dynamic });
      pending = null;
    } else {
      argv.push(token);
      expanded.push(dynamic);
    }
    resetWord();
    if (++count > COMMAND_TOKENS) failure = 'command-token-limit';
  }
  function segment(separator) {
    word();
    if (pending) failure ||= 'malformed-shell-redirection';
    if (argv.length || redirections.length)
      segments.push({ argv, expanded, separator, redirections });
    argv = [];
    expanded = [];
    redirections = [];
  }
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    if (quote !== "'" && (char === '$' || char === '%' || (char === '~' && !quote && !started)))
      dynamic = true;
    if (
      quote !== "'" &&
      (char.charCodeAt(0) === 96 || (char === '$' && (next === '(' || next === '[')))
    )
      return fail('shell-syntax-not-resolved');
    if (quote) {
      if (char === quote) quote = null;
      else if (quote === '"' && char === '\\' && next === '\r' && text[index + 2] === '\n')
        index += 2;
      else if (
        quote === '"' &&
        char === '\\' &&
        ['"', '\\', '$', '\n', String.fromCharCode(96)].includes(next)
      ) {
        if (next !== '\n') token += next;
        index++;
      } else token += char;
      continue;
    }
    if (char === '$' && next === '{') {
      const parameter = /^\$\{[A-Za-z_][\w:]*\}/.exec(text.slice(index));
      if (!parameter) return fail('shell-syntax-not-resolved');
      token += parameter[0];
      started = true;
      index += parameter[0].length - 1;
    } else if (char === '$' && (next === "'" || next === '"'))
      return fail('shell-syntax-not-resolved');
    else if (char === '"' || char === "'") {
      quote = char;
      started = true;
      unquoted = false;
    } else if (char === '\\' && next === '\r' && text[index + 2] === '\n') index += 2;
    else if (
      char === '\\' &&
      next &&
      (/[\s'"|;&#<>0-9$%*?\[\]\\]/.test(next) || next.charCodeAt(0) === 96)
    ) {
      if (next !== '\n') {
        token += next;
        started = true;
        unquoted = false;
      }
      index++;
    } else if (char === '#' && !started) {
      while (index < text.length && text[index] !== '\n') index++;
      segment(';');
    } else if ((char === '&' && next === '>') || (char === '|' && next === '&'))
      return fail('shell-redirection-not-resolved');
    else if ('|;&\n\r'.includes(char)) {
      const separator = (char === '|' || char === '&') && next === char ? char + next : char;
      if (separator.length === 2) index++;
      segment(separator);
    } else if (/\s/.test(char)) word();
    else if (char === '<' || char === '>') {
      if (char === '<' && (next === '<' || next === '#'))
        return fail('multiline-shell-not-analyzed');
      if ((char === '<' && next === '>') || (char === '>' && next === '|'))
        return fail('shell-redirection-not-resolved');
      if (next === '(') return fail('shell-syntax-not-resolved');
      let fd = char === '<' ? 0 : 1;
      if (!pending && started && unquoted && /^\d+$/.test(token)) {
        fd = Number(token);
        if (!Number.isSafeInteger(fd)) return fail('shell-redirection-not-resolved');
        resetWord();
      } else word();
      if (failure) return fail(failure);
      if (pending) return fail('malformed-shell-redirection');
      if (++redirectCount > COMMAND_REDIRECTIONS) return fail('command-redirection-limit');
      if (++count > COMMAND_TOKENS) return fail('command-token-limit');
      let operator = char;
      if (next === '&' || (char === '>' && next === '>')) {
        operator += next;
        index++;
      }
      pending = { fd, operator };
    } else {
      if ('(){}'.includes(char)) return fail('shell-syntax-not-resolved');
      if ('^\\'.includes(char)) issues.add('shell-syntax-not-resolved');
      if ('*?['.includes(char)) dynamic = true;
      token += char;
      started = true;
    }
    if (failure) return fail(failure);
  }
  if (quote) return fail('unclosed-command-quote');
  segment(null);
  if (failure) return fail(failure);
  return { segments, issues: [...issues] };
}

module.exports = { parseLiteralCommands, COMMAND_CHARS, COMMAND_TOKENS, COMMAND_REDIRECTIONS };
