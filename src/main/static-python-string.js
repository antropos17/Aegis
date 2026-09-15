'use strict';

const { COMMAND_CHARS } = require('./static-command-parser');
const ESCAPES = Object.freeze({
  '\\': '\\',
  "'": "'",
  '"': '"',
  a: '\x07',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
});

/** Decode a bounded plain/raw Python string, excluding bytes and formatted strings. @param {string} raw @returns {object} String value or a fixed coverage issue. @since v0.15.1 */
function readPythonString(raw) {
  const match = /^([ru]?)("""|'''|"|')/i.exec(raw);
  const invalid = { issue: 'python-string-not-resolved' };
  if (!match || !raw.endsWith(match[2]) || raw.length < match[0].length + match[2].length)
    return invalid;
  const body = raw.slice(match[0].length, -match[2].length).replace(/\r\n?/g, '\n');
  if (match[1].toLowerCase() === 'r')
    return body.length <= COMMAND_CHARS ? { value: body } : { issue: 'python-value-limit' };
  let value = '';
  for (let i = 0; i < body.length; i++) {
    let next = body[i];
    if (next === '\\') {
      const escape = body[++i];
      if (escape === '\n') continue;
      if (Object.hasOwn(ESCAPES, escape)) next = ESCAPES[escape];
      else if (['x', 'u', 'U'].includes(escape)) {
        const length = { x: 2, u: 4, U: 8 }[escape];
        const digits = body.slice(i + 1, i + 1 + length);
        if (digits.length !== length || !/^[\da-f]+$/i.test(digits)) return invalid;
        const code = Number.parseInt(digits, 16);
        if (code > 0x10ffff) return invalid;
        next = String.fromCodePoint(code);
        i += length;
      } else if (escape && /[0-7]/.test(escape)) {
        const digits = /^[0-7]{1,3}/.exec(body.slice(i))[0];
        next = String.fromCodePoint(Number.parseInt(digits, 8));
        i += digits.length - 1;
      } else return invalid;
    }
    value += next;
    if (value.length > COMMAND_CHARS) return { issue: 'python-value-limit' };
  }
  return { value };
}

module.exports = { readPythonString };
