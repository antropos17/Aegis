import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import Settings from '../../../frontend/observatory/components/Settings.svelte';
import Analysis from '../../../frontend/observatory/components/Analysis.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';
import { createPreviewHost } from '../../../frontend/observatory/demo/host';

function sharedHost() {
  let saved = {
    darkMode: true,
    uiScale: 1,
    scanIntervalSec: 10,
    notificationsEnabled: true,
    customSensitivePatterns: ['secret'],
    ignoredDirectories: ['X:/build'],
    anthropicApiKey: '',
  };
  return {
    getSettings: vi.fn(async () => structuredClone(saved)),
    getUpdateStatus: async () => ({}),
    saveSettings: vi.fn(async (value, options) => {
      saved = options?.patch ? { ...saved, ...value } : value;
      return { success: true };
    }),
  };
}
const mountSettings = (host, extra = {}) =>
  render(Settings, { host, appearance: vi.fn(), navigate: vi.fn(), ...extra });

it('preserves independent edits from two settings windows opened on the same old snapshot', async () => {
  const host = sharedHost();
  const first = within(mountSettings(host).container);
  const second = within(mountSettings(host).container);
  await first.findByText('Settings saved');
  await second.findByText('Settings saved');
  await fireEvent.click(first.getByRole('tab', { name: 'Monitoring', exact: true }));
  await fireEvent.input(first.getByLabelText('Scan interval (seconds)'), {
    target: { value: '60' },
  });
  await fireEvent.click(second.getByRole('tab', { name: 'Monitoring', exact: true }));
  await fireEvent.click(second.getByLabelText('Notifications'));
  await fireEvent.click(first.getByRole('button', { name: 'Save settings' }));
  await first.findByText('Completed');
  await fireEvent.click(second.getByRole('button', { name: 'Save settings' }));
  await second.findByText('Completed');
  expect(host.saveSettings.mock.calls).toEqual([
    [{ scanIntervalSec: 60 }, { patch: true }],
    [{ notificationsEnabled: false }, { patch: true }],
  ]);
  expect(await host.getSettings()).toMatchObject({
    scanIntervalSec: 60,
    notificationsEnabled: false,
  });
});

