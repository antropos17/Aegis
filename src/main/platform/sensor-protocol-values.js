/** @file Pure sensor/1 schema primitives. @since 0.19.2-beta */
'use strict';
const { readRecord, readArray } = require('./sensor-protocol-data');

const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MODES = Object.freeze({
  ebpf: 'linux',
  fanotify: 'linux',
  procfs: 'linux',
  'endpoint-security': 'darwin',
  libproc: 'darwin',
});

class WireError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** @param {string} [code] @returns {never} @since 0.19.2-beta */
function fail(code = 'message-invalid') {
  throw new WireError(code);
}

/** @param {unknown} value @param {string[]} keys @returns {void} @since 0.19.2-beta */
function exact(value, keys) {
  readRecord(value, keys);
}

/** @param {string} value @returns {boolean} @since 0.19.2-beta */
function scalarString(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

/** @param {unknown} value @param {number} limit @returns {string} @since 0.19.2-beta */
function text(value, limit) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\0') ||
    value.length > limit ||
    !scalarString(value) ||
    Buffer.byteLength(value, 'utf8') > limit
  )
    fail();
  return value;
}

/** @param {unknown} value @param {number} min @param {number} max @returns {number} @since 0.19.2-beta */
function integer(value, min, max) {
  if (!Number.isInteger(value) || Object.is(value, -0) || value < min || value > max) fail();
  return value;
}

/** @param {unknown} value @param {boolean} [positive] @returns {string} @since 0.19.2-beta */
function u64(value, positive = true) {
  if (
    typeof value !== 'string' ||
    value.length > 20 ||
    !/^(0|[1-9][0-9]*)$/.test(value) ||
    (positive && value === '0') ||
    BigInt(value) > 18446744073709551615n
  )
    fail();
  return value;
}

/** @param {unknown} value @param {string[]} allowed @returns {string} @since 0.19.2-beta */
function choice(value, allowed) {
  if (!allowed.includes(value)) fail();
  return value;
}

/** @param {unknown} value @param {number} max @param {number} [min] @returns {Array} @since 0.19.2-beta */
function array(value, max, min = 0) {
  return readArray(value, max, min);
}

/** @param {unknown[]} values @returns {void} @since 0.19.2-beta */
function unique(values) {
  if (new Set(values).size !== values.length) fail();
}

/** @param {unknown} options @returns {string} @since 0.19.2-beta */
function direction(options) {
  exact(options, ['direction']);
  return choice(options.direction, ['host-to-sensor', 'sensor-to-host']);
}

module.exports = {
  MAX_FRAME_BYTES,
  MODES,
  WireError,
  fail,
  exact,
  scalarString,
  text,
  integer,
  u64,
  choice,
  array,
  unique,
  direction,
};
