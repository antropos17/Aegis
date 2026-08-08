/**
 * @file agent-selection.ts — Live agent selection / focus identity helpers
 * @module renderer/utils/agent-selection
 * @description Canonical selection identity is the stamped `instanceId` from
 *   scan-batch — never a pid, name, or renderer-derived key (IDENTITY-RECON §6 step 8).
 * @since 0.10.0
 */

/**
 * Read a stamped process-instance key for selection. Never derives one.
 * Empty string is treated as missing (same as null/undefined).
 * @param agent - Live agent or focus source carrying optional instanceId
 * @returns The stamped id, or null when absent
 */
export function readSelectionInstanceId(
  agent: { readonly instanceId?: string | null } | null | undefined,
): string | null {
  if (!agent) return null;
  const id = agent.instanceId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Whether `agent` is the currently selected live instance.
 * Requires a non-null selection and a matching stamped id — never pid equality.
 * @param selectedInstanceId - Current selection store value
 * @param agent - Candidate live agent
 * @returns true only on exact instanceId match
 */
export function isAgentSelected(
  selectedInstanceId: string | null,
  agent: { readonly instanceId?: string | null },
): boolean {
  const id = readSelectionInstanceId(agent);
  return selectedInstanceId !== null && id !== null && selectedInstanceId === id;
}

/**
 * Resolve the live agent record for a selection. PID reuse cannot rebind: a
 * stale selected id that no longer appears in the batch returns null.
 * @param agents - Current live agent list
 * @param selectedInstanceId - Selection store value
 * @returns Matching agent or null
 */
export function resolveSelectedAgent<T extends { readonly instanceId?: string | null }>(
  agents: readonly T[],
  selectedInstanceId: string | null,
): T | null {
  if (selectedInstanceId === null) return null;
  for (const a of agents) {
    if (a.instanceId === selectedInstanceId) return a;
  }
  return null;
}

/**
 * Toggle card expansion selection. A keyless agent cannot be selected — the
 * previous selection is left unchanged (no pid/name fallback).
 * @param selectedInstanceId - Current selection
 * @param agent - Card agent being toggled
 * @returns Next selection value
 */
export function toggleInstanceSelection(
  selectedInstanceId: string | null,
  agent: { readonly instanceId?: string | null },
): string | null {
  const id = readSelectionInstanceId(agent);
  if (id === null) return selectedInstanceId;
  return selectedInstanceId === id ? null : id;
}

/**
 * Focus/highlight target from a stats row, timeline dot, or similar source.
 * Returns null when the source has no stamped instanceId — caller must not
 * fall back to pid.
 * @param source - Object that may carry instanceId
 * @returns Focus store value to set, or null to skip
 */
export function focusInstanceId(
  source: { readonly instanceId?: string | null } | null | undefined,
): string | null {
  return readSelectionInstanceId(source);
}
