import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import App from '../../../frontend/observatory/App.svelte';
import type { Host, RecordData } from '../../../frontend/observatory/runtime/host';

const stats = { appHealth: { state: 'HEALTHY', populationReliable: true } };
const worker = {
  agent: 'Codex',
  pid: 101,
  instanceId: '101:first',
  instanceIdSource: 'os',
  process: 'codex.exe',
  cwd: 'X:/fixture-project',
  riskScore: 42,
};
function bridge() {
  const listeners: Record<string, (value: unknown) => void> = {};
  const host: Host = {
    getStats: async () => stats,
    getResourceUsage: async () => ({}),
    getFalsePositives: vi.fn(async () => []),
    getSettings: async () => ({ darkMode: false, uiScale: 1, scanIntervalSec: 10 }),
    getAppVersion: async () => 'test',
    getUpdateStatus: async () => ({}),
    suspendProcess: vi.fn(async () => ({ success: true })),
  };
  for (const name of [
    'onScanBatch',
    'onStatsUpdate',
    'onFileAccess',
    'onNetworkUpdate',
    'onScanStatus',
    'onAgentResourceUsage',
    'onTokenCosts',
  ]) {
    host[name] = (callback: unknown) => {
      listeners[name] = callback as (value: unknown) => void;
      return () => {
        delete listeners[name];
      };
    };
  }
  return {
    host,
    push: async (name: string, data: unknown) => {
      await act(() => listeners[name](data));
    },
  };
}
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('aegis-advanced-mode', 'false');
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it('keeps agent selection and activity in one destination and retains its filters through settings', async () => {
  const transport = bridge();
  render(App, { host: transport.host });
  const navigation = within(screen.getByRole('navigation', { name: 'Main navigation' }));
  expect(
    navigation.getAllByRole('button').map((button) => button.getAttribute('aria-label')),
  ).toEqual(['Investigate', 'Check files', 'Settings']);
  await transport.push('onScanBatch', { stats, agents: [worker] });
  const workspace = screen.getByRole('region', { name: 'Investigation workspace' });
  const search = within(workspace).getByRole('searchbox', { name: 'Search events' });
  await fireEvent.input(search, { target: { value: 'keep-this-filter' } });
  await fireEvent.click(within(workspace).getByRole('button', { name: 'Codex' }));
  expect(navigation.getByRole('button', { name: 'Investigate' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(within(workspace).getByRole('combobox', { name: 'Worker process' })).toHaveValue('');
  expect(search).toHaveValue('keep-this-filter');
  expect(transport.host.suspendProcess).not.toHaveBeenCalled();
  await fireEvent.click(navigation.getByRole('button', { name: 'Settings' }));
  await fireEvent.click(navigation.getByRole('button', { name: 'Investigate' }));
  expect(search).toBeVisible();
  expect(search).toHaveValue('keep-this-filter');
  expect(screen.getAllByRole('searchbox', { name: 'Search events' })).toHaveLength(1);
}, 15_000);

it('reviews captured file evidence and false-alarm status beside the same feed without a modal', async () => {
  const transport = bridge();
  render(App, { host: transport.host });
  await transport.push('onScanBatch', { stats, agents: [worker] });
  const evidence: RecordData = {
    agent: worker.agent,
    pid: worker.pid,
    instanceId: worker.instanceId,
    file: 'X:/fixture-project/review-this.txt',
    action: 'modified',
    sensitive: true,
    timestamp: Date.now(),
    attribution: { status: 'confirmed', evidence: [] },
  };
  await transport.push('onFileAccess', [evidence]);
  const workspace = screen.getByRole('region', { name: 'Investigation workspace' });
  await fireEvent.click(within(workspace).getByText('review-this.txt'));
  const inspector = screen.getByRole('region', { name: 'Selected evidence' });
  expect(within(inspector).getByText(evidence.file as string)).toBeVisible();
  expect(within(inspector).getByRole('button', { name: 'Mute false alarm' })).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(within(workspace).getByRole('searchbox', { name: 'Search events' })).toBeVisible();
  await transport.push('onFileAccess', [
    { ...evidence, action: 'deleted', timestamp: Date.now() + 1 },
  ]);
  expect(within(inspector).getByText('modified', { exact: true })).toBeVisible();
  await fireEvent.click(within(inspector).getByRole('button', { name: 'Close evidence' }));
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: 'Selected evidence' })).toBeNull(),
  );
}, 15_000);

it('retains the feed actor when opening held unnamed evidence after that worker departs', async () => {
  const transport = bridge();
  render(App, { host: transport.host });
  await transport.push('onScanBatch', { stats, agents: [worker] });
  await transport.push('onFileAccess', [
    {
      pid: worker.pid,
      instanceId: worker.instanceId,
      file: 'X:/fixture-project/held.txt',
      action: 'modified',
      timestamp: Date.now(),
      attribution: { status: 'confirmed', evidence: [] },
    },
  ]);
  const opener = screen.getByRole('button', { name: 'Open 1 observations for held.txt' });
  await act(() => opener.focus());
  await transport.push('onScanBatch', { stats, agents: [] });
  await fireEvent.click(opener);
  const inspector = screen.getByRole('region', { name: 'Selected evidence' });
  expect(within(inspector).getByText('Codex', { exact: true })).toBeVisible();
  await fireEvent.input(screen.getByRole('searchbox', { name: 'Search events' }), {
    target: { value: 'hide-opener' },
  });
  await fireEvent.click(within(inspector).getByRole('button', { name: 'Close evidence' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Activity' })).toHaveFocus());
}, 15_000);

it('updates full details when the original inspector finishes a pending exception write', async () => {
  const transport = bridge();
  let saved: unknown[] = [];
  let release = () => {};
  const writeGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  transport.host.getFalsePositives = vi.fn(async () => saved);
  transport.host.addFalsePositive = vi.fn(async (entry: unknown) => {
    await writeGate;
    saved = [entry];
    return { success: true };
  });
  render(App, { host: transport.host });
  await transport.push('onScanBatch', { stats, agents: [worker] });
  await transport.push('onFileAccess', [
    {
      agent: worker.agent,
      instanceId: worker.instanceId,
      file: 'X:/fixture-project/pending.txt',
      action: 'modified',
      timestamp: Date.now(),
    },
  ]);
  await fireEvent.click(
    screen.getByRole('button', { name: 'Open 1 observations for pending.txt' }),
  );
  const inspector = screen.getByRole('region', { name: 'Selected evidence' });
  const mute = within(inspector).getByRole('button', { name: 'Mute false alarm' });
  await waitFor(() => expect(mute).toBeEnabled());
  await fireEvent.click(mute);
  await waitFor(() => expect(transport.host.addFalsePositive).toHaveBeenCalledTimes(1));
  await fireEvent.click(within(inspector).getByRole('button', { name: 'Full details' }));
  const dialog = screen.getByRole('dialog');
  await waitFor(() =>
    expect(within(dialog).getByRole('button', { name: 'Mute false alarm' })).toBeEnabled(),
  );
  await act(() => release());
  await waitFor(() =>
    expect(within(dialog).getByRole('button', { name: 'Re-enable alerts' })).toBeEnabled(),
  );
  expect(transport.host.addFalsePositive).toHaveBeenCalledTimes(1);
}, 15_000);
