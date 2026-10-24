'use strict';

/** Create the closed live consumer for runtime-owned, verified native reads.
 * The producer's one-use takeAdmission method is the authority boundary; a raw
 * JSON observation or display capsule is never itself operational authority.
 * @param {Object} deps Producer admission and existing operational consumers.
 * @returns {Object} Synchronous offer and bounded diagnostic counters.
 * @since v0.20.1
 */
function createNativeFileIngress(deps) {
  for (const key of [
    'takeAdmission',
    'isReady',
    'classifySensitive',
    'isSelfAccess',
    'acceptAudit',
    'dedupLive',
    'recordActivity',
    'recordBaseline',
    'publishLive',
  ])
    if (typeof deps?.[key] !== 'function') throw new Error('Invalid native file ingress');
  let rejected = 0;
  return Object.freeze({
    offer() {
      rejected++;
      return false;
    },
    getStats() {
      return { accepted: 0, live: 0, coalesced: 0, rejected };
    },
  });
}

module.exports = { createNativeFileIngress };
