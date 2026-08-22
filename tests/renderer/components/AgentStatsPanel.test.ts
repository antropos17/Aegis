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

describe('AgentStatsPanel — translated table labels', () => {
  it('renders column, status, and count strings through the English catalogue', () => {
    agents.set([
      {
        agent: 'Claude Code',
        pid: 100,
        process: 'claude.exe',
        status: 'running',
        instanceId: '100:1754380000000',
        category: 'coding-assistant',
      },
    ]);

    const { container } = render(AgentStatsPanel);

    expect(container.querySelector('.col-agent')).toHaveTextContent('Agent');
    expect(container.querySelector('.col-status')).toHaveTextContent('Status');
    expect(container.querySelector('.status-dot')).toHaveAttribute('aria-label', 'active');
    expect(container.querySelector('tbody .col-status')).toHaveTextContent('active');
    expect(container.querySelector('tbody .col-files')).toHaveTextContent('0 events');
    expect(container.querySelector('tbody .col-net')).toHaveTextContent('0 conn');
  });
});
