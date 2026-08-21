/**
 * SensorHealthChip.test.ts — the renderer names degraded and failed sensors, and it
 * names them from the id lists.
 *
 * The chip is driven end to end here: a real `stats` payload goes into the store the
 * IPC bridge writes, and the assertions are made against the DOM. Nothing is stubbed
 * between the two, so these also pin the store's narrowing of an `unknown` payload.
 *
 * The load-bearing test in this file is the anti-parsing pin. `appHealth.reasons` is a
 * closed set of aggregate reason codes and is NOT a source of sensor names; a surface
 * that scraped identifiers out of it would look right today and go quietly blank the
 * first time a reason's wording changed. So a payload whose reasons and whose raw
 * `byId` records both mention a sensor that is absent from
 * `sensors.effective.{degraded,failed}SensorIds` must not put that name on screen.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { stats } from '../../../src/renderer/lib/stores/ipc.js';
import {
  readUnhealthySensors,
  unhealthySensors,
} from '../../../src/renderer/lib/stores/app-health.js';
import SensorHealthChip from '../../../src/renderer/lib/components/SensorHealthChip.svelte';

/** A leaf record shaped like the ones `sensors.byId` carries. */
function record(sensorId: string, state: string): Record<string, unknown> {
  return {
    sensorId,
    state,
    lastAttemptAt: 1_700_000_000_000,
    lastSuccessAt: state === 'FAILED' ? null : 1_699_999_990_000,
    lastError: state === 'FAILED' ? 'access is denied' : null,
    consecutiveFailures: state === 'FAILED' ? 3 : 0,
    lossCount: state === 'DEGRADED' ? 2 : 0,
    detail: null,
  };
}

/**
 * A stats payload carrying an `appHealth` block, with the two effective id lists and
 * the aggregate reasons under the caller's control.
 */
function statsPayload(options: {
  degraded?: string[];
  failed?: string[];
  reasons?: string[];
  byId?: Record<string, unknown>;
}): Record<string, unknown> {
  const degraded = options.degraded ?? [];
  const failed = options.failed ?? [];
  return {
    currentAgents: 3,
    permissionDeniedScans: 0,
    monitoringPaused: false,
    appHealth: {
      state: failed.length > 0 || degraded.length > 0 ? 'DEGRADED' : 'HEALTHY',
      reasons: options.reasons ?? [],
      populationState: 'HEALTHY',
      populationReliable: true,
      populationAsOf: 1_700_000_000_000,
      identityQuality: 'witnessed',
      identityDegraded: false,
      sensors: {
        byId: options.byId ?? {},
        raw: {
          state: 'HEALTHY',
          participatingCount: 5,
          totalCount: 6,
          failedSensorIds: [],
          degradedSensorIds: [],
        },
        effective: {
          state: failed.length > 0 ? 'FAILED' : degraded.length > 0 ? 'DEGRADED' : 'HEALTHY',
          participatingCount: 5,
          totalCount: 6,
          failedSensorIds: failed,
          degradedSensorIds: degraded,
        },
        projections: [],
      },
      watchPlan: { state: 'HEALTHY', liveWatcherCount: 4, unavailableGroups: [] },
    },
  };
}

beforeEach(() => {
  stats.set({});
});

describe('SensorHealthChip — nothing to report', () => {
  it('renders nothing when both id lists are empty', () => {
    stats.set(statsPayload({ degraded: [], failed: [] }));
    const { container } = render(SensorHealthChip);

    expect(container.querySelector('.sensor-health')).toBeNull();
    expect(container.textContent?.trim()).toBe('');
  });

  it('renders nothing when the payload carries no appHealth at all', () => {
    stats.set({ currentAgents: 0, permissionDeniedScans: 0 });
    const { container } = render(SensorHealthChip);

    expect(container.querySelector('.sensor-health')).toBeNull();
  });

  it('renders nothing on the BOOTING payload, whose effective aggregate is null', () => {
    stats.set({
      appHealth: {
        state: 'BOOTING',
        reasons: [],
        populationState: null,
        populationReliable: false,
        sensors: { byId: {}, raw: null, effective: null, projections: [] },
        watchPlan: null,
      },
    });
    const { container } = render(SensorHealthChip);

    expect(container.querySelector('.sensor-health')).toBeNull();
  });

  it('renders no placeholder text — an empty list is absence, not an empty section', () => {
    stats.set(statsPayload({}));
    const { container } = render(SensorHealthChip);

    expect(container.textContent).not.toContain('DEGRADED');
    expect(container.textContent).not.toContain('FAILED');
    expect(container.textContent).not.toContain('None');
  });
});

