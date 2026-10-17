import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { _electron as electron } from 'playwright';
import { exitWithin, exists, ownedPids, inspectProfile } from './sensor-support.mjs';
import { etwPassed } from '../../../tools/development/etw-package.mjs';

const { values } = parseArgs({
  options: { executable: { type: 'string' }, output: { type: 'string' } },
});
assert(process.platform === 'win32' && process.arch === 'x64', 'Windows x64 required');
assert(path.isAbsolute(values.executable ?? '') && path.isAbsolute(values.output ?? ''));
const out = path.resolve(values.output);
fs.mkdirSync(out);
const fixture = path.join(out, 'fixture');
const home = path.join(out, 'home');
const profile = path.join(out, 'profile');
const temp = path.join(out, 'temp');
for (const folder of [fixture, home, temp]) fs.mkdirSync(folder);
const canary = 'AEGIS_ETW_CANARY_' + crypto.randomUUID();
const file = path.join(fixture, 'read.txt');
const outside = path.join(out, 'outside.txt');
fs.writeFileSync(file, canary.padEnd(4096, '.'));
fs.writeFileSync(outside, canary);
const env = { ...process.env, USERPROFILE: home, HOME: home, TEMP: temp, TMP: temp };
delete env.ELECTRON_RUN_AS_NODE;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const receipt = {
  status: 'FAIL',
  startedAt: new Date().toISOString(),
  scope: 'live Kernel-File diagnostic; ordinary Node reads synthetic files; candidates only',
  productionAdmission: false,
  independentSessionAbsence: 'not-qualified',
};
let app, appProcess, page;
const errors = [];

