/**
 * AgentCard.test.ts — what the card does with a per-instance resource sample.
 *
 * The distinction under test is the one a monitor cannot afford to blur: a MEASURED
 * zero ("this process is idle") versus NO MEASUREMENT ("we have nothing to say"). The
 * running app can be made to show the first two states easily; a record whose `cpu` is
 * null — sampled, unreadable — only shows up when a process exits or denies access
 * mid-scan, which is why it is pinned here instead.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { flushSync } from 'svelte';

/**
 * `window.aegis` must exist BEFORE `stores/ipc` is evaluated, or that module takes the
 * demo branch. Same reason as NetworkPanel.test.ts / Timeline.test.ts.
 */
const noop = () => {};
(window as unknown as { aegis: unknown }).aegis = {
  onScanBatch: noop,
  onFileAccess: noop,
  onStatsUpdate: noop,
  onNetworkUpdate: noop,
  onScanStatus: noop,
  onTokenCosts: noop,
  onAgentResourceUsage: noop,
  getStats: () => Promise.resolve({}),
  getResourceUsage: () => Promise.resolve({}),
  getFalsePositives: () => Promise.resolve([]),
  getSettings: () => Promise.resolve({}),
  saveSettings: () => Promise.resolve({}),
  getAuditEntriesBefore: () => Promise.resolve([]),
};

const { agentResourceUsage } = await import('../../../src/renderer/lib/stores/ipc.js');
const AgentCard = (await import('../../../src/renderer/lib/components/AgentCard.svelte')).default;
// Namespace import on purpose: the alert-state suite below asserts the card against the
// toast's own gate, and a missing export must read as a failed assertion, not a load error.
const anomalyToast = await import('../../../src/renderer/lib/utils/anomaly-toast-tracker.js');

/** One live agent, shaped as `enrichedAgents` hands it to the card. */
function agent(over: Record<string, unknown> = {}) {
  return {
    name: 'Claude Code',
    agent: 'Claude Code',
    process: 'claude.exe',
    pid: 100,
    instanceId: '100:1717000000000',
    category: 'ai',
    riskScore: 10,
    ...over,
  };
}

/** The CPU or MEM chip's rendered figure, or null when it rendered the absent state. */
function chipFigure(container: HTMLElement, label: string): string | null {
  const chip = [...container.querySelectorAll('.stat-chip')].find(
    (c) => c.querySelector('.stat-label')?.textContent?.trim() === label,
  );
  return chip?.querySelector('.stat-value')?.textContent?.trim() ?? null;
}

/** The absent text of the CPU or MEM chip, or null when it rendered a figure. */
function chipAbsent(container: HTMLElement, label: string): string | null {
  const chip = [...container.querySelectorAll('.stat-chip')].find(
    (c) => c.querySelector('.stat-label')?.textContent?.trim() === label,
  );
  return chip?.querySelector('.stat-absent')?.textContent?.trim() ?? null;
}

