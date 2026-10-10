import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import DockerCandidates from '../../../frontend/observatory/components/DockerCandidates.svelte';
import App from '../../../frontend/observatory/App.svelte';
import type { Host } from '../../../frontend/observatory/runtime/host';

const containerId = 'a'.repeat(64);
function snapshot() {
  return {
    status: 'ready',
    reason: null,
    observedAt: Date.now(),
    attemptedAt: Date.now(),
    stale: false,
    candidates: [
      {
        id: `docker:${containerId}`,
        containerId,
        name: '<img src=x onerror=alert(1)>',
        image: 'example/claude-agent:latest',
        agent: 'Claude Code',
        match: 'image',
        runtime: 'docker',
      },
    ],
  };
}
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

it('shows escaped metadata candidates with no host-process actions or risk claims', () => {
  const view = render(DockerCandidates, { snapshot: snapshot() });
  const panel = screen.getByRole('region', { name: 'Docker container candidates' });
  expect(within(panel).getByText('Claude Code')).toBeVisible();
  expect(within(panel).getByText('<img src=x onerror=alert(1)>')).toBeVisible();
  expect(within(panel).getByText('Image metadata')).toBeVisible();
  expect(within(panel).queryByRole('button')).toBeNull();
  expect(panel.textContent).not.toMatch(/PID|Risk|Running|Kill|Suspend|Resume/);
  expect(view.container.querySelector('img')).toBeNull();
});

it('retains rows on unavailable discovery and distinguishes a fresh empty result', async () => {
  const value = snapshot();
  const view = render(DockerCandidates, {
    snapshot: { ...value, status: 'unavailable', reason: 'daemon-unavailable', stale: true },
  });
  expect(screen.getByRole('status')).toHaveTextContent('Docker discovery unavailable');
  expect(screen.getByText('Claude Code')).toBeVisible();
  expect(screen.getByText(/Last observed candidates are retained/)).toBeVisible();
  await view.rerender({ snapshot: { ...value, candidates: [] } });
  expect(
    screen.getByText('No Docker container candidates matched the observed image metadata.'),
  ).toBeVisible();
  expect(screen.queryByText('Claude Code')).toBeNull();
});

it('expires a held metadata snapshot without another host delivery and disposes its timer', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  const view = render(DockerCandidates, { snapshot: snapshot() });
  expect(screen.getByRole('status')).toHaveTextContent('Docker metadata observed');
  await vi.advanceTimersByTimeAsync(91_000);
  await tick();
  expect(screen.getByRole('status')).toHaveTextContent('Docker metadata is stale');
  expect(screen.getByText('Claude Code')).toBeVisible();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['false', 'true'])(
  'exposes Docker candidates after primary content with interface preference %s while host population is unknown',
  async (advanced) => {
    localStorage.setItem('aegis-advanced-mode', advanced);
    const noop = () => () => {};
    const host: Host = {
      getStats: async () => ({
        dockerDiscovery: snapshot(),
        appHealth: { populationReliable: false },
      }),
      getSettings: async () => ({ darkMode: false, scanIntervalSec: 10 }),
      getResourceUsage: async () => ({}),
      getFalsePositives: async () => [],
      getAppVersion: async () => 'test',
      getUpdateStatus: async () => ({}),
      onScanBatch: noop,
      onStatsUpdate: noop,
      onFileAccess: noop,
      onNetworkUpdate: noop,
      onScanStatus: noop,
      onAgentResourceUsage: noop,
      onTokenCosts: noop,
    };
    render(App, { host });
    const panel = await screen.findByRole('region', { name: 'Docker container candidates' });
    expect(await within(panel).findByText('Claude Code')).toBeVisible();
    expect(within(panel).getByRole('status')).toHaveTextContent('Docker metadata observed');
    const primary = document.querySelector('#workspace-content > #content');
    expect(primary).not.toBeNull();
    expect(primary!.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel.parentElement?.id).toBe('workspace-content');
    if (advanced === 'true') {
      const navigation = screen.getByRole('navigation', { name: 'Main navigation' });
      await fireEvent.click(within(navigation).getByRole('button', { name: /Agents/ }));
      expect(screen.getByRole('region', { name: 'Docker container candidates' })).toBeVisible();
    }
  },
);
