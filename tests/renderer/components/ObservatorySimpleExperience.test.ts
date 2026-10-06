import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import Settings from '../../../frontend/observatory/components/Settings.svelte';
import App from '../../../frontend/observatory/App.svelte';
import Agents from '../../../frontend/observatory/components/Agents.svelte';
import {
  emptyTelemetry,
  type Host,
  type RecordData,
} from '../../../frontend/observatory/runtime/host';

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it('saves the interface separately while preserving an unsaved monitoring draft', async () => {
  const host = {
    getSettings: vi.fn(async () => ({
      darkMode: false,
      uiScale: 1,
      scanIntervalSec: 10,
      customSensitivePatterns: [],
      ignoredDirectories: [],
    })),
    getUpdateStatus: async () => ({}),
    saveSettings: vi.fn(async () => ({ success: true })),
  };
  const onAdvancedChange = vi.fn();
  render(Settings, { host, appearance: vi.fn(), navigate: vi.fn(), onAdvancedChange });
  await screen.findByText('Settings saved');
  await fireEvent.click(screen.getByRole('tab', { name: 'Monitoring' }));
  await fireEvent.input(screen.getByLabelText('Scan interval (seconds)'), {
    target: { value: '45' },
  });
  await fireEvent.input(screen.getByLabelText('Sensitive paths'), {
    target: { value: 'draft-secret' },
  });
  await fireEvent.click(screen.getByRole('checkbox', { name: 'Advanced interface' }));
  expect(localStorage.getItem('aegis-advanced-mode')).toBe('true');
  expect(onAdvancedChange).toHaveBeenCalledExactlyOnceWith(true);
  expect(screen.getByLabelText('Scan interval (seconds)')).toHaveValue('45');
  expect(screen.getByLabelText('Sensitive paths')).toHaveValue('draft-secret');
  expect(screen.getByRole('button', { name: 'Save settings' })).toBeEnabled();
  expect(host.saveSettings).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() =>
    expect(host.saveSettings).toHaveBeenCalledExactlyOnceWith(
      { scanIntervalSec: 45, customSensitivePatterns: ['draft-secret'] },
      { patch: true },
    ),
  );
  expect(localStorage.getItem('aegis-advanced-mode')).toBe('true');
});

it('leaves the previous interface selected when persistence fails', async () => {
  const onAdvancedChange = vi.fn();
  render(Settings, {
    host: { getSettings: async () => ({ darkMode: false, uiScale: 1, scanIntervalSec: 10 }) },
    appearance: vi.fn(),
    navigate: vi.fn(),
    onAdvancedChange,
  });
  await screen.findByText('Settings saved');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Quota exceeded');
  });
  await fireEvent.click(screen.getByRole('checkbox', { name: 'Advanced interface' }));
  expect(screen.getByRole('checkbox', { name: 'Advanced interface' })).not.toBeChecked();
  expect(screen.getByRole('alert')).toHaveTextContent('Could not save interface preference');
  expect(onAdvancedChange).not.toHaveBeenCalled();
  expect(localStorage.getItem('aegis-advanced-mode')).toBeNull();
});

it('keeps the independently saved interface available when host settings cannot load', async () => {
  const onAdvancedChange = vi.fn();
  render(Settings, {
    host: {
      getSettings: async () => {
        throw new Error('Settings unavailable');
      },
    },
    appearance: vi.fn(),
    navigate: vi.fn(),
    onAdvancedChange,
  });
  await screen.findByRole('alert');
  const control = screen.getByRole('checkbox', { name: 'Advanced interface' });
  expect(control).toBeEnabled();
  await fireEvent.click(control);
  expect(control).toBeChecked();
  expect(onAdvancedChange).toHaveBeenCalledExactlyOnceWith(true);
  expect(localStorage.getItem('aegis-advanced-mode')).toBe('true');
  expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
});

function appBridge() {
  const listeners: Record<string, (_value: unknown) => void> = {};
  const saved: RecordData = {
    darkMode: false,
    uiScale: 1,
    scanIntervalSec: 10,
    customSensitivePatterns: [],
    ignoredDirectories: [],
  };
  const host: Host = {
    getSettings: async () => ({ ...saved }),
    getStats: async () => ({ appHealth: { state: 'HEALTHY', populationReliable: true } }),
    getResourceUsage: async () => ({}),
    getFalsePositives: async () => [],
    getAppVersion: async () => 'test',
    getUpdateStatus: async () => ({}),
    saveSettings: vi.fn(async (patch: unknown) => {
      Object.assign(saved, patch);
      return { success: true };
    }),
  };
  for (const name of [
    'onScanBatch',
    'onFileAccess',
    'onNetworkUpdate',
    'onStatsUpdate',
    'onScanStatus',
    'onAgentResourceUsage',
    'onTokenCosts',
  ]) {
    host[name] = (callback: unknown) => {
      listeners[name] = callback as (_value: unknown) => void;
      return () => {
        delete listeners[name];
      };
    };
  }
  return { host, listeners };
}

function navigation() {
  return within(screen.getByRole('navigation', { name: 'Main navigation' }));
}

it('starts with five Simple destinations and truthful unknown agent state', () => {
  const { host } = appBridge();
  render(App, { host });
  expect(
    navigation()
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label')),
  ).toEqual(['Home', 'Agents', 'Activity', 'Check files', 'Settings']);
  expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  expect(
    screen.getByText(
      'Waiting for a reliable process observation. Running agents are not yet known.',
    ),
  ).toBeVisible();
  expect(
    within(screen.getByRole('region', { name: 'Observed agents' })).getByText(
      /—\s*agents ·\s*—\s*processes/,
    ),
  ).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Agent radar' })).toBeNull();
  expect(localStorage.getItem('aegis-advanced-mode')).toBeNull();
});