describe('AgentCard — per-instance resource figures', () => {
  beforeEach(() => {
    agentResourceUsage.set([]);
  });

  it('renders CPU and memory for the matching instance', () => {
    agentResourceUsage.set([
      { instanceId: '100:1717000000000', pid: 100, cpu: 2.9, memMb: 631, gpu: null },
    ]);
    const { container } = render(AgentCard, {
      props: { agent: agent(), expandedInstanceId: null },
    });

    expect(chipFigure(container, 'CPU')).toBe('2.9 %');
    expect(chipFigure(container, 'MEM')).toBe('631 MB');
  });

  it('renders a MEASURED zero as a figure, never as the absent state', () => {
    // An idle process is a real observation. Collapsing it into "no sample" would throw
    // away the very thing the reading proves.
    agentResourceUsage.set([
      { instanceId: '100:1717000000000', pid: 100, cpu: 0, memMb: 0, gpu: null },
    ]);
    const { container } = render(AgentCard, {
      props: { agent: agent(), expandedInstanceId: null },
    });

    expect(chipFigure(container, 'CPU')).toBe('0 %');
    expect(chipFigure(container, 'MEM')).toBe('0 MB');
    expect(chipAbsent(container, 'CPU')).toBeNull();
    expect(chipAbsent(container, 'MEM')).toBeNull();
  });

  it('renders the absent state when a sampled field came back null', () => {
    // The record EXISTS — the process was sampled and the figure could not be read.
    // Indistinguishable to a viewer from having no record, and rendered the same way.
    agentResourceUsage.set([
      { instanceId: '100:1717000000000', pid: 100, cpu: null, memMb: null, gpu: null },
    ]);
    const { container } = render(AgentCard, {
      props: { agent: agent(), expandedInstanceId: null },
    });

    expect(chipAbsent(container, 'CPU')).toBe('no sample');
    expect(chipAbsent(container, 'MEM')).toBe('no sample');
    expect(chipFigure(container, 'CPU')).toBeNull();
    expect(chipFigure(container, 'MEM')).toBeNull();
  });

  it('renders the absent state when no record exists for this instance', () => {
    agentResourceUsage.set([
      { instanceId: '999:1717000000000', pid: 999, cpu: 50, memMb: 900, gpu: null },
    ]);
    const { container } = render(AgentCard, {
      props: { agent: agent(), expandedInstanceId: null },
    });

    expect(chipAbsent(container, 'CPU')).toBe('no sample');
    expect(chipFigure(container, 'CPU')).toBeNull();
  });

  it('never matches on pid: a same-pid record under another key is not this instance', () => {
    // The failure this guards: pid 100 recycled, the dead instance's sample still in the
    // last payload, and the new process wearing its CPU figure.
    agentResourceUsage.set([
      { instanceId: '100:OLD-LIFE', pid: 100, cpu: 77, memMb: 999, gpu: null },
    ]);
    const { container } = render(AgentCard, {
      props: { agent: agent(), expandedInstanceId: null },
    });

    expect(chipAbsent(container, 'CPU')).toBe('no sample');
    expect(container.textContent).not.toContain('77');
  });

  it('an agent carrying no instanceId gets no figures', () => {
    agentResourceUsage.set([
      { instanceId: '100:1717000000000', pid: 100, cpu: 2.9, memMb: 631, gpu: null },
    ]);
    const { container } = render(AgentCard, {
      props: { agent: agent({ instanceId: null }), expandedInstanceId: null },
    });

    expect(chipAbsent(container, 'CPU')).toBe('no sample');
  });

  it('two instances of the same tool show independent figures in the PID list', () => {
    // The card is one per display NAME, so this is where the two are told apart at all.
    agentResourceUsage.set([
      { instanceId: '100:aaa', pid: 100, cpu: 2.9, memMb: 631, gpu: null },
      { instanceId: '200:bbb', pid: 200, cpu: 0, memMb: 430, gpu: null },
    ]);
    const grouped = {
      ...agent({ instanceId: '100:aaa' }),
      _processCount: 2,
      _instances: [
        agent({ instanceId: '100:aaa', pid: 100, cwd: 'X:/projects/one' }),
        agent({ instanceId: '200:bbb', pid: 200, cwd: 'X:/projects/two' }),
      ],
    };
    const { container } = render(AgentCard, {
      props: { agent: grouped, expandedInstanceId: '100:aaa' },
    });

    const rows = [...container.querySelectorAll('.pid-row')].map((row) => ({
      pid: row.querySelector('.pid-num')?.textContent?.trim(),
      res: [...row.querySelectorAll('.pid-res-val')].map((el) => el.textContent?.trim()),
    }));
    expect(rows).toEqual([
      { pid: '100', res: ['2.9 %', '631 MB'] },
      { pid: '200', res: ['0 %', '430 MB'] },
    ]);
  });

  it('a PID-list row with no record of its own renders the absent state', () => {
    agentResourceUsage.set([{ instanceId: '100:aaa', pid: 100, cpu: 2.9, memMb: 631, gpu: null }]);
    const grouped = {
      ...agent({ instanceId: '100:aaa' }),
      _processCount: 2,
      _instances: [
        agent({ instanceId: '100:aaa', pid: 100 }),
        agent({ instanceId: '200:bbb', pid: 200 }),
      ],
    };
    const { container } = render(AgentCard, {
      props: { agent: grouped, expandedInstanceId: '100:aaa' },
    });

    const second = [...container.querySelectorAll('.pid-row')][1];
    expect(second?.querySelector('.pid-res-absent')?.textContent?.trim()).toBe('no sample');
    expect(second?.querySelector('.pid-res-val')).toBeNull();
  });
});

/**
 * The contract under test: the card's alert state agrees with the anomaly toast. Both read
 * the SAME number — the per-instance anomaly score `scan-loop.js` merges the sequence-engine
 * hold into (`anomalyScoresByInstance`, max over a name's instances for the toast) — and both
 * gate it at ONE exported threshold. Before this suite the toast said "score 70" while the
 * card, keyed on `riskScore` alone, stayed in its low-risk band (bench/demo/README.md, #325).
 * `riskScore` itself — the exposure model with its per-factor ceilings — is not moved by any
 * of this: the badge keeps its band, the card gains a state.
 */
