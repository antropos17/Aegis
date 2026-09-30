import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import Rules from '../../../frontend/observatory/components/Rules.svelte';
import {
  emptyTelemetry,
  invoke,
  type RecordData,
  type Telemetry,
} from '../../../frontend/observatory/runtime/host';
import { createPreviewHost } from '../../../frontend/observatory/demo/host';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const telemetry = (): Telemetry => ({
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  agents: ['Codex', 'Claude Code'].map((agent, index): Telemetry['agents'][number] => ({
    agent,
    process: 'agent.exe',
    pid: index + 1,
    status: 'running',
    category: 'cli-tool',
    instanceId: String(index + 1) + ':live',
    instanceIdSource: 'os',
  })),
});
const envelope = (permissions: RecordData = {}) => ({
  permissions: structuredClone(permissions),
  instancePermissions: {},
});

it('rejects missing rule identities before keyed rendering and recovers through reading', async () => {
  const host = {
    getAllPermissions: async () => envelope(),
    getRules: vi.fn<() => Promise<unknown>>().mockResolvedValueOnce([{}, {}]).mockResolvedValue([]),
    reloadRules: vi.fn(),
  };
  render(Rules, { host, telemetry: telemetry() });
  await fireEvent.click(screen.getByRole('button', { name: /Detection rules/ }));
  await screen.findByText('Detection rule reply is invalid');
  expect(screen.getByText('Detection rules unavailable. Retry loading.')).toBeVisible();
  expect(screen.queryByText('No detection rules loaded.')).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  await waitFor(() => expect(screen.getByText('No detection rules loaded.')).toBeVisible());
  expect(host.reloadRules).not.toHaveBeenCalled();
});

it('keeps search results unknown after initial rule load failure until a population is loaded', async () => {
  const host = {
    getAllPermissions: async () => envelope(),
    getRules: vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValue([{ id: 'FS001', name: 'Healthy rule' }]),
  };
  render(Rules, { host, telemetry: telemetry() });
  await fireEvent.click(screen.getByRole('button', { name: /Detection rules/ }));
  await screen.findByText('Detection rules unavailable. Retry loading.');
  await fireEvent.input(screen.getByLabelText('Search detection rules'), {
    target: { value: 'missing' },
  });
  expect(screen.queryByText('No rules match this search.')).toBeNull();
  expect(screen.queryByText('No detection rules loaded.')).toBeNull();
  expect(screen.getByText('Detection rules unavailable. Retry loading.')).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  await waitFor(() => expect(screen.getByText('No rules match this search.')).toBeVisible());
  expect(screen.queryByText('Detection rules unavailable. Retry loading.')).toBeNull();
});

