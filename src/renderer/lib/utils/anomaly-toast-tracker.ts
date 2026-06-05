/**
 * anomaly-toast-tracker.ts — Seed-then-diff tracker for anomaly toasts
 *
 * Pure, no DOM dependency. Used by App.svelte to decide which anomaly scores
 * are *newly* over-threshold and therefore warrant a toast.
 *
 * The first NON-EMPTY scores object SEEDS the known set and returns no keys, so
 * anomalies already present when scores first arrive never trigger a toast storm
 * (fixes C-12). Every later call diffs against the previous set and returns only
 * the keys that have just crossed the threshold.
 *
 * Empty / null / non-object emissions are ignored entirely: they neither consume
 * the seed nor wipe the known set. This matters because the `anomalies` store is
 * `writable({})` — it emits `{}` at mount, before any scan batch lands. If `{}`
 * consumed the seed, the first populated batch would arrive already-"initialized"
 * and storm; if `{}` wiped the set, a transient empty emission would re-toast
 * everything on the next batch.
 *
 * @module anomaly-toast-tracker
 * @since v0.10.0-alpha
 */

// ═══ TYPES ═══

/** Map of agent name → anomaly score, as emitted by the `anomalies` store. */
export type AnomalyScores = Record<string, unknown> | null | undefined;

/** Stateful tracker returned by {@link createAnomalyToastTracker}. */
export interface AnomalyToastTracker {
  /**
   * Fold a new batch of anomaly scores into the tracker.
   *
   * @param scores - Latest anomaly scores (tolerates null/undefined/non-object
   *   and empty `{}`, all treated as no-ops).
   * @returns Agent names that are over threshold AND were not over threshold on
   *   the previous non-empty call. Always `[]` for the first non-empty object
   *   (seed) and for empty/invalid emissions.
   */
  ingest(scores: AnomalyScores): string[];
}

// ═══ PUBLIC API ═══

/**
 * Create a seed-then-diff anomaly-toast tracker.
 *
 * @param threshold - Minimum score (inclusive) for an agent to count as an
 *   anomaly. Defaults to `50`, matching the gate in App.svelte.
 * @returns A tracker whose `ingest` returns only freshly-anomalous agent names.
 */
export function createAnomalyToastTracker(threshold = 50): AnomalyToastTracker {
  let prevKeys = new Set<string>();
  let initialized = false;

  return {
    ingest(scores: AnomalyScores): string[] {
      // Ignore empty/null/invalid emissions: do not seed, do not wipe state.
      if (!scores || typeof scores !== 'object') return [];
      const entries = Object.entries(scores);
      if (entries.length === 0) return [];

      const currentKeys = new Set<string>();
      const fresh: string[] = [];

      for (const [agent, score] of entries) {
        if (typeof score === 'number' && score >= threshold) {
          currentKeys.add(agent);
          // On the seed (first non-empty) call, `initialized` is false → nothing
          // is reported, so anomalies present when scores first arrive do not
          // produce a toast storm.
          if (initialized && !prevKeys.has(agent)) {
            fresh.push(agent);
          }
        }
      }

      prevKeys = currentKeys;
      initialized = true;
      return fresh;
    },
  };
}
