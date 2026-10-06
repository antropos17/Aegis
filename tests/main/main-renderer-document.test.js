import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const windows = [];
const electron = {
  app: {
    getPath: () => os.tmpdir(),
    getVersion: () => 'test',
    setName: () => {},
    disableHardwareAcceleration: () => {},
    requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}),
    on: () => {},
    quit: () => {},
  },
  BrowserWindow: class {
    constructor(options) {
      this.options = options;
      this.events = new Map();
      this.webContents = {
        on: (name, handler) => this.events.set(name, handler),
        setWindowOpenHandler: vi.fn(),
        session: { webRequest: { onHeadersReceived: vi.fn() } },
      };
      this.loadFile = vi.fn();
      this.loadURL = vi.fn();
      this.setMenuBarVisibility = vi.fn();
      this.on = vi.fn();
      windows.push(this);
    }
  },
  globalShortcut: { register: () => {}, unregisterAll: () => {} },
  shell: {},
  ipcMain: { handle: () => {}, on: () => {} },
  dialog: {},
  Notification: class {},
  Tray: class {},
  Menu: { buildFromTemplate: (value) => value },
  nativeImage: {},
  safeStorage: { isEncryptionAvailable: () => false },
};
const require_ = createRequire(import.meta.url);
const mainPath = require_.resolve('../../src/main/main.js');
const previousModule = require_.cache[mainPath];
delete require_.cache[mainPath];
const originalLoad = Module._load;
Module._load = function (request) {
  return request === 'electron' ? electron : originalLoad.apply(this, arguments);
};
const originalArgv = process.argv;
process.argv = ['node', 'main.js'];
const main = require_(mainPath);

afterEach(() => {
  vi.unstubAllEnvs();
  main._setMainWindowForTest(undefined);
  delete electron.app.isPackaged;
  windows.length = 0;
});
afterAll(() => {
  Module._load = originalLoad;
  process.argv = originalArgv;
  delete require_.cache[mainPath];
  if (previousModule) require_.cache[mainPath] = previousModule;
});

const localFile = path.resolve('dist', 'renderer', 'index.html');
describe('main renderer document selection', () => {
  it.each([
    'https://untrusted.example/app',
    'http://127.0.0.1:5173/',
    'file:///untrusted/renderer.html',
    'data:text/html,untrusted',
  ])('loads local packaged content despite override %s', (override) => {
    vi.stubEnv('VITE_DEV_SERVER_URL', override);
    electron.app.isPackaged = true;
    main.createWindow();
    const window = windows[0];
    expect(window.loadFile).toHaveBeenCalledExactlyOnceWith(localFile);
    expect(window.loadURL).not.toHaveBeenCalled();
    expect(window.options.webPreferences).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    });
    const foreign = { url: override, preventDefault: vi.fn() };
    window.events.get('will-navigate')(foreign);
    expect(foreign.preventDefault).toHaveBeenCalledOnce();
    const local = { url: pathToFileURL(localFile).href, preventDefault: vi.fn() };
    window.events.get('will-navigate')(local);
    expect(local.preventDefault).not.toHaveBeenCalled();
  });

  it.each(['http://localhost:5173/', 'http://[::1]:5173/'])(
    'keeps the explicit unpackaged dev server %s',
    (override) => {
      vi.stubEnv('VITE_DEV_SERVER_URL', override);
      electron.app.isPackaged = false;
      main.createWindow();
      expect(windows[0].loadURL).toHaveBeenCalledExactlyOnceWith(override);
      expect(windows[0].loadFile).not.toHaveBeenCalled();
    },
  );

  it('defaults to the local file when there is no override', () => {
    vi.stubEnv('VITE_DEV_SERVER_URL', '');
    electron.app.isPackaged = false;
    main.createWindow();
    expect(windows[0].loadFile).toHaveBeenCalledExactlyOnceWith(localFile);
  });

  it('does not enable development when the packaging state is unavailable', () => {
    vi.stubEnv('VITE_DEV_SERVER_URL', 'https://untrusted.example/');
    main.createWindow();
    expect(windows[0].loadFile).toHaveBeenCalledExactlyOnceWith(localFile);
  });
});
