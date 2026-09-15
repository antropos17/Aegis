'use strict';
/** Bounded diagnostic duration; production scheduling is unchanged.
 * @param {string|undefined} value - Optional duration in seconds.
 * @returns {{durationMs: number, watchdogMs: number, sampleMs: number}}
 * @since 0.15.0
 */
function limits(value) {
  const seconds = value === undefined ? 180 : Number(value);
  if (!Number.isInteger(seconds) || seconds < 180 || seconds > 7200)
    throw new Error('Diagnostic duration must be 180..7200 seconds');
  return {
    durationMs: seconds * 1000,
    watchdogMs: seconds * 1000 + 30000,
    sampleMs: seconds > 180 ? 5000 : 1000,
  };
}
module.exports = { limits };
