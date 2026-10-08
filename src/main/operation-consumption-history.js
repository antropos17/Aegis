'use strict';

/** Retain this live ledger's successful consumed IDs without granting authority.
 * No entry is evicted. A full history refuses new attempts until owner recovery;
 * a fresh owner cannot infer erased disk history from this ordinary-account memory.
 * @param {number} maximum Existing ledger entry ceiling.
 * @returns {{check: function, remember: function, has: function}} Private bounded history.
 * @since v0.19.2 */
function createConsumptionHistory(maximum) {
  const consumed = new Set();
  const check = (name) => {
    if (consumed.has(name) || consumed.size >= maximum) throw Error('operation-ledger-unavailable');
  };
  return Object.freeze({
    check,
    remember(name) {
      check(name);
      consumed.add(name);
    },
    has: (name) => consumed.has(name),
  });
}

module.exports = { createConsumptionHistory };
