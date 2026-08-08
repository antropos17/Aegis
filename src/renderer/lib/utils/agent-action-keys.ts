/**
 * @file agent-action-keys.ts — Identity keys for AgentActions (ack vs watchlist)
 * @module renderer/utils/agent-action-keys
 * @description Splits two lifetimes that used to share one `agentKey` string:
 *   - acknowledgement: ephemeral, per live process instance (stamped instanceId)
 *   - watchlist: durable, per agent display name (main/blocklist signature)
 *   IDENTITY-RECON §6 step 10 / C4.
 * @since 0.10.0
 */

/**
 * Canonical key for session-local acknowledgement. Read, never derive.
 * @param agent - Live agent object from the card
 * @returns Stamped instanceId, or null when missing (ack action is a no-op)
 */
export function acknowledgementInstanceId(
  agent: { readonly instanceId?: string | null } | null | undefined,
): string | null {
  if (!agent) return null;
  const id = agent.instanceId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Durable watchlist signature — display name only (matches main/blocklist design:
 * any-PID signature entry when pid is null). Never an instanceId (per-boot) and
 * never a bare pid (recyclable).
 * @param agent - Live agent object from the card
 * @returns Signature string, or null when no display name is available
 */
export function watchlistSignature(
  agent: { readonly name?: string; readonly agent?: string } | null | undefined,
): string | null {
  if (!agent) return null;
  const name = agent.name || agent.agent;
  return typeof name === 'string' && name.length > 0 ? name : null;
}