describe('SensorHealthChip — naming the sensors', () => {
  it('names every degraded sensor from degradedSensorIds', () => {
    stats.set(statsPayload({ degraded: ['fs-handle', 'network'] }));
    const { container } = render(SensorHealthChip);

    const value = container.querySelector('.sensor-health__value--degraded');
    expect(value).toBeInTheDocument();
    expect(value).toHaveTextContent('fs-handle, network');
  });

  it('names every failed sensor from failedSensorIds', () => {
    stats.set(statsPayload({ failed: ['process', 'fs-rm'] }));
    const { container } = render(SensorHealthChip);

    const value = container.querySelector('.sensor-health__value--failed');
    expect(value).toBeInTheDocument();
    expect(value).toHaveTextContent('process, fs-rm');
  });

  it('keeps degraded and failed visually distinct, each under its own label', () => {
    stats.set(statsPayload({ degraded: ['fs-chokidar'], failed: ['process'] }));
    const { container } = render(SensorHealthChip);

    const chips = container.querySelectorAll('.sensor-health');
    expect(chips).toHaveLength(2);

    const failed = container.querySelector('.sensor-health__value--failed');
    const degraded = container.querySelector('.sensor-health__value--degraded');
    expect(failed).toHaveTextContent('process');
    expect(degraded).toHaveTextContent('fs-chokidar');
    // Different elements, different modifier classes — the two severities never share
    // a node, so they can never render as one undifferentiated list.
    expect(failed).not.toBe(degraded);
    expect(failed).not.toHaveClass('sensor-health__value--degraded');
    expect(degraded).not.toHaveClass('sensor-health__value--failed');

    const labels = Array.from(container.querySelectorAll('.sensor-health__label')).map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(['FAILED', 'DEGRADED']);
  });

  it('preserves payload order rather than re-sorting the ids', () => {
    stats.set(statsPayload({ degraded: ['network', 'fs-chokidar', 'fs-handle'] }));
    const { container } = render(SensorHealthChip);

    expect(container.querySelector('.sensor-health__value--degraded')).toHaveTextContent(
      'network, fs-chokidar, fs-handle',
    );
  });
});

describe('SensorHealthChip — the names come from the id lists, nowhere else', () => {
  it('does not surface a sensor that only the reasons mention (anti-parsing pin)', () => {
    // `reasons` is the aggregate explanation. Here it is written the way a future
    // wording change might write it — with a sensor id inside the string — while the
    // id lists name a different sensor. Only the lists may reach the DOM.
    stats.set(
      statsPayload({
        degraded: ['network'],
        failed: [],
        reasons: ['sensor-degraded: fs-handle', 'identity-degraded', 'population-degraded'],
      }),
    );
    const { container } = render(SensorHealthChip);

    expect(container.querySelector('.sensor-health__value--degraded')).toHaveTextContent('network');
    expect(container.textContent).not.toContain('fs-handle');
    expect(container.textContent).not.toContain('identity-degraded');
    expect(container.textContent).not.toContain('population');
  });

  it('renders nothing when the reasons report a degradation the id lists do not', () => {
    stats.set(
      statsPayload({
        degraded: [],
        failed: [],
        reasons: ['sensor-degraded', 'sensor-failed', 'watch-roots-unavailable'],
      }),
    );
    const { container } = render(SensorHealthChip);

    expect(container.querySelector('.sensor-health')).toBeNull();
    expect(container.textContent?.trim()).toBe('');
  });

  it('does not surface a raw byId record that the effective aggregate leaves out', () => {
    // `proc-snapshot` is DEGRADED in the raw records and absent from `effective` —
    // exactly the accepted birth-time fallback the projection rewrites. `effective` is
    // the set the app-health state rests on, so it is the set the UI names.
    stats.set(
      statsPayload({
        degraded: ['network'],
        byId: {
          'proc-snapshot': record('proc-snapshot', 'DEGRADED'),
          network: record('network', 'DEGRADED'),
          process: record('process', 'HEALTHY'),
        },
      }),
    );
    const { container } = render(SensorHealthChip);

    expect(container.textContent).toContain('network');
    expect(container.textContent).not.toContain('proc-snapshot');
  });
});

describe('readUnhealthySensors — the store narrowing behind the chip', () => {
  it('reads both lists off sensors.effective', () => {
    expect(
      readUnhealthySensors(statsPayload({ degraded: ['network'], failed: ['process'] })),
    ).toEqual({ degraded: ['network'], failed: ['process'] });
  });

  it('is total: null, undefined and a malformed payload all yield empty lists', () => {
    const empty = { degraded: [], failed: [] };
    expect(readUnhealthySensors(null)).toEqual(empty);
    expect(readUnhealthySensors(undefined)).toEqual(empty);
    expect(readUnhealthySensors({})).toEqual(empty);
    expect(readUnhealthySensors({ appHealth: 'broken' })).toEqual(empty);
    expect(readUnhealthySensors({ appHealth: { sensors: { effective: 7 } } })).toEqual(empty);
  });

  it('drops non-string and empty entries instead of rendering a blank name', () => {
    expect(
      readUnhealthySensors({
        appHealth: {
          sensors: {
            effective: { degradedSensorIds: ['network', '', 42, null], failedSensorIds: 'process' },
          },
        },
      }),
    ).toEqual({ degraded: ['network'], failed: [] });
  });

  it('tracks the stats store', () => {
    stats.set(statsPayload({ failed: ['fs-rm'] }));
    expect(get(unhealthySensors)).toEqual({ degraded: [], failed: ['fs-rm'] });

    stats.set(statsPayload({}));
    expect(get(unhealthySensors)).toEqual({ degraded: [], failed: [] });
  });
});
