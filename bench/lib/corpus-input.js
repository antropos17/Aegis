'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const LIMITS = Object.freeze({
  runs: 24,
  artifactBytes: 65536,
  totalBytes: 4194304,
  outputBytes: 262144,
  steps: 64,
  events: 64,
  depth: 16,
  nodes: 12000,
  string: 8192,
});
/** @returns {never} Fixed private-input refusal. @since unreleased */
function invalid() {
  throw new Error('corpus-input-invalid');
}
/** @param {Buffer} bytes Exact input. @returns {string} SHA-256. @since unreleased */
function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
/** @param {string} dir Existing local directory. @returns {string} Checked absolute path. @since unreleased */
function ordinaryDirectory(dir) {
  if (
    typeof dir !== 'string' ||
    !dir ||
    dir.length > 1024 ||
    dir.includes('\0') ||
    /^[/\\]{2}/.test(dir)
  )
    invalid();
  const resolved = path.resolve(dir),
    root = path.parse(resolved).root;
  let current = root;
  for (const part of resolved.slice(root.length).split(path.sep)) {
    if (part.includes(':')) invalid();
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) invalid();
  }
  return resolved;
}
/** @param {Buffer} bytes Bounded UTF-8 JSON. @returns {object} Unique-key JSON data. @since unreleased */
function parse(bytes) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length > LIMITS.artifactBytes) invalid();
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
          if (value.length > LIMITS.string) invalid();
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
      if (typeof result === 'number' && !Number.isFinite(result)) invalid();
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
 * Read one explicit ordinary artifact through a bounded stable descriptor, including close confirmation.
 * @param {string} file Known artifact filename.
 * @param {object} budget Whole-batch consumed byte count.
 * @param {boolean} [optional] Missing file may yield null.
 * @returns {Buffer|null} Exact input bytes.
 * @since unreleased
 */
function read(file, budget, optional = false) {
  let named;
  try {
    named = fs.lstatSync(file, { bigint: true });
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    invalid();
  }
  if (
    !named.isFile() ||
    named.isSymbolicLink() ||
    named.nlink !== 1n ||
    named.size > BigInt(LIMITS.artifactBytes) ||
    budget.bytes + Number(named.size) > LIMITS.totalBytes
  )
    invalid();
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const before = fs.fstatSync(fd, { bigint: true }),
      fields = ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink'];
    if (
      !before.isFile() ||
      before.ino <= 0n ||
      fields.some((key) => typeof before[key] !== 'bigint' || before[key] !== named[key])
    )
      invalid();
    const bytes = Buffer.alloc(LIMITS.artifactBytes + 1);
    let used = 0,
      count;
    do {
      count = fs.readSync(fd, bytes, used, bytes.length - used, used);
      if (!Number.isSafeInteger(count) || count < 0 || count > bytes.length - used) invalid();
      used += count;
    } while (count && used < bytes.length);
    const after = fs.fstatSync(fd, { bigint: true }),
      final = fs.lstatSync(file, { bigint: true });
    if (
      used > LIMITS.artifactBytes ||
      BigInt(used) !== before.size ||
      final.isSymbolicLink() ||
      fields.some((key) => before[key] !== after[key] || before[key] !== final[key])
    )
      invalid();
    budget.bytes += used;
    if (budget.bytes > LIMITS.totalBytes) invalid();
    return bytes.subarray(0, used);
  } finally {
    fs.closeSync(fd);
  }
}
module.exports = { LIMITS, invalid, digest, ordinaryDirectory, parse, read };
