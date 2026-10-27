'use strict';

const { types } = require('node:util');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const FIELDS = ['eventId', 'epoch', 'token'];

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

module.exports = { projectAuditIdentity, readAuditIdentity };
