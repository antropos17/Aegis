'use strict';

const shape = (v, keys) =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((key) => Object.hasOwn(v, key));
const pid = (v) => Number.isInteger(v) && v > 0 && v <= 0x7fffffff;
const positive = (v) =>
  typeof v === 'string' && /^[1-9]\d{0,18}$/.test(v) && BigInt(v) <= 0x7fffffffffffffffn;

/** Validate a private main-held reservation; never include it in diagnostics or IPC.
 * @param {unknown} value Proposed native custody tuple.
 * @returns {boolean} Whether its four process references have the closed canonical shape.
 * @since v0.19.2
 */
function validMainLease(value) {
  return Boolean(
    shape(value, ['guid', 'ownerPid', 'ownerBirth', 'peers']) &&
    typeof value.guid === 'string' &&
    /^[0-9a-f]{32}$/.test(value.guid) &&
    value.guid !== '0'.repeat(32) &&
    pid(value.ownerPid) &&
    positive(value.ownerBirth) &&
    Array.isArray(value.peers) &&
    value.peers.length === 4 &&
    value.peers.every(
      (peer) =>
        shape(peer, ['pid', 'birth', 'handle']) &&
        pid(peer.pid) &&
        peer.pid !== value.ownerPid &&
        positive(peer.birth) &&
        positive(peer.handle),
    ) &&
    new Set(value.peers.map((peer) => peer.pid)).size === 4 &&
    new Set(value.peers.map((peer) => peer.handle)).size === 4,
  );
}
module.exports = { validMainLease };
