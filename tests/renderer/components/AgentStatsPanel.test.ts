/**
 * AgentStatsPanel.test.ts — the table's empty row distinguishes "no agents
 * observed" from "the population could not be observed".
 *
 * The gate is `appHealth.populationState === 'FAILED'`, read through the
 * app-health store; the existing hardcoded "No agents detected" branch stays
 * byte-identical for every other population state.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { agents, stats } from '../../../src/renderer/lib/stores/ipc.js';
import AgentStatsPanel from '../../../src/renderer/lib/components/AgentStatsPanel.svelte';

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

describe('AgentStatsPanel — empty table under a FAILED population', () => {
  it('says the population is unknown, not that there are no agents', () => {
    stats.set(statsPayload('FAILED'));
    const { container } = render(AgentStatsPanel);

    const cell = container.querySelector('.empty-state');
    expect(cell).toBeInTheDocument();
    expect(cell).toHaveTextContent('Agent population unknown');
    expect(container.textContent).not.toContain('No agents detected');
  });
});

describe('AgentStatsPanel — empty table under a HEALTHY population', () => {
  it('keeps the current no-agents empty state, without the unknown text', () => {
    stats.set(statsPayload('HEALTHY'));
    const { container } = render(AgentStatsPanel);

    const cell = container.querySelector('.empty-state');
    expect(cell).toBeInTheDocument();
    expect(cell).toHaveTextContent('No agents detected');
    expect(container.textContent).not.toContain('Agent population unknown');
  });
});
