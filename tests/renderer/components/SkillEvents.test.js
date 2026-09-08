import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const noop = () => {};
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
  getAuditEntriesBefore: async () => [],
  revealInExplorer: vi.fn(),
};
const { events, network } = await import('../../../src/renderer/lib/stores/ipc.js');
const ActivityFeed = (await import('../../../src/renderer/lib/components/ActivityFeed.svelte'))
  .default;
const GroupedFeedItem = (
  await import('../../../src/renderer/lib/components/GroupedFeedItem.svelte')
).default;
const file = 'C:\\Users\\u\\.codex\\plugins\\cache\\provider\\pdf\\1.2\\skills\\pdf\\SKILL.md';
const ev = {
  agent: '',
  pid: null,
  file,
  action: 'modified',
  timestamp: Date.now(),
  attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
};

describe('skill names in actual feed components', () => {
  beforeEach(() => {
    events.set([]);
    network.set([]);
    window.aegis.revealInExplorer.mockClear();
  });

  it('shows the skill independently of unknown actor and reveals the original full path', async () => {
    events.set([[ev]]);
    const view = render(ActivityFeed);
    expect(view.container.querySelector('.feed-agent')?.textContent.trim()).toBe('Unknown source');
    const label = view.getByRole('button', { name: 'Skill: pdf · SKILL.md' });
    expect(label.getAttribute('title')).toBe(file);
    await fireEvent.click(label);
    expect(window.aegis.revealInExplorer).toHaveBeenCalledWith(file);
  });

  it('keeps the same name in grouped events without requiring new backend metadata', () => {
    const view = render(GroupedFeedItem, {
      props: { ev: { ...ev, _type: 'file' }, index: 0, groupKey: 'a', onToggle: noop },
    });
    expect(view.getByRole('button', { name: 'Skill: pdf · SKILL.md' })).toBeTruthy();
  });

  it('shows a created skill folder by name without claiming it was used', () => {
    events.set([
      [{ ...ev, file: 'C:\\Users\\u\\.claude\\skills\\improve-animations', action: 'created' }],
    ]);
    const view = render(ActivityFeed);
    expect(view.getByRole('button', { name: 'Skill: improve-animations' })).toBeTruthy();
    expect(view.container.querySelector('.feed-action')?.textContent).toBe('created');
    expect(view.container.querySelector('.feed-agent')?.textContent.trim()).toBe('Unknown source');
  });
});
