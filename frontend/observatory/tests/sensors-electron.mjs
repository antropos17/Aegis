import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { _electron as electron } from 'playwright';
import {
  observeSensors,
  exitWithin,
  exists,
  ownedPids,
  inspectProfile,
} from './sensor-support.mjs';
import { sensorsPassed } from '../../../tools/development/desktop-contract.mjs';

const { values } = parseArgs({
  options: { executable: { type: 'string' }, output: { type: 'string' } },
});
assert(process.platform === 'win32' && process.arch === 'x64', 'Windows x64 required');
assert(
  path.isAbsolute(values.executable ?? '') && path.isAbsolute(values.output ?? ''),
  'Absolute paths required',
);
const out = path.resolve(values.output);
fs.mkdirSync(out);
const home = path.join(out, 'home');
const profile = path.join(out, 'profile');
fs.mkdirSync(path.join(home, '.ssh'), { recursive: true });
const canary = 'AEGIS_SENSOR_CANARY_' + crypto.randomUUID();
fs.writeFileSync(path.join(home, '.ssh/sensor-held.txt'), canary);
fs.writeFileSync(path.join(home, '.env.sensor-held'), canary);
const env = {
  ...process.env,
  USERPROFILE: home,
  HOME: home,
  TEMP: path.join(out, 'temp'),
  TMP: path.join(out, 'temp'),
};
fs.mkdirSync(env.TEMP);
delete env.ELECTRON_RUN_AS_NODE;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const receipt = {
  status: 'FAIL',
  startedAt: new Date().toISOString(),
  fixture: 'owned process-name signature; synthetic home; no provider execution',
  endpoint: 'example.com:443',
  payloadBytesSent: 0,
};
let app, appProcess, fixture, page;
const errors = [];
try {
  const resolver = new dns.Resolver({ timeout: 3000, tries: 1 });
  receipt.remoteIp = (await resolver.resolve4('example.com'))[0];
  const probe = path.join(out, 'aider.exe');
  execFileSync(
    path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    [
      '/nologo',
      '/target:exe',
      '/platform:x64',
      '/warnaserror+',
      '/out:' + probe,
      path.resolve('tests/fixtures/sensor-process.cs'),
    ],
    { env, windowsHide: true, timeout: 30000, maxBuffer: 65536 },
  );
  fixture = spawn(probe, [home, receipt.remoteIp], {
    env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  fixture.stdin.on('error', () => {});
  const lines = [];
  let outputBytes = 0;
  createInterface({ input: fixture.stdout }).on('line', (line) => {
    outputBytes += Buffer.byteLength(line);
    if (outputBytes <= 65536) lines.push(line);
  });
  fixture.stderr.on('data', (data) => {
    outputBytes += data.length;
  });
  const next = async () => {
    const deadline = Date.now() + 15000;
    while (!lines.length && fixture.exitCode === null && Date.now() < deadline) await sleep(25);
    assert(
      outputBytes <= 65536 && lines.length,
      'Native fixture unavailable or output exceeded budget',
    );
    return JSON.parse(lines.shift());
  };
  const command = async (name) => {
    fixture.stdin.write(name + '\n');
    assert.deepEqual(await next(), { command: name, ok: true });
  };
  receipt.native = await next();
  assert.equal(receipt.native.ready, true);
  receipt.fixturePid = fixture.pid;
  app = await electron.launch({
    executablePath: values.executable,
    args: ['--user-data-dir=' + profile],
    env,
    timeout: 30000,
  });
  appProcess = app.process();
  receipt.packaged = await app.evaluate(
    ({ app }) => app.isPackaged && app.getAppPath().endsWith('app.asar'),
  );
  assert.equal(receipt.packaged, true);
  receipt.windowInputIsolated = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setIgnoreMouseEvents(true);
    window.setFocusable(false);
    window.blur();
    return !window.isFocusable() && !window.isFocused();
  });
  assert.equal(receipt.windowInputIsolated, true);
  page = await app.firstWindow();
  page.on('pageerror', (error) => {
    if (errors.length < 20) errors.push(error.message);
  });
  await page.getByRole('heading', { name: 'Monitoring', exact: true, level: 1 }).waitFor();
  await page.evaluate(observeSensors, { pid: fixture.pid, home, canary });
  await page.waitForFunction(
    () => window.__sensorProbe.batches.some((row) => row.reliable && row.instanceId && row.witness),
    undefined,
    { timeout: 55000 },
  );
  const first = await page.evaluate(() =>
    window.__sensorProbe.batches.find((row) => row.reliable && row.instanceId && row.witness),
  );
  receipt.instanceId = first.instanceId;
  receipt.witness = first.witness;
  // Real saved configuration: restarting the polling lifetime must not lose the TCP retry.
  await page.locator('.sidebar').getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Settings sections', exact: true })
    .getByRole('button', { name: 'Monitoring', exact: true })
    .click();
  await page.getByLabel('Scan interval (seconds)', { exact: true }).evaluate((input) => {
    input.value = '2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  receipt.settingsSavedAt = Date.now();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page
    .getByRole('status')
    .filter({ hasText: /^Settings saved$/ })
    .waitFor();
  await page.waitForFunction(
    (at) => window.__sensorProbe.network.some((row) => row.at >= at && row.rows.length === 2),
    receipt.settingsSavedAt,
    { timeout: 20000 },
  );
  receipt.networkLive = await page.evaluate(
    (at) => window.__sensorProbe.network.find((row) => row.at >= at && row.rows.length === 2),
    receipt.settingsSavedAt,
  );
  for (const name of ['create', 'modify', 'delete', 'create']) {
    await command(name);
    await sleep(2500);
  }
  await page.waitForFunction(
    () => window.__sensorProbe.files.filter((row) => row.action === 'holding').length >= 2,
    undefined,
    { timeout: 40000 },
  );
  await page.waitForFunction(
    () => window.__sensorProbe.files.filter((row) => row.action !== 'holding').length >= 4,
    undefined,
    { timeout: 10000 },
  );
  await page.locator('.sidebar').getByRole('button', { name: 'Events', exact: true }).click();
  await page.getByLabel('Search events', { exact: true }).fill('.env.sensor-events');
  const changes = page.locator('tbody tr').filter({ hasText: '.env.sensor-events' });
  await changes.getByText('Unattributed activity', { exact: true }).waitFor();
  assert.match(await changes.innerText(), /No process evidence/);
  await page.screenshot({ path: path.join(out, 'files.png') });
  await page.getByLabel('Search events', { exact: true }).fill('.env.sensor-held');
  const held = page.locator('tbody tr').filter({ hasText: '.env.sensor-held' });
  await held.getByText('Aider', { exact: true }).waitFor();
  assert.match(await held.innerText(), /PID confirmed/);
  assert.match(await held.innerText(), /holding/);
  receipt.filesVisible = true;
  await page.locator('.sidebar').getByRole('button', { name: 'Network', exact: true }).click();
  const context = page.getByRole('region', { name: 'Selected agent context', exact: true });
  await context.getByLabel('Selected agent', { exact: true }).selectOption('Aider');
  await context.getByLabel('Selected process', { exact: true }).selectOption(receipt.instanceId);
  const networkPanel = page.getByRole('region', { name: 'Network', exact: true });
  await networkPanel.getByRole('combobox', { name: 'Grouping', exact: true }).selectOption('none');
  const networkTable = networkPanel.locator('.observation-table:visible');
  const showLatest = networkTable.getByRole('button', { name: 'Show latest', exact: true });
  if (await showLatest.isEnabled()) await showLatest.click();
  const connections = networkTable.locator('tbody tr').filter({ hasText: 'Aider' });
  await connections.nth(1).waitFor({ timeout: 10000 });
  assert.equal(await connections.count(), 2);
  assert((await connections.allTextContents()).every((text) => text.includes('PID confirmed')));
  await page.screenshot({ path: path.join(out, 'network.png') });
  receipt.networkVisible = true;
  await command('close-network');
  receipt.networkClosedAt = Date.now();
  await page.waitForFunction(
    (at) => window.__sensorProbe.network.some((row) => row.at > at && row.rows.length === 0),
    receipt.networkClosedAt,
    { timeout: 40000 },
  );
  receipt.networkClosed = await page.evaluate(
    (at) => window.__sensorProbe.network.find((row) => row.at > at && row.rows.length === 0),
    receipt.networkClosedAt,
  );
  assert.equal(fixture.exitCode, null, 'Fixture exited before socket closure was observed');
  receipt.networkClosedWhileAlive = true;
  if (await showLatest.isEnabled()) await showLatest.click();
  await networkTable.getByText('No records match these filters.', { exact: true }).waitFor();
  receipt.networkClearedVisible = true;
  fixture.stdin.end();
  assert.equal(await exitWithin(fixture), 0);
  const exitAt = Date.now();
  await page.waitForFunction(
    (at) =>
      window.__sensorProbe.batches.some((row) => row.at >= at && row.reliable && !row.instanceId),
    exitAt,
    { timeout: 12000 },
  );
  receipt.fixtureExited = true;
  Object.assign(receipt, await page.evaluate(() => window.__sensorProbe));
  receipt.health = await page.evaluate(
    async () => (await window.aegis.getStats()).appHealth.sensors.byId,
  );
  assert.deepEqual(errors, []);
  receipt.ownedPids = await ownedPids(app, appProcess.pid, env);
  const closed = app.waitForEvent('close', { timeout: 15000 });
  await page.getByRole('button', { name: 'Quit AEGIS', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Quit AEGIS?', exact: true })
    .getByRole('button', { name: 'Quit AEGIS', exact: true })
    .click();
  await closed;
  assert.equal(await exitWithin(appProcess), 0);
  const deadline = Date.now() + 10000;
  while (receipt.ownedPids.some(exists) && Date.now() < deadline) await sleep(100);
  assert(
    receipt.ownedPids.every((pid) => !exists(pid)),
    'Owned app/helper remains',
  );
  receipt.closureConfirmed = true;
  receipt.audit = inspectProfile(profile, home, fixture.pid, canary);
  receipt.contentExcluded = true;
  receipt.status = 'PASS';
  assert(sensorsPassed(receipt), 'Incomplete sensor evidence');
} catch (error) {
  receipt.status = 'FAIL';
  receipt.failure = error.message;
  receipt.pageErrors = errors;
  if (page && !page.isClosed()) {
    Object.assign(receipt, await page.evaluate(() => window.__sensorProbe ?? {}).catch(() => ({})));
    await page.screenshot({ path: path.join(out, 'failure.png'), timeout: 5000 }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  if (fixture && fixture.exitCode === null) {
    fixture.stdin.end();
    await exitWithin(fixture).catch(() => {
      receipt.fixtureCleanupUnconfirmed = true;
      process.exitCode = 1;
    });
  }
  if (app && appProcess?.exitCode === null) {
    await app.close().catch(() => {
      receipt.appCleanupUnconfirmed = true;
      process.exitCode = 1;
    });
    await exitWithin(appProcess).catch(() => {
      receipt.appCleanupUnconfirmed = true;
      process.exitCode = 1;
    });
  }
  receipt.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status: receipt.status, failure: receipt.failure, output: out }));
}
