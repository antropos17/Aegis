import { policySaveTarget } from '../../../frontend/observatory/runtime/policy-targets';
import { buildInstanceKey } from '../../../src/shared/instance-key.js';
import { createPreviewHost } from '../../../frontend/observatory/demo/host';
import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import Catalog from '../../../frontend/observatory/components/Catalog.svelte';
import Rules from '../../../frontend/observatory/components/Rules.svelte';
import Analysis from '../../../frontend/observatory/components/Analysis.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';
import { validateCatalog } from '../../../frontend/observatory/runtime/catalog';
const process = (pid, cwd = 'X:/project') => ({
  agent: 'Codex',
  process: 'codex.exe',
  pid,
  instanceId: `${pid}:1`,
  instanceIdSource: 'os',
  cwd,
  parentEditor: 'VS Code',
});
const state = () => ({
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  agents: [process(101), process(102)],
});

it('shows duplicate legacy signatures once and retains a custom definition that shares a bundled ID', async () => {
  const bundled = { id: 'fixture', displayName: 'Bundled fixture', names: ['base.exe'] };
  const custom = {
    id: 'fixture',
    displayName: 'Legacy fixture',
    names: ['one.exe', 'one.exe', 'two.exe', 'three.exe', 'four.exe'],
  };
  render(Catalog, {
    host: {
      getAgentDatabase: async () => ({ agents: [bundled] }),
      getCustomAgents: async () => [custom],
    },
    inspect: vi.fn(),
  });
  await screen.findByText('Legacy fixture');
  expect(screen.getByText('Bundled fixture')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'one.exe' })).toHaveLength(1);
  expect(screen.getByRole('button', { name: '+1 more' })).toBeInTheDocument();
  expect(screen.getByText('1 bundled · 1 custom')).toBeInTheDocument();
  expect(validateCatalog([custom])[0].names).toEqual([
    'one.exe',
    'two.exe',
    'three.exe',
    'four.exe',
  ]);
  expect(custom.names).toHaveLength(5);
});

it('edits one policy per durable project and keeps inactive overrides available with exact keys', async () => {
  let permissions = { Codex: { network: 'block' }, 'Codex::X:/offline': { network: 'allow' } };
  const host = {
    getAllPermissions: async () => ({ permissions }),
    getRules: async () => [],
    saveInstancePermissions: vi.fn(async (next) => {
      const key = next.cwd
        ? `${next.agentName}::${next.cwd}`
        : next.parentEditor
          ? `${next.agentName}::${next.parentEditor}`
          : next.agentName;
      permissions = { ...permissions, [key]: next.permissions };
      return { success: true };
    }),
  };
  const mounted = render(Rules, { host, telemetry: state() });
  await waitFor(() => expect(screen.getByLabelText('Target')).toHaveValue('Codex'));
  await fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'instance' } });
  const select = screen.getByLabelText('Target');
  await waitFor(() => expect(select).toHaveValue('Codex::X:/project'));
  expect(within(select).getAllByRole('option')).toHaveLength(3);
  expect(within(select).getByRole('option', { name: /2 processes/ })).toBeInTheDocument();
  expect(screen.getByLabelText('Network')).toHaveValue('block');
  await fireEvent.change(select, { target: { value: 'Codex::X:/offline' } });
  expect(screen.getByLabelText('Network')).toHaveValue('allow');
  await fireEvent.change(screen.getByLabelText('Network'), { target: { value: 'monitor' } });
  await mounted.rerender({ telemetry: { ...state(), agents: [] } });
  expect(select).toHaveValue('Codex::X:/offline');
  await fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
  await waitFor(() => expect(host.saveInstancePermissions).toHaveBeenCalledTimes(1));
  expect(permissions).toMatchObject({
    Codex: { network: 'block' },
    'Codex::X:/offline': { network: 'monitor' },
  });
});

it('inherits parent policy before product defaults and keeps an unsaved project after its process exits', async () => {
  const host = {
    getAllPermissions: async () => ({
      permissions: { Codex: { network: 'block' }, 'Codex::VS Code': { network: 'allow' } },
    }),
    getRules: async () => [],
  };
  const mounted = render(Rules, { host, telemetry: state() });
  await waitFor(() => expect(screen.getByLabelText('Target')).toHaveValue('Codex'));
  await fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'instance' } });
  await waitFor(() => expect(screen.getByLabelText('Target')).toHaveValue('Codex::X:/project'));
  expect(screen.getByLabelText('Network')).toHaveValue('allow');
  await fireEvent.change(screen.getByLabelText('Network'), { target: { value: 'monitor' } });
  await mounted.rerender({ telemetry: { ...state(), agents: [] } });
  expect(screen.getByLabelText('Target')).toHaveValue('Codex::X:/project');
  expect(screen.getByLabelText('Network')).toHaveValue('monitor');
  expect(screen.getByText('Unsaved permissions')).toBeInTheDocument();
});

