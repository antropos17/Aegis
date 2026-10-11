import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import Settings from '../../../frontend/observatory/components/Settings.svelte';

const status = (state) => ({ status: state, version: '0.19.2-beta' });
const mountSettings = (host) => render(Settings, { host, appearance: vi.fn(), navigate: vi.fn() });
const desktop = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Desktop & updates', exact: true }));

it('preserves a pushed update when the initial status snapshot arrives late', async () => {
  let resolveSeed;
  let push;
  const unsubscribe = vi.fn();
  const host = {
    getSettings: async () => ({}),
    getUpdateStatus: vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSeed = resolve;
        }),
    ),
    onUpdateStatus: vi.fn((callback) => {
      push = callback;
      return unsubscribe;
    }),
  };
  const mounted = mountSettings(host);
  await desktop();
  push(status('ready'));
  expect(await screen.findByText(/Update ready to install/)).toBeVisible();
  resolveSeed(status('idle'));
  await tick();
  expect(screen.getByText(/Update ready to install/)).toBeVisible();
  expect(screen.queryByText(/Ready to check for updates/)).toBeNull();
  mounted.unmount();
  expect(unsubscribe).toHaveBeenCalledExactlyOnceWith();
  push(status('error'));
  await tick();
  expect(screen.queryByText(/Update could not be completed/)).toBeNull();
});

it('disposes the subscription while an initial update read is still pending', async () => {
  let resolveSeed;
  const unsubscribe = vi.fn();
  const mounted = mountSettings({
    getSettings: async () => ({}),
    getUpdateStatus: () =>
      new Promise((resolve) => {
        resolveSeed = resolve;
      }),
    onUpdateStatus: () => unsubscribe,
  });
  await desktop();
  mounted.unmount();
  resolveSeed(status('ready'));
  await tick();
  expect(unsubscribe).toHaveBeenCalledExactlyOnceWith();
  expect(screen.queryByRole('button', { name: 'Install and restart' })).toBeNull();
});

it.each([
  ['idle', 'Check for updates', 'checkForUpdates', 'checking'],
  ['available', 'Download update', 'downloadUpdate', 'downloading'],
  ['ready', 'Install and restart', 'installUpdate', 'installing'],
])(
  'dispatches only the selected %s update action without arguments',
  async (seed, label, method, result) => {
    const host = {
      getSettings: async () => ({}),
      getUpdateStatus: async () => status(seed),
      checkForUpdates: vi.fn(async () => status(result)),
      downloadUpdate: vi.fn(async () => status(result)),
      installUpdate: vi.fn(async () => status(result)),
    };
    mountSettings(host);
    await desktop();
    await fireEvent.click(await screen.findByRole('button', { name: label }));
    await waitFor(() => expect(host[method]).toHaveBeenCalledExactlyOnceWith());
    for (const other of ['checkForUpdates', 'downloadUpdate', 'installUpdate']) {
      if (other !== method) expect(host[other]).not.toHaveBeenCalled();
    }
    const labels = {
      checking: /Checking for updates/,
      downloading: /Downloading update/,
      installing: /Installing update/,
    };
    expect(await screen.findByText(labels[result])).toBeVisible();
  },
);
