'use strict';

const path = require('node:path');
const { createHmac } = require('node:crypto');

const LIMITS = Object.freeze({
  bytes: 512 * 1024,
  lineBytes: 64 * 1024,
  records: 1024,
  calls: 256,
  depth: 12,
  nodes: 2048,
  toleranceMs: 5000,
  skewMs: 60000,
});
/** Recognize a non-array record. @param {*} v Input. @returns {boolean} Record shape. @since v0.19.0 */
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Bound selected identifiers/paths. @param {*} v Input. @returns {boolean} Safe bounded text. @since v0.19.0 */
const text = (v) =>
  typeof v === 'string' && v.length > 0 && v.length <= 4096 && !/\p{Cc}|\p{Cs}/u.test(v);
/** Preserve unknown epoch values. @param {*} v Input. @returns {boolean} Nonnegative safe integer. @since v0.19.0 */
const epoch = (v) => Number.isSafeInteger(v) && v >= 0;
/** Parse a complete source timestamp. @param {*} v ISO timestamp. @returns {number|null} Epoch milliseconds or unknown. @since v0.19.0 */
function timestamp(v) {
  if (
    typeof v !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(v)
  )
    return null;
  const [year, month, day] = v.slice(0, 10).split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.toISOString().slice(0, 10) !== v.slice(0, 10) || Number(v.slice(11, 13)) > 23)
    return null;
  const ms = Date.parse(v);
  return epoch(ms) ? ms : null;
}
function normalizedPath(value, platform, cwd) {
  if (!text(value) || !['win32', 'posix'].includes(platform)) return null;
  const api = platform === 'win32' ? path.win32 : path.posix;
  if (
    platform === 'win32' &&
    (/^[a-z]:(?![\\/])/i.test(value) ||
      /^[\\/]{2}[?.]/.test(value) ||
      /^[\\/](?![\\/])/.test(value))
  )
    return null;
  if (!api.isAbsolute(value)) {
    if (!text(cwd) || !api.isAbsolute(cwd)) return null;
    value = api.join(cwd, value);
  }
  // Lexical normalization only: preserve case, symlink identity and namespaces.
  return api.normalize(value).replace(platform === 'win32' ? /\\/g : /$^/g, '/');
}

function canonical(value) {
  let nodes = 0;
  function visit(v, depth) {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) throw Error('argument-limit');
    if (typeof v === 'number' && !Number.isFinite(v)) throw Error('non-finite-argument');
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map((item) => visit(item, depth + 1)).join(',')}]`;
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${visit(v[k], depth + 1)}`)
      .join(',')}}`;
  }
  return visit(value, 0);
}

/** Create private keyed digests; key ownership and lifetime belong to the caller.
 * @param {Buffer} key At least 32 bytes of private key material.
 * @returns {object} Value helpers which never return raw input.
 * @since v0.19.0 */
function createValues(key) {
  if (!Buffer.isBuffer(key) || key.length < 32 || key.length > 128)
    throw Error('invalid-digest-key');
  const secret = Buffer.from(key);
  const digest = (kind, v) =>
    createHmac('sha256', secret).update(`${kind}\0`).update(v).digest('hex');
  function pathDigest(value, platform, cwd) {
    const normalized = normalizedPath(value, platform, cwd);
    return normalized === null ? null : digest(`path:${platform}`, normalized);
  }
  function objectDigest(kind, value, platform, cwd) {
    if (kind === 'path') return pathDigest(value, platform, cwd);
    if (kind !== 'endpoint' || !text(value)) return null;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      url.hash = '';
      return digest('endpoint', url.href);
    } catch (_) {
      return null;
    }
  }
  function projectArguments(value) {
    try {
      return { argsDigest: digest('args', canonical(value)), reason: null };
    } catch (error) {
      return {
        argsDigest: null,
        reason:
          error.message === 'non-finite-argument' ? 'invalid-tool-arguments' : 'argument-limit',
      };
    }
  }
  return { digest, pathDigest, objectDigest, projectArguments };
}

module.exports = { LIMITS, object, text, epoch, timestamp, createValues };
