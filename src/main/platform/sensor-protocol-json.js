/** @file Strict bounded sensor/1 JSON syntax. @since 0.19.2-beta */
'use strict';
const { fail, scalarString } = require('./sensor-protocol-values');

/**
 * Parse one UTF-8 payload, rejecting JSON spellings which lose wire information.
 * Depth counts the root container as one. No peer text is included in errors.
 * @param {Buffer} payload
 * @returns {unknown}
 * @since 0.19.2-beta
 */
function parsePayload(payload) {
  if (payload[0] === 0xef && payload[1] === 0xbb && payload[2] === 0xbf) fail('utf8-invalid');
  let source;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(payload);
  } catch {
    fail('utf8-invalid');
  }
  let offset = 0;
  const bad = () => fail('json-invalid');
  function whitespace() {
    while (offset < source.length && /[\x20\t\r\n]/.test(source[offset])) offset++;
  }
  function string() {
    const start = offset++;
    while (offset < source.length) {
      const char = source[offset++];
      if (char === '"') {
        let result;
        try {
          result = JSON.parse(source.slice(start, offset));
        } catch {
          bad();
        }
        if (!scalarString(result)) bad();
        return result;
      }
      if (char === '\\') offset++;
      else if (char.charCodeAt(0) < 0x20) bad();
    }
    bad();
  }
  function value(depth) {
    whitespace();
    const char = source[offset];
    if (char === '"') return string();
    if (char === '{' || char === '[') {
      if (depth >= 16) bad();
      const isObject = char === '{';
      const result = isObject ? Object.create(null) : [];
      const seen = new Set();
      const close = isObject ? '}' : ']';
      offset++;
      whitespace();
      if (source[offset] === close) {
        offset++;
        return result;
      }
      while (true) {
        whitespace();
        if (isObject) {
          if (source[offset] !== '"') bad();
          const key = string();
          if (seen.has(key)) bad();
          seen.add(key);
          whitespace();
          if (source[offset++] !== ':') bad();
          result[key] = value(depth + 1);
        } else result.push(value(depth + 1));
        whitespace();
        if (source[offset] === close) {
          offset++;
          return result;
        }
        if (source[offset++] !== ',') bad();
      }
    }
    for (const [literal, result] of [
      ['null', null],
      ['true', true],
      ['false', false],
    ]) {
      if (source.startsWith(literal, offset)) {
        offset += literal.length;
        return result;
      }
    }
    const start = offset;
    while (offset < source.length && !/[\x20\t\r\n,}\]]/.test(source[offset])) offset++;
    const token = source.slice(start, offset);
    if (!/^(0|[1-9][0-9]*)$/.test(token)) bad();
    return Number(token);
  }
  const result = value(0);
  whitespace();
  if (offset !== source.length) bad();
  return result;
}

module.exports = { parsePayload };
