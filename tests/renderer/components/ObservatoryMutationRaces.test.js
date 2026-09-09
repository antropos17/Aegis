import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import Settings from '../../../frontend/observatory/components/Settings.svelte';
import Analysis from '../../../frontend/observatory/components/Analysis.svelte';
import Catalog from '../../../frontend/observatory/components/Catalog.svelte';
import Rules from '../../../frontend/observatory/components/Rules.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const telemetry = () => ({
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  agents: [
    {
      agent: 'Codex',
      process: 'codex.exe',
      pid: 42,
      instanceId: '42:live',
      instanceIdSource: 'os',
    },
  ],
});

it('keeps edits made while settings save is pending and saves only the submitted draft', async () => {
  const pending = deferred();
  let saved = { darkMode: true, uiScale: 1, scanIntervalSec: 10 };
  const host = {
    getSettings: async () => ({ ...saved }),
    getUpdateStatus: async () => ({}),
    saveSettings: vi.fn(async (value) => {
      await pending.promise;
      saved = value;
      return { success: true };
    }),
  };
  const onSettingsSaved = vi.fn();
  render(Settings, { host, appearance: vi.fn(), navigate: vi.fn(), onSettingsSaved });
  await screen.findByText('Settings saved');
  await fireEvent.click(screen.getByRole('tab', { name: 'Monitoring', exact: true }));
  await fireEvent.input(screen.getByLabelText('Scan interval (seconds)'), {
    target: { value: '20' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() => expect(host.saveSettings).toHaveBeenCalledTimes(1));
  await fireEvent.input(screen.getByLabelText('Scan interval (seconds)'), {
    target: { value: '35' },
  });
  pending.resolve();
  await screen.findByText('Completed');
  expect(saved.scanIntervalSec).toBe(20);
  expect(onSettingsSaved).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ scanIntervalSec: 20 }),
  );
  expect(screen.getByLabelText('Scan interval (seconds)')).toHaveValue('35');
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
});