async function diagnostics() {
  return app.evaluate(async ({ app }) => {
    const { createRequire } = process.mainModule.require('node:module');
    return createRequire(app.getAppPath() + '/package.json')(
      './src/main/main.js',
    ).getEtwFileDiagnostics();
  });
}
try {
  app = await electron.launch({
    executablePath: values.executable,
    args: ['--user-data-dir=' + profile, '--etw-file-diagnostic-root=' + fixture],
    env,
    timeout: 30000,
  });
  appProcess = app.process();
  Object.assign(
    receipt,
    await app.evaluate(async ({ app, BrowserWindow }) => {
      const { createRequire } = process.mainModule.require('node:module');
      const require = createRequire(app.getAppPath() + '/package.json');
      const w = BrowserWindow.getAllWindows()[0];
      w.setIgnoreMouseEvents(true);
      w.setFocusable(false);
      w.blur();
      return {
        packaged: app.isPackaged && app.getAppPath().endsWith('app.asar'),
        diagnosticBuild: require('./package.json').aegisEtwDiagnostic === true,
        windowInputIsolated: !w.isFocusable() && !w.isFocused(),
        bundleSelfContained: ['EtwFile.exe', 'EtwFile.dll', 'coreclr.dll'].every((name) =>
          require('node:fs').existsSync(
            require('node:path').join(process.resourcesPath, 'etw-file', name),
          ),
        ),
      };
    }),
  );
  assert(receipt.packaged && receipt.diagnosticBuild && receipt.bundleSelfContained);
  page = await app.firstWindow();
  page.on('pageerror', (error) => {
    if (errors.length < 20) errors.push(error.message);
  });
  await page.getByRole('heading', { name: 'Monitoring', level: 1, exact: true }).waitFor();
  console.log('Waiting for the single interactive ETW collector UAC decision (up to 130 seconds).');
  const readyDeadline = Date.now() + 135000;
  let data;
  do {
    data = await diagnostics();
    if (data?.phase === 'running' || data?.phase === 'failed') break;
    await sleep(200);
  } while (Date.now() < readyDeadline);
  assert.equal(data?.phase, 'running', 'Live ETW collector did not become ready');
  receipt.liveReady = true;
  let observed = false;
  const readDeadline = Date.now() + 12000;
  while (Date.now() < readDeadline) {
    fs.readFileSync(file);
    fs.readFileSync(outside);
    data = await diagnostics();
    assert.equal(data.phase, 'running');
    assert(data.ringBytes <= 1024 ** 2 && data.records.length <= 256, 'Unbounded diagnostic ring');
    assert(
      data.records.every((r) => r.agent === null && r.instanceId === null),
      'False attribution',
    );
    assert(
      data.records.every(
        (r) => r.path === null || r.path.toLowerCase().startsWith(fixture.toLowerCase() + '\\'),
      ),
      'Out-of-scope retention',
    );
    assert(!JSON.stringify(data).includes(canary), 'File contents retained');
    observed ||= data.records.some(
      (r) => r.eventId === 15 && r.headerPid === process.pid && r.path === file,
    );
    await sleep(50);
  }
  assert(observed, 'Own ordinary-process Read candidate missing');
  receipt.readCandidate = observed;
  receipt.candidateMetadataOnly = true;
  receipt.scopeExcluded = true;
  receipt.ringBounded = true;
  receipt.ringDropped = data.ringDropped;
  const health = await page.evaluate(async () => (await window.aegis.getStats()).appHealth);
  receipt.health = health.sensors.byId['etw-file'];
  receipt.populationReliable = health.populationReliable === true;
  assert.equal(receipt.health.state, 'DEGRADED');
  assert.match(receipt.health.detail, /experimental-correlation/);
  await page.locator('.sidebar').getByRole('button', { name: 'Statistics', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Statistics sections', exact: true })
    .getByRole('button', { name: 'Sensors', exact: true })
    .click();
  const card = page.locator('article').filter({ hasText: 'Windows file events' });
  await card.getByText('Degraded', { exact: true }).waitFor({ timeout: 10000 });
  receipt.healthVisible = true;
  await page.screenshot({ path: path.join(out, 'etw.png') });
  receipt.ownedPids = await ownedPids(app, appProcess.pid, env);
  const final = path.join(out, 'shutdown.json');
  // Observe the real owner at will-quit; do not inject records or replace the backend.
  await app.evaluate(async ({ app }, destination) => {
    const { createRequire } = process.mainModule.require('node:module');
    const require = createRequire(app.getAppPath() + '/package.json');
    const main = require('./src/main/main.js');
    app.once('will-quit', () => {
      const data = JSON.stringify(main.getEtwFileDiagnostics());
      require('node:fs').writeFileSync(
        destination,
        data.length <= 262144 ? data : '{"overflow":true}',
        { flag: 'wx' },
      );
    });
  }, final);
  assert.equal((await diagnostics()).phase, 'running', 'Capture already ended before quit');
  receipt.quitDuringCapture = true;
  const closed = app.waitForEvent('close', { timeout: 22000 });
  await page.getByRole('button', { name: 'Quit AEGIS', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Quit AEGIS?', exact: true })
    .getByRole('button', { name: 'Quit AEGIS', exact: true })
    .click();
  await closed;
  assert.equal(await exitWithin(appProcess), 0);
  assert(fs.statSync(final).size <= 262144);
  const ended = JSON.parse(fs.readFileSync(final));
  assert.equal(ended.phase, 'stopped');
  assert.equal(ended.records.length, 0);
  receipt.summary = ended.summaries.at(-1);
  assert.equal(receipt.summary.stopVerified, true);
  assert.equal(receipt.summary.stopReason, 'shutdown');
  const deadline = Date.now() + 10000;
  while (receipt.ownedPids.some(exists) && Date.now() < deadline) await sleep(100);
  assert(
    receipt.ownedPids.every((pid) => !exists(pid)),
    'Owned app/helper remains',
  );
  receipt.closureConfirmed = true;
  const audit = inspectProfile(profile, fixture, process.pid, canary);
  assert.equal(audit.length, 0, 'Diagnostic candidate admitted to audit');
  receipt.contentExcluded = true;
  receipt.noDiagnosticAudit = true;
  assert.deepEqual(errors, []);
  receipt.status = 'PASS';
  assert(etwPassed(receipt), 'Incomplete packaged ETW evidence');
} catch (error) {
  receipt.status = 'FAIL';
  receipt.failure = error.message;
  receipt.pageErrors = errors;
  if (app && appProcess?.exitCode === null) {
    receipt.lastDiagnostics = await diagnostics().catch(() => null);
    await page?.screenshot({ path: path.join(out, 'failure.png'), timeout: 5000 }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  if (app && appProcess?.exitCode === null) {
    await app.close().catch(() => {
      receipt.appCleanupUnconfirmed = true;
    });
    await exitWithin(appProcess).catch(() => {
      receipt.appCleanupUnconfirmed = true;
    });
  }
  if (receipt.appCleanupUnconfirmed) {
    receipt.status = 'FAIL';
    process.exitCode = 1;
  }
  receipt.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status: receipt.status, failure: receipt.failure, output: out }));
}
