import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/svelte';
import App from '../../../frontend/observatory/App.svelte';
it('opens settings from the tray without remounting the workspace and disposes its subscription', async () => {
  localStorage.clear();
  let navigate;
  const stop = vi.fn();
  const host = {
    onNavigateView: (callback) => {
      navigate = callback;
      return stop;
    },
    getSettings: async () => ({ uiScale: 1 }),
    getStats: async () => ({}),
    getResourceUsage: async () => ({}),
    getFalsePositives: async () => [],
    getAppVersion: async () => 'test',
  };
  const app = render(App, { host });
  await act(() => navigate('settings'));
  const heading = screen.getByRole('heading', { name: 'Application preferences', exact: true });
  expect(heading).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'Monitoring', exact: true }));
  expect(heading.isConnected).toBe(true);
  expect(heading).not.toBeVisible();
  await act(() => navigate('settings'));
  expect(heading).toBeVisible();
  await act(() => navigate('https://example.com'));
  expect(heading).toBeVisible();
  app.unmount();
  expect(stop).toHaveBeenCalledTimes(1);
});