it.each(
  [
    [{ id: '' }],
    [{ id: '   ' }],
    [{ id: 'FS001' }, { id: 'FS001' }],
    [{ id: 1 }],
    [{ id: 'FS001', enabled: 'false' }],
    [{ id: 'FS001', enabled: null }],
  ].map((reply) => ({ reply })),
)('retains loaded rules when identity or enabled admission fails: %j', async ({ reply }) => {
  const { host, reload } = policyHost();
  host.getRules
    .mockResolvedValueOnce([{ id: 'FS001', name: 'Retained rule', enabled: false }])
    .mockResolvedValueOnce(reply)
    .mockResolvedValue([{ id: 'preview-rule', name: 'Recovered rule', enabled: true }]);
  render(Rules, { host, telemetry: telemetry() });
  await fireEvent.click(screen.getByRole('button', { name: /Detection rules/ }));
  await screen.findByText('Retained rule');
  reload();
  await screen.findByText('Detection rule reply is invalid');
  expect(screen.getByText('Detection rules unavailable. Showing last loaded rules.')).toBeVisible();
  expect(screen.getByRole('checkbox', { name: 'Enable Retained rule' })).not.toBeChecked();
  expect(screen.queryByText('No detection rules loaded.')).toBeNull();
  await fireEvent.input(screen.getByLabelText('Search detection rules'), {
    target: { value: 'missing' },
  });
  expect(screen.getByText('No rules match this search.')).toBeVisible();
  expect(screen.getByText('Detection rules unavailable. Showing last loaded rules.')).toBeVisible();
  await fireEvent.input(screen.getByLabelText('Search detection rules'), { target: { value: '' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  await screen.findByText('Recovered rule');
  expect(screen.getByRole('checkbox', { name: 'Enable Recovered rule' })).toBeChecked();
  expect(screen.queryByText('Detection rule reply is invalid')).toBeNull();
});

it('retains the acknowledged target and another draft when save readback fails', async () => {
  const pending = deferred<void>();
  let saved: RecordData = {};
  const changed = vi.fn();
  const host = {
    getAllPermissions: vi.fn(async () => envelope(saved)),
    getRules: vi.fn(async () => []),
    saveInstancePermissions: vi.fn(
      async (value: { agentName: string; permissions: RecordData }) => {
        await pending.promise;
        saved = { ...saved, [value.agentName]: structuredClone(value.permissions) };
        return { success: true };
      },
    ),
  };
  render(Rules, { host, telemetry: telemetry(), onPermissionsChanged: changed });
  await waitFor(() => expect(screen.getByLabelText('Target')).toHaveValue('Codex'));
  await fireEvent.change(screen.getByLabelText('Network'), { target: { value: 'block' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
  await waitFor(() => expect(host.saveInstancePermissions).toHaveBeenCalledTimes(1));
  await fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'Claude Code' } });
  await fireEvent.change(screen.getByLabelText('File system'), { target: { value: 'allow' } });
  host.getAllPermissions.mockRejectedValueOnce(new Error('Read unavailable'));
  pending.resolve();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Reset all to defaults' })).toBeEnabled(),
  );
  await fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'Codex' } });
  expect(screen.getByLabelText('Network')).toHaveValue('block');
  expect(
    screen.getByText('Permissions saved. Could not refresh the current policy. Retry loading.'),
  ).toBeVisible();
  expect(host.saveInstancePermissions).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      agentName: 'Codex',
      permissions: expect.objectContaining({ network: 'block' }),
    }),
  );
  expect(changed).toHaveBeenCalledTimes(1);
  await fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'Claude Code' } });
  expect(screen.getByLabelText('File system')).toHaveValue('allow');
  expect(screen.getByText('Unsaved permissions')).toBeVisible();
});

it('loads permissions independently of failed rules and recovers rules through a read-only retry', async () => {
  const host = {
    getAllPermissions: vi.fn(async () => envelope()),
    getRules: vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('Rules read unavailable'))
      .mockResolvedValue([]),
    reloadRules: vi.fn(),
  };
  render(Rules, { host, telemetry: telemetry() });
  await waitFor(() => expect(screen.getByLabelText('Target')).toHaveValue('Codex'));
  expect(screen.getByText('No saved permission overrides.')).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: /Detection rules/ }));
  expect(screen.getByText('Detection rules unavailable. Retry loading.')).toBeVisible();
  expect(screen.queryByText('No detection rules loaded.')).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  await waitFor(() => expect(screen.getByText('No detection rules loaded.')).toBeVisible());
  expect(host.reloadRules).not.toHaveBeenCalled();
  expect(host.getRules).toHaveBeenCalledTimes(2);
});

it.each([
  null,
  {},
  { success: false, error: 'Renderer request denied' },
  { permissions: {}, instancePermissions: [] },
  { permissions: { Codex: { network: 'invalid' } }, instancePermissions: {} },
  { permissions: { Codex: { network: ['monitor'] } }, instancePermissions: {} },
])('does not admit an unavailable permission reply as saved empty policy: %j', async (reply) => {
  const host = {
    getAllPermissions: vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce(reply)
      .mockResolvedValue(envelope()),
    getRules: async () => [],
    resetPermissionsToDefaults: vi.fn(),
  };
  render(Rules, { host, telemetry: telemetry() });
  await waitFor(() =>
    expect(screen.getByText('Permissions unavailable. Retry loading.')).toBeVisible(),
  );
  expect(screen.queryByText('Permissions saved')).toBeNull();
  expect(screen.queryByText('No saved permission overrides.')).toBeNull();
  expect(screen.getByRole('button', { name: 'Reset all to defaults' })).toBeDisabled();
  expect(screen.getByLabelText('Network')).toBeDisabled();
  await fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  await waitFor(() => expect(screen.getByText('No saved permission overrides.')).toBeVisible());
  expect(host.resetPermissionsToDefaults).not.toHaveBeenCalled();
});

