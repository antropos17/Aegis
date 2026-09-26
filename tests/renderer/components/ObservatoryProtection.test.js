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
  const panel = mounted.container.querySelector('.radar-panel');
  const heading = await within(panel).findByRole('heading', { name: 'Agent radar' });
  expect(heading).toBeVisible();
  expect(panel).toBeVisible();
  const switcher = within(screen.getByRole('group', { name: 'Monitoring' }));
  const radar = switcher.getByRole('button', { name: 'Detailed monitoring' });
  const protection = switcher.getByRole('button', { name: 'Protection overview' });
  expect(radar).toHaveAttribute('aria-pressed', 'true');
  expect(protection).toHaveAttribute('aria-pressed', 'false');
  await fireEvent.click(radar);
  expect(panel).toBeVisible();
  await fireEvent.click(protection);
  expect(radar).toHaveAttribute('aria-pressed', 'false');
  expect(protection).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('region', { name: 'Protection overview' })).toBeVisible();
  expect(panel).not.toBeVisible();
  await fireEvent.click(radar);
  expect(radar).toHaveAttribute('aria-pressed', 'true');
  expect(protection).toHaveAttribute('aria-pressed', 'false');
  expect(heading).toBeVisible();
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
  expect(
    within(details).getByText('An open handle does not prove that file contents were read.'),
  ).toBeVisible();
  expect(within(details).getByText(/retained record\(s\).*latest/)).toBeVisible();
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

it('returns focus to the activity region when the selected row is filtered away', async () => {
  render(ProtectionOverview, props());
  await fireEvent.click(screen.getByRole('button', { name: /Codex.*Held a file open/ }));
  await fireEvent.input(screen.getByRole('searchbox', { name: 'Search agent activity' }), {
    target: { value: 'no matching observation' },
  });
  expect(screen.queryByRole('button', { name: /Codex.*Held a file open/ })).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
  expect(screen.getByRole('region', { name: 'Agent activity' })).toHaveFocus();
});

it('reviews only retained file rows for this mount and reopens an unchanged-looking new delivery', async () => {
  const input = props();
  const first = input.telemetry.events[0];
  const mounted = render(ProtectionOverview, input);
  const summary = screen.getByRole('button', { name: /Needs your review/ });
  const fileRow = () => screen.getByRole('button', { name: /Codex.*Held a file open/ });
  expect(summary).toHaveTextContent('1 activity groups');
  await fireEvent.click(fileRow());
  const details = screen.getByRole('complementary', { name: 'Selected activity' });
  const mark = within(details).getByRole('button', { name: 'Mark reviewed' });
  expect(mark).toHaveAttribute('aria-pressed', 'false');
  mark.focus();
  await fireEvent.click(mark);
  expect(mark).toHaveFocus();
  expect(mark).toHaveAttribute('aria-pressed', 'true');
  expect(summary).toHaveTextContent('0 activity groups');
  expect(fileRow()).toHaveAccessibleName(/Reviewed this session/);
  expect(within(details).getByText('Reviewed this session')).toBeVisible();

  await mounted.rerender({ ...input, telemetry: { ...input.telemetry, events: [first] } });
  expect(mark).toHaveAttribute('aria-pressed', 'true');
  expect(summary).toHaveTextContent('0 activity groups');
  await fireEvent.click(screen.getByRole('button', { name: 'Needs review' }));
  expect(screen.queryByRole('button', { name: /Codex.*Held a file open/ })).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
  expect(screen.getByRole('region', { name: 'Agent activity' })).toHaveFocus();
  await fireEvent.click(screen.getByRole('button', { name: 'All activity' }));
  expect(fileRow()).toHaveAccessibleName(/Reviewed this session/);
  await fireEvent.click(fileRow());

  const newDelivery = { ...first };
  await mounted.rerender({ ...input, telemetry: { ...input.telemetry, events: [newDelivery] } });
  expect(summary).toHaveTextContent('1 activity groups');
  expect(fileRow()).toHaveAccessibleName(/Review needed/);
  expect(
    within(screen.getByRole('complementary', { name: 'Selected activity' })).getByRole('button', {
      name: 'Mark reviewed',
    }),
  ).toHaveAttribute('aria-pressed', 'false');

  await fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));
  await mounted.rerender({ ...input, telemetry: { ...input.telemetry, events: [] } });
  await mounted.rerender({ ...input, telemetry: { ...input.telemetry, events: [newDelivery] } });
  expect(summary).toHaveTextContent('1 activity groups');
  mounted.unmount();
  render(ProtectionOverview, input);
  expect(screen.getByRole('button', { name: /Needs your review/ })).toHaveTextContent(
    '1 activity groups',
  );
  expect(fileRow()).toHaveAccessibleName(/Review needed/);
});

it('keeps flagged network groups in review without offering a review control', async () => {
  const input = props();
  input.telemetry.events = [];
  input.telemetry.network = [
    {
      agent: 'Codex',
      instanceId: '7:first',
      pid: 7,
      destination: 'api.example.invalid',
      verdict: 'flagged',
      timestamp: 10,
      attribution: { status: 'inferred', evidence: ['cwd-containment'] },
    },
  ];
  render(ProtectionOverview, input);
  expect(screen.getByRole('button', { name: /Needs your review/ })).toHaveTextContent(
    '1 activity groups',
  );
  await fireEvent.click(screen.getByRole('button', { name: /Codex.*Connection observed/ }));
  const details = screen.getByRole('complementary', { name: 'Selected activity' });
  expect(within(details).queryByRole('button', { name: 'Mark reviewed' })).toBeNull();
  expect(within(details).getByText(/Network groups cannot be marked reviewed/)).toBeVisible();
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
