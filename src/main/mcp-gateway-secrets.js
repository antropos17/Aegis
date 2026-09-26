'use strict';
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readActionFile, parseActionJson } = require('./action-policy');

const blocked = () => Error('gateway-content-blocked');
const validString = (value) => typeof value === 'string' && !/[\ud800-\udfff]/u.test(value);

function variantsFor(value) {
  const bytes = Buffer.from(value);
  try {
    const base64 = bytes.toString('base64');
    const url64 = base64.replace(/\+/g, '-').replace(/\//g, '_');
    const hex = bytes.toString('hex');
    const percent = hex.replace(/../g, '%$&');
    const encoded = encodeURIComponent(value);
    return [
      value,
      base64,
      base64.replace(/=+$/, ''),
      url64,
      url64.replace(/=+$/, ''),
      hex,
      hex.toUpperCase(),
      encoded,
      encoded.replace(/%[0-9A-F]{2}/g, (part) => part.toLowerCase()),
      percent,
      percent.toUpperCase(),
    ];
  } finally {
    bytes.fill(0);
  }
}

function readValues(bytes) {
  const policy = parseActionJson(bytes);
  if (
    !policy ||
    Array.isArray(policy) ||
    Object.keys(policy).length !== 2 ||
    policy.schemaVersion !== 1 ||
    !Array.isArray(policy.values) ||
    policy.values.length < 1 ||
    policy.values.length > 32
  )
    throw blocked();
  let size = 0;
  const values = new Set();
  for (const value of policy.values) {
    if (
      !validString(value) ||
      // eslint-disable-next-line no-control-regex -- Explicit secret values exclude control characters.
      /[\x00-\x1f\x7f-\x9f]/u.test(value) ||
      Buffer.byteLength(value) < 8 ||
      Buffer.byteLength(value) > 256 ||
      values.has(value)
    )
      throw blocked();
    size += Buffer.byteLength(value);
    if (size > 4096) throw blocked();
    values.add(value);
  }
  return [...values];
}

function scan(value, variants) {
  let nodes = 0;
  let size = 0;
  const inspect = (text) => {
    if (!validString(text)) throw blocked();
    size += Buffer.byteLength(text);
    if (size > 65536 || variants.some((variant) => text.includes(variant))) throw blocked();
  };
  const visit = (current, depth) => {
    if (++nodes > 2048 || depth > 8) throw blocked();
    if (current === null || typeof current === 'boolean') return;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw blocked();
      return;
    }
    if (typeof current === 'string') return inspect(current);
    if (typeof current !== 'object') throw blocked();
    const array = Array.isArray(current);
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== (array ? Array.prototype : Object.prototype) && prototype !== null)
      throw blocked();
    const keys = Reflect.ownKeys(current);
    if (keys.length > 2048 || (array && keys.length !== current.length + 1)) throw blocked();
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') throw blocked();
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= current.length)) throw blocked();
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw blocked();
      inspect(key);
      visit(descriptor.value, depth + 1);
    }
  };
  visit(value, 0);
  const serialized = JSON.stringify(value);
  if (
    Buffer.byteLength(serialized) > 65536 ||
    variants.some((variant) => serialized.includes(variant))
  )
    throw blocked();
}

/** Capture a bounded operator-selected list of known secrets and encoded representations.
 * This is exact substring filtering, not general secret discovery or arbitrary decoding.
 * @param {string | undefined} policyPath Explicit private policy file; omitted disables filtering.
 * @param {AbortSignal} signal Owning connection lifetime.
 * @returns {Promise<{recheck: function(): Promise<void>, assertSafe: function(unknown): void, close: function(): void}>}
 * Private guard whose errors contain no source data. @since v0.15.1 */
async function captureSecretPolicy(policyPath, signal) {
  if (policyPath === undefined)
    return { recheck: async () => {}, assertSafe: () => {}, close: () => {} };
  let closed = false;
  let digest;
  let variants = [];
  const close = () => {
    closed = true;
    variants.fill('');
    variants.length = 0;
    digest = undefined;
    signal.removeEventListener('abort', close);
  };
  try {
    if (signal.aborted || typeof policyPath !== 'string' || !policyPath) throw blocked();
    const selectedPath = path.resolve(policyPath);
    signal.addEventListener('abort', close, { once: true });
    const recheck = async () => {
      let bytes;
      try {
        if (closed) throw blocked();
        bytes = await readActionFile(selectedPath);
        const hash = createHash('sha256').update(bytes).digest('hex');
        if (closed || (digest && hash !== digest)) throw blocked();
        if (!digest) {
          const values = readValues(bytes);
          try {
            variants = [...new Set(values.flatMap(variantsFor))];
            variants = [
              ...new Set([...variants, ...variants.map((v) => JSON.stringify(v).slice(1, -1))]),
            ];
          } finally {
            values.fill('');
          }
          digest = hash;
        }
      } catch {
        close();
        throw blocked();
      } finally {
        bytes?.fill(0);
      }
    };
    await recheck();
    return {
      recheck,
      close,
      assertSafe(value) {
        try {
          if (closed) throw blocked();
          scan(value, variants);
        } catch {
          throw blocked();
        }
      },
    };
  } catch {
    close();
    throw blocked();
  }
}

module.exports = { captureSecretPolicy };
