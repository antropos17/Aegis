'use strict';

/** Match saved scoring exceptions without changing the observation or its attribution.
 * @param {unknown} event Original file observation
 * @param {unknown} entries Saved patterns, with unchanged regex and agent-label semantics
 * @returns {boolean} Whether this attributed observation matches a saved exception
 * @since 0.19.2
 */
function matchesFalsePositive(event, entries) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || !Array.isArray(entries))
    return false;
  if (
    typeof event.agent !== 'string' ||
    !event.agent ||
    typeof event.file !== 'string' ||
    !event.file ||
    event.attribution === 'unattributed' ||
    event.attribution?.status === 'unattributed'
  )
    return false;
  return entries.some((entry) => {
    if (
      !entry ||
      typeof entry.agentName !== 'string' ||
      entry.agentName !== event.agent ||
      typeof entry.pattern !== 'string' ||
      !entry.pattern ||
      entry.pattern.length > 256
    )
      return false;
    try {
      return new RegExp(entry.pattern).test(event.file);
    } catch {
      return false;
    }
  });
}

module.exports = { matchesFalsePositive };
