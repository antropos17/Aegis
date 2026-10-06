import type { FalsePositiveEntry } from '../../../src/shared/types';
import { matchesFalsePositive } from '../../../src/shared/false-positive-match.js';
import type { Telemetry } from './host';
import type { SensitiveAlert } from './sensitive-alerts';

/** Hold only bounded transient candidates until saved preferences have a known read outcome.
 * @param capacity Maximum pending candidates, aligned with the retained review capacity
 * @returns Presentation-only delivery gate; retained tracker ingestion remains independent
 * @since 0.19.2
 */
export function createSensitivePresentation(capacity = 100): {
  ingest: (
    fresh: readonly SensitiveAlert[],
    retained: readonly SensitiveAlert[],
    state: Telemetry['falsePositiveReadState'],
    patterns: readonly FalsePositiveEntry[],
  ) => SensitiveAlert[];
} {
  let pending: SensitiveAlert[] = [];
  return {
    ingest(fresh, retained, state, patterns): SensitiveAlert[] {
      const retainedIds = new Set(retained.map((item) => item.id));
      const candidates = [...pending, ...fresh]
        .filter((item) => retainedIds.has(item.id))
        .slice(-capacity);
      pending = state === 'pending' ? candidates : [];
      return state === 'pending'
        ? []
        : candidates.filter((item) => !matchesFalsePositive(item.event, patterns));
    },
  };
}
