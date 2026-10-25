'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { LIMITS } = require('./reproducibility');
const invalid = () => {
  throw new Error('reproducibility-input-invalid');
};

/**
 * Parse bounded strict UTF-8 JSON with unique keys and canonical numeric tokens.
 * @param {Buffer} bytes Input bytes.
 * @returns {object} Parsed declarations.
 * @since v0.11.0
 */
function parseInput(bytes) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length > LIMITS.bytes) invalid();
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
          const value = JSON.parse(text.slice(start, pos));
          if (value.length > 1024) invalid();
          return value;
        }
      }
      invalid();
    }
    function value(depth) {
      if (++nodes > LIMITS.nodes || depth > LIMITS.depth) invalid();
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
          if (++count > 1024) invalid();
          let key;
          if (object) {
            if (text[pos] !== '"') invalid();
            key = string();
            space();
            if (Object.hasOwn(out, key) || text[pos++] !== ':') invalid();
          }
          const item = value(depth + 1);
          if (object) out[key] = item;
          else out.push(item);
          space();
          if (text[pos] === end) {
            pos++;
            return out;
          }
          if (text[pos++] !== ',') invalid();
          space();
        }
        invalid();
      }
      const token = /^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        text.slice(pos),
      )?.[0];
      if (!token) invalid();
      pos += token.length;
      const result = JSON.parse(token);
      if (
        typeof result === 'number' &&
        (!Number.isFinite(result) || JSON.stringify(result) !== token)
      )
        invalid();
      return result;
    }
    const result = value(0);
    space();
    if (pos !== text.length) invalid();
    return result;
  } catch {
    invalid();
  }
}

/**
 * Resolve an ordinary local file path through ordinary, existing parent directories.
 * @param {string} file Task-owned filename.
 * @param {boolean} output Require final file to be absent.
 * @returns {string} Resolved path.
 * @since v0.11.0
 */
function ordinaryPath(file, output) {
  if (
    typeof file !== 'string' ||
    !file ||
    file.length > 1024 ||
    file.includes('\0') ||
    /^[/\\]{2}/.test(file)
  )
    invalid();
  const resolved = path.resolve(file),
    root = path.parse(resolved).root;
  let current = root;
  const parts = resolved.slice(root.length).split(path.sep);
  for (let index = 0; index < parts.length; index++) {
    if (parts[index].includes(':')) invalid();
    current = path.join(current, parts[index]);
    const last = index === parts.length - 1;
    if (last && output) {
      try {
        fs.lstatSync(current);
      } catch (error) {
        if (error.code === 'ENOENT') return resolved;
        throw error;
      }
      invalid();
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (last ? !stat.isFile() || stat.nlink !== 1 : !stat.isDirectory()))
      invalid();
  }
  return resolved;
}

/**
 * Read a bounded stable ordinary file, refusing observed replacement or growth.
 * @param {string} file Already checked input path.
 * @returns {Buffer} Exact bytes.
 * @since v0.11.0
 */
function readStable(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(LIMITS.bytes)) invalid();
    const bytes = Buffer.alloc(LIMITS.bytes + 1);
    let used = 0,
      read;
    do {
      read = fs.readSync(fd, bytes, used, bytes.length - used, null);
      used += read;
    } while (read && used < bytes.length);
    const after = fs.fstatSync(fd, { bigint: true }),
      named = fs.lstatSync(file, { bigint: true });
    if (
      used > LIMITS.bytes ||
      BigInt(used) !== before.size ||
      named.isSymbolicLink() ||
      ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink'].some(
        (key) => before[key] !== after[key] || before[key] !== named[key],
      )
    )
      invalid();
    return bytes.subarray(0, used);
  } finally {
    fs.closeSync(fd);
  }
}
module.exports = { parseInput, ordinaryPath, readStable };
