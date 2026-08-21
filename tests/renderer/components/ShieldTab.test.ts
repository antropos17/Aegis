/**
 * ShieldTab.test.ts — the bento empty state distinguishes "no agents observed"
 * from "the population could not be observed".
 *
 * Both directions run with `firstScanDone` true: the skeleton path already covers
 * boot, and this file does not touch it. The gate is
 * `appHealth.populationState === 'FAILED'`, read through the app-health store —
 * never `appHealth.state`, whose FAILED also has a defensive zero-coverage route.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { agents, firstScanDone, stats } from '../../../src/renderer/lib/stores/ipc.js';
import ShieldTab from '../../../src/renderer/lib/components/ShieldTab.svelte';

/** A stats payload whose population leaf sits at the given state. */
function statsPayload(populationState: string): Record<string, unknown> {
  const failed = populationState === 'FAILED';
  return {
    currentAgents: 0,
    permissionDeniedScans: 0,
    monitoringPaused: false,
    appHealth: {
      state: failed ? 'FAILED' : 'HEALTHY',
      reasons: failed ? ['population-failed', 'sensor-failed'] : [],
      populationState,
      populationReliable: populationState === 'HEALTHY',
      populationAsOf: failed ? null : 1_700_000_000_000,
      identityQuality: 'witnessed',
      identityDegraded: false,
      sensors: { byId: {}, raw: null, effective: null, projections: [] },
      watchPlan: { state: 'HEALTHY', liveWatcherCount: 4, unavailableGroups: [] },
    },
  };
}

beforeEach(() => {
  agents.set([]);
  firstScanDone.set(true);
  stats.set({});
});

describe('ShieldTab — empty state under a FAILED population', () => {
  it('says the population is unknown, not that there are no agents', () => {
    stats.set(statsPayload('FAILED'));
    const { container } = render(ShieldTab);

    expect(container.querySelector('.empty-title')).toHaveTextContent('Agent population unknown');
    expect(container.querySelector('.empty-hint')).toHaveTextContent(
      'cannot currently enumerate running processes',
    );
    expect(container.textContent).not.toContain('No AI agents detected');
  });
});

describe('ShieldTab — empty state under a HEALTHY population', () => {
  it('keeps the current no-agents empty state, without the unknown text', () => {
    stats.set(statsPayload('HEALTHY'));
    const { container } = render(ShieldTab);

    expect(container.querySelector('.empty-title')).toHaveTextContent('No AI agents detected');
    expect(container.querySelector('.empty-hint')).toHaveTextContent(
      'detected AI agents will appear here automatically',
    );
    expect(container.textContent).not.toContain('Agent population unknown');
  });
});
