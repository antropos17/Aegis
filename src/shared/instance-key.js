/**
 * @file instance-key.js — Durable settings key for agent workspace context
 * @module shared/instance-key
 * @description Single definition of `instanceKey` for permissions / settings.json.
 *
 *   **Not** runtime process identity. That is `instanceId` (`pid:startTime` etc.)
 *   from main/process-identity.js — per-boot, must never be written to settings.
 *
 *   **Not** watchlist identity. Watchlist uses the display name / signature
 *   (any-PID) so it can survive restarts by design (IDENTITY-RECON C4).
 *
 *   **instanceKey** answers "whose *saved permissions* are these?" across launches:
 *   name + optional cwd (most specific) or parentEditor, then bare name.
 *   Two concurrent processes with the same name and null cwd intentionally share
 *   one durable key — that is a permissions-scoping choice, not a process id.
 *
 * @see IDENTITY-RECON.md §6 step 6
 * @since 0.10.0
 */

'use strict';

/**
 * Build the durable permission key for an agent workspace context.
 *
 * Priority (most specific wins when building a save key):
 * 1. `name::cwd` when cwd is a non-empty string
 * 2. `name::parentEditor` when parentEditor is a non-empty string
 * 3. bare `name`
 *
 * Truthiness matches the historical dual implementations in config-manager.js
 * and risk.ts: empty string and null both mean "absent".
 *
 * @param {string} agentName - Display name of the agent (not an instanceId)
 * @param {string|null|undefined} [parentEditor] - Host editor label when known
 * @param {string|null|undefined} [cwd] - Working directory when known
 * @returns {string} Key for settings.agentPermissions
 * @since 0.10.0
 */
function buildInstanceKey(agentName, parentEditor, cwd) {
  const name = typeof agentName === 'string' ? agentName : '';
  if (cwd) return `${name}::${cwd}`;
  if (parentEditor) return `${name}::${parentEditor}`;
  return name;
}

module.exports = {
  buildInstanceKey,
};