describe('AgentCard — anomaly alert state agrees with the toast', () => {
  beforeEach(() => {
    agentResourceUsage.set([]);
  });

  /** The card's alert state, read off the one class the card already had for it. */
  function isDanger(container: HTMLElement): boolean {
    return container.querySelector('.agent-card.danger') !== null;
  }

  /** The badge's band label, off the aria-label TrustBadge already renders. */
  function badgeLabel(container: HTMLElement): string | null {
    return container.querySelector('.trust-badge')?.getAttribute('aria-label') ?? null;
  }

  it('the number the toast printed puts the card in the danger state', () => {
    // The toast side, exactly as App.svelte drives it: seed, then a batch where the staged
    // agent crosses the gate — the name comes back, and `Anomaly: aider score 70` is shown.
    const tracker = anomalyToast.createAnomalyToastTracker();
    tracker.ingest({ aider: 0 });
    expect(tracker.ingest({ aider: 70 })).toEqual(['aider']);

    // The card side, fed the same score as `enrichedAgents` attaches it (risk.ts).
    const { container } = render(AgentCard, {
      props: {
        agent: agent({ name: 'aider', agent: 'aider', riskScore: 10, anomalyScore: 70 }),
        expandedInstanceId: null,
      },
    });
    expect(isDanger(container)).toBe(true);
  });

  it('the card gate is the toast gate: 50 alerts, 49 does not', () => {
    const below = render(AgentCard, {
      props: { agent: agent({ riskScore: 10, anomalyScore: 49 }), expandedInstanceId: null },
    });
    expect(isDanger(below.container)).toBe(false);
    below.unmount();

    const at = render(AgentCard, {
      props: { agent: agent({ riskScore: 10, anomalyScore: 50 }), expandedInstanceId: null },
    });
    expect(isDanger(at.container)).toBe(true);
  });

  it('a grouped card alerts on its worst instance, not on the representative', () => {
    // The toast is keyed by NAME and carries the max over that name's instances
    // (scan-loop.js). The representative is the max-riskScore instance (agent-panel-utils),
    // which need not be the one the sequence closed on — so the card reads the group.
    const grouped = {
      ...agent({ instanceId: '100:aaa', riskScore: 10, anomalyScore: 0 }),
      _processCount: 2,
      _instances: [
        agent({ instanceId: '100:aaa', pid: 100, riskScore: 10, anomalyScore: 0 }),
        agent({ instanceId: '200:bbb', pid: 200, riskScore: 5, anomalyScore: 70 }),
      ],
    };
    const { container } = render(AgentCard, {
      props: { agent: grouped, expandedInstanceId: null },
    });
    expect(isDanger(container)).toBe(true);
  });

  it('crossing the toast gate flashes the card the way a risk crossing does', async () => {
    const { container, rerender } = render(AgentCard, {
      props: { agent: agent({ riskScore: 10, anomalyScore: 0 }), expandedInstanceId: null },
    });
    expect(container.querySelector('.agent-card.threat-flash')).toBeNull();

    await rerender({ agent: agent({ riskScore: 10, anomalyScore: 70 }), expandedInstanceId: null });
    flushSync();
    expect(isDanger(container)).toBe(true);
    expect(container.querySelector('.agent-card.threat-flash')).not.toBeNull();
  });

  it('mounting already over the gate is not a crossing: state, no flash', () => {
    // Same rule the risk crossing always had (`_prevRiskScore === -1` on mount).
    const { container } = render(AgentCard, {
      props: { agent: agent({ riskScore: 10, anomalyScore: 70 }), expandedInstanceId: null },
    });
    expect(isDanger(container)).toBe(true);
    expect(container.querySelector('.agent-card.threat-flash')).toBeNull();
  });

  it('the badge keeps the exposure band while the card alerts', () => {
    // The non-change: `riskScore` is not folded, so TrustBadge still classifies 10 as low.
    const { container } = render(AgentCard, {
      props: { agent: agent({ riskScore: 10, anomalyScore: 70 }), expandedInstanceId: null },
    });
    expect(isDanger(container)).toBe(true);
    expect(badgeLabel(container)).toBe('Risk score 10: Low Risk');
  });

  it('a risk crossing still alerts on its own, with no anomaly at all', () => {
    // The other side of the OR — the behaviour the card had before this suite.
    const below = render(AgentCard, {
      props: { agent: agent({ riskScore: 69, anomalyScore: 0 }), expandedInstanceId: null },
    });
    expect(isDanger(below.container)).toBe(false);
    below.unmount();

    const at = render(AgentCard, {
      props: { agent: agent({ riskScore: 70, anomalyScore: 0 }), expandedInstanceId: null },
    });
    expect(isDanger(at.container)).toBe(true);
  });
});