it('keeps captured request counts and scope while newer telemetry and selection change', async () => {
  let resolve;
  const pending = new Promise((r) => {
    resolve = r;
  });
  const host = {
    getSettings: async () => ({ anthropicApiKey: 'fixture' }),
    analyzeAgent: vi.fn(() => pending),
    openThreatReport: vi.fn(async () => ({ success: true })),
  };
  const mounted = render(Analysis, { host, telemetry: state() });
  await screen.findByText('API key saved · verified on first analysis');
  await fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'agent' } });
  await fireEvent.change(screen.getByLabelText('Agent'), { target: { value: 'Codex' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
  await waitFor(() => expect(host.analyzeAgent).toHaveBeenCalledExactlyOnceWith('Codex'));
  await fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'session' } });
  await mounted.rerender({ telemetry: { ...state(), agents: [], stats: { totalFiles: 999 } } });
  resolve({
    success: true,
    structured: { summary: 'Captured fixture', riskLevel: 'HIGH', counts: { totalFiles: 999 } },
    counts: { totalFiles: 3, totalSensitive: 1, totalAgents: 1, totalNet: 2 },
  });
  await screen.findByText('Captured fixture');
  await fireEvent.click(screen.getByRole('button', { name: 'Open report' }));
  await waitFor(() => expect(host.openThreatReport).toHaveBeenCalledTimes(1));
  expect(host.openThreatReport.mock.calls[0][0]).toMatchObject({
    scope: 'Codex',
    counts: { totalFiles: 3, totalSensitive: 1, totalAgents: 1, totalNet: 2 },
  });
});

it('preserves legacy ID conflicts while saving another custom definition', async () => {
  let custom = [
    { id: 'fixture', displayName: 'Legacy fixture', names: ['legacy.exe'] },
    { id: 'other', displayName: 'Other fixture', names: ['other.exe'] },
  ];
  const host = {
    getAgentDatabase: async () => ({
      agents: [{ id: 'fixture', displayName: 'Bundled fixture', names: ['base.exe'] }],
    }),
    getCustomAgents: async () => custom,
    saveCustomAgents: vi.fn(async (next) => {
      custom = next;
      return { success: true };
    }),
  };
  render(Catalog, { host, inspect: vi.fn() });
  await screen.findByText('Other fixture');
  expect(screen.getByText('Bundled ID conflict · not used for detection')).toBeInTheDocument();
  const row = screen.getByText('Other fixture').closest('tr');
  await fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
  await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Renamed fixture' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Save agent' }));
  await waitFor(() => expect(host.saveCustomAgents).toHaveBeenCalledTimes(1));
  expect(custom).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'fixture', names: ['legacy.exe'] }),
      expect.objectContaining({ id: 'other', displayName: 'Renamed fixture' }),
    ]),
  );
});

it.each(['Codex::X:/offline::nested', 'Codex::VS Code', 'Codex::C:\\Projects\\Example'])(
  'round-trips an inactive durable key exactly: %s',
  (key) => {
    const target = policySaveTarget(key, [], true);
    expect(buildInstanceKey(target.agentName, target.parentEditor, target.cwd)).toBe(key);
  },
);

it('retains original live context and saves a global policy without adding a context', () => {
  const live = {
    name: 'Codex',
    instanceKey: 'Codex::X:/project',
    cwd: 'X:/project',
    parentEditor: 'VS Code',
  };
  expect(policySaveTarget(live.instanceKey, [live], true)).toEqual({
    agentName: 'Codex',
    cwd: 'X:/project',
    parentEditor: 'VS Code',
  });
  expect(policySaveTarget('Codex', [live], false)).toEqual({
    agentName: 'Codex',
    cwd: null,
    parentEditor: null,
  });
});

it('saves two old project drafts through independent single-key writes in either completion order', async () => {
  let permissions = {
    'Codex::X:/one': { network: 'monitor' },
    'Codex::X:/two': { network: 'monitor' },
  };
  const release = [];
  const host = {
    getAllPermissions: vi.fn(async () => ({ permissions: structuredClone(permissions) })),
    getRules: async () => [],
    saveAgentPermissions: vi.fn(),
    saveInstancePermissions: vi.fn(async (data) => {
      await new Promise((resolve) => release.push(resolve));
      const key = buildInstanceKey(data.agentName, data.parentEditor, data.cwd);
      permissions = { ...permissions, [key]: data.permissions };
      return { success: true };
    }),
  };
  const first = within(render(Rules, { host, telemetry: emptyTelemetry() }).container);
  const second = within(render(Rules, { host, telemetry: emptyTelemetry() }).container);
  await waitFor(() => expect(host.getAllPermissions).toHaveBeenCalledTimes(2));
  await fireEvent.change(first.getByLabelText('Scope'), { target: { value: 'instance' } });
  await fireEvent.change(second.getByLabelText('Scope'), { target: { value: 'instance' } });
  await fireEvent.change(second.getByLabelText('Target'), { target: { value: 'Codex::X:/two' } });
  await fireEvent.change(first.getByLabelText('Network'), { target: { value: 'block' } });
  await fireEvent.change(second.getByLabelText('Network'), { target: { value: 'allow' } });
  await fireEvent.click(first.getByRole('button', { name: 'Save permissions' }));
  await fireEvent.click(second.getByRole('button', { name: 'Save permissions' }));
  await waitFor(() => expect(host.saveInstancePermissions).toHaveBeenCalledTimes(2));
  expect(host.getAllPermissions).toHaveBeenCalledTimes(2);
  expect(host.saveAgentPermissions).not.toHaveBeenCalled();
  release[1]();
  await second.findByText('Completed');
  release[0]();
  await first.findByText('Completed');
  expect(permissions).toMatchObject({
    'Codex::X:/one': { network: 'block' },
    'Codex::X:/two': { network: 'allow' },
  });
});

it('keeps preview single-policy saves isolated to the same durable keys', async () => {
  const host = createPreviewHost();
  await host.saveInstancePermissions({
    agentName: 'Codex',
    parentEditor: null,
    cwd: null,
    permissions: { network: 'block' },
  });
  await host.saveInstancePermissions({
    agentName: 'Codex',
    parentEditor: 'X:/offline::nested',
    cwd: null,
    permissions: { network: 'allow' },
  });
  expect(await host.getAllPermissions()).toMatchObject({
    permissions: { Codex: { network: 'block' }, 'Codex::X:/offline::nested': { network: 'allow' } },
  });
});
