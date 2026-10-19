/** @file Own-data-only admission for sensor wire and identity APIs. @since 0.19.2-beta */
'use strict';
const { isProxy } = require('node:util').types;

function bad() {
  throw new TypeError('sensor-data-invalid');
}
function record(value) {
  if (value === null || typeof value !== 'object' || isProxy(value)) bad();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) bad();
}

/**
 * Copy approved own data properties without invoking accessors. Carrying identity
 * rows may ignore unrelated metadata; closed records inspect every own key.
 * @param {object} value
 * @param {string[]} keys
 * @param {{closed?: boolean, optional?: string[]}} [options]
 * @returns {object}
 * @since 0.19.2-beta
 */
function readRecord(value, keys, { closed = true, optional = [] } = {}) {
  record(value);
  if (closed) {
    const allowed = new Set(keys);
    if (Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !allowed.has(key))) bad();
  }
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) {
      if (optional.includes(key)) continue;
      bad();
    }
    if (!Object.hasOwn(descriptor, 'value')) bad();
    result[key] = descriptor.value;
  }
  return result;
}

/**
 * Copy dense standard arrays using own descriptors and numeric assignment.
 * Instance map/iterator/toJSON methods are never executed.
 * @param {Array} value
 * @param {number} max
 * @param {number} [min]
 * @returns {Array}
 * @since 0.19.2-beta
 */
function readArray(value, max, min = 0) {
  if (value === null || typeof value !== 'object' || isProxy(value)) bad();
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) bad();
  const length = Object.getOwnPropertyDescriptor(value, 'length').value;
  if (length < min || length > max || Reflect.ownKeys(value).length !== length + 1) bad();
  const result = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) bad();
    result[index] = descriptor.value;
  }
  return result;
}

/**
 * Snapshot a direct JS message into trusted records/arrays before schema reads.
 * The same finite container depth and collection ceiling bound decoded messages.
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {unknown}
 * @since 0.19.2-beta
 */
function snapshotData(value, depth = 0) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (typeof value !== 'object' || isProxy(value) || depth >= 16) bad();
  if (Array.isArray(value)) {
    const result = readArray(value, 4096);
    for (let index = 0; index < result.length; index++)
      result[index] = snapshotData(result[index], depth + 1);
    return result;
  }
  record(value);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) bad();
  const result = readRecord(value, keys);
  for (const key of keys) result[key] = snapshotData(result[key], depth + 1);
  return result;
}

module.exports = { readRecord, readArray, snapshotData };
