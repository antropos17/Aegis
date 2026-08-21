/**
 * @file app-health.ts — the app-health block of the stats payload, narrowed for the UI
 * @module renderer/stores/app-health
 * @description The renderer's ONLY reader of `stats.appHealth`. It answers one
 *   question — which sensors are degraded and which have failed — and it answers it
 *   from `appHealth.sensors.effective`, the id lists the main process publishes for
 *   exactly this purpose.
 *
 *   `appHealth.reasons` is NOT a source of sensor names and must never be parsed for
 *   them. It is the aggregate-level explanation, a closed set of reason CODES
 *   (`sensor-degraded`, `population-failed`, …) that says a sensor is degraded without
 *   saying which one; the shared type says so at `AppHealthReason`. Deriving names by
 *   matching substrings out of those codes would couple this surface to prose, and
 *   prose changes silently — the wording would drift, the names would stop appearing,
 *   and nothing would go red. `tests/renderer/components/SensorHealthChip.test.ts`
 *   pins that: a payload whose reasons mention a sensor absent from the id lists must
 *   not surface that name.
 *
 *   `effective` and not `raw`: the two differ by exactly the entries listed in
 *   `sensors.projections` — today the accepted CIM birth-time fallback on
 *   `proc-snapshot`, which is degradation of the SOURCE and not of the application.
 *   `effective` is the set `appHealth.state` itself rests on, so naming its members is
 *   naming the sensors that actually drove the state the user is being shown.
 * @since 0.12.0
 */

import { derived } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { stats } from './ipc.js';
import type { SensorHealthAggregate } from '../../../shared/types';

/**
 * The two sensor-id lists of `appHealth.sensors.effective`, narrowed to strings.
 *
 * The element types are taken FROM the shared aggregate rather than restated as
 * `string[]`, so a rename on either field of `SensorHealthAggregate` fails this file
 * instead of silently leaving the UI reading a key that no longer exists.
 */
export interface UnhealthySensors {
  /** `sensors.effective.degradedSensorIds`, in payload order. Empty when none. */
  readonly degraded: SensorHealthAggregate['degradedSensorIds'];
  /** `sensors.effective.failedSensorIds`, in payload order. Empty when none. */
  readonly failed: SensorHealthAggregate['failedSensorIds'];
}

/**
 * Read one property off a value that the renderer only knows as `unknown`.
 *
 * `stats` is a `Record<string, unknown>` off the wire, so every step down to the id
 * lists is a value this process has not proven anything about. Walking it one guarded
 * hop at a time keeps the reader total without a single `any` and without a cast that
 * would assert a shape nobody checked.
 * @param source Any value; a non-object yields `undefined`.
 * @param key Property to read.
 * @returns The property value, or `undefined`.
 */
function pick(source: unknown, key: string): unknown {
  if (typeof source !== 'object' || source === null) return undefined;
  return (source as Record<string, unknown>)[key];
}

/**
 * Narrow a wire value to a list of sensor ids.
 *
 * Order is preserved exactly as delivered — the main process emits the records in a
 * stable order so a reader diffing two ticks sees a real change, and re-sorting here
 * would throw that away. Non-string and empty entries are dropped rather than rendered
 * as a blank name.
 * @param value The candidate list.
 * @returns The sensor ids, or an empty array.
 */
function toSensorIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === 'string' && id !== '');
}

/**
 * Extract the degraded and failed sensor ids from a stats payload.
 *
 * Total by construction: a payload with no `appHealth`, the BOOTING payload whose
 * `sensors.effective` is `null`, and a malformed list all yield two empty arrays. An
 * empty result means "no sensor is named", which the UI renders as nothing at all —
 * never as an empty section or a placeholder.
 * @param payload The `stats` store value, or any prefix of it.
 * @returns The two id lists.
 * @since 0.12.0
 */
export function readUnhealthySensors(
  payload: Record<string, unknown> | null | undefined,
): UnhealthySensors {
  const effective = pick(pick(pick(payload, 'appHealth'), 'sensors'), 'effective');
  return {
    degraded: toSensorIds(pick(effective, 'degradedSensorIds')),
    failed: toSensorIds(pick(effective, 'failedSensorIds')),
  };
}

/**
 * Live degraded / failed sensor ids, refreshed with every stats payload.
 *
 * Derived from {@link stats}, which `get-stats`, `stats-update` and `scan-batch.stats`
 * all write — the app-health block rides those surfaces and has no channel of its own.
 * @since 0.12.0
 */
export const unhealthySensors: Readable<UnhealthySensors> = derived(stats, readUnhealthySensors);
