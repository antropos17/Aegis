'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { _electron: electron } = createRequire(path.join(process.cwd(), 'package.json'))(
  'playwright',
);
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  assert(['--exe', '--root', '--phase', '--version'].includes(process.argv[i]), 'Unknown argument');
  assert(process.argv[i + 1], 'Missing argument');
  options[process.argv[i].slice(2)] = process.argv[i + 1];
}
for (const name of ['exe', 'root', 'phase', 'version']) assert(options[name], 'Missing ' + name);
assert(['seed', 'verify'].includes(options.phase), 'Invalid phase');
const root = path.resolve(options.root);
const hosted =
  process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted';
const allowed = path.resolve(hosted ? process.env.RUNNER_TEMP : 'X:/tmp');
assert(
  root.toLowerCase().startsWith((allowed + path.sep).toLowerCase()),
  'QA output must be in the disposable temp directory',
);
const profile = hosted ? path.join(process.env.APPDATA, 'aegis') : path.join(root, 'profile');
const expected = {
  scanIntervalSec: 20,
  notificationsEnabled: false,
  startMinimized: false,
  autoStartWithWindows: false,
  darkMode: true,
  uiScale: 1.25,
  timelineZoom: 12,
  ignoreCommonBuildDirs: false,
};
const sentinel = 'AEGIS isolated upgrade fixture — no user data';
const normalize = (value) => path.resolve(value).toLowerCase();
let app;
async function launch() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: path.resolve(options.exe),
    args: ['--user-data-dir=' + profile],
    env,
    timeout: 60000,
  });
  const window = await app.firstWindow();
  await window.waitForFunction(() => typeof window.aegis?.getSettings === 'function');
  const state = await app.evaluate(({ app }) => ({
    version: app.getVersion(),
    profile: app.getPath('userData'),
    packaged: app.isPackaged,
  }));
  assert.equal(normalize(state.profile), normalize(profile));
  assert.equal(state.version, options.version);
  assert.equal(state.packaged, true);
  return window;
}
async function verify(window) {
  const actual = await window.evaluate(async (keys) => {
    const settings = await window.aegis.getSettings();
    return Object.fromEntries(keys.map((key) => [key, settings[key]]));
  }, Object.keys(expected));
  assert.deepEqual(actual, expected);
  if (options.version === '0.15.0-alpha') {
    assert.equal(
      await window.evaluate(async () => (await window.aegis.getSettings()).automaticUpdatesEnabled),
      false,
      'Upgrade must not enable automatic updates without consent',
    );
  }
  assert.equal(
    await fs.readFile(path.join(profile, 'qualification-sentinel.txt'), 'utf8'),
    sentinel,
  );
}
(async () => {
  await fs.mkdir(root, { recursive: true });
  if (options.phase === 'seed') {
    try {
      await fs.access(profile);
      throw new Error('Seed profile already exists; refusing to overwrite it');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await fs.mkdir(profile, { recursive: true });
    await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify(expected));
    await fs.writeFile(path.join(profile, 'qualification-sentinel.txt'), sentinel);
  }
  try {
    let window = await launch();
    if (options.phase === 'seed') {
      const saved = await window.evaluate(async (patch) => {
        const current = await window.aegis.getSettings();
        return window.aegis.saveSettings({ ...current, ...patch });
      }, expected);
      assert.equal(saved.success, true, saved.error || 'Old version rejected fixture settings');
    }
    await verify(window);
    await app.close();
    app = null;
    window = await launch();
    await verify(window);
    if (options.version === '0.15.0-alpha') {
      await window.getByRole('heading', { name: 'Agent radar', exact: true }).waitFor();
      await window.screenshot({ path: path.join(root, 'upgraded-radar.png') });
    }
    await fs.writeFile(
      path.join(root, options.phase + '.json'),
      JSON.stringify(
        {
          version: options.version,
          executable: path.resolve(options.exe),
          profile,
          phase: options.phase,
          checkedSettings: expected,
          sentinelRetained: true,
          restartPassed: true,
          installerWasExecutedByThisScript: false,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        version: options.version,
        phase: options.phase,
        settings: Object.keys(expected).length,
        restartPassed: true,
      }),
    );
  } finally {
    if (app) await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