it('keeps submitted intent as a draft when the saved policy changes before readback', async () => {
  const host = {
    getAllPermissions: async () => envelope({ Codex: { network: 'monitor' } }),
    getRules: async () => [],
    saveInstancePermissions: vi.fn(async () => ({ success: true })),
  };
  render(Rules, { host, telemetry: telemetry() });
  await waitFor(() => expect(screen.getByLabelText('Target')).toHaveValue('Codex'));
  await fireEvent.change(screen.getByLabelText('Network'), { target: { value: 'block' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Reset all to defaults' })).toBeEnabled(),
  );
  expect(screen.getByLabelText('Network')).toHaveValue('block');
  expect(screen.getByText('Unsaved permissions')).toBeVisible();
  expect(
    screen.getByText(
      'Current saved policy differs from the submitted permissions. Your draft is preserved.',
    ),
  ).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(screen.getByLabelText('Network')).toHaveValue('monitor');
  expect(host.saveInstancePermissions).toHaveBeenCalledTimes(1);
});

it('preserves all local drafts after an acknowledged reset whose readback fails', async () => {
  let saved: RecordData = {};
  const changed = vi.fn();
  const host = {
    getAllPermissions: vi.fn(async () => envelope(saved)),
    getRules: async () => [],
    resetPermissionsToDefaults: vi.fn(async () => {
      saved = { Codex: { network: 'monitor' } };
      return { success: true, permissions: saved, seenAgents: ['Codex'] };
    }),
  };
  render(Rules, { host, telemetry: telemetry(), onPermissionsChanged: changed });
  await waitFor(() => expect(screen.getByLabelText('Target')).toHaveValue('Codex'));
  await fireEvent.change(screen.getByLabelText('Network'), { target: { value: 'block' } });
  await fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'Claude Code' } });
  await fireEvent.change(screen.getByLabelText('File system'), { target: { value: 'allow' } });
  host.getAllPermissions.mockRejectedValueOnce(new Error('Read unavailable'));
  await fireEvent.click(screen.getByText('Restore default policy'));
  await fireEvent.click(screen.getByRole('button', { name: 'Reset all to defaults' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Reset all to defaults' })).toBeEnabled(),
  );
  expect(screen.getByText('Unsaved permissions')).toBeVisible();
  expect(
    screen.getByText(
      'Default policy restored. Could not refresh the current policy. Local drafts are preserved.',
    ),
  ).toBeVisible();
  await fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'Codex' } });
  expect(screen.getByLabelText('Network')).toHaveValue('block');
  await fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  await waitFor(() => expect(screen.queryByText('Read unavailable')).toBeNull());
  expect(screen.getByLabelText('Network')).toHaveValue('block');
  await fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'Claude Code' } });
  expect(screen.getByLabelText('File system')).toHaveValue('allow');
  expect(host.resetPermissionsToDefaults).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenCalledTimes(1);
});
function policyHost() {
  let saved: RecordData = {};
  let reload = () => {};
  const cleanup = vi.fn();
  const host = {
    getAllPermissions: vi.fn(async (): Promise<unknown> => envelope(saved)),
    getRules: vi.fn(async (): Promise<unknown> => []),
    saveInstancePermissions: vi.fn(
      async (value: {
        agentName: string;
        cwd?: string | null;
        parentEditor?: string | null;
        permissions: RecordData;
      }) => {
        const context = value.cwd || value.parentEditor;
        saved = {
          ...saved,
          [value.agentName + (context ? '::' + context : '')]: structuredClone(value.permissions),
        };
        return { success: true };
      },
    ),
    resetPermissionsToDefaults: vi.fn(async () => ({ success: true, permissions: {} })),
    onRulesReloaded: (callback: () => void) => {
      reload = callback;
      return cleanup;
    },
  };
  return { host, cleanup, reload: () => reload() };
}

