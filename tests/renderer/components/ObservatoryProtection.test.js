import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import App from '../../../frontend/observatory/App.svelte';
import ProtectionOverview from '../../../frontend/observatory/components/ProtectionOverview.svelte';
import Rules from '../../../frontend/observatory/components/Rules.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

const snapshot = () => ({
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  agents: [{ agent: 'Codex', instanceId: '7:first', pid: 7, process: 'codex.exe', cwd: 'C:/work' }],
  events: [
    {
      agent: 'Codex',
      instanceId: '7:first',
      pid: 7,
      file: 'C:/work/.env',
      action: 'holding',
      sensitive: true,
      timestamp: 10,
      attribution: { status: 'inferred', evidence: ['cwd-containment'] },
    },
  ],
});
const host = () => ({
  getAllPermissions: vi.fn(async () => ({
    permissions: { Codex: { sensitive: 'block' } },
    instancePermissions: {},
  })),
});
const props = () => ({
  host: host(),
  telemetry: snapshot(),
  inspect: vi.fn(),
  openPolicy: vi.fn(),
  navigate: vi.fn(),
});

it('starts with the radar and keeps the protection overview reachable', async () => {
  const mounted = render(App, { host: null });
  expect(await screen.findByRole('heading', { name: 'Agent radar' })).toBeVisible();
  expect(mounted.container.querySelector('.radar-panel')).toBeVisible();
  const radar = screen.getByRole('button', { name: 'Detailed monitoring' });
  const protection = screen.getByRole('button', { name: 'Protection overview' });
  expect(radar).toHaveAttribute('aria-pressed', 'true');
  expect(protection).toHaveAttribute('aria-pressed', 'false');
  await fireEvent.click(radar);
  expect(mounted.container.querySelector('.radar-panel')).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'Protection overview' }));
  expect(radar).toHaveAttribute('aria-pressed', 'false');
  expect(protection).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('region', { name: 'Protection overview' })).toBeVisible();
  expect(mounted.container.querySelector('.radar-panel')).not.toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'Detailed monitoring' }));
  expect(screen.getByRole('heading', { name: 'Agent radar' })).toBeVisible();
});

it('connects evidence to the intended policy and keeps inferred ownership visible', async () => {
  const input = props();
  render(ProtectionOverview, input);
  await fireEvent.click(
    screen.getByRole('button', { name: /Codex.*Indirect match.*Held a file open/ }),
  );
  const details = screen.getByRole('complementary', { name: 'Selected activity' });
  expect(await within(details).findByText('Block requested · not enforced')).toBeVisible();
  expect(within(details).getByText('C:/work/.env')).toBeVisible();
  await fireEvent.click(within(details).getByRole('button', { name: 'Edit this agent’s policy' }));
  expect(input.openPolicy).toHaveBeenCalledExactlyOnceWith('Codex::C:/work');
  await fireEvent.click(within(details).getByRole('button', { name: 'Agent & controls' }));
  expect(input.inspect.mock.calls[0][1]).toMatchObject({
    instanceId: '7:first',
    detailSection: 'processes',
  });
});

it('retains the selected evidence and disables process navigation after its lifetime disappears or observations go stale', async () => {
  const input = props();
  const mounted = render(ProtectionOverview, input);
  await fireEvent.click(
    screen.getByRole('button', { name: /Codex.*Indirect match.*Held a file open/ }),
  );
  await mounted.rerender({ ...input, telemetry: { ...input.telemetry, stale: true } });
  expect(screen.getByRole('button', { name: 'Agent & controls' })).toBeDisabled();
  await mounted.rerender({
    ...input,
    telemetry: {
      ...snapshot(),
      agents: [{ ...input.telemetry.agents[0], instanceId: '7:replacement' }],
      events: [],
    },
  });
  expect(screen.getByText(/Previously selected/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Agent & controls' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Edit this agent’s policy' })).toBeNull();
});

it('shows unavailable preferences after a failed refresh instead of retaining an old allow label', async () => {
  const input = props();
  const mounted = render(ProtectionOverview, input);
  await fireEvent.click(
    screen.getByRole('button', { name: /Codex.*Indirect match.*Held a file open/ }),
  );
  await screen.findByText('Block requested · not enforced');
  input.host.getAllPermissions.mockRejectedValueOnce(new Error('Unavailable'));
  await mounted.rerender({ ...input, policyRevision: 1 });
  await screen.findByText(/Saved preferences could not be loaded/);
  expect(screen.getByText('Preferences unavailable')).toBeVisible();
  input.host.getAllPermissions.mockResolvedValue({
    permissions: { Codex: { sensitive: 'allow' } },
    instancePermissions: {},
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Retry preferences' }));
  expect(await screen.findByText('Allow preferred · not enforced')).toBeVisible();
});

it('uses current process availability while the displayed activity is paused', async () => {
  const input = props();
  render(ProtectionOverview, {
    ...input,
    liveTelemetry: { ...snapshot(), stale: true },
  });
  await fireEvent.click(
    screen.getByRole('button', { name: /Codex.*Indirect match.*Held a file open/ }),
  );
  expect(screen.getByRole('button', { name: 'Agent & controls' })).toBeDisabled();
});

it('opens the requested project policy without a write, and invalidates the overview only after a successful save', async () => {
  const transport = {
    ...host(),
    getRules: async () => [],
    saveInstancePermissions: vi.fn(async () => ({ success: false, error: 'Disk full' })),
  };
  const changed = vi.fn();
  render(Rules, {
    host: transport,
    telemetry: snapshot(),
    targetRequest: { key: 'Codex::C:/work', revision: 1 },
    onPermissionsChanged: changed,
  });
  await waitFor(() => expect(screen.getByLabelText('Target')).toHaveValue('Codex::C:/work'));
  expect(transport.saveInstancePermissions).not.toHaveBeenCalled();
  await fireEvent.change(screen.getByLabelText('Sensitive files'), { target: { value: 'allow' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
  await screen.findByText('Disk full');
  expect(changed).not.toHaveBeenCalled();
  transport.saveInstancePermissions.mockResolvedValue({ success: true });
  await fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
});