it('saves settings and provider changes from mounted old drafts without crossing their fields', async () => {
  const host = sharedHost();
  const onSettingsSaved = vi.fn();
  const prefs = within(mountSettings(host, { onSettingsSaved }).container);
  const provider = within(render(Analysis, { host, telemetry: emptyTelemetry() }).container);
  await prefs.findByText('Settings saved');
  await fireEvent.click(prefs.getByRole('tab', { name: 'Monitoring', exact: true }));
  await fireEvent.input(prefs.getByLabelText('Scan interval (seconds)'), {
    target: { value: '60' },
  });
  await fireEvent.click(provider.getByRole('button', { name: 'Connect AI analysis' }));
  await fireEvent.input(screen.getByLabelText('New API key'), {
    target: { value: 'fixture-secret' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
  await screen.findByText('Completed');
  await fireEvent.click(prefs.getByRole('button', { name: 'Save settings' }));
  await prefs.findByText('Completed');
  expect(host.saveSettings.mock.calls).toEqual([
    [{ anthropicApiKey: 'fixture-secret' }, { patch: true }],
    [{ scanIntervalSec: 60 }, { patch: true }],
  ]);
  expect(await host.getSettings()).toMatchObject({
    scanIntervalSec: 60,
    anthropicApiKey: 'fixture-secret',
  });
  expect(onSettingsSaved.mock.calls[0][0]).toMatchObject({ scanIntervalSec: 60 });
  expect(onSettingsSaved.mock.calls[0][0]).not.toHaveProperty('anthropicApiKey');
});

it('keeps a confirmed write saved when its refresh fails and does not publish a stale callback', async () => {
  const host = sharedHost();
  const onSettingsSaved = vi.fn();
  mountSettings(host, { onSettingsSaved });
  await screen.findByText('Settings saved');
  await fireEvent.click(screen.getByRole('tab', { name: 'Monitoring', exact: true }));
  await fireEvent.input(screen.getByLabelText('Scan interval (seconds)'), {
    target: { value: '60' },
  });
  host.getSettings.mockRejectedValueOnce(new Error('Read unavailable'));
  await fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await screen.findByText('Completed');
  expect(screen.getByText(/Settings saved. Could not refresh/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
  expect(onSettingsSaved).not.toHaveBeenCalled();
  expect(host.saveSettings).toHaveBeenCalledExactlyOnceWith(
    { scanIntervalSec: 60 },
    { patch: true },
  );
  expect(await host.getSettings()).toMatchObject({ scanIntervalSec: 60 });
});

it('does not resend unchanged normalized patterns and exclusions', async () => {
  const host = sharedHost();
  mountSettings(host);
  await screen.findByText('Settings saved');
  await fireEvent.click(screen.getByRole('tab', { name: 'Monitoring', exact: true }));
  await fireEvent.input(screen.getByLabelText('Sensitive paths'), {
    target: { value: '  secret  \n' },
  });
  await fireEvent.input(screen.getByLabelText('Additional exclusions'), {
    target: { value: '\n X:/build \n' },
  });
  await fireEvent.input(screen.getByLabelText('Scan interval (seconds)'), {
    target: { value: '20' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() =>
    expect(host.saveSettings).toHaveBeenCalledExactlyOnceWith(
      { scanIntervalSec: 20 },
      { patch: true },
    ),
  );
});

it('uses isolated patch merging and detached reads in the preview bridge', async () => {
  const host = createPreviewHost();
  await host.saveSettings({ scanIntervalSec: 60 }, { patch: true });
  await host.saveSettings({ ignoredDirectories: ['X:/fixture'] }, { patch: true });
  const first = await host.getSettings();
  first.ignoredDirectories.push('mutated');
  expect(await host.getSettings()).toMatchObject({
    scanIntervalSec: 60,
    uiScale: 1,
    ignoredDirectories: ['X:/fixture'],
  });
  expect(await host.saveSettings({ darkMode: false }, { patch: 'true' })).toMatchObject({
    success: false,
  });
  expect(await host.getSettings()).toMatchObject({ darkMode: true });
});

it('retains existing provider configuration when a failed replacement finishes before its initial read', async () => {
  let resolveSeed;
  const seed = new Promise((resolve) => {
    resolveSeed = resolve;
  });
  const host = {
    getSettings: async () => seed,
    saveSettings: vi.fn(async () => ({ success: false, error: 'Keychain locked' })),
  };
  render(Analysis, { host, telemetry: emptyTelemetry() });
  await fireEvent.click(screen.getByRole('button', { name: 'Connect AI analysis' }));
  await fireEvent.input(screen.getByLabelText('New API key'), {
    target: { value: 'fixture-replacement' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
  await screen.findByText('Keychain locked');
  resolveSeed({ anthropicApiKey: 'fixture-existing' });
  await screen.findByText('API key saved · verified on first analysis');
  expect(screen.getByLabelText('New API key')).toHaveValue('fixture-replacement');
});

it('does not overwrite another window theme and motion when saving an old interval draft', async () => {
  localStorage.setItem('aegis-theme', 'dark');
  localStorage.setItem('aegis-motion', 'full');
  const host = sharedHost();
  const firstAppearance = vi.fn();
  const secondAppearance = vi.fn();
  const first = within(mountSettings(host, { appearance: firstAppearance }).container);
  const second = within(mountSettings(host, { appearance: secondAppearance }).container);
  await first.findByText('Settings saved');
  await second.findByText('Settings saved');
  await fireEvent.change(first.getByLabelText('Theme'), { target: { value: 'light' } });
  await fireEvent.click(first.getByRole('checkbox', { name: /Animations/ }));
  await fireEvent.click(first.getByRole('button', { name: 'Save settings' }));
  await first.findByText('Completed');
  expect(firstAppearance).toHaveBeenCalledExactlyOnceWith(false, 1, false);
  await fireEvent.click(second.getByRole('tab', { name: 'Monitoring', exact: true }));
  await fireEvent.input(second.getByLabelText('Scan interval (seconds)'), {
    target: { value: '60' },
  });
  await fireEvent.click(second.getByRole('button', { name: 'Save settings' }));
  await second.findByText('Completed');
  expect(localStorage.getItem('aegis-theme')).toBe('light');
  expect(localStorage.getItem('aegis-motion')).toBe('reduce');
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(document.documentElement.dataset.motion).toBe('reduce');
  expect(secondAppearance).not.toHaveBeenCalled();
  expect(await host.getSettings()).toMatchObject({ darkMode: false, scanIntervalSec: 60 });
});

it('does not replay saved appearance over a newer global theme or scale preview', async () => {
  localStorage.setItem('aegis-theme', 'dark');
  let resolveWrite;
  const pending = new Promise((resolve) => {
    resolveWrite = resolve;
  });
  const host = sharedHost();
  host.saveSettings.mockImplementationOnce(async () => {
    await pending;
    return { success: true };
  });
  const appearance = vi.fn();
  const first = within(mountSettings(host, { appearance }).container);
  const second = within(mountSettings(host).container);
  await first.findByText('Settings saved');
  await second.findByText('Settings saved');
  await fireEvent.change(first.getByLabelText('Theme'), { target: { value: 'light' } });
  await fireEvent.click(first.getByRole('button', { name: 'Save settings' }));
  await waitFor(() => expect(host.saveSettings).toHaveBeenCalledTimes(1));
  await fireEvent.change(second.getByLabelText('Theme'), { target: { value: 'dark-hc' } });
  await fireEvent.input(second.getByLabelText('Interface scale'), { target: { value: '1.5' } });
  resolveWrite();
  await first.findByText('Completed');
  expect(document.documentElement.dataset.theme).toBe('dark-hc');
  expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.5');
  expect(appearance).not.toHaveBeenCalled();
  expect(second.getByText('Unsaved changes')).toBeInTheDocument();
});

it('blocks invalid exact values and saves valid interval and scale changes as a patch', async () => {
  const host = sharedHost();
  mountSettings(host);
  await screen.findByText('Settings saved');
  await fireEvent.input(screen.getByLabelText('Interface scale percent'), {
    target: { value: '125' },
  });
  expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.25');
  await fireEvent.click(screen.getByRole('tab', { name: 'Monitoring' }));
  const exact = screen.getByLabelText('Exact scan interval (seconds)');
  await fireEvent.input(exact, { target: { value: '' } });
  expect(exact).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('positive number');
  expect(host.saveSettings).not.toHaveBeenCalled();
  await fireEvent.input(exact, { target: { value: '17' } });
  expect(exact).toHaveAttribute('aria-invalid', 'false');
  await fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await screen.findByText('Completed');
  expect(host.saveSettings).toHaveBeenCalledExactlyOnceWith(
    { uiScale: 1.25, scanIntervalSec: 17 },
    { patch: true },
  );
});

it('keeps presets as a draft and restores their preview when discarded', async () => {
  const host = sharedHost();
  const appearance = vi.fn();
  mountSettings(host, { appearance });
  await screen.findByText('Settings saved');
  const savedTheme = screen.getByLabelText('Theme').value;
  await fireEvent.click(screen.getByRole('button', { name: '125%', exact: true }));
  expect(screen.getByLabelText('Interface scale percent')).toHaveValue(125);
  await fireEvent.click(screen.getByRole('tab', { name: 'Monitoring' }));
  await fireEvent.click(screen.getByRole('button', { name: '5 s', exact: true }));
  expect(screen.getByLabelText('Exact scan interval (seconds)')).toHaveValue(5);
  expect(host.saveSettings).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Exact scan interval (seconds)')).toHaveValue(10),
  );
  expect(appearance).toHaveBeenLastCalledWith(
    savedTheme.startsWith('dark'),
    1,
    savedTheme.endsWith('-hc'),
  );
});

it('recovers a failed settings load without reloading the workspace', async () => {
  const host = sharedHost();
  host.getSettings.mockRejectedValueOnce(new Error('Settings temporarily unavailable'));
  mountSettings(host);
  await screen.findByRole('alert');
  await fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  await screen.findByText('Settings saved');
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(screen.getByLabelText('Theme')).toBeEnabled();
});

it('does not create a dirty draft when the initial shell theme settles after loading', async () => {
  localStorage.setItem('aegis-theme', 'light');
  const host = sharedHost();
  mountSettings(host, { currentTheme: 'dark' });
  await waitFor(() => expect(screen.getByLabelText('Theme')).toHaveValue('dark'));
  expect(screen.getByText('Settings saved')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
  expect(host.saveSettings).not.toHaveBeenCalled();
  localStorage.removeItem('aegis-theme');
});
