/**
 * Durable settings key for agent workspace context (permissions).
 * Not runtime instanceId; not watchlist signature.
 * @see src/shared/instance-key.js
 */
export function buildInstanceKey(
  agentName: string,
  parentEditor?: string | null,
  cwd?: string | null,
): string;
