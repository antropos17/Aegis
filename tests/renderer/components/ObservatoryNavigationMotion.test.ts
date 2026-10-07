import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import App from '../../../frontend/observatory/App.svelte';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('aegis-advanced-mode', 'true');
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => Object.assign(new EventTarget(), { matches: false })),
  );
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.motion;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mountApp() {
  let pushStats: (_value: unknown) => void = () => {};
  let trayNavigate: (_value: unknown) => void = () => {};
  const host = {
    getStats: async () => ({ appHealth: { state: 'HEALTHY', populationReliable: true } }),
    getResourceUsage: async () => ({}),
    getFalsePositives: async () => [],
    getSettings: async () => ({ darkMode: false, scanIntervalSec: 10 }),
    getAppVersion: async () => 'test',
    getUpdateStatus: async () => ({}),
    onStatsUpdate: (callback: (_value: unknown) => void) => {
      pushStats = callback;
      return () => {};
    },
    onNavigateView: (callback: (_value: unknown) => void) => {
      trayNavigate = callback;
      return () => {};
    },
  };
  const app = render(App, { host });
  const surface = app.container.querySelector<HTMLElement>('#workspace-content')!;
  const animations: { cancel: ReturnType<typeof vi.fn> }[] = [];
  const animate = vi.fn(() => {
    const animation = { cancel: vi.fn() };
    animations.push(animation);
    return animation;
  });
  Object.defineProperty(surface, 'animate', { configurable: true, value: animate });
  const navigation = screen.getByRole('navigation', { name: 'Main navigation' });
  const destination = (name: string) => within(navigation).getByRole('button', { name });
  return {
    ...app,
    animate,
    animations,
    destination,
    main: screen.getByRole('main'),
    pushStats: (value: unknown) => pushStats(value),
    trayNavigate: (value: unknown) => trayNavigate(value),
  };
}

it('moves focus before motion completes and retains drafts and scroll without telemetry replay', async () => {
  const app = mountApp();
  expect(app.animate).not.toHaveBeenCalled();
  await fireEvent.click(app.destination('Settings'), { detail: 1 });
  await waitFor(() => expect(app.main).toHaveFocus());
  expect(app.animate).toHaveBeenCalledOnce();
  await screen.findByText('Settings saved');
  const draft = screen.getByLabelText('Scan interval (seconds)');
  await fireEvent.input(draft, { target: { value: '23' } });
  app.main.scrollTop = 135;
  await fireEvent.click(app.destination('Statistics'), { detail: 1 });
  expect(app.main).toHaveFocus();
  expect(app.animations[0].cancel).toHaveBeenCalledOnce();
  expect(draft.isConnected).toBe(true);
  expect(draft).not.toBeVisible();
  expect(app.animate).toHaveBeenCalledTimes(2);
  await act(() =>
    app.pushStats({ appHealth: { state: 'HEALTHY', populationReliable: true }, totalFiles: 7 }),
  );
  expect(app.animate).toHaveBeenCalledTimes(2);
  await fireEvent.click(app.destination('Settings'), { detail: 1 });
  expect(draft).toBeVisible();
  expect(draft).toHaveValue('23');
  expect(app.main.scrollTop).toBe(135);
  expect(app.main).toHaveFocus();
  const last = app.animations.at(-1)!;
  app.unmount();
  expect(last.cancel).toHaveBeenCalledOnce();
});

it('keeps keyboard, history, Commands and tray navigation immediate after a pointer gesture', async () => {
  const app = mountApp();
  await fireEvent.click(app.destination('Statistics'), { detail: 1 });
  expect(app.animate).toHaveBeenCalledOnce();
  await fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
  expect(screen.getByRole('heading', { name: 'Monitoring', level: 1 })).toBeInTheDocument();
  expect(app.main).toHaveFocus();
  await fireEvent.keyDown(app.destination('Settings'), { key: 'Enter' });
  await fireEvent.click(app.destination('Settings'), { detail: 0 });
  expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument();
  expect(app.main).toHaveFocus();
  await fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  const search = await screen.findByRole('combobox', { name: 'Find a workspace or action' });
  await waitFor(() => expect(search).toHaveFocus());
  await fireEvent.input(search, { target: { value: 'action control' } });
  await fireEvent.keyDown(search, { key: 'Enter' });
  expect(
    await screen.findByRole('heading', { name: 'Action control', level: 1 }),
  ).toBeInTheDocument();
  expect(app.main).toHaveFocus();
  await act(() => app.trayNavigate('settings'));
  expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument();
  expect(app.main).toHaveFocus();
  expect(app.animate).toHaveBeenCalledOnce();
});

it('restores pointer history and saved reading positions immediately while new destinations still animate', async () => {
  const app = mountApp();
  app.main.scrollTop = 61;
  await fireEvent.click(app.destination('Statistics'), { detail: 1 });
  expect(app.animate).toHaveBeenCalledOnce();
  app.main.scrollTop = 125;
  await fireEvent.click(screen.getByRole('button', { name: 'Back' }), { detail: 1 });
  expect(screen.getByRole('heading', { name: 'Monitoring', level: 1 })).toBeInTheDocument();
  expect(app.main.scrollTop).toBe(61);
  expect(app.main).toHaveFocus();
  expect(app.animations[0].cancel).toHaveBeenCalledOnce();
  expect(app.animate).toHaveBeenCalledOnce();
  await fireEvent.click(screen.getByRole('button', { name: 'Forward' }), { detail: 1 });
  expect(screen.getByRole('heading', { name: 'Statistics', level: 1 })).toBeInTheDocument();
  expect(app.main.scrollTop).toBe(125);
  expect(app.main).toHaveFocus();
  expect(app.animate).toHaveBeenCalledOnce();
  await fireEvent.click(app.destination('Settings'), { detail: 1 });
  await screen.findByText('Settings saved');
  expect(app.animate).toHaveBeenCalledTimes(2);
  app.main.scrollTop = 73;
  await fireEvent.click(app.destination('Statistics'), { detail: 1 });
  expect(app.animations[1].cancel).toHaveBeenCalledOnce();
  expect(app.main.scrollTop).toBe(125);
  expect(app.main).toHaveFocus();
  expect(app.animate).toHaveBeenCalledTimes(2);
  await fireEvent.click(app.destination('Settings'), { detail: 1 });
  expect(app.main.scrollTop).toBe(73);
  expect(app.main).toHaveFocus();
  expect(app.animate).toHaveBeenCalledTimes(2);
  await fireEvent.click(app.destination('Events'), { detail: 1 });
  expect(screen.getByRole('heading', { name: 'Events', level: 1 })).toBeInTheDocument();
  expect(app.main).toHaveFocus();
  expect(app.animate).toHaveBeenCalledTimes(3);
  app.unmount();
  expect(app.animations[2].cancel).toHaveBeenCalledOnce();
});
