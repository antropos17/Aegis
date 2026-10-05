import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import App from '../../../frontend/observatory/App.svelte';
import { createPreviewHost } from '../../../frontend/observatory/demo/host';
import { language } from '../../../frontend/observatory/runtime/i18n';

afterEach(() => {
  localStorage.clear();
  language.set('en');
});

// Full App mounts need the same coverage budget as the audit-delivery integration test.
it('exposes application exit across workspaces, coalesces clicks and allows retry after cancellation', async () => {
  let finish;
  const host = createPreviewHost();
  host.quitApp = vi.fn(() => new Promise((resolve) => (finish = resolve)));
  render(App, { host });
  const exit = screen.getByRole('button', { name: 'Quit AEGIS', exact: true });
  exit.focus();
  await fireEvent.click(exit);
  await fireEvent.click(exit);
  expect(host.quitApp).toHaveBeenCalledOnce();
  expect(exit).toHaveAttribute('aria-busy', 'true');
  expect(exit).toHaveFocus();
  finish({ success: false, cancelled: true });
  await waitFor(() => expect(exit).toHaveAttribute('aria-busy', 'false'));
  expect(screen.getByText('Exit cancelled.')).toBeInTheDocument();
  expect(exit).toHaveFocus();
  await fireEvent.click(screen.getByRole('button', { name: 'Settings', exact: true }));
  await fireEvent.click(screen.getByRole('tab', { name: 'Desktop & updates' }));
  expect(
    screen.getByText(/Closing the window keeps AEGIS running in the system tray/),
  ).toBeVisible();
  await fireEvent.click(exit);
  expect(host.quitApp).toHaveBeenCalledTimes(2);
  finish({ success: true });
  await screen.findByText('Quitting…');
  await fireEvent.click(exit);
  expect(host.quitApp).toHaveBeenCalledTimes(2);
}, 15_000);

it('keeps a failed exit actionable without rendering host error details or claiming completion', async () => {
  const host = createPreviewHost();
  host.quitApp = vi
    .fn()
    .mockRejectedValueOnce(new Error('private-native-path'))
    .mockResolvedValueOnce({ success: false, error: 'another-private-detail' });
  render(App, { host });
  const exit = screen.getByRole('button', { name: 'Quit AEGIS', exact: true });
  await fireEvent.click(exit);
  await screen.findByText('AEGIS could not quit. Try again.');
  await fireEvent.click(exit);
  await waitFor(() => expect(host.quitApp).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(/private|Completed/)).not.toBeInTheDocument();
  expect(exit).toHaveAttribute('aria-busy', 'false');
}, 15_000);

it('disables exit in the simulated preview and when the runtime lacks the capability', async () => {
  const host = createPreviewHost();
  host.quitApp = vi.fn();
  const mounted = render(App, { host, preview: true });
  const exit = screen.getByRole('button', { name: 'Quit AEGIS', exact: true });
  expect(exit).toBeDisabled();
  expect(screen.getByText('Available in the desktop app.')).toBeInTheDocument();
  await fireEvent.click(exit);
  expect(host.quitApp).not.toHaveBeenCalled();
  delete host.quitApp;
  await mounted.rerender({ host, preview: false });
  expect(exit).toBeDisabled();
}, 15_000);

it('localizes exit and cancellation feedback while keeping the control mounted', async () => {
  const host = createPreviewHost();
  host.quitApp = vi.fn(async () => ({ success: false, cancelled: true }));
  render(App, { host });
  language.set('pt');
  const exit = await screen.findByRole('button', { name: 'Sair do AEGIS', exact: true });
  await fireEvent.click(exit);
  await screen.findByText('Saída cancelada.');
  expect(exit).toBeInTheDocument();
}, 15_000);

it('keeps settings editable during a process outage while retaining sensor and audit warnings', async () => {
  const host = createPreviewHost();
  host.onScanBatch = () => () => {};
  host.getResourceUsage = vi.fn(async () => {
    throw new Error('Process collector unavailable');
  });
  host.getStats = vi.fn(async () => ({
    appHealth: {
      state: 'DEGRADED',
      populationReliable: false,
      sensors: { effective: { degradedSensorIds: ['network'] } },
    },
    auditDelivery: { droppedEntries: 0, bufferDepth: 1, writeFailed: true },
  }));
  render(App, { host });
  const outage = 'Process collector unavailable';
  const waiting = /Waiting for a reliable process observation/;
  await screen.findByText(outage);
  expect(screen.getByText(waiting)).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'Settings', exact: true }));
  expect(screen.queryByText(outage)).not.toBeInTheDocument();
  expect(screen.queryByText(waiting)).not.toBeInTheDocument();
  expect(screen.getByText(/Degraded sensors:.*network/)).toBeVisible();
  expect(screen.getByText(/The last audit write failed; pending records/)).toBeVisible();
  const scale = await screen.findByRole('slider', { name: 'Interface scale' });
  expect(scale).toBeEnabled();
  await fireEvent.input(scale, { target: { value: '1.25' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Save settings', exact: true }));
  await waitFor(() => expect(screen.getByText('Settings saved', { exact: true })).toBeVisible());
  expect((await host.getSettings()).uiScale).toBe(1.25);
  await fireEvent.click(screen.getByRole('button', { name: 'Monitoring', exact: true }));
  expect(screen.getByText(outage)).toBeVisible();
  expect(screen.getByText(waiting)).toBeVisible();
}, 15_000);
