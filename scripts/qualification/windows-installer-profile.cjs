'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createRequire } = require('node:module');

if (
  process.platform !== 'win32' ||
  process.env.GITHUB_ACTIONS !== 'true' ||
  !['github-hosted', 'github-hosted-hyperv-guest'].includes(process.env.RUNNER_ENVIRONMENT)
) {
  throw Error(
    'Installer profile qualification requires a disposable GitHub-hosted Windows runner.',
  );
}
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  assert(['--exe', '--root', '--phase', '--version'].includes(process.argv[i]));
  assert(process.argv[i + 1]);
  options[process.argv[i].slice(2)] = process.argv[i + 1];
}
for (const key of ['exe', 'root', 'phase', 'version']) assert(options[key]);
assert(['fresh', 'baseline', 'upgrade', 'reinstall'].includes(options.phase));
assert(['0.20.0-beta', '0.20.1-beta'].includes(options.version));
const normalize = (p) => path.resolve(p).toLowerCase();
const root = path.resolve(options.root);
assert(normalize(root).startsWith(normalize(process.env.RUNNER_TEMP) + path.sep));
require('./windows-installer-paths.cjs').assertInstallPath(root, options.exe);
const profile = path.join(process.env.APPDATA, 'aegis');
const expected = {
  scanIntervalSec: 20,
  notificationsEnabled: false,
  startMinimized: false,
  autoStartWithWindows: false,
  darkMode: true,
  uiScale: 1.25,
  timelineZoom: 12,
  ignoreCommonBuildDirs: false,
  automaticUpdatesEnabled: false,
};
const sentinel = 'AEGIS hosted installer lifecycle 0.20.0-to-0.20.1; disposable fixture only';
const seed = ['fresh', 'baseline'].includes(options.phase);
require('./windows-launch-diagnostics.cjs').enableLaunchDiagnostics();
const { _electron: electron } = createRequire(path.join(process.cwd(), 'package.json'))(
  'playwright',
);
let app;
const observed = [];
const errors = [];
let stage = 'profile-seed';
const startedAt = Date.now();
async function launch() {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/TOKEN|PASSWORD|SECRET|ELECTRON_RUN_AS_NODE|NODE_OPTIONS|^DEBUG$/.test(key))
      delete env[key];
  stage = 'electron-launch-' + (observed.length + 1);
  app = await electron.launch({
    executablePath: path.resolve(options.exe),
    args: ['--user-data-dir=' + profile],
    env,
    timeout: 45000,
  });
  stage = 'first-window-' + (observed.length + 1);
  const window = await app.firstWindow();
  stage = 'bridge-ready-' + (observed.length + 1);
  window.on('pageerror', (error) => errors.push(error.message));
  await window.waitForFunction(() => typeof window.aegis?.getSettings === 'function', undefined, {
    timeout: 30000,
  });
  const state = await app.evaluate(({ app }) => ({
    version: app.getVersion(),
    profile: app.getPath('userData'),
    packaged: app.isPackaged,
    pid: process.pid,
    architecture: process.arch,
  }));
  assert.equal(state.version, options.version);
  assert.equal(normalize(state.profile), normalize(profile));
  assert.equal(state.packaged, true);
  assert.equal(state.architecture, 'x64');
  observed.push(state);
  stage = 'rendered-monitoring-' + observed.length;
  assert(
    (await window.locator('body').innerText()).trim().length > 0,
    'Rendered application is empty',
  );
  await window
    .getByRole('heading', { name: 'Monitoring', exact: true, level: 1 })
    .waitFor({ timeout: 30000 });
  return window;
}
async function verify(window) {
  stage = 'verify-settings-' + observed.length;
  const actual = await window.evaluate(async (keys) => {
    const values = await window.aegis.getSettings();
    return Object.fromEntries(keys.map((key) => [key, values[key]]));
  }, Object.keys(expected));
  assert.deepEqual(actual, expected, 'Settings changed across launch, upgrade or reinstall');
  assert.equal(
    await fs.readFile(path.join(profile, 'qualification-sentinel.txt'), 'utf8'),
    sentinel,
  );
}
(async () => {
  if (seed) {
    await assert.rejects(fs.access(profile), (error) => error.code === 'ENOENT');
    await fs.mkdir(profile);
    await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify(expected), {
      flag: 'wx',
    });
    await fs.writeFile(path.join(profile, 'qualification-sentinel.txt'), sentinel, { flag: 'wx' });
  }
  try {
    let window = await launch();
    if (seed) {
      const saved = await window.evaluate((patch) => window.aegis.saveSettings(patch), expected);
      assert.equal(saved.success, true, saved.error || 'Settings save refused');
    }
    await verify(window);
    await app.close();
    app = null;
    window = await launch();
    await verify(window);
    await window.screenshot({
      path: path.join(root, 'evidence', options.phase + '.png'),
    });
    assert.deepEqual(errors, [], 'Renderer page errors');
    await app.close();
    app = null;
    await fs.writeFile(
      path.join(root, 'evidence', options.phase + '.json'),
      JSON.stringify(
        {
          status: 'PASS',
          phase: options.phase,
          version: options.version,
          observations: observed,
          settings: expected,
          sentinelRetained: true,
          restartPassed: true,
          rendererErrors: errors,
          scope:
            'Installed packaged application launch and retained synthetic settings/data; no provider or protection acceptance.',
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    );
  } catch (error) {
    await fs.writeFile(
      path.join(root, 'evidence', options.phase + '-failure.json'),
      JSON.stringify(
        {
          status: 'FAIL',
          stage,
          elapsedMs: Date.now() - startedAt,
          observations: observed,
          error: error.message,
          launchTimeoutMs: 45000,
          diagnosticLimitBytes: 262144,
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    if (app) await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
