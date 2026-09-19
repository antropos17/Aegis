import { expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { createDesktopShell } = require('../../src/main/platform/desktop-shell');
function fixture(options = {}) {
  const app = { isPackaged: true, setAppUserModelId: vi.fn() };
  const adapter = createDesktopShell({
    app,
    platform: 'win32',
    appId: 'com.aegis.oversight',
    ...options,
  });
  const webContents = Object.assign(new EventEmitter(), { send: vi.fn() });
  const window = {
    webContents,
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  };
  return { app, adapter, window, webContents };
}
it('sets the installed identity and keeps development separate', () => {
  const f = fixture();
  f.adapter.configureIdentity();
  expect(f.app.setAppUserModelId).toHaveBeenCalledWith('com.aegis.oversight');
  f.app.isPackaged = false;
  f.adapter.configureIdentity();
  expect(f.app.setAppUserModelId).toHaveBeenLastCalledWith('com.aegis.oversight.development');
});
it.each(['darwin', 'linux'])('does not call Windows APIs on %s', (platform) => {
  const f = fixture({ platform });
  f.adapter.configureIdentity();
  expect(f.app.setAppUserModelId).not.toHaveBeenCalled();
});
it('queues settings until loaded and restores the same minimized window', () => {
  const f = fixture();
  f.adapter.open('settings');
  f.adapter.attach(f.window);
  expect(f.webContents.send).not.toHaveBeenCalled();
  f.webContents.emit('did-finish-load');
  expect(f.webContents.send).toHaveBeenCalledWith('navigate-view', 'settings');
  expect(f.window.restore).toHaveBeenCalled();
  expect(f.window.show).toHaveBeenCalled();
  expect(f.window.focus).toHaveBeenCalled();
  f.adapter.open();
  expect(f.webContents.send).toHaveBeenCalledTimes(1);
  f.webContents.emit('did-start-loading');
  f.adapter.open('settings');
  expect(f.webContents.send).toHaveBeenCalledTimes(1);
  f.webContents.emit('did-finish-load');
  expect(f.webContents.send).toHaveBeenCalledTimes(2);
});
it('preserves start-minimized until opened and rejects unknown destinations', () => {
  const f = fixture();
  f.adapter.attach(f.window);
  f.webContents.emit('did-finish-load');
  f.adapter.open('https://example.com');
  expect(f.adapter.wasRequested()).toBe(false);
  expect(f.window.show).not.toHaveBeenCalled();
  expect(f.webContents.send).not.toHaveBeenCalled();
  f.adapter.open();
  expect(f.adapter.wasRequested()).toBe(true);
  expect(f.window.show).toHaveBeenCalledTimes(1);
});
it('preload exposes only allowed view payloads and removes its exact listener', () => {
  let api;
  const ipcRenderer = new EventEmitter();
  vm.runInNewContext(readFileSync('src/main/preload.js', 'utf8'), {
    require: () => ({
      ipcRenderer,
      contextBridge: {
        exposeInMainWorld: (_name, value) => {
          api = value;
        },
      },
    }),
  });
  const callback = vi.fn();
  const stop = api.onNavigateView(callback);
  ipcRenderer.emit('navigate-view', {}, 'settings');
  ipcRenderer.emit('navigate-view', {}, 'file:///private');
  ipcRenderer.emit('navigate-view', {}, { view: 'settings' });
  expect(callback.mock.calls).toEqual([['settings']]);
  stop();
  ipcRenderer.emit('navigate-view', {}, 'overview');
  expect(callback).toHaveBeenCalledTimes(1);
  expect(ipcRenderer.listenerCount('navigate-view')).toBe(0);
});

it('ships a real ICO directory with seven valid PNG frames', () => {
  const ico = readFileSync('assets/icon.ico');
  expect(ico.readUInt16LE(0)).toBe(0);
  expect(ico.readUInt16LE(2)).toBe(1);
  expect(ico.readUInt16LE(4)).toBe(7);
  [16, 24, 32, 48, 64, 128, 256].forEach((size, index) => {
    const entry = 6 + 16 * index;
    expect(ico[entry] || 256).toBe(size);
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    expect(offset + length).toBeLessThanOrEqual(ico.length);
    expect(ico.subarray(offset, offset + 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(ico.readUInt32BE(offset + 16)).toBe(size);
    expect(ico.readUInt32BE(offset + 20)).toBe(size);
  });
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  expect(pkg.build.win.icon).toBe('assets/icon.ico');
  expect(pkg.build.files).toContain('assets/icon.ico');
});
