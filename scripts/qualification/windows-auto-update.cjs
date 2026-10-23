'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { hashFile, inspectInitialCache } = require('./windows-updater-cache.cjs');
const { installUpdaterObserver } = require('./windows-updater-observer.cjs');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { setTimeout: delay } = require('node:timers/promises');

assert.equal(process.platform, 'win32');
assert.equal(process.arch, 'x64');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted-hyperv-guest');
assert.equal(process.env.USERNAME, 'AegisSetup');
const options = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, values) => {
    if (index % 2 === 0) pairs.push([value.slice(2), values[index + 1]]);
    return pairs;
  }, []),
);
assert.deepEqual(Object.keys(options).sort(), ['exe', 'root']);
const root = path.resolve(options.root);
const exe = path.resolve(options.exe);
assert(root.toLowerCase().startsWith('c:\\aegis-installer-qa\\'));
assert(exe.toLowerCase().startsWith(root.toLowerCase() + '\\install\\'));
const evidence = path.join(root, 'evidence');
const profile = path.join(process.env.APPDATA, 'aegis');
const pin = '6234da8b7fb3c090fb1a2302d170ae20d56994bc5c73c00b7a15b6c4fc04e339';
const bytes = 149653092;
const expected = {
  scanIntervalSec: 20,
  notificationsEnabled: false,
  startMinimized: false,
  autoStartWithWindows: false,
  darkMode: true,
  uiScale: 1.25,
  timelineZoom: 12,
  ignoreCommonBuildDirs: false,
  automaticUpdatesEnabled: true,
};
const sentinel = 'AEGIS hosted installer lifecycle 0.20.0-to-0.20.1; disposable fixture only';
require('./windows-launch-diagnostics.cjs').enableLaunchDiagnostics();
const { _electron: electron } = createRequire(path.join(process.cwd(), 'package.json'))(
  'playwright',
);
const proof = {
  schema: 'aegis-automatic-update/1',
  status: 'RUNNING',
  sourceSha: process.env.GITHUB_SHA,
  runId: process.env.GITHUB_RUN_ID,
  from: '0.20.0-beta',
  to: '0.20.1-beta',
  states: [],
  requests: [],
  launches: [],
  manualCheckCalls: 0,
  manualDownloadCalls: 0,
  feedOverridden: false,
  verificationBypassed: false,
  error: null,
};
let app;
let cache;
const rendererErrors = [];
const save = () =>
  fs.writeFile(path.join(evidence, 'auto-update.json'), JSON.stringify(proof, null, 2));
