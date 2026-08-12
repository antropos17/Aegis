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
    const { container } = render(AgentCard, { props: { agent: agent() } });

    expect(chipFigure(container, 'CPU')).toBe('2.9 %');
    expect(chipFigure(container, 'MEM')).toBe('631 MB');
  });

  it('renders a MEASURED zero as a figure, never as the absent state', () => {
    // An idle process is a real observation. Collapsing it into "no sample" would throw
    // away the very thing the reading proves.
    agentResourceUsage.set([
      { instanceId: '100:1717000000000', pid: 100, cpu: 0, memMb: 0, gpu: null },
    ]);
    const { container } = render(AgentCard, { props: { agent: agent() } });

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
    const { container } = render(AgentCard, { props: { agent: agent() } });

    expect(chipAbsent(container, 'CPU')).toBe('no sample');
    expect(chipAbsent(container, 'MEM')).toBe('no sample');
    expect(chipFigure(container, 'CPU')).toBeNull();
    expect(chipFigure(container, 'MEM')).toBeNull();
  });

  it('renders the absent state when no record exists for this instance', () => {
    agentResourceUsage.set([
      { instanceId: '999:1717000000000', pid: 999, cpu: 50, memMb: 900, gpu: null },
    ]);
    const { container } = render(AgentCard, { props: { agent: agent() } });

    expect(chipAbsent(container, 'CPU')).toBe('no sample');
    expect(chipFigure(container, 'CPU')).toBeNull();
  });

  it('never matches on pid: a same-pid record under another key is not this instance', () => {
    // The failure this guards: pid 100 recycled, the dead instance's sample still in the
    // last payload, and the new process wearing its CPU figure.
    agentResourceUsage.set([
      { instanceId: '100:OLD-LIFE', pid: 100, cpu: 77, memMb: 999, gpu: null },
    ]);
    const { container } = render(AgentCard, { props: { agent: agent() } });

    expect(chipAbsent(container, 'CPU')).toBe('no sample');
    expect(container.textContent).not.toContain('77');
  });

  it('an agent carrying no instanceId gets no figures', () => {
    agentResourceUsage.set([
      { instanceId: '100:1717000000000', pid: 100, cpu: 2.9, memMb: 631, gpu: null },
    ]);
    const { container } = render(AgentCard, { props: { agent: agent({ instanceId: null }) } });

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
