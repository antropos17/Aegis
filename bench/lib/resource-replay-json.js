'use strict';
const { createHash } = require('node:crypto');
/** @returns {never} Fixed refusal. @since unreleased */
const fail = () => {
  throw Error('resource-replay-refused');
};
/** @param {Buffer} bytes Exact bytes. @returns {string} SHA-256. @since unreleased */
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** @param {unknown} v Candidate. @returns {boolean} Safe ID. @since unreleased */
const id = (v) => typeof v === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(v);
/** @param {unknown} v Candidate. @returns {boolean} SHA-256 shape. @since unreleased */
const sha = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
/** @param {unknown} v Candidate. @param {number} [min] Lower. @param {number} [max] Upper. @returns {boolean} Safe integer. @since unreleased */
const integer = (v, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(v) && v >= min && v <= max;
/** @param {object} v JSON object. @param {string|string[]} keys Closed keys. @returns {void} @since unreleased */
function exact(v, keys) {
  if (typeof keys === 'string') keys = keys.split(' ');
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(v, k))
  )
    fail();
}
/** @param {unknown} a JSON. @param {unknown} b JSON. @returns {boolean} Entire structural equality. @since unreleased */
function equal(a, b) {
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const ak = Object.keys(a).sort(),
    bk = Object.keys(b).sort();
  return ak.length === bk.length && ak.every((key, i) => key === bk[i] && equal(a[key], b[key]));
}
/** @param {object} v JSON. @param {object} expected Fixed contract. @returns {void} @since unreleased */
function fixed(v, expected) {
  exact(v, Object.keys(expected));
  if (!equal(v, expected)) fail();
}
/** Parse bounded strict UTF-8 JSON with unique keys before accumulation. @param {Buffer} bytes Bounded input. @returns {object} Ordinary JSON data. @since unreleased */
function parse(bytes) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length > 524289) fail();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    let pos = 0,
      nodes = 0;
    const space = () => {
      while (/[\x20\t\r\n]/.test(text[pos] || '!')) pos++;
    };
    function string() {
      const start = pos++;
      while (pos < text.length) {
        const ch = text[pos++];
        if (ch === '\\') pos++;
        else if (ch === '"') {
          const result = JSON.parse(text.slice(start, pos));
          if (result.length > 4096) fail();
          return result;
        }
      }
      fail();
    }
    function value(depth) {
      if (++nodes > 50000 || depth > 24) fail();
      space();
      if (text[pos] === '"') return string();
      if (text[pos] === '{' || text[pos] === '[') {
        const object = text[pos++] === '{',
          out = object ? Object.create(null) : [],
          end = object ? '}' : ']';
        let count = 0;
        space();
        if (text[pos] === end) {
          pos++;
          return out;
        }
        while (pos < text.length) {
          if (++count > 1024) fail();
          let key;
          if (object) {
            if (text[pos] !== '"') fail();
            key = string();
            space();
            if (Object.hasOwn(out, key) || text[pos++] !== ':') fail();
          }
          const item = value(depth + 1);
          if (object) out[key] = item;
          else out.push(item);
          space();
          if (text[pos] === end) {
            pos++;
            return out;
          }
          if (text[pos++] !== ',') fail();
          space();
        }
        fail();
      }
      const token = /^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        text.slice(pos),
      )?.[0];
      if (!token) fail();
      pos += token.length;
      const result = JSON.parse(token);
      if (typeof result === 'number' && !Number.isFinite(result)) fail();
      return result;
    }
    const result = value(0);
    space();
    if (pos !== text.length) fail();
    return result;
  } catch {
    fail();
  }
}
module.exports = { fail, hash, id, sha, integer, exact, equal, fixed, parse };
