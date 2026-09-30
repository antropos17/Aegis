'use strict';
const { createProviderAdapter } = require('./provider-adapter-common');
const PROFILE = Object.freeze({ provider: 'claude', version: 'claude-hook-subset-v1' });
/** Adapt only the selected finite Claude hook subset.
 * @param {object} owner Trusted explicit policy/context. @returns {object} Local adapter. @since v0.17.0 */
function createClaudeAdapter(owner) {
  return createProviderAdapter(PROFILE, owner);
}
module.exports = { createClaudeAdapter, PROFILE };