it('persists only the submitted snapshot and retains newer edits through matching readback', async () => {
  const { host } = policyHost();
  const pending = deferred<void>();
  const save = host.saveInstancePermissions.getMockImplementation()!;
  host.saveInstancePermissions.mockImplementationOnce(async (value) => {
    await pending.promise;
    return save(value);
  });
  render(Rules, { host, telemetry: telemetry() });
  await waitFor(() => expect(screen.getByLabelText('Target')).toHaveValue('Codex'));
  await fireEvent.change(screen.getByLabelText('Network'), { target: { value: 'block' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
  await waitFor(() => expect(host.saveInstancePermissions).toHaveBeenCalledTimes(1));
  await fireEvent.change(screen.getByLabelText('Network'), { target: { value: 'allow' } });
  pending.resolve();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save permissions' })).toBeEnabled(),
  );
  expect(screen.getByLabelText('Network')).toHaveValue('allow');
  expect(screen.getByText('Unsaved permissions')).toBeVisible();
  expect(await host.getAllPermissions()).toMatchObject({
    permissions: { Codex: { network: 'block' } },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(screen.getByLabelText('Network')).toHaveValue('block');
  expect(screen.getByRole('button', { name: 'Save permissions' })).toBeDisabled();
});

it.each(['resolve', 'reject'] as const)(
  'ignores an older load %s after a newer accepted permission/rule generation',
  async (outcome) => {
    const { host, reload } = policyHost();
    const oldPermissions = deferred<unknown>(),
      oldRules = deferred<unknown>();
    host.getAllPermissions
      .mockImplementationOnce(() => oldPermissions.promise)
      .mockResolvedValue(envelope({ Codex: { network: 'block' } }));
    host.getRules
      .mockImplementationOnce(() => oldRules.promise)
      .mockResolvedValue([{ id: 'fresh', name: 'Fresh rule' }]);
    render(Rules, { host, telemetry: telemetry() });
    expect(screen.getByText('Loading permissions…')).toBeVisible();
    expect(screen.queryByText('Permissions saved')).toBeNull();
    await waitFor(() => expect(host.getRules).toHaveBeenCalledTimes(1));
    reload();
    await waitFor(() => expect(screen.getByLabelText('Network')).toHaveValue('block'));
    if (outcome === 'resolve') {
      oldPermissions.resolve(envelope({ Codex: { network: 'allow' } }));
      oldRules.resolve([{ id: 'old', name: 'Old rule' }]);
    } else {
      oldPermissions.reject(new Error('Old permissions failure'));
      oldRules.reject(new Error('Old rules failure'));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByLabelText('Network')).toHaveValue('block');
    expect(screen.queryByText('Old permissions failure')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: /Detection rules/ }));
    expect(screen.getByText('Fresh rule')).toBeVisible();
    expect(screen.queryByText('Old rule')).toBeNull();
    expect(screen.queryByText('Old rules failure')).toBeNull();
  },
);

it('keeps acknowledged save state while a superseding refresh is pending or fails', async () => {
  const { host, reload } = policyHost();
  const ownRead = deferred<unknown>(),
    newerRead = deferred<unknown>();
  render(Rules, { host, telemetry: telemetry() });
  await waitFor(() => expect(screen.getByLabelText('Target')).toHaveValue('Codex'));
  host.getAllPermissions
    .mockImplementationOnce(() => ownRead.promise)
    .mockImplementationOnce(() => newerRead.promise);
  await fireEvent.change(screen.getByLabelText('Network'), { target: { value: 'block' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
  await waitFor(() => expect(host.getAllPermissions).toHaveBeenCalledTimes(2));
  reload();
  await waitFor(() => expect(host.getAllPermissions).toHaveBeenCalledTimes(3));
  ownRead.resolve(envelope({ Codex: { network: 'monitor' } }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Reset all to defaults' })).toBeEnabled(),
  );
  expect(screen.getByLabelText('Network')).toHaveValue('block');
  expect(screen.getByText('Permissions saved. Refreshing the current policy.')).toBeVisible();
  newerRead.reject(new Error('Current read unavailable'));
  await screen.findByText(
    'Permissions saved. Could not refresh the current policy. Retry loading.',
  );
  await fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  await waitFor(() => expect(screen.queryByText('Current read unavailable')).toBeNull());
  expect(screen.getByLabelText('Network')).toHaveValue('block');
  expect(host.saveInstancePermissions).toHaveBeenCalledTimes(1);
});

it('retains reliable permissions and rules on malformed refresh replies', async () => {
  const { host, reload } = policyHost();
  host.getAllPermissions
    .mockResolvedValueOnce(envelope({ Codex: { network: 'block' } }))
    .mockResolvedValue({ success: false });
  host.getRules
    .mockResolvedValueOnce([{ id: 'retained', name: 'Retained rule' }])
    .mockResolvedValue({ success: false });
  render(Rules, { host, telemetry: telemetry() });
  await waitFor(() => expect(screen.getByLabelText('Network')).toHaveValue('block'));
  reload();
  await screen.findByText('Permissions unavailable. Showing last loaded preferences.');
  expect(screen.getByLabelText('Network')).toHaveValue('block');
  await fireEvent.click(screen.getByRole('button', { name: /Detection rules/ }));
  expect(screen.getByText('Detection rules unavailable. Showing last loaded rules.')).toBeVisible();
  expect(screen.getByText('Retained rule')).toBeVisible();
  expect(screen.queryByText('No detection rules loaded.')).toBeNull();
});

it('lets an in-flight refresh settle after a refused write without leaving loading stuck', async () => {
  const { host, reload } = policyHost();
  const permissions = deferred<unknown>(),
    rules = deferred<unknown>();
  host.saveInstancePermissions.mockResolvedValueOnce({ success: false });
  render(Rules, { host, telemetry: telemetry() });
  await waitFor(() => expect(screen.getByLabelText('Target')).toHaveValue('Codex'));
  host.getAllPermissions.mockImplementationOnce(() => permissions.promise);
  host.getRules.mockImplementationOnce(() => rules.promise);
  reload();
  await fireEvent.change(screen.getByLabelText('Network'), { target: { value: 'block' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
  await screen.findByText('Operation cancelled or not completed');
  permissions.resolve(envelope({ Codex: { network: 'allow' } }));
  rules.resolve([{ id: 'settled', name: 'Settled rule' }]);
  await waitFor(() => expect(screen.queryByText('Loading permissions…')).toBeNull());
  expect(screen.getByLabelText('Network')).toHaveValue('block');
  await fireEvent.click(screen.getByRole('button', { name: /Detection rules/ }));
  expect(screen.getByText('Settled rule')).toBeVisible();
});

it('keeps drafts and does not invalidate the overview when reset is refused', async () => {
  const { host } = policyHost();
  const changed = vi.fn();
  host.resetPermissionsToDefaults.mockResolvedValueOnce({ success: false, permissions: {} });
  render(Rules, { host, telemetry: telemetry(), onPermissionsChanged: changed });
  await waitFor(() => expect(screen.getByLabelText('Target')).toHaveValue('Codex'));
  await fireEvent.change(screen.getByLabelText('Network'), { target: { value: 'block' } });
  await fireEvent.click(screen.getByText('Restore default policy'));
  await fireEvent.click(screen.getByRole('button', { name: 'Reset all to defaults' }));
  await screen.findByText('Operation cancelled or not completed');
  expect(screen.getByLabelText('Network')).toHaveValue('block');
  expect(screen.getByText('Unsaved permissions')).toBeVisible();
  expect(changed).not.toHaveBeenCalled();
  expect(host.getAllPermissions).toHaveBeenCalledTimes(1);
});

it.each(['save', 'reset'] as const)(
  'suppresses %s completion callbacks and readback after disposal',
  async (kind) => {
    const { host, cleanup } = policyHost();
    const pending = deferred<void>(),
      changed = vi.fn();
    if (kind === 'save')
      host.saveInstancePermissions.mockImplementationOnce(async () => {
        await pending.promise;
        return { success: true };
      });
    else
      host.resetPermissionsToDefaults.mockImplementationOnce(async () => {
        await pending.promise;
        return { success: true, permissions: {} };
      });
    const mounted = render(Rules, { host, telemetry: telemetry(), onPermissionsChanged: changed });
    await waitFor(() => expect(screen.getByLabelText('Target')).toHaveValue('Codex'));
    if (kind === 'save')
      await fireEvent.change(screen.getByLabelText('Network'), { target: { value: 'block' } });
    else await fireEvent.click(screen.getByText('Restore default policy'));
    await fireEvent.click(
      screen.getByRole('button', {
        name: kind === 'save' ? 'Save permissions' : 'Reset all to defaults',
      }),
    );
    mounted.unmount();
    pending.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(changed).not.toHaveBeenCalled();
    expect(host.getAllPermissions).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  },
);

it('reads actual preview reset defaults and clears the pre-reset target drafts only after matching readback', async () => {
  const host = createPreviewHost();
  await invoke(host, 'saveInstancePermissions', {
    agentName: 'Codex',
    permissions: { network: 'block' },
  });
  render(Rules, { host, telemetry: telemetry() });
  await waitFor(() => expect(screen.getByLabelText('Network')).toHaveValue('block'));
  await fireEvent.change(screen.getByLabelText('Network'), { target: { value: 'allow' } });
  await fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'Claude Code' } });
  await fireEvent.change(screen.getByLabelText('File system'), { target: { value: 'allow' } });
  await fireEvent.click(screen.getByText('Restore default policy'));
  await fireEvent.click(screen.getByRole('button', { name: 'Reset all to defaults' }));
  await screen.findByText('Completed');
  expect(screen.getByLabelText('File system')).toHaveValue('monitor');
  await fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'Codex' } });
  expect(screen.getByLabelText('Network')).toHaveValue('monitor');
  expect(screen.queryByText('Unsaved permissions')).toBeNull();
  expect(await host.getAllPermissions()).toMatchObject({ permissions: {} });
});

it('retains an inactive project submission through failed readback using its exact durable key', async () => {
  const { host } = policyHost();
  await host.saveInstancePermissions({
    agentName: 'Codex',
    parentEditor: 'X:/offline::nested',
    permissions: { network: 'monitor' },
  });
  host.saveInstancePermissions.mockClear();
  const pending = deferred<void>(),
    save = host.saveInstancePermissions.getMockImplementation()!;
  host.saveInstancePermissions.mockImplementationOnce(async (value) => {
    await pending.promise;
    return save(value);
  });
  render(Rules, { host, telemetry: telemetry() });
  await waitFor(() => expect(screen.getByLabelText('Target')).toHaveValue('Codex'));
  await fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'instance' } });
  await waitFor(() =>
    expect(screen.getByLabelText('Target')).toHaveValue('Codex::X:/offline::nested'),
  );
  await fireEvent.change(screen.getByLabelText('Network'), { target: { value: 'block' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
  await fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'agent' } });
  await fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'Claude Code' } });
  await fireEvent.change(screen.getByLabelText('File system'), { target: { value: 'allow' } });
  host.getAllPermissions.mockRejectedValueOnce(new Error('Project read unavailable'));
  pending.resolve();
  await screen.findByText(
    'Permissions saved. Could not refresh the current policy. Retry loading.',
  );
  await fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'instance' } });
  expect(screen.getByLabelText('Network')).toHaveValue('block');
  expect(host.saveInstancePermissions).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ agentName: 'Codex', parentEditor: 'X:/offline::nested', cwd: null }),
  );
});

it('preserves drafts when a confirmed reset readback differs from the actual reset reply', async () => {
  const { host } = policyHost();
  host.getAllPermissions.mockResolvedValue(envelope({ Codex: { network: 'block' } }));
  render(Rules, { host, telemetry: telemetry() });
  await waitFor(() => expect(screen.getByLabelText('Network')).toHaveValue('block'));
  await fireEvent.change(screen.getByLabelText('Network'), { target: { value: 'allow' } });
  await fireEvent.click(screen.getByText('Restore default policy'));
  await fireEvent.click(screen.getByRole('button', { name: 'Reset all to defaults' }));
  await screen.findByText('Completed');
  expect(screen.getByLabelText('Network')).toHaveValue('allow');
  expect(
    screen.getByText(
      'Default policy restored. Current saved policy differs from the reset reply. Local drafts are preserved.',
    ),
  ).toBeVisible();
  expect(screen.getByText('Unsaved permissions')).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(screen.getByLabelText('Network')).toHaveValue('block');
});
