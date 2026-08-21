/**
 * app-health-population.test.ts — the population-unknown gate reads the enum, and
 * nothing but the enum.
 *
 * `populationState` is the lifecycle classifier; `populationReliable` collapses
 * STARTING, DEGRADED and FAILED into one `false` (ai-mistakes #29), and
 * `appHealth.state === 'FAILED'` also has a defensive zero-coverage route. The
 * load-bearing cases here are the ones that separate those collapsed members: a
 * reimplementation of `readPopulationUnknown` via `!populationReliable` or via
 * `appHealth.state` must go red on them.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

// stores/ipc.ts reads `window.aegis` at module load (and would start demo-mode
// timers in a browserless env), so its `stats` input is replaced with a plain
// writable. The factory is self-contained — it must not close over module-scope
// bindings, because vi.mock is hoisted above the imports below.
vi.mock('../../src/renderer/lib/stores/ipc.js', async () => {
  const { writable } = await import('svelte/store');
  return { stats: writable({}) };
});

import {
  readPopulationUnknown,
  populationUnknown,
} from '../../src/renderer/lib/stores/app-health.js';
import * as ipc from '../../src/renderer/lib/stores/ipc.js';

const stats = (ipc as unknown as { stats: { set: (v: Record<string, unknown>) => void } }).stats;

/** A stats payload whose `appHealth` block carries the given population fields. */
function payload(appHealth: Record<string, unknown>): Record<string, unknown> {
  return { currentAgents: 0, permissionDeniedScans: 0, appHealth };
}

beforeEach(() => {
  stats.set({});
});

describe('readPopulationUnknown — FAILED and only FAILED', () => {
  it('is true when populationState is FAILED', () => {
    expect(
      readPopulationUnknown(
        payload({ populationState: 'FAILED', populationReliable: false, populationAsOf: null }),
      ),
    ).toBe(true);
  });

  it('is false for HEALTHY', () => {
    expect(
      readPopulationUnknown(payload({ populationState: 'HEALTHY', populationReliable: true })),
    ).toBe(false);
  });

  it('is false for DEGRADED', () => {
    expect(
      readPopulationUnknown(payload({ populationState: 'DEGRADED', populationReliable: false })),
    ).toBe(false);
  });

  it('is false for an observed STARTING, whose populationReliable is already false', () => {
    // The ai-mistakes #29 case: a never-scanned leaf is STARTING with the flag
    // false on every launch. An implementation reading `!populationReliable`
    // instead of the enum paints that normal startup as a failure — and goes red here.
    expect(
      readPopulationUnknown(payload({ populationState: 'STARTING', populationReliable: false })),
    ).toBe(false);
  });

  it('is false for the BOOTING null, where no leaf record exists yet', () => {
    expect(
      readPopulationUnknown(payload({ populationState: null, populationReliable: false })),
    ).toBe(false);
  });

  it('is false when appHealth.state is FAILED but the population leaf is not', () => {
    // `state === 'FAILED'` also has a defensive zero-coverage route, so it is not
    // evidence of a failed population. Only the leaf's own enum is.
    expect(
      readPopulationUnknown(
        payload({
          state: 'FAILED',
          reasons: ['zero-coverage'],
          populationState: 'HEALTHY',
          populationReliable: true,
        }),
      ),
    ).toBe(false);
  });

  it('is total: null, undefined and malformed payloads all yield false', () => {
    expect(readPopulationUnknown(null)).toBe(false);
    expect(readPopulationUnknown(undefined)).toBe(false);
    expect(readPopulationUnknown({})).toBe(false);
    expect(readPopulationUnknown({ appHealth: 'broken' })).toBe(false);
    expect(readPopulationUnknown({ appHealth: { populationState: 42 } })).toBe(false);
  });
});

describe('populationUnknown — tracks the stats store', () => {
  it('flips with the payload and back', () => {
    stats.set(payload({ populationState: 'FAILED', populationReliable: false }));
    expect(get(populationUnknown)).toBe(true);

    stats.set(payload({ populationState: 'HEALTHY', populationReliable: true }));
    expect(get(populationUnknown)).toBe(false);
  });

  it('is false on the empty boot payload', () => {
    expect(get(populationUnknown)).toBe(false);
  });
});
