import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import ContainerCandidates from '../../../frontend/observatory/components/ContainerCandidates.svelte';
import App from '../../../frontend/observatory/App.svelte';
import type { Host } from '../../../frontend/observatory/runtime/host';
import type { ContainerRuntime } from '../../../frontend/observatory/runtime/container-discovery';
import { language } from '../../../frontend/observatory/runtime/i18n';

const containerId = 'a'.repeat(64);
function snapshot(runtime: ContainerRuntime) {
  return {
    status: 'ready',
    reason: null,
    observedAt: Date.now(),
    attemptedAt: Date.now(),
    stale: false,
    candidates: [
      {
        id: `${runtime}:${containerId}`,
        containerId,
        name: '<img src=x onerror=alert(1)>',
        image: 'example/claude-agent:latest',
        agent: 'Claude Code',
        match: 'image',
        runtime,
      },
    ],
  };
}
afterEach(() => {
  vi.useRealTimers();
  language.set('en');
  localStorage.clear();
});

it('shows escaped metadata candidates in separate runtime sections without process actions or risk', () => {
  const view = render(ContainerCandidates, {
    dockerSnapshot: snapshot('docker'),
    podmanSnapshot: snapshot('podman'),
  });
  for (const runtime of ['Docker', 'Podman']) {
    const section = screen.getByRole('region', { name: `${runtime} container candidates` });
    expect(within(section).getByText('Claude Code')).toBeVisible();
    expect(within(section).getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    expect(within(section).getByText('Image metadata')).toBeVisible();
    expect(within(section).getByText('Last observed:')).toBeVisible();
    expect(within(section).queryByRole('button')).toBeNull();
    expect(section.textContent).not.toMatch(/PID|Risk|Running|Kill|Suspend|Resume/);
  }
  expect(view.container.querySelector('img')).toBeNull();
  expect(view.container.querySelectorAll('.panel')).toHaveLength(1);
});

it('retains unavailable Podman rows while Docker is fresh, then clears only a fresh empty Podman result', async () => {
  const docker = snapshot('docker');
  const podman = snapshot('podman');
  const view = render(ContainerCandidates, {
    dockerSnapshot: docker,
    podmanSnapshot: {
      ...podman,
      status: 'unavailable',
      reason: 'runtime-unavailable',
      stale: true,
    },
  });
  const dockerSection = screen.getByRole('region', { name: 'Docker container candidates' });
  const podmanSection = screen.getByRole('region', { name: 'Podman container candidates' });
  expect(within(dockerSection).getByRole('status')).toHaveTextContent('Docker metadata observed');
  expect(within(podmanSection).getByRole('status')).toHaveTextContent(
    'Podman discovery unavailable',
  );
  expect(within(podmanSection).getByText('The local Podman runtime is unavailable.')).toBeVisible();
  expect(within(podmanSection).getByText('Claude Code')).toBeVisible();
  expect(within(podmanSection).getByText(/Last observed candidates are retained/)).toBeVisible();
  await view.rerender({ dockerSnapshot: docker, podmanSnapshot: { ...podman, candidates: [] } });
  expect(
    within(podmanSection).getByText(
      'No Podman container candidates matched the observed image metadata.',
    ),
  ).toBeVisible();
  expect(within(podmanSection).queryByText('Claude Code')).toBeNull();
  expect(within(dockerSection).getByText('Claude Code')).toBeVisible();
});

it.each(['remote-config', 'unsupported-platform'])(
  'qualifies empty %s Podman discovery independently of ready empty Docker',
  (reason) => {
    render(ContainerCandidates, {
      dockerSnapshot: { ...snapshot('docker'), candidates: [] },
      podmanSnapshot: {
        ...snapshot('podman'),
        status: 'unavailable',
        reason,
        candidates: [],
        stale: true,
      },
    });
    const docker = screen.getByRole('region', { name: 'Docker container candidates' });
    const podman = screen.getByRole('region', { name: 'Podman container candidates' });
    expect(within(docker).getByText(/No Docker container candidates matched/)).toBeVisible();
    expect(
      within(podman).getByText('A current Podman candidate population is unavailable.'),
    ).toBeVisible();
    expect(within(podman).getByRole('status')).toHaveTextContent('Podman discovery unavailable');
  },
);

it('expires each held snapshot independently and disposes the shared freshness timer', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  const docker = snapshot('docker');
  const podman = { ...snapshot('podman'), observedAt: Date.now() - 40_000 };
  const view = render(ContainerCandidates, { dockerSnapshot: docker, podmanSnapshot: podman });
  const dockerSection = screen.getByRole('region', { name: 'Docker container candidates' });
  const podmanSection = screen.getByRole('region', { name: 'Podman container candidates' });
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(51_000);
  await tick();
  expect(within(dockerSection).getByRole('status')).toHaveTextContent('Docker metadata observed');
  expect(within(podmanSection).getByRole('status')).toHaveTextContent('Podman metadata is stale');
  await view.rerender({ dockerSnapshot: snapshot('docker'), podmanSnapshot: podman });
  expect(within(podmanSection).getByRole('status')).toHaveTextContent('Podman metadata is stale');
  expect(within(podmanSection).getByText('Claude Code')).toBeVisible();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('updates both runtime sections to Portuguese while preserving recorded metadata', async () => {
  render(ContainerCandidates, {
    dockerSnapshot: snapshot('docker'),
    podmanSnapshot: {
      ...snapshot('podman'),
      status: 'unavailable',
      reason: 'remote-config',
      stale: true,
    },
  });
  language.set('pt');
  await tick();
  const panel = screen.getByRole('region', { name: 'Contêineres candidatos' });
  expect(
    within(panel).getByRole('region', { name: 'Contêineres Docker candidatos' }),
  ).toBeVisible();
  const podman = within(panel).getByRole('region', { name: 'Contêineres Podman candidatos' });
  expect(within(podman).getByRole('status')).toHaveTextContent(
    'Descoberta de contêineres Podman indisponível',
  );
  expect(within(podman).getByText(/O Podman usa uma configuração remota/)).toBeVisible();
  expect(within(podman).getByText('Claude Code')).toBeVisible();
});

it.each(['false', 'true'])(
  'exposes both runtime sections after primary content with interface preference %s while host population is unknown',
  async (advanced) => {
    localStorage.setItem('aegis-advanced-mode', advanced);
    const noop = () => () => {};
    const host: Host = {
      getStats: async () => ({
        dockerDiscovery: snapshot('docker'),
        podmanDiscovery: {
          ...snapshot('podman'),
          status: 'unavailable',
          reason: 'timeout',
          stale: true,
        },
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
    const panel = await screen.findByRole('region', { name: 'Container candidates' });
    const docker = within(panel).getByRole('region', { name: 'Docker container candidates' });
    const podman = within(panel).getByRole('region', { name: 'Podman container candidates' });
    expect(await within(docker).findByText('Claude Code')).toBeVisible();
    expect(within(docker).getByRole('status')).toHaveTextContent('Docker metadata observed');
    expect(within(podman).getByRole('status')).toHaveTextContent('Podman discovery unavailable');
    expect(within(podman).getByText('Claude Code')).toBeVisible();
    const primary = document.querySelector('#workspace-content > #content');
    expect(primary).not.toBeNull();
    expect(primary!.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel.parentElement?.id).toBe('workspace-content');
    if (advanced === 'true') {
      const navigation = screen.getByRole('navigation', { name: 'Main navigation' });
      await fireEvent.click(within(navigation).getByRole('button', { name: /Agents/ }));
    } else {
      await fireEvent.click(screen.getByRole('button', { name: /^Commands/ }));
      await fireEvent.click(screen.getByRole('option', { name: /^Agents ·/ }));
    }
    expect(screen.getByRole('region', { name: 'Docker container candidates' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Podman container candidates' })).toBeVisible();
  },
);

it('shows dated configuration facts and independently expires them without grading isolation', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  const docker = snapshot('docker');
  const configured = {
    ...docker,
    candidates: [
      {
        ...docker.candidates[0],
        configuration: {
          status: 'observed',
          observedAt: Date.now() - 89_000,
          privileged: false,
          readOnlyRootFilesystem: true,
          networkMode: 'host',
        },
      },
    ],
  };
  const view = render(ContainerCandidates, {
    dockerSnapshot: configured,
    podmanSnapshot: snapshot('podman'),
  });
  const region = screen.getByRole('region', { name: 'Docker container candidates' });
  expect(within(region).getByText('Observed configuration')).toBeVisible();
  expect(within(region).getByText('No')).toBeVisible();
  expect(within(region).getByText('Yes')).toBeVisible();
  expect(region.querySelectorAll('time')).toHaveLength(2);
  expect(within(region).queryByText(/Configuration is stale/)).toBeNull();
  await vi.advanceTimersByTimeAsync(1000);
  await tick();
  expect(within(region).getByText(/Configuration is stale/)).toBeVisible();
  expect(within(region).getByRole('status')).toHaveTextContent('Docker metadata observed');
  expect(
    within(region).getByText(
      'Configuration observations do not establish isolation or a security grade.',
    ),
  ).toBeVisible();
  expect(
    within(screen.getByRole('region', { name: 'Podman container candidates' })).queryByText(
      'Observed configuration',
    ),
  ).toBeNull();
  await view.rerender({
    dockerSnapshot: {
      ...docker,
      candidates: [
        { ...docker.candidates[0], configuration: { status: 'unavailable', observedAt: null } },
      ],
    },
    podmanSnapshot: snapshot('podman'),
  });
  expect(within(region).getByText('Configuration unavailable')).toBeVisible();
  expect(within(region).queryByText('Privileged')).toBeNull();
});
