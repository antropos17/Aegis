import type { FalsePositiveEntry } from '../../../src/shared/types';

/** Validate the complete saved population before accepting it as known state.
 * @param value Saved entries or a rejected/invalid IPC reply
 * @returns Original validated entries, preserving every existing pattern
 * @since 0.19.2
 */
export function falsePositivePopulation(value: unknown): FalsePositiveEntry[] {
  if (
    !Array.isArray(value) ||
    value.some((entry: unknown) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return true;
      const row = entry as Record<string, unknown>;
      return (
        typeof row.agentName !== 'string' ||
        !row.agentName ||
        typeof row.pattern !== 'string' ||
        !row.pattern ||
        typeof row.timestamp !== 'number' ||
        !Number.isFinite(row.timestamp) ||
        row.timestamp <= 0
      );
    })
  )
    throw new Error('Saved false-alarm exceptions could not be read');
  return value as FalsePositiveEntry[];
}