// Multiple full-workspace transitions use the existing App integration coverage budget.
it('opens technical commands and keyboard routes without changing the saved mode', async () => {
  const { host } = appBridge();
  render(App, { host });
  await fireEvent.click(screen.getByRole('button', { name: /Commands/ }));
  const input = screen.getByRole('combobox', { name: 'Find a workspace or action' });
  await fireEvent.input(input, { target: { value: 'network' } });
  expect(screen.getByRole('option', { name: 'Network · Advanced · Investigate' })).toBeVisible();
  await fireEvent.keyDown(input, { key: 'Enter' });
  await screen.findByRole('heading', { level: 1, name: 'Network' });
  expect(navigation().getAllByRole('button')).toHaveLength(5);
  expect(
    screen.getByText(
      'This technical workspace remains available in Simple. Show every workspace from Settings.',
    ),
  ).toBeVisible();
  expect(screen.getByRole('main')).toHaveFocus();
  await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  await screen.findByRole('heading', { level: 1, name: 'Home' });
  await fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
  await screen.findByRole('heading', { level: 1, name: 'Network' });
  await fireEvent.keyDown(window, { key: '5' });
  await screen.findByRole('heading', { level: 1, name: 'Statistics' });
  expect(localStorage.getItem('aegis-advanced-mode')).toBeNull();
}, 15_000);

// Two full App mounts use the same coverage budget as existing workspace integration tests.
it('retains drafts through interface changes and navigation and restores Advanced after restart', async () => {
  const transport = appBridge();
  const mounted = render(App, { host: transport.host });
  await fireEvent.click(navigation().getByRole('button', { name: 'Settings' }));
  await screen.findByText('Settings saved');
  await fireEvent.click(screen.getByRole('tab', { name: 'Monitoring' }));
  await fireEvent.input(screen.getByLabelText('Scan interval (seconds)'), {
    target: { value: '45' },
  });
  const mode = screen.getByRole('checkbox', { name: 'Advanced interface' });
  mode.focus();
  await fireEvent.click(mode);
  expect(mode).toHaveFocus();
  expect(navigation().getAllByRole('button')).toHaveLength(14);
  await fireEvent.click(navigation().getByRole('button', { name: 'Monitoring' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByLabelText('Scan interval (seconds)')).toHaveValue('45');
  await fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(screen.getByLabelText('Scan interval (seconds)')).toHaveValue('10');
  expect(mode).toBeChecked();
  expect(localStorage.getItem('aegis-advanced-mode')).toBe('true');
  mounted.unmount();
  const next = appBridge();
  render(App, { host: next.host });
  expect(navigation().getAllByRole('button')).toHaveLength(14);
  expect(screen.getByRole('heading', { level: 1, name: 'Monitoring' })).toBeVisible();
}, 15_000);

it('mounts Simple Home only after its first visit and preserves its activity search across mode changes', async () => {
  localStorage.setItem('aegis-advanced-mode', 'true');
  const { host } = appBridge();
  render(App, { host });
  expect(screen.queryAllByLabelText('Search events')).toHaveLength(0);
  await fireEvent.click(navigation().getByRole('button', { name: 'Events' }));
  expect(screen.getAllByLabelText('Search events')).toHaveLength(1);
  await fireEvent.click(navigation().getByRole('button', { name: 'Settings' }));
  await screen.findByText('Settings saved');
  await fireEvent.click(screen.getByRole('checkbox', { name: 'Advanced interface' }));
  await fireEvent.click(navigation().getByRole('button', { name: 'Home' }));
  const homeSearch = within(screen.getByRole('region', { name: 'Recent activity' })).getByLabelText(
    'Search events',
  );
  await fireEvent.input(homeSearch, { target: { value: '/retained-home-draft' } });
  await fireEvent.click(navigation().getByRole('button', { name: 'Settings' }));
  await fireEvent.click(screen.getByRole('checkbox', { name: 'Advanced interface' }));
  await fireEvent.click(navigation().getByRole('button', { name: 'Monitoring' }));
  expect(homeSearch).toBeInTheDocument();
  expect(homeSearch).not.toBeVisible();
  await fireEvent.click(navigation().getByRole('button', { name: 'Settings' }));
  await fireEvent.click(screen.getByRole('checkbox', { name: 'Advanced interface' }));
  await fireEvent.click(navigation().getByRole('button', { name: 'Home' }));
  const revisited = within(screen.getByRole('region', { name: 'Recent activity' })).getByLabelText(
    'Search events',
  );
  expect(revisited).toBe(homeSearch);
  expect(revisited).toHaveValue('/retained-home-draft');
});

it('keeps the Advanced agent table section while Simple uses the compact overview', async () => {
  const telemetry = { ...emptyTelemetry(), ready: true, stale: false };
  const mounted = render(Agents, { telemetry, inspect: vi.fn() });
  await fireEvent.click(screen.getByRole('tab', { name: 'Resources' }));
  expect(screen.getByRole('columnheader', { name: 'Tokens' })).toBeVisible();
  await mounted.rerender({ advanced: false });
  expect(screen.queryByRole('tab')).toBeNull();
  expect(screen.getByRole('columnheader', { name: 'Risk' })).toBeVisible();
  await mounted.rerender({ advanced: true });
  expect(screen.getByRole('tab', { name: 'Resources' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('columnheader', { name: 'Tokens' })).toBeVisible();
});
