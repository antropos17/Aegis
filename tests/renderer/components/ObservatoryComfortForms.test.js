import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import Settings from '../../../frontend/observatory/components/Settings.svelte';
import Rules from '../../../frontend/observatory/components/Rules.svelte';
import Catalog from '../../../frontend/observatory/components/Catalog.svelte';
import Analysis from '../../../frontend/observatory/components/Analysis.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

const agent = (name, pid) => ({
  agent: name,
  process: 'agent.exe',
  pid,
  instanceId: pid + ':live',
  instanceIdSource: 'os',
  cwd: 'X:/project',
});
const telemetry = () => ({
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  agents: [agent('Codex', 10), agent('Claude Code', 20)],
});

it('keeps settings drafts across sections and direct requests, and retains edits after a failed save', async () => {
  const saved = {
    darkMode: true,
    uiScale: 1,
    scanIntervalSec: 10,
    anthropicApiKey: 'private-setting-key',
    unrelated: 'retained',
  };
  const host = {
    getSettings: vi.fn(async () => saved),
    getUpdateStatus: async () => ({}),
    saveSettings: vi.fn(async () => ({ success: false, error: 'Disk full' })),
  };
  const { container, rerender } = render(Settings, {
    host,
    appearance: vi.fn(),
    navigate: vi.fn(),
  });
  await screen.findByText('Settings saved');
  expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
  await fireEvent.click(screen.getByRole('tab', { name: 'Monitoring', exact: true }));
  await fireEvent.input(screen.getByLabelText('Scan interval (seconds)'), {
    target: { value: '23' },
  });
  await fireEvent.input(screen.getByLabelText('Additional exclusions'), {
    target: { value: 'X:/builds' },
  });
  await rerender({ sectionRequest: { id: 'desktop', revision: 1 } });
  expect(screen.getByRole('tab', { name: 'Desktop & updates' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await fireEvent.click(screen.getByRole('tab', { name: 'Monitoring', exact: true }));
  expect(screen.getByLabelText('Scan interval (seconds)')).toHaveValue('23');
  expect(screen.getByLabelText('Additional exclusions')).toHaveValue('X:/builds');
  await fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Disk full');
  expect(host.saveSettings.mock.calls[0][0]).toMatchObject({
    scanIntervalSec: 23,
    ignoredDirectories: ['X:/builds'],
    unrelated: 'retained',
  });
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  expect(container.textContent).not.toContain('private-setting-key');
  await fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  await waitFor(() => expect(screen.getByLabelText('Scan interval (seconds)')).toHaveValue('10'));
  expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
});

it('retains each agent policy draft across target changes and refresh without mixing them', async () => {
  const host = {
    getAllPermissions: vi.fn(async () => ({ permissions: {}, instancePermissions: {} })),
    getRules: async () => [],
    saveAgentPermissions: vi.fn(async () => ({ success: true })),
  };
  render(Rules, { host, telemetry: telemetry() });
  await waitFor(() => expect(screen.getByLabelText('Target')).toHaveValue('Codex'));
  await fireEvent.change(screen.getByLabelText('Network'), { target: { value: 'block' } });
  await fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'Claude Code' } });
  expect(screen.getByLabelText('Network')).toHaveValue('monitor');
  await fireEvent.change(screen.getByLabelText('File system'), { target: { value: 'allow' } });
  await fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'Codex' } });
  expect(screen.getByLabelText('Network')).toHaveValue('block');
  expect(screen.getByLabelText('File system')).toHaveValue('monitor');
  await fireEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true }));
  await waitFor(() => expect(host.getAllPermissions).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText('Network')).toHaveValue('block');
  await fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
  await waitFor(() => expect(host.saveAgentPermissions).toHaveBeenCalledTimes(1));
  expect(host.saveAgentPermissions.mock.calls[0][0].Codex.network).toBe('block');
  await fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'Claude Code' } });
  expect(screen.getByLabelText('File system')).toHaveValue('allow');
  await fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  await fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'Codex' } });
  await fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'Claude Code' } });
  expect(screen.getByLabelText('File system')).toHaveValue('monitor');
});

