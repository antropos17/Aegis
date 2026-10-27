import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import Notifications from '../../../frontend/observatory/components/Notifications.svelte';
import ProtectionOverview from '../../../frontend/observatory/components/ProtectionOverview.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

it('distinguishes a failed history load from a failed review save and preserves live alerts on retry', async () => {
  const liveId = '00000000-0000-4000-8000-000000000001';
  const restoredId = '00000000-0000-4000-8000-000000000002';
  let completeRetry;
  const retryResult = new Promise((resolve) => (completeRetry = resolve));
  const host = {
    listSensitiveAlerts: vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockReturnValue(retryResult),
    setSensitiveAlertReviewed: vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: 'write failed' })
      .mockResolvedValue({ success: true, status: 'ready' }),
  };
  const telemetry = {
    ...emptyTelemetry(),
    ready: true,
    stale: false,
    events: [
      {
        eventId: liveId,
        agent: 'Claude',
        file: 'C:/work/.env-live',
        action: 'accessed',
        sensitive: true,
        timestamp: 10,
      },
    ],
  };
  render(Notifications, { host, telemetry });
  await fireEvent.click(screen.getByRole('button', { name: /Sensitive activity review/ }));
  const dialog = screen.getByRole('dialog', { name: 'Sensitive activity review' });
  expect(
    await within(dialog).findByText(
      'Saved alert history could not be loaded. Live alerts remain available.',
    ),
  ).toBeVisible();
  expect(within(dialog).queryByText('Alert review could not be saved. Try again.')).toBeNull();
  expect(within(dialog).getByText('.env-live')).toBeVisible();

  await fireEvent.click(within(dialog).getByRole('button', { name: 'Mark reviewed' }));
  expect(
    await within(dialog).findByText('Alert review could not be saved. Try again.'),
  ).toBeVisible();
  expect(within(dialog).getByText('.env-live')).toBeVisible();
  const retry = within(dialog).getByRole('button', { name: 'Retry loading' });
  retry.focus();
  await fireEvent.click(retry);
  expect(retry).toHaveFocus();
  expect(retry).toHaveAttribute('aria-disabled', 'true');
  await fireEvent.click(retry);
  expect(host.listSensitiveAlerts).toHaveBeenCalledTimes(2);
  completeRetry({
    success: true,
    status: 'ready',
    items: [
      {
        eventId: restoredId,
        timestamp: 5,
        basename: '.env-restored',
        action: 'accessed',
        agent: 'Claude',
        attribution: 'confirmed',
        reviewed: false,
      },
    ],
  });
  expect(await within(dialog).findByText('.env-restored')).toBeVisible();
  await waitFor(() =>
    expect(within(dialog).getByRole('button', { name: 'Needs review' })).toHaveFocus(),
  );
  expect(within(dialog).getByText('.env-live')).toBeVisible();
  expect(
    within(dialog).queryByText(
      'Saved alert history could not be loaded. Live alerts remain available.',
    ),
  ).toBeNull();
  expect(within(dialog).getByText('Alert review could not be saved. Try again.')).toBeVisible();
  const liveRow = within(dialog).getByText('.env-live').closest('li');
  await fireEvent.click(within(liveRow).getByRole('button', { name: 'Mark reviewed' }));
  await waitFor(() =>
    expect(within(dialog).queryByText('Alert review could not be saved. Try again.')).toBeNull(),
  );
  expect(host.setSensitiveAlertReviewed).toHaveBeenLastCalledWith(liveId, true);
});

it('names both directions of the session review action', async () => {
  const telemetry = {
    ...emptyTelemetry(),
    ready: true,
    stale: false,
    agents: [
      { agent: 'Codex', instanceId: '7:first', pid: 7, process: 'codex.exe', cwd: 'C:/work' },
    ],
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
  };
  render(ProtectionOverview, {
    host: null,
    telemetry,
    inspect: vi.fn(),
    openPolicy: vi.fn(),
    navigate: vi.fn(),
  });
  await fireEvent.click(screen.getByRole('button', { name: /Codex.*Held a file open/ }));
  const details = screen.getByRole('complementary', { name: 'Selected activity' });
  await fireEvent.click(within(details).getByRole('button', { name: 'Mark reviewed' }));
  const undo = within(details).getByRole('button', { name: 'Return to review' });
  expect(undo).toHaveAttribute('aria-pressed', 'true');
  await fireEvent.click(undo);
  expect(within(details).getByRole('button', { name: 'Mark reviewed' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});
