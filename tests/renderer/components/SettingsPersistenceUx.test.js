import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import App from '../../../frontend/observatory/App.svelte';
import Settings from '../../../frontend/observatory/components/Settings.svelte';
import SettingsLanguage from '../../../frontend/observatory/components/SettingsLanguage.svelte';
import { language } from '../../../frontend/observatory/runtime/i18n';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  language.set('en');
  localStorage.removeItem('aegis.language');
  localStorage.removeItem('aegis-theme');
  localStorage.removeItem('aegis-advanced-mode');
});

it('shows a partial-persistence warning after import while applying the theme through the app', async () => {
  localStorage.setItem('aegis-theme', 'dark-hc');
  localStorage.setItem('aegis-advanced-mode', 'true');
  let settings = { darkMode: true, uiScale: 1, scanIntervalSec: 10 };
  let navigate;
  const host = {
    getSettings: async () => settings,
    getUpdateStatus: async () => ({}),
    onNavigateView: (callback) => {
      navigate = callback;
      return () => {};
    },
    importConfig: vi.fn(async () => {
      settings = { ...settings, darkMode: false };
      return { success: true };
    }),
  };
  render(App, { host });
  await waitFor(() => expect(navigate).toBeTypeOf('function'));
  navigate('settings');
  await screen.findByLabelText('Theme');
  await waitFor(() => expect(screen.getByLabelText('Theme')).toHaveValue('dark-hc'));
  const originalSetItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (key === 'aegis-theme') throw new DOMException('Quota exceeded', 'QuotaExceededError');
    return originalSetItem.call(this, key, value);
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Data & help' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Import', exact: true }));
  expect(
    await screen.findByText('Settings imported. Theme could not be saved on this device.'),
  ).toBeVisible();
  expect(host.importConfig).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('Theme')).toHaveValue('light-hc');
  expect(document.documentElement.dataset.theme).toBe('light-hc');
  expect(localStorage.getItem('aegis-theme')).toBe('dark-hc');
});

it('applies an imported theme, preserves contrast, and reads the same theme after remount', async () => {
  localStorage.setItem('aegis-theme', 'dark-hc');
  let settings = { darkMode: true, uiScale: 1, scanIntervalSec: 10 };
  const host = {
    getSettings: async () => settings,
    getUpdateStatus: async () => ({}),
    importConfig: async () => {
      settings = { ...settings, darkMode: false };
      return { success: true };
    },
  };
  const appearance = vi.fn();
  const mounted = render(Settings, { host, appearance, navigate: vi.fn() });
  await screen.findByText('Settings saved');
  expect(screen.getByLabelText('Theme')).toHaveValue('dark-hc');
  await fireEvent.click(screen.getByRole('button', { name: 'Data & help' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Import', exact: true }));
  await waitFor(() => expect(appearance).toHaveBeenCalledWith(false, 1, true));
  expect(screen.getByLabelText('Theme')).toHaveValue('light-hc');
  expect(localStorage.getItem('aegis-theme')).toBe('light-hc');
  mounted.unmount();
  render(Settings, { host, appearance, navigate: vi.fn() });
  await screen.findByText('Settings saved');
  expect(screen.getByLabelText('Theme')).toHaveValue('light-hc');
});

it('reports a language persistence failure without discarding the selection, and recovers', async () => {
  const originalSetItem = Storage.prototype.setItem;
  const fail = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (key === 'aegis.language') throw new DOMException('Quota exceeded', 'QuotaExceededError');
    return originalSetItem.call(this, key, value);
  });
  render(SettingsLanguage);
  await fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'pt' } });
  expect(screen.getByLabelText('Idioma')).toHaveValue('pt');
  expect(screen.getByRole('status')).toHaveTextContent(
    'O idioma está disponível apenas nesta sessão. Não foi possível salvá-lo neste dispositivo.',
  );
  expect(localStorage.getItem('aegis.language')).not.toBe('pt');

  fail.mockRestore();
  await fireEvent.change(screen.getByLabelText('Idioma'), { target: { value: 'en' } });
  expect(screen.getByLabelText('Language')).toHaveValue('en');
  expect(screen.getByRole('status')).toHaveTextContent(
    'Language is saved immediately on this device.',
  );
  expect(localStorage.getItem('aegis.language')).toBe('en');
});
