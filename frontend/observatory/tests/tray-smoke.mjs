import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = process.cwd();
const packaged = !!process.env.AEGIS_SMOKE_EXECUTABLE;
const out = resolve(packaged ? 'dist/packaged-tray-qa' : 'dist/tray-qa');
const profile = resolve(out, 'profile');
await mkdir(profile, { recursive: true });
await writeFile(resolve(profile, 'settings.json'), JSON.stringify({ startMinimized: true }));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(packaged ? { executablePath: process.env.AEGIS_SMOKE_EXECUTABLE } : {}),
  args: [...(packaged ? [] : [root]), '--user-data-dir=' + profile],
  env,
  timeout: 45000,
});
const errors = [];
try {
  const window = await app.firstWindow();
  window.on('pageerror', (error) => errors.push(error.message));
  await window.getByRole('heading', { name: 'Monitoring', exact: true, level: 1 }).waitFor();
  const packaging = await app.evaluate(async ({ app }, expectedPackaged) => {
    const { createRequire } = process.getBuiltinModule('node:module');
    const { join } = process.getBuiltinModule('node:path');
    const load = createRequire(join(app.getAppPath(), 'package.json'));
    if (app.isPackaged !== expectedPackaged) throw new Error('Unexpected packaging mode');
    const buildMetadataPresent = Object.hasOwn(load('./package.json'), 'build');
    if (expectedPackaged && buildMetadataPresent) throw new Error('Build metadata not stripped');
    const tray = load('./src/main/tray-icon.js');
    const deadline = Date.now() + 5000;
    while (!tray._state?.tray && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    const state = tray._state;
    if (!state?.tray) throw new Error('Native tray did not initialize');
    const original = state.tray.setContextMenu.bind(state.tray);
    state.tray.setContextMenu = (menu) => {
      globalThis.__trayMenu = menu;
      original(menu);
    };
    tray.init(state);
    tray.rebuildTrayMenu();
    return { isPackaged: app.isPackaged, buildMetadataPresent };
  }, packaged);
  const click = (id) =>
    app.evaluate((_electron, key) => {
      const item = globalThis.__trayMenu.getMenuItemById(key);
      if (!item) throw new Error('Missing native menu item: ' + key);
      item.click();
    }, id);
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    false,
  );
  await click('open');
  assert(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await click('settings');
  await window.getByRole('heading', { name: 'Settings', exact: true, level: 1 }).waitFor();
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()),
    false,
  );
  await window.screenshot({ path: resolve(out, 'settings.png') });
  await click('monitoring');
  assert.equal(
    await app.evaluate(() => globalThis.__trayMenu.getMenuItemById('monitoring').label),
    'Resume Monitoring',
  );
  await click('monitoring');
  assert.equal(
    await app.evaluate(() => globalThis.__trayMenu.getMenuItemById('monitoring').label),
    'Pause Monitoring',
  );
  const labels = await app.evaluate(() =>
    globalThis.__trayMenu.items.filter((item) => item.id).map((item) => item.label),
  );
  assert.deepEqual(labels, ['Open AEGIS', 'Pause Monitoring', 'Settings', 'Quit']);
  const security = await app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    const prefs = windows[0].webContents.getLastWebPreferences();
    return {
      windowCount: windows.length,
      sandbox: prefs.sandbox,
      contextIsolation: prefs.contextIsolation,
      nodeIntegration: prefs.nodeIntegration,
    };
  });
  assert.deepEqual(security, {
    windowCount: 1,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
  });
  assert.deepEqual(errors, []);
  const exited = new Promise((resolve) => app.process().once('exit', resolve));
  await click('quit');
  await exited;
  const receipt = {
    packaging,
    labels,
    security,
    errors,
    verified: [
      'native tray menu callbacks',
      'open hidden window',
      'restore minimized window into Settings',
      'pause and resume labels',
      'Quit exits the app',
    ],
    limits: ['Explorer rendering and installed shortcut upgrade not exercised'],
  };
  await writeFile(resolve(out, 'verification.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally {
  await app.close().catch(() => {});
}
