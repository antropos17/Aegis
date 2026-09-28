/** Qualification-only metadata. These identifiers are never host authorization. */
export const HEX32 = /^[a-f0-9]{32}$/;
export const HEX64 = /^[a-f0-9]{64}$/;
export const GUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** @param {unknown} condition @returns {void} @since v0.17.0 */
export function requireVm(condition) {
  if (!condition) throw new Error('vm-fixture-invalid');
}

/** @param {object} value @param {string[]} expected @returns {void} @since v0.17.0 */
export function exactKeys(value, expected) {
  requireVm(value && Object.getPrototypeOf(value) === Object.prototype);
  requireVm(Object.keys(value).length === expected.length);
  requireVm(expected.every((key) => Object.hasOwn(value, key)));
}

/** @param {object} value @returns {Readonly<object>} @since v0.17.0 */
export function binding(value) {
  exactKeys(value, ['sessionId', 'vmId', 'epoch']);
  requireVm(
    typeof value.sessionId === 'string' &&
      typeof value.vmId === 'string' &&
      typeof value.epoch === 'string',
  );
  requireVm(HEX32.test(value.sessionId) && GUID.test(value.vmId) && HEX32.test(value.epoch));
  return Object.freeze({ sessionId: value.sessionId, vmId: value.vmId, epoch: value.epoch });
}
