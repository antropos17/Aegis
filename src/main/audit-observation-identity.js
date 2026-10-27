'use strict';

const { types } = require('node:util');
const { createHash } = require('node:crypto');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const FIELDS = ['eventId', 'epoch', 'token'];
const origins = new WeakMap();

/** Admit only a complete, closed observation identity without invoking accessors.
 * @param {unknown} value Optional private audit identity.
 * @returns {object|null} Detached lowercase identifiers, or null when unavailable.
 * @since 0.21.0-beta
 */
function projectAuditIdentity(value) {
  try {
    if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value))
      return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const names = Reflect.ownKeys(value);
    if (names.length !== FIELDS.length || names.some((name) => !FIELDS.includes(name))) return null;
    const projected = {};
    for (const name of FIELDS) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value') ||
        typeof descriptor.value !== 'string' ||
        !UUID.test(descriptor.value)
      )
        return null;
      projected[name] = descriptor.value.toLowerCase();
    }
    return projected;
  } catch {
    return null;
  }
}

/** Read optional identity without invoking getters or proxy traps.
 * @param {unknown} value Audit details.
 * @returns {object|null} Valid identity or null.
 * @since 0.21.0-beta
 */
function readAuditIdentity(value) {
  try {
    if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value))
      return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, 'auditIdentity');
    return descriptor && Object.hasOwn(descriptor, 'value')
      ? projectAuditIdentity(descriptor.value)
      : null;
  } catch {
    return null;
  }
}

/** Record an index-provided row locator without adding any serializable field.
 * @param {object} row Normalized indexed row.
 * @param {unknown} file Canonical audit basename from the index.
 * @param {unknown} lineNo Zero-based physical nonempty-line ordinal.
 * @returns {object} The original row, whether or not a locator was admitted.
 * @since 0.21.0-beta
 */
function rememberAuditOrigin(row, file, lineNo) {
  if (
    row &&
    typeof row === 'object' &&
    !types.isProxy(row) &&
    typeof file === 'string' &&
    /^aegis-audit-\d{4}-\d{2}-\d{2}\.json$/.test(file) &&
    Number.isSafeInteger(lineNo) &&
    lineNo >= 0
  ) {
    origins.set(row, auditOriginFor(file, lineNo));
  }
  return row;
}

/** Compute the same private indexed location key for a canonical source pair.
 * @param {string} file Canonical audit basename.
 * @param {number} lineNo Zero-based nonempty-line ordinal.
 * @returns {string} Opaque origin key.
 * @since 0.21.0-beta
 */
function auditOriginFor(file, lineNo) {
  return createHash('sha256')
    .update(JSON.stringify([file, lineNo]))
    .digest('hex');
}

/** Get the private indexed origin of the same in-process row object.
 * @param {unknown} row Audit row.
 * @returns {string|null} Opaque origin key, or null for fallback/unbound rows.
 * @since 0.21.0-beta
 */
function auditOrigin(row) {
  if (!row || typeof row !== 'object' || types.isProxy(row)) return null;
  return origins.get(row) ?? null;
}

module.exports = {
  projectAuditIdentity,
  readAuditIdentity,
  rememberAuditOrigin,
  auditOrigin,
  auditOriginFor,
};
