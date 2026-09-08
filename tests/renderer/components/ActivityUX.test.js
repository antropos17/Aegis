import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, within } from '@testing-library/svelte';
import { tick } from 'svelte';

const noop = () => {};
// Canvas animation is outside these interaction tests; browser QA renders it normally.
vi.stubGlobal('requestAnimationFrame', () => 0);
vi.stubGlobal('cancelAnimationFrame', noop);
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
window.aegis = {
  onScanBatch: noop,
  onFileAccess: noop,
  onStatsUpdate: noop,
  onNetworkUpdate: noop,
  onScanStatus: noop,
  onTokenCosts: noop,
  onAgentResourceUsage: noop,
  getStats: async () => ({}),
  getResourceUsage: async () => ({}),
  getFalsePositives: async () => [],
  getSettings: async () => ({}),
};
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
const { agents, events, network, firstScanDone, stats } =
  await import('../../../src/renderer/lib/stores/ipc.js');
const ActivityTab = (await import('../../../src/renderer/lib/components/ActivityTab.svelte'))
  .default;
const ActivityFeed = (await import('../../../src/renderer/lib/components/ActivityFeed.svelte'))
  .default;
const ShieldTab = (await import('../../../src/renderer/lib/components/ShieldTab.svelte')).default;

const agent = (name, pid) => ({ name, agent: name, pid, instanceId: `${pid}:1000`, type: 'cli' });
const fileEvent = (name, timestamp) => ({
  agent: name,
  pid: 42,
  file: `C:/workspace/${timestamp}.txt`,
  timestamp,
  action: 'modified',
  sensitive: false,
});

beforeEach(() => {
  agents.set([]);
  events.set([]);
  network.set([]);
  stats.set({});
  firstScanDone.set(true);
});

describe('activity navigation and quiet scans', () => {
  it('finishes loading after a quiet first scan with no file events', () => {
    const view = render(ActivityTab);
    expect(view.container.querySelector('.activity-skeleton')).toBeNull();
    expect(view.getByText(/No activity recorded yet/)).toBeVisible();
  });

  it('keeps Network accessible while the first scan and file stream are pending', async () => {
    firstScanDone.set(false);
    const view = render(ActivityTab);
    expect(view.container.querySelector('.activity-skeleton')).not.toBeNull();
    await fireEvent.click(view.getByRole('button', { name: 'Network', exact: true }));
    expect(view.container.querySelector('.activity-skeleton')).toBeNull();
    expect(view.getByRole('button', { name: 'Network', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(view.container.querySelector('.net-empty')).not.toBeNull();
  });

  it('shows network-only activity before any file batch arrives', () => {
    firstScanDone.set(false);
    network.set([
      {
        agent: 'Cursor',
        pid: 42,
        remoteIp: '127.0.0.1',
        remotePort: 8080,
        state: 'ESTABLISHED',
        timestamp: 1000,
      },
    ]);
    const view = render(ActivityTab);
    expect(view.container.querySelector('.activity-skeleton')).toBeNull();
    expect(view.container.querySelector('.group-header')).toHaveTextContent('Cursor');
  });
});

describe('activity controls change the visible feed', () => {
  beforeEach(() => {
    agents.set([agent('Cursor', 42), agent('Claude Code', 43)]);
    events.set([[fileEvent('Cursor', 1000), fileEvent('Claude Code', 2000)]]);
  });

  it('resets all filters while retaining the chosen grouping mode', async () => {
    const view = render(ActivityTab);
    const reset = view.getByRole('button', { name: 'Reset filters' });
    expect(reset).toBeDisabled();
    await fireEvent.change(view.getByLabelText('Agent', { exact: true }), {
      target: { value: 'Cursor' },
    });
    await fireEvent.click(
      within(view.getByRole('group', { name: 'Severity' })).getByRole('button', {
        name: /^critical$/i,
      }),
    );
    await fireEvent.click(
      within(view.getByRole('group', { name: 'Type' })).getByRole('button', { name: /^network$/i }),
    );
    expect(view.getByText(/No events match these filters/)).toBeVisible();
    await fireEvent.click(reset);
    expect(view.getByLabelText('Agent', { exact: true })).toHaveValue('all');
    for (const name of ['Severity', 'Type']) {
      expect(
        within(view.getByRole('group', { name })).getByRole('button', { name: /^all$/i }),
      ).toHaveAttribute('aria-pressed', 'true');
    }
    expect(view.getByRole('button', { name: 'Group by agent' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(view.container.querySelectorAll('.group-header')).toHaveLength(2);
    expect(reset).toBeDisabled();
  });

  it('switches Shield between chronological entries and grouped entries', async () => {
    const view = render(ShieldTab);
    const feed = within(view.container.querySelector('.bento-feed'));
    const toggle = feed.getByRole('button', { name: 'Group by agent' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(view.container.querySelectorAll('.bento-feed .feed-entry')).toHaveLength(2);
    await fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(view.container.querySelectorAll('.bento-feed .group-header')).toHaveLength(2);
    await fireEvent.click(toggle);
    expect(view.container.querySelectorAll('.bento-feed .feed-entry')).toHaveLength(2);
  });

  it('distinguishes filtered emptiness in the chronological view', async () => {
    const view = render(ActivityFeed, { typeFilter: 'network' });
    expect(view.getByText(/No events match these filters/)).toBeVisible();
    events.set([]);
    await tick();
    expect(view.getByText(/No activity recorded yet/)).toBeVisible();
  });

  it('preserves the reading position and returns to newest records only on request', async () => {
    const view = render(ActivityFeed);
    const scroll = view.container.querySelector('.feed-scroll');
    Object.defineProperty(scroll, 'scrollHeight', { value: 1000 });
    scroll.scrollTop = 300;
    await fireEvent.scroll(scroll);
    expect(view.getByRole('button', { name: 'Jump to latest' })).toBeVisible();
    events.set([
      [fileEvent('Cursor', 3000), fileEvent('Claude Code', 2000), fileEvent('Cursor', 1000)],
    ]);
    await tick();
    expect(scroll.scrollTop).toBe(300);
    await fireEvent.click(view.getByRole('button', { name: 'Jump to latest' }));
    expect(scroll.scrollTop).toBe(0);
    expect(view.container.querySelector('.feed-entry')).toHaveTextContent('3000.txt');
    expect(view.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
  });
});
