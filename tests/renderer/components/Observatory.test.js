import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';
import Monitoring from '../../../frontend/observatory/components/Monitoring.svelte';
import Rules from '../../../frontend/observatory/components/Rules.svelte';
import Settings from '../../../frontend/observatory/components/Settings.svelte';
import Reports from '../../../frontend/observatory/components/Reports.svelte';
import Analysis from '../../../frontend/observatory/components/Analysis.svelte';
import Catalog from '../../../frontend/observatory/components/Catalog.svelte';
import Statistics from '../../../frontend/observatory/components/Statistics.svelte';
import Metadata from '../../../frontend/observatory/components/Metadata.svelte';

const agent = (id, pid = 101) => ({
  agent: 'Claude Code',
  process: 'claude.exe',
  pid,
  instanceId: id,
  instanceIdSource: 'os',
  cwd: 'X:/project',
});
const telemetry = (agents = [agent('101:1')]) => ({
  ...emptyTelemetry(),
  agents,
  ready: true,
  stale: false,
});
const noOp = () => {};

describe('Observatory production components', () => {
  it('selects exact same-name instances and never joins null identities to resources', async () => {
    const inspect = vi.fn();
    render(Monitoring, {
      telemetry: {
        ...telemetry([agent('101:1'), agent('102:1', 102), agent(null, 103)]),
        resources: [{ instanceId: null, cpu: 99.9 }],
      },
      selected: null,
      inspect,
    });
    await fireEvent.click(screen.getByRole('button', { name: /Select Claude Code, 3 processes/ }));
    await fireEvent.click(screen.getByText(/Individual processes/));
    await fireEvent.change(screen.getByLabelText('Selected process'), {
      target: { value: '102:1' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Process', exact: true }));
    expect(inspect.mock.calls[0][1].instanceId).toBe('102:1');
    expect(screen.queryByText('99.9%')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Clear radar selection' }));
    expect(screen.queryByRole('button', { name: 'Process', exact: true })).toBeNull();
  });

  it('preserves permission drafts across new snapshots and preserves other project overrides on save', async () => {
    const host = {
      getAllPermissions: vi.fn(async () => ({
        permissions: {},
        instancePermissions: { 'Other::project': { filesystem: 'allow' } },
      })),
      getRules: async () => [],
      saveInstancePermissions: vi.fn(async () => ({ success: true })),
    };
    const mounted = render(Rules, { host, telemetry: telemetry() });
    await waitFor(() => expect(host.getAllPermissions).toHaveBeenCalled());
    await fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'Claude Code' } });
    await fireEvent.click(screen.getByRole('button', { name: 'strict', exact: true }));
    await mounted.rerender({ host, telemetry: telemetry() });
    expect(screen.getByLabelText('Network')).toHaveValue('block');
    await fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
    await waitFor(() => expect(host.saveInstancePermissions).toHaveBeenCalled());
    expect(host.saveInstancePermissions.mock.calls[0][0]).toMatchObject({
      agentName: 'Claude Code',
      parentEditor: null,
      cwd: null,
      permissions: { network: 'block' },
    });
  });

  it('shows failed persistence, excludes unrelated settings from patches and never exposes the provider key', async () => {
    const settings = {
      darkMode: true,
      uiScale: 1,
      scanIntervalSec: 10,
      anthropicApiKey: 'private-test-key',
      customAgents: [{ id: 'mine' }],
    };
    const host = {
      getSettings: async () => settings,
      getUpdateStatus: async () => ({}),
      saveSettings: vi.fn(async () => ({ success: false, error: 'Disk full' })),
    };
    const appearance = vi.fn();
    const { container } = render(Settings, { host, appearance, navigate: noOp });
    await screen.findByText('Settings saved');
    await fireEvent.click(screen.getByRole('tab', { name: 'Monitoring', exact: true }));
    await fireEvent.input(screen.getByLabelText('Scan interval (seconds)'), {
      target: { value: '20' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk full');
    expect(host.saveSettings).toHaveBeenCalledExactlyOnceWith(
      { scanIntervalSec: 20 },
      { patch: true },
    );
    expect(appearance).not.toHaveBeenCalled();
    expect(container.innerHTML).not.toContain('private-test-key');
  });

  it('renders update notes as text and requires separate download and restart actions', async () => {
    let push;
    const host = {
      getSettings: async () => ({}),
      getUpdateStatus: async () => ({ status: 'available', notes: '<img src=x onerror=alert(1)>' }),
      onUpdateStatus: (cb) => {
        push = cb;
        return noOp;
      },
      downloadUpdate: vi.fn(async () => ({ status: 'downloading' })),
      installUpdate: vi.fn(async () => ({ status: 'ready' })),
    };
    const { container } = render(Settings, { host, appearance: noOp, navigate: noOp });
    await fireEvent.click(screen.getByRole('tab', { name: 'Desktop & updates' }));
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    await fireEvent.click(await screen.findByRole('button', { name: 'Download update' }));
    expect(host.downloadUpdate).toHaveBeenCalledOnce();
    expect(host.installUpdate).not.toHaveBeenCalled();
    expect(container.querySelector('img[src="x"], img[onerror]')).toBeNull();
    push({ status: 'ready' });
    await fireEvent.click(await screen.findByRole('button', { name: 'Install and restart' }));
    expect(host.installUpdate).toHaveBeenCalledOnce();
  });

  it('continues a page whose timestamps all tie without losing the boundary cursor', async () => {
    const timestamp = '2026-01-01T00:00:00.000Z';
    const page = Array.from({ length: 100 }, (_, id) => ({
      timestamp,
      eventId: id,
      type: 'file-access',
    }));
    const host = {
      getAuditStats: async () => ({ persisted: 101 }),
      getAuditEntriesBefore: vi
        .fn()
        .mockResolvedValueOnce(page)
        .mockResolvedValueOnce([{ timestamp, eventId: 100, type: 'file-access' }]),
    };
    const inspect = vi.fn();
    render(Reports, { host, audit: true, inspect, telemetry: telemetry(), navigate: noOp });
    await screen.findByText('100 audit entries loaded');
    const older = screen.getByText('Load older entries');
    await fireEvent.click(older);
    await screen.findByText('101 audit entries loaded');
    await fireEvent.click(
      screen.getByRole('button', { name: 'Open 101 observations for file-access' }),
    );
    expect(new Set(inspect.mock.calls[0][1].observations.map((row) => row.eventId)).size).toBe(101);
    expect(host.getAuditEntriesBefore.mock.calls[1]).toEqual([timestamp, 100, undefined, 100]);
    await waitFor(() => expect(older).toBeDisabled());
  });

  it('keeps cancelled exports visible as incomplete', async () => {
    render(Reports, {
      host: { exportLog: async () => ({ success: false }) },
      inspect: noOp,
      telemetry: telemetry(),
      navigate: noOp,
    });
    await fireEvent.click(screen.getByRole('tab', { name: 'Export', exact: true }));
    await fireEvent.click(screen.getByRole('button', { name: 'JSON activity log', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('cancelled');
    expect(screen.queryByText('Completed')).toBeNull();
  });

  it('does not call the analysis provider until requested and clears unsaved keys on navigation', async () => {
    const host = {
      getSettings: async () => ({ anthropicApiKey: 'stored-secret' }),
      analyzeSession: vi.fn(async () => ({
        success: true,
        structured: { summary: '<img src=x>' },
      })),
    };
    const mounted = render(Analysis, { host, telemetry: telemetry(), visible: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run analysis' })).toBeEnabled());
    expect(host.analyzeSession).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Connection settings' }));
    await fireEvent.input(screen.getByLabelText('New API key'), {
      target: { value: 'unsaved-secret' },
    });
    await mounted.rerender({ host, telemetry: telemetry(), visible: false });
    expect(screen.queryByLabelText('New API key')).toBeNull();
    await mounted.rerender({ visible: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Connection settings' }));
    expect(screen.getByLabelText('New API key')).toHaveValue('');
    await fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(await screen.findByText('<img src=x>')).toBeInTheDocument();
    expect(mounted.container.querySelector('img[src="x"], img[onerror]')).toBeNull();
    expect(mounted.container.innerHTML).not.toContain('stored-secret');
  });

  it('persists imported custom signatures and rejects malformed imports before saving', async () => {
    const signature = { id: 'custom-test', displayName: 'Test Agent', names: ['test.exe'] };
    const host = {
      getAgentDatabase: async () => ({ agents: [] }),
      getCustomAgents: async () => [],
      importAgentDatabase: vi
        .fn()
        .mockResolvedValueOnce({ success: true, agents: [signature] })
        .mockResolvedValueOnce({ success: true, agents: [{ id: 'bad', names: [] }] }),
      saveCustomAgents: vi.fn(async () => ({ success: true })),
    };
    render(Catalog, { host, inspect: noOp });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Import', exact: true })).toBeEnabled(),
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Import', exact: true }));
    await waitFor(() => expect(host.saveCustomAgents).toHaveBeenCalledWith([signature]));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Import', exact: true })).toBeEnabled(),
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Import', exact: true }));
    await screen.findByRole('alert');
    expect(host.saveCustomAgents).toHaveBeenCalledOnce();
  });

  it('keeps token-only samples and missing resource measurements visible', async () => {
    render(Statistics, {
      telemetry: {
        ...telemetry(),
        tokens: [{ instanceId: '101:1', totalTokens: 42, costUsd: 0, estimated: false }],
      },
      inspect: noOp,
    });
    await fireEvent.click(screen.getByRole('tab', { name: 'Tokens', exact: true }));
    expect(screen.getByText('From supported logs')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('42')).toBeInTheDocument();
    expect(screen.getAllByText(/—/).length).toBeGreaterThan(0);
  });

  it('escapes hostile metadata and removes secret fields recursively', () => {
    const { container } = render(Metadata, {
      value: {
        path: '<img src=x onerror=alert(1)>',
        nested: { anthropicApiKey: 'private-secret', event: 'observed' },
      },
    });
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img');
    expect(container.textContent).not.toContain('private-secret');
  });
});