it('does not erase a new provider draft when an earlier dialog save completes', async () => {
  const pending = deferred();
  const host = {
    getSettings: async () => ({}),
    saveSettings: vi.fn(async () => {
      await pending.promise;
      return { success: true };
    }),
  };
  render(Analysis, { host, telemetry: telemetry() });
  await fireEvent.click(screen.getByRole('button', { name: 'Connect AI analysis' }));
  await fireEvent.input(screen.getByLabelText('New API key'), { target: { value: 'fixture-old' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
  await waitFor(() => expect(host.saveSettings).toHaveBeenCalledTimes(1));
  await fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Connect AI analysis' }));
  await fireEvent.input(screen.getByLabelText('New API key'), { target: { value: 'fixture-new' } });
  pending.resolve();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save key' })).toBeEnabled());
  expect(screen.getByLabelText('New API key')).toHaveValue('fixture-new');
});

it('does not allow competing whole-catalog deletes while a write is pending', async () => {
  const pending = deferred();
  let custom = ['One', 'Two'].map((name) => ({
    id: name.toLowerCase(),
    displayName: name,
    names: [name + '.exe'],
  }));
  const host = {
    getAgentDatabase: async () => ({ agents: [] }),
    getCustomAgents: async () => custom,
    saveCustomAgents: vi.fn(async (value) => {
      await pending.promise;
      custom = value;
      return { success: true };
    }),
  };
  render(Catalog, { host, inspect: vi.fn() });
  await screen.findByText('One', { exact: true });
  const row = (name) => screen.getByText(name, { exact: true }).closest('tr');
  await fireEvent.click(within(row('One')).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(host.saveCustomAgents).toHaveBeenCalledTimes(1));
  expect(within(row('Two')).getByRole('button', { name: 'Delete' })).toBeDisabled();
  pending.resolve();
  await waitFor(() => expect(screen.queryByText('One', { exact: true })).toBeNull());
});

it('prevents reset-all racing a pending policy save', async () => {
  const pending = deferred();
  let reads = 0;
  const host = {
    getAllPermissions: vi.fn(async () => {
      if (++reads > 1) await pending.promise;
      return {};
    }),
    getRules: async () => [],
    saveAgentPermissions: vi.fn(async () => ({ success: true })),
    resetPermissionsToDefaults: vi.fn(async () => ({ success: true })),
  };
  render(Rules, { host, telemetry: telemetry() });
  await waitFor(() => expect(screen.getByLabelText('Target')).toHaveValue('Codex'));
  await fireEvent.click(screen.getByRole('button', { name: 'strict', exact: true }));
  await fireEvent.click(screen.getByText('Restore default policy'));
  await fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
  await waitFor(() => expect(host.getAllPermissions).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('button', { name: 'Reset all to defaults' })).toBeDisabled();
  expect(host.resetPermissionsToDefaults).not.toHaveBeenCalled();
  pending.resolve();
});

it('publishes settings only after confirmed writes and rereads successful imports', async () => {
  let saved = { darkMode: true, uiScale: 1, scanIntervalSec: 10 };
  const onSettingsSaved = vi.fn();
  const host = {
    getSettings: async () => saved,
    getUpdateStatus: async () => ({}),
    saveSettings: async () => ({ success: false, error: 'Save refused' }),
    importConfig: vi
      .fn()
      .mockResolvedValueOnce({ success: false })
      .mockImplementationOnce(async () => {
        saved = { ...saved, scanIntervalSec: 60 };
        return { success: true };
      }),
  };
  render(Settings, { host, appearance: vi.fn(), navigate: vi.fn(), onSettingsSaved });
  await screen.findByText('Settings saved');
  await fireEvent.click(screen.getByRole('tab', { name: 'Monitoring', exact: true }));
  await fireEvent.input(screen.getByLabelText('Scan interval (seconds)'), {
    target: { value: '20' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await screen.findByText('Save refused');
  expect(onSettingsSaved).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByRole('tab', { name: 'Data & help' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Import', exact: true }));
  await screen.findByText('Operation cancelled or not completed');
  expect(onSettingsSaved).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Scan interval (seconds)')).toHaveValue('20');
  await fireEvent.click(screen.getByRole('button', { name: 'Import', exact: true }));
  await waitFor(() =>
    expect(onSettingsSaved).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ scanIntervalSec: 60 }),
    ),
  );
  expect(screen.getByLabelText('Scan interval (seconds)')).toHaveValue('60');
});

it('uses explicit key removal intent and preserves text entered during that pending removal', async () => {
  const pending = deferred();
  const host = {
    getSettings: async () => ({ anthropicApiKey: 'fixture-saved' }),
    saveSettings: vi.fn(async () => {
      await pending.promise;
      return { success: true };
    }),
  };
  render(Analysis, { host, telemetry: telemetry() });
  await fireEvent.click(await screen.findByRole('button', { name: 'Connection settings' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Remove saved key' }));
  await waitFor(() => expect(host.saveSettings).toHaveBeenCalledTimes(1));
  expect(host.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ anthropicApiKey: '' }), {
    clearAnthropicApiKey: true,
  });
  await fireEvent.input(screen.getByLabelText('New API key'), {
    target: { value: 'fixture-replacement' },
  });
  expect(screen.getByRole('button', { name: 'Save key' })).toBeDisabled();
  pending.resolve();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save key' })).toBeEnabled());
  expect(screen.getByLabelText('New API key')).toHaveValue('fixture-replacement');
});

it('does not let an old provider settings seed overwrite a confirmed new configuration', async () => {
  const initial = deferred();
  let reads = 0;
  const host = {
    getSettings: async () => (++reads === 1 ? initial.promise : {}),
    saveSettings: vi.fn(async () => ({ success: true })),
  };
  render(Analysis, { host, telemetry: telemetry() });
  await fireEvent.click(screen.getByRole('button', { name: 'Connect AI analysis' }));
  await fireEvent.input(screen.getByLabelText('New API key'), {
    target: { value: 'fixture-configured' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
  await screen.findByText('Completed');
  initial.resolve({});
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.getByText('API key saved · verified on first analysis')).toBeInTheDocument();
  expect(host.saveSettings.mock.calls[0]).toHaveLength(1);
});

it('allows explicit removal of an unreadable saved key without enabling it in preview', async () => {
  const host = {
    getSettings: async () => ({ anthropicApiKey: '' }),
    saveSettings: vi.fn(async () => ({ success: true })),
  };
  const mounted = render(Analysis, { host, telemetry: telemetry() });
  await fireEvent.click(screen.getByRole('button', { name: 'Connect AI analysis' }));
  expect(screen.getByText(/OS keychain is locked/)).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: 'Remove saved key' }));
  await waitFor(() =>
    expect(host.saveSettings).toHaveBeenCalledExactlyOnceWith(
      { anthropicApiKey: '' },
      { clearAnthropicApiKey: true },
    ),
  );
  await fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
  await mounted.rerender({ preview: true });
  await fireEvent.click(screen.getByRole('button', { name: 'Connect AI analysis' }));
  expect(screen.queryByRole('button', { name: 'Remove saved key' })).toBeNull();
  expect(host.saveSettings).toHaveBeenCalledTimes(1);
});
