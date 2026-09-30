'use strict';
const { createProviderAdapter } = require('./provider-adapter-common');
const PROFILE = Object.freeze({ provider: 'codex', version: 'codex-hook-subset-v1' });
/** Adapt only the selected finite Codex hook subset.
 * @param {object} owner Trusted explicit policy/context. @returns {object} Local adapter. @since v0.17.0 */
function createCodexAdapter(owner) {
  return createProviderAdapter(PROFILE, owner);
}
module.exports = { createCodexAdapter, PROFILE };
