/**
 * AgentPanel.test.ts — the panel's empty state distinguishes "no agents observed"
 * from "the population could not be observed".
 *
 * An empty agent list from a FAILED process-population sensor is the absence of an
 * observation, not an observation of zero agents. The gate is
 * `appHealth.populationState === 'FAILED'` — driven end to end here: a real stats
 * payload goes into the store the IPC bridge writes, and the assertions are made
 * against the DOM.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { agents, stats } from '../../../src/renderer/lib/stores/ipc.js';
import AgentPanel from '../../../src/renderer/lib/components/AgentPanel.svelte';

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
  stats.set({});
});

describe('AgentPanel — empty list under a FAILED population', () => {
  it('says the population is unknown, not that there are no agents', () => {
    stats.set(statsPayload('FAILED'));
    const { container } = render(AgentPanel);

    expect(container.textContent).toContain('Agent population unknown');
    expect(container.textContent).not.toContain('No AI agents detected');
  });
});

describe('AgentPanel — empty list under a HEALTHY population', () => {
  it('keeps the current no-agents empty state, without the unknown text', () => {
    stats.set(statsPayload('HEALTHY'));
    const { container } = render(AgentPanel);

    expect(container.textContent).toContain('No AI agents detected');
    expect(container.textContent).not.toContain('Agent population unknown');
  });
});
