import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import App from '../../../frontend/observatory/App.svelte';
import Settings from '../../../frontend/observatory/components/Settings.svelte';

it('leaves high contrast through the ordinary theme toggle and persists the ordinary theme', async () => {
  localStorage.setItem('aegis-theme', 'light-hc');
  render(App, { host: null });
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light-hc'));
  await fireEvent.click(screen.getByRole('button', { name: 'Toggle theme' }));
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(localStorage.getItem('aegis-theme')).toBe('dark');
  await fireEvent.click(screen.getByRole('button', { name: 'Toggle theme' }));
  expect(document.documentElement.dataset.theme).toBe('light');
});

it('does not let delayed settings overwrite a theme chosen while the app starts', async () => {
  localStorage.setItem('aegis-theme', 'dark-hc');
  let resolveSettings;
  const pending = new Promise((resolve) => {
    resolveSettings = resolve;
  });
  const host = { getSettings: () => pending };
  render(App, { host });
  await fireEvent.click(screen.getByRole('button', { name: 'Toggle theme' }));
  expect(document.documentElement.dataset.theme).toBe('light');
  resolveSettings({ darkMode: true, uiScale: 1 });
  await pending;
  await waitFor(() => expect(localStorage.getItem('aegis-theme')).toBe('light'));
});

it('updates the settings theme after a toolbar change without losing other draft settings', async () => {
  localStorage.setItem('aegis-theme', 'dark-hc');
  const host = {
    getSettings: async () => ({ darkMode: true, scanIntervalSec: 10, uiScale: 1 }),
    getUpdateStatus: async () => ({}),
  };
  const mounted = render(Settings, {
    host,
    appearance: vi.fn(),
    navigate: vi.fn(),
    currentTheme: 'dark-hc',
  });
  await waitFor(() => expect(screen.getByLabelText('Theme')).toHaveValue('dark-hc'));
  await fireEvent.input(screen.getByLabelText('Scan interval (seconds)'), {
    target: { value: '23' },
  });
  await mounted.rerender({ currentTheme: 'light' });
  expect(screen.getByLabelText('Theme')).toHaveValue('light');
  expect(screen.getByLabelText('Scan interval (seconds)')).toHaveValue('23');
});
