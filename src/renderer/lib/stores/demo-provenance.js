/**
 * @file Provenance marker for browser-only demo payloads.
 *
 * Deliberately separate from `demo-data.js`. The marker and its predicate are the only
 * part of the demo surface that must survive into a production build — `demoDataActive`
 * (stores/ipc.ts) reads every payload through {@link isDemoPayload}, so the check has to
 * exist even in a bundle that carries no scenario engine. Everything that FABRICATES
 * data (`demo-data.js`, `demo-pools.js`, `demo-analysis.js`) stays behind the build-time
 * flag and is dropped from the default build; keeping the predicate here is what lets
 * that boundary hold without pulling the pools in behind it.
 */

/**
 * Key stamped onto every payload the demo engine writes into a store.
 *
 * The renderer previously told demo from real only by `isDemoMode` (stores/ipc.ts) —
 * a build-time constant sitting BESIDE the data, never on it. A fabricated agent
 * record and a scanned one were byte-identical in shape, so no consumer and no test
 * could establish provenance from a payload alone. This key closes that: the claim
 * "this is simulated" now travels with the value it describes.
 *
 * Not stamped on the anomalies payload — that store is a bare `Record<agentName,
 * number>` (see ipc.ts `anomalies`), so a marker key would be indistinguishable from
 * an agent literally named `_demo`. Anomalies are only ever written alongside a
 * marked `stats` object, which is what {@link isDemoPayload} is read from instead.
 */
export const DEMO_MARK = '_demo';

/**
 * True when a payload carries the demo provenance marker.
 *
 * Deliberately strict on `=== true`: a payload that merely HAS the key (a truthy
 * string, a stray `0`) is not a claim the demo engine made, and treating it as one
 * would let unrelated data raise the demo indicator.
 * @param {unknown} payload - Any store value: an agent record, a file event, a
 *   network connection, or the stats object.
 * @returns {boolean}
 */
export function isDemoPayload(payload) {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    /** @type {Record<string, unknown>} */ (payload)[DEMO_MARK] === true
  );
}