async function observeNetwork() {
  await app.evaluate(({ session }) => {
    globalThis.__qualificationRequests = [];
    const observe = (details, phase) => {
      const url = new URL(details.url);
      if (
        ['api.github.com', 'github.com', 'release-assets.githubusercontent.com'].includes(
          url.hostname,
        ) &&
        globalThis.__qualificationRequests.length < 80
      )
        globalThis.__qualificationRequests.push({
          url: url.origin + url.pathname,
          status: details.statusCode || 0,
          phase,
        });
    };
    // electron-updater 6.8.9 uses this nonpersistent partition. Playwright's
    // main-process evaluation exposes Electron, but not a CommonJS require.
    const updaterSession = session.fromPartition('electron-updater', { cache: false });
    for (const network of [session.defaultSession, updaterSession]) {
      network.webRequest.onCompleted((details) => observe(details, 'completed'));
      network.webRequest.onBeforeRedirect((details) => observe(details, 'redirect'));
      network.webRequest.onBeforeRequest((details, callback) => {
        observe(details, 'request');
        callback({});
      });
    }
  });
}
async function launch(version) {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/TOKEN|PASSWORD|SECRET|ELECTRON_RUN_AS_NODE|NODE_OPTIONS|^DEBUG$/.test(key))
      delete env[key];
  app = await electron.launch({
    executablePath: exe,
    args: ['--user-data-dir=' + profile],
    env,
    timeout: 45000,
  });
  const window = await app.firstWindow();
  window.on('pageerror', (error) => rendererErrors.push(error.message));
  await window.waitForFunction(() => typeof window.aegis?.getUpdateStatus === 'function');
  const state = await app.evaluate(({ app }) => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    architecture: process.arch,
    pid: process.pid,
    profile: app.getPath('userData'),
  }));
  assert.equal(state.version, version);
  assert.equal(state.packaged, true);
  assert.equal(state.architecture, 'x64');
  assert.equal(path.resolve(state.profile).toLowerCase(), profile.toLowerCase());
  proof.launches.push(state);
  await app.evaluate(installUpdaterObserver);
  await observeNetwork();
  await save();
  await window
    .getByRole('heading', { name: 'Monitoring', exact: true, level: 1 })
    .waitFor({ timeout: 30000 });
  return window;
}
async function waitStatus(window, target, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const value = await window.evaluate(() => window.aegis.getUpdateStatus());
    const state = {
      status: value.status,
      version: value.version,
      progress: Math.floor(value.progress || 0),
      error: value.error,
    };
    if (JSON.stringify(proof.states.at(-1)?.value) !== JSON.stringify(state)) {
      assert(proof.states.length < 500, 'State evidence budget exceeded');
      proof.states.push({ at: new Date().toISOString(), value: state });
      await save();
    }
    assert.notEqual(value.status, 'error', value.error || 'Updater error');
    assert.notEqual(value.status, 'unsupported');
    if (value.status === target) return value;
    await delay(250);
  }
  throw Error('Timed out waiting for update status: ' + target);
}
async function collectRequests() {
  proof.requests.push(...(await app.evaluate(() => globalThis.__qualificationRequests)));
  const diagnostics = await app.evaluate(async () => {
    await Promise.all(globalThis.__qualificationUpdaterPending);
    return globalThis.__qualificationUpdater;
  });
  const filename = 'updater-discovery-' + proof.launches.length + '.json';
  await fs.writeFile(path.join(evidence, filename), JSON.stringify(diagnostics, null, 2));
  proof.discoveryReceipts ||= [];
  if (!proof.discoveryReceipts.includes(filename)) proof.discoveryReceipts.push(filename);
  await save();
}
async function checkSettings(window) {
  const actual = await window.evaluate(async (keys) => {
    const values = await window.aegis.getSettings();
    return Object.fromEntries(keys.map((key) => [key, values[key]]));
  }, Object.keys(expected));
  assert.deepEqual(actual, expected);
  assert.equal(
    await fs.readFile(path.join(profile, 'qualification-sentinel.txt'), 'utf8'),
    sentinel,
  );
}
function desktop(action, pid) {
  const script = path.join(process.cwd(), 'scripts/qualification/windows-updater-desktop.ps1');
  const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
  const command = `& ([scriptblock]::Create([IO.File]::ReadAllText(${quote(script)}))) -Action ${quote(action)} -AppPid ${pid} -Exe ${quote(exe)} -QaRoot ${quote(root)}`;
  const child = spawn(
    path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-STA', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return new Promise((resolve, reject) => {
    let size = 0;
    let diagnostic = '';
    const timer = setTimeout(
      () => {
        child.kill();
        reject(Error('Desktop witness timeout'));
      },
      action === 'relaunch' ? 210000 : 75000,
    );
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => {
        size += chunk.length;
        if (size > 65536) {
          child.kill();
          reject(Error('Desktop diagnostic budget exceeded'));
        }
        if (diagnostic.length < 8192) diagnostic += chunk.toString('utf8');
      });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(Error('Desktop witness failed: ' + diagnostic));
    });
  });
}
async function pendingInstaller() {
  const pending = path.join(cache, 'pending');
  const files = (await fs.readdir(pending)).filter((name) => name.endsWith('.exe'));
  assert.equal(files.length, 1);
  const file = path.join(pending, files[0]);
  const stat = await fs.lstat(file);
  assert(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(stat.size, bytes);
  assert.equal(await hashFile(file), pin);
  proof.downloaded = {
    filename: files[0],
    bytes: stat.size,
    sha256: pin,
    pendingWasInitiallyAbsent: proof.initialCache.pendingAbsent,
  };
  await save();
}
(async () => {
  try {
    let window = await launch(proof.from);
    const oldPid = proof.launches[0].pid;
    const config = await fs.readFile(
      path.join(path.dirname(exe), 'resources', 'app-update.yml'),
      'utf8',
    );
    const cacheName = /^updaterCacheDirName:\s*([A-Za-z0-9._-]+)\s*$/m.exec(config)?.[1];
    assert.equal(typeof cacheName, 'string');
    cache = path.join(process.env.LOCALAPPDATA, cacheName);
    proof.initialCache = await inspectInitialCache(cache, {
      bytes: 149653017,
      sha256: '9494799164b2c73a195b4fbe6c243a697025a3b119350488828e8288117d72b3',
    });
    await save();
    assert.equal((await window.evaluate(() => window.aegis.getUpdateStatus())).status, 'idle');
    const enabledAt = Date.now();
    const saved = await window.evaluate(() =>
      window.aegis.saveSettings({ automaticUpdatesEnabled: true }, { patch: true }),
    );
    assert.equal(saved.success, true);
    await checkSettings(window);
    const ready = await waitStatus(window, 'ready', 600);
    assert.equal(ready.version, proof.to);
    proof.automaticReadyAfterMs = Date.now() - enabledAt;
    assert(proof.automaticReadyAfterMs >= 25000, 'Expected the real scheduled background check');
    await collectRequests();
    await pendingInstaller();
    for (const segment of [
      '/repos/antropos17/Aegis/releases',
      '/manifest.json',
      '/manifest.json.sig',
    ])
      assert(
        proof.requests.some((r) => r.url.includes(segment) && r.status >= 200 && r.status < 400),
        'Missing actual request: ' + segment,
      );
    assert(
      proof.requests.some((r) => r.url.endsWith('.exe') && r.phase === 'request'),
      'Missing actual installer download request',
    );
    await window.getByRole('button', { name: 'Settings', exact: true }).click();
    const install = window.getByRole('button', { name: 'Install and restart', exact: true });
    await install.waitFor({ timeout: 15000 });
    await install.scrollIntoViewIfNeeded();
    await window.screenshot({ path: path.join(evidence, 'updater-ready.png') });
    const later = desktop('later', oldPid);
    await install.click();
    await later;
    assert.equal((await window.evaluate(() => window.aegis.getUpdateStatus())).status, 'ready');
    assert.equal(await app.evaluate(() => process.pid), oldPid);
    proof.laterPreservedOldProcess = true;
    await save();
    let closed = false;
    app.once('close', () => {
      closed = true;
    });
    const confirmed = desktop('install', oldPid);
    await install.click();
    await confirmed;
    // On Windows Playwright's close event follows its shell launcher. The
    // native witness checks the real old PID and new window within 180 seconds.
    await desktop('relaunch', oldPid);
    proof.playwrightClosedAtNativeRelaunch = closed;
    app = null;
    proof.relaunch = JSON.parse(
      await fs.readFile(path.join(evidence, 'updater-desktop-relaunch.json'), 'utf8'),
    );
    assert.equal(proof.relaunch.status, 'PASS');
    await delay(3000);
    window = await launch(proof.to);
    await checkSettings(window);
    await waitStatus(window, 'up-to-date', 90);
    await collectRequests();
    await window.screenshot({ path: path.join(evidence, 'updater-updated.png') });
    await app.close();
    app = null;
    window = await launch(proof.to);
    await checkSettings(window);
    await app.close();
    app = null;
    assert.deepEqual(rendererErrors, []);
    proof.settings = expected;
    proof.sentinelRetained = true;
    proof.restartPassed = true;
    proof.rendererErrors = rendererErrors;
    proof.status = 'PASS';
    await save();
  } catch (error) {
    if (app) {
      await collectRequests().catch(() => {});
      await app
        .firstWindow()
        .then((window) => window.screenshot({ path: path.join(evidence, 'updater-failure.png') }))
        .catch(() => {});
    }
    proof.status = 'FAIL';
    proof.error = error.message;
    await save();
    throw error;
  } finally {
    if (app) await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