it('filters loaded rules by readable name or category and explains empty results', async () => {
  render(Rules, {
    host: {
      getAllPermissions: async () => ({}),
      getRules: async () => [
        { id: 'a', name: 'SSH access', category: 'sensitive' },
        { id: 'b', name: 'External connection', category: 'network' },
      ],
    },
    telemetry: telemetry(),
  });
  await fireEvent.click(screen.getByRole('button', { name: /Detection rules/ }));
  await screen.findByText('SSH access');
  await fireEvent.input(screen.getByLabelText('Search detection rules'), {
    target: { value: 'network' },
  });
  expect(screen.getByText('External connection')).toBeInTheDocument();
  expect(screen.queryByText('SSH access')).toBeNull();
  await fireEvent.input(screen.getByLabelText('Search detection rules'), {
    target: { value: 'absent' },
  });
  expect(screen.getByText('No rules match this search.')).toBeInTheDocument();
});

it('focuses the missing catalog field after switching tabs and preserves editor scroll on return', async () => {
  render(Catalog, {
    host: { getAgentDatabase: async () => ({ agents: [] }), getCustomAgents: async () => [] },
    inspect: vi.fn(),
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Add agent' }));
  const dialog = screen.getByRole('dialog');
  await fireEvent.click(within(dialog).getByRole('tab', { name: 'Recognition' }));
  await fireEvent.click(within(dialog).getByRole('button', { name: 'Save agent' }));
  await waitFor(() => expect(within(dialog).getByLabelText('Name')).toHaveFocus());
  await fireEvent.input(within(dialog).getByLabelText('Name'), { target: { value: 'My agent' } });
  const body = dialog.querySelector('.editor-body');
  body.scrollTop = 55;
  await fireEvent.click(within(dialog).getByRole('tab', { name: 'Recognition' }));
  body.scrollTop = 20;
  await fireEvent.click(within(dialog).getByRole('tab', { name: 'General' }));
  expect(body.scrollTop).toBe(55);
  await fireEvent.click(within(dialog).getByRole('button', { name: 'Save agent' }));
  await waitFor(() => expect(within(dialog).getByLabelText('Process name')).toHaveFocus());
});

it('keeps analysis action beside scope and resets the provider dialog to connection without retaining keys', async () => {
  const host = {
    getSettings: async () => ({ anthropicApiKey: 'saved-private-key' }),
    analyzeSession: vi.fn(),
  };
  const { container } = render(Analysis, { host, telemetry: telemetry() });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Run analysis' })).toBeEnabled());
  expect(container.querySelector('.analysis-config')).toContainElement(
    screen.getByRole('button', { name: 'Run analysis' }),
  );
  await fireEvent.click(screen.getByRole('button', { name: 'Connection settings' }));
  await fireEvent.input(screen.getByLabelText('New API key'), {
    target: { value: 'unsaved-private-key' },
  });
  await fireEvent.click(screen.getByRole('tab', { name: 'Usage', exact: true }));
  await fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Connection settings' }));
  expect(screen.getByRole('tab', { name: 'Connection', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByLabelText('New API key')).toHaveValue('');
  expect(host.analyzeSession).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain('saved-private-key');
});

it('reveals and focuses sensitive paths when the host rejects a pattern from another section', async () => {
  const host = {
    getSettings: async () => ({ darkMode: true, uiScale: 1, scanIntervalSec: 10 }),
    getUpdateStatus: async () => ({}),
    saveSettings: async () => ({ success: false, error: 'Unsafe or invalid regex pattern' }),
  };
  render(Settings, { host, appearance: vi.fn(), navigate: vi.fn() });
  await screen.findByText('Settings saved');
  await fireEvent.click(screen.getByRole('tab', { name: 'Monitoring', exact: true }));
  await fireEvent.input(screen.getByLabelText('Sensitive paths'), {
    target: { value: '(invalid' },
  });
  await fireEvent.click(screen.getByRole('tab', { name: 'Data & help' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() => expect(screen.getByLabelText('Sensitive paths')).toHaveFocus());
  expect(screen.getByRole('tab', { name: 'Monitoring', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByLabelText('Sensitive paths')).toHaveValue('(invalid');
  expect(await screen.findByRole('alert')).toHaveTextContent('Unsafe or invalid regex pattern');
});
