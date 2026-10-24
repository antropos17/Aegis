// @ts-check
'use strict';

/** @typedef {{ok: boolean, code: string, presence: string}} Status */
const MAX_LIFETIME_MS = 300000;
const WRITER_CODES = new Set([
  'IDLE',
  'REVIEW_REQUIRED',
  'INVALID_CAPABILITY',
  'BUSY',
  'RETAINED_UNKNOWN',
  'OWNED_INSTALL_EXISTS',
  'TARGET_READ_FAILED',
  'PLAN_REFUSED',
  'CONFIGURED_UNOWNED',
  'NO_OWNED_INSTALL',
  'BACKUP_TAMPERED',
  'BACKUP_FAILED',
  'TARGET_IDENTITY_CHANGED',
  'OWNED_ENTRY_REFUSED',
  'INVALID_APPROVAL',
  'RETENTION_LIMIT',
  'TARGET_CHANGED',
  'WRITE_UNCERTAIN',
  'READBACK_FAILED',
  'INSTALLED',
  'REMOVED',
]);
/**
 * Construct a frozen sanitized projection.
 * @param {boolean} ok Success.
 * @param {string} code Fixed code.
 * @param {string} [presence] Bounded presence.
 * @returns {Status} No private data.
 * @since v0.19.3
 */
const status = (ok, code, presence = 'Unknown') => Object.freeze({ ok, code, presence });
/**
 * Snapshot plain own data fields without evaluating accessors.
 * @param {unknown} value Plain record.
 * @param {string[]} required Required fields.
 * @param {string[]} [optional] Optional fields.
 * @returns {Record<string, any>} Own values, or throws without diagnostics.
 * @since v0.19.3
 */
function fields(value, required, optional = []) {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw Error();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    required.some((key) => !Object.hasOwn(descriptors, key)) ||
    Reflect.ownKeys(descriptors).some(
      (key) =>
        typeof key !== 'string' ||
        ![...required, ...optional].includes(key) ||
        !Object.hasOwn(descriptors[key], 'value'),
    )
  )
    throw Error();
  return Object.fromEntries(Object.entries(descriptors).map(([key, item]) => [key, item.value]));
}
/**
 * Project only results from the internally constructed real writer.
 * @param {Status} result Trusted writer result.
 * @returns {Status} Fixed sanitized fields.
 * @since v0.19.3
 */
const projected = (result) =>
  WRITER_CODES.has(result.code)
    ? status(
        result.ok === true,
        result.code,
        result.presence === 'Configured' ? 'Configured' : 'Unknown',
      )
    : status(false, 'OPERATION_FAILED');
/**
 * Snapshot constructor fields and bind trusted IO methods to their provider.
 * @param {unknown} options Explicit private capabilities.
 * @returns {Record<string, any>} Snapshot or throws without diagnostics.
 * @since v0.19.3
 */
function readOptions(options) {
  const input = fields(options, ['owner', 'configPath', 'io', 'lifetimeMs'], ['now']);
  if (
    !input.owner ||
    typeof input.owner !== 'object' ||
    !Number.isInteger(input.lifetimeMs) ||
    input.lifetimeMs < 1 ||
    input.lifetimeMs > MAX_LIFETIME_MS ||
    (Object.hasOwn(input, 'now') && typeof input.now !== 'function')
  )
    throw Error();
  const provider = input.io;
  const io = fields(
    provider,
    ['contract', 'readTarget', 'retainPrivate', 'readPrivate', 'compareAndWrite'],
    ['close', 'status'],
  );
  for (const method of ['readTarget', 'retainPrivate', 'readPrivate', 'compareAndWrite']) {
    if (typeof io[method] !== 'function') throw Error();
    io[method] = io[method].bind(provider);
  }
  input.io = Object.freeze(io);
  return input;
}

module.exports = { MAX_LIFETIME_MS, fields, status, projected, readOptions };
