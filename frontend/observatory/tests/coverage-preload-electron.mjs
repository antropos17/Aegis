import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, lstat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import {
  hash,
  sourceBinding,
  storage,
  removeScratch,
  assertDormant,
  terminateOwned,
  armDeadline,
  boundedLog,
  prepareBuild,
} from './coverage-preload-support.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const reuseReceipt = args[0] === '--reuse-build' ? resolve(args[1]) : null;
assert.equal(
  args.length,
  reuseReceipt ? 4 : 3,
  'Usage: --build | --reuse-build RECEIPT --output NEW_DIRECTORY',
);
assert.equal(args[0], reuseReceipt ? '--reuse-build' : '--build');
assert.equal(args[reuseReceipt ? 2 : 1], '--output');
assert.equal(process.platform, 'win32', 'Actual Windows is required; no platform simulation');
assert.match(process.version, /^v24\./);
assert(Number(process.versions.node.split('.')[1]) >= 16, 'Node 24.16 or later is required');
const output = resolve(args.at(-1));
// Every run uses a new directory; receipts and screenshots are never overwritten.
for (let ancestor = dirname(output); ; ancestor = dirname(ancestor)) {
  assert(!(await lstat(ancestor)).isSymbolicLink(), 'Output ancestor is a reparse/link');
  if (dirname(ancestor) === ancestor) break;
}
await mkdir(output);
const scratch = join(output, 'disposable');
await mkdir(scratch);
for (const directory of ['profile', 'session', 'logs', 'temp', 'cache'])
  await mkdir(join(scratch, directory));
const env = {
  ...process.env,
  TEMP: join(scratch, 'temp'),
  TMP: join(scratch, 'temp'),
  npm_config_cache: join(scratch, 'cache'),
  NODE_COMPILE_CACHE: join(scratch, 'cache', 'node'),
  ELECTRON_CACHE: join(scratch, 'cache', 'electron'),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const receipt = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  repo,
  output,
  scope: 'actual Windows dormant ETW leaf through unchanged preload and production renderer',
  fixture: 'dedicated IPC sender and ancillary booting envelope; no production main authorization',
  exclusions: [
    'normal startup',
    'live/native capture',
    'Linux/macOS runtime',
    'packaged ETW helper selection',
    'full W9 acceptance',
  ],
  limits: {
    appBatchMs: 120000,
    combinedLogBytes: 2097152,
    disposableBytes: 134217728,
    screenshotBytes: 8388608,
  },
  pass: false,
  cleanup: false,
};
let app;
let appChild;
const log = boundedLog(receipt.limits.combinedLogBytes);
let interval;
let deadline;
let inFlight = false;
const samples = [];
const errors = [];
try {
  receipt.storageBefore = await storage(output);
  receipt.sourceBefore = await sourceBinding(repo);
  receipt.node = { version: process.version, sha256: await hash(process.execPath) };
  const electronName = (
    await readFile(join(repo, 'node_modules/electron/path.txt'), 'utf8')
  ).trim();
  const executablePath = join(repo, 'node_modules/electron/dist', electronName);
  receipt.electronBinary = { sha256: await hash(executablePath) };
  await prepareBuild({ repo, receipt, env, log, reuseReceipt });
  const input = join(scratch, 'input.json');
  await writeFile(input, JSON.stringify({ repo, scratch }));
  env.AEGIS_COVERAGE_INPUT = input;
  const appStarted = Date.now();
  deadline = armDeadline(receipt.limits.appBatchMs);
  receipt.deadline = {
    armedBeforeLaunch: true,
    totalMs: receipt.limits.appBatchMs,
    shutdownReserveMs: 15000,
  };
  await deadline.run(
    async () => {
      app = await electron.launch({
        executablePath,
        args: [join(repo, 'frontend/observatory/tests/coverage-preload-harness.cjs')],
        cwd: scratch,
        env,
        timeout: 30000,
      });
      const child = app.process();
      appChild = child;
      receipt.processId = child.pid;
      const fatal = new Promise((_, reject) => {
        const capture = (chunk) => {
          if (log.add(chunk) > receipt.limits.combinedLogBytes)
            reject(new Error('Combined log exceeded 2 MiB'));
        };
        child.stdout?.on('data', capture);
        child.stderr?.on('data', capture);
        interval = setInterval(async () => {
          if (inFlight) return;
          inFlight = true;
          try {
            const measured = await storage(scratch);
            samples.push({ at: new Date().toISOString(), ...measured });
            if (measured.bytes > receipt.limits.disposableBytes)
              reject(new Error('Disposable profile/cache exceeded 128 MiB'));
          } catch (error) {
            reject(error);
          } finally {
            inFlight = false;
          }
        }, 1000);
      });
      const check = async () => {
        receipt.electronVersion = await app.evaluate(() => process.versions.electron);
        const page = await app.firstWindow({ timeout: 15000 });
        page.setDefaultTimeout(10000);
        page.on('pageerror', (error) => errors.push(error.message));
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const coverage = page
          .locator('.sidebar')
          .getByRole('button', { name: 'Coverage', exact: true });
        await coverage.focus();
        await page.keyboard.press('Enter');
        const panel = page.locator('.coverage-workspace');
        await panel.waitFor({ state: 'visible' });
        const inspect = () => app.evaluate(() => global.__coveragePreload.inspect());
        const raw = await page.evaluate(() => window.aegis.getStats());
        assert.deepEqual(
          raw,
          (await inspect()).raw,
          'Real preload reply differs from actual runtime snapshot',
        );
        await assertDormant(page, raw);
        assert(
          await page.locator('#main').evaluate((node) => document.activeElement === node),
          'Coverage focus',
        );
        assert.equal(await panel.getByText('Preview · simulated data', { exact: true }).count(), 0);
        receipt.initial = await inspect();
        const statistics = panel.getByRole('button', { name: 'Sensor statistics', exact: true });
        await statistics.focus();
        await page.keyboard.press('Tab');
        const action = panel.getByRole('button', { name: 'Review action control', exact: true });
        assert(
          await action.evaluate((node) => node === document.activeElement),
          'Coverage toolbar tab order',
        );
        assert(
          await action.evaluate((node) => getComputedStyle(node).outlineStyle !== 'none'),
          'Focus indicator',
        );
        await statistics.focus();
        await page.keyboard.press('Enter');
        await page.getByRole('heading', { name: 'Statistics', level: 1, exact: true }).waitFor();
        assert.equal(
          await page
            .getByRole('button', { name: 'Sensors', exact: true })
            .getAttribute('aria-current'),
          'location',
        );
        const sensor = page
          .locator('.sensor-grid article')
          .filter({ hasText: 'Windows file events' });
        assert.equal(await sensor.locator('.sensor-state').innerText(), 'Off');
        assert(
          await sensor
            .getByText('Optional diagnostic capture is off.', { exact: true })
            .isVisible(),
        );
        await coverage.focus();
        await page.keyboard.press('Enter');
        await panel.waitFor({ state: 'visible' });
        await assertDormant(page, raw);
        // Negative control: omit only the leaf in a real Electron stats-update push.
        // The raw production runtime stays untouched; the oracle must detect bridge/display loss.
        await app.evaluate(() => global.__coveragePreload.publish(true));
        await panel
          .getByText('Sensor health has not been delivered yet.', { exact: true })
          .waitFor();
        await assert.rejects(assertDormant(page, raw));
        receipt.negativeControl = {
          kind: 'fixture transport omission',
          detected: true,
          rawRuntimeUnchanged: true,
        };
        assert.deepEqual((await inspect()).raw, raw);
        await app.evaluate(() => global.__coveragePreload.publish());
        await assertDormant(page, raw);
        const animations = await page.evaluate(() => ({
          reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
          infiniteRunning: document
            .getAnimations()
            .filter(
              (animation) =>
                animation.playState === 'running' &&
                animation.effect?.getTiming().iterations === Infinity,
            ).length,
        }));
        assert.equal(animations.reduced, true);
        assert.equal(animations.infiniteRunning, 0);
        receipt.reducedMotion = animations;
        receipt.screenshots = [];
        for (const viewport of [
          { width: 1200, height: 800 },
          { width: 900, height: 600 },
        ]) {
          await page.setViewportSize(viewport);
          await panel.locator('.sensor-list').scrollIntoViewIfNeeded();
          assert(
            await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
            'Coverage horizontal overflow',
          );
          const path = join(output, `dormant-${viewport.width}x${viewport.height}.png`);
          // Chromium's CDP screenshot can wait for a hidden compositor indefinitely.
          // Electron captures this owned webContents while preserving show:false.
          const png = await app.evaluate(async ({ BrowserWindow }) => {
            const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage(
              undefined,
              {
                stayHidden: true,
                stayAwake: true,
              },
            );
            return image.toPNG().toString('base64');
          });
          const bytes = Buffer.from(png, 'base64');
          assert(bytes.length > 1000 && bytes.length <= receipt.limits.screenshotBytes);
          await writeFile(path, bytes);
          receipt.screenshots.push({
            path,
            bytes: (await lstat(path)).size,
            sha256: await hash(path),
          });
        }
        assert(
          receipt.screenshots.reduce((sum, file) => sum + file.bytes, 0) <=
            receipt.limits.screenshotBytes,
        );
        receipt.final = await inspect();
        assert.deepEqual(receipt.final.forbidden, {
          spawn: 0,
          exists: 0,
          rootCheck: 0,
          agents: 0,
          population: 0,
        });
        assert.equal(receipt.final.active, false);
        assert.equal(receipt.final.diagnostics.phase, 'disabled');
        assert.deepEqual(receipt.final.diagnostics.nativeProcessIds, []);
        assert.deepEqual(receipt.final.blockedRequests, []);
        assert.equal(receipt.final.window.visible, false);
        for (const [key, expected] of [
          ['sandbox', true],
          ['contextIsolation', true],
          ['nodeIntegration', false],
        ])
          assert.equal(receipt.final.window.preferences[key], expected);
        for (const [key, directory] of [
          ['userData', 'profile'],
          ['sessionData', 'session'],
          ['logs', 'logs'],
        ])
          assert.equal(resolve(receipt.final.paths[key]), join(scratch, directory));
        assert(
          !receipt.final.loaded.some((file) =>
            /[/\\](main|process-scanner|file-watcher|config|llm-detector|token-reader)\.js$/.test(
              file,
            ),
          ),
          'Normal application/provider module loaded',
        );
        assert(receipt.final.calls.filter((channel) => channel === 'get-stats').length >= 2);
        assert.deepEqual(errors, []);
        receipt.appElapsedMs = Date.now() - appStarted;
        receipt.sourceAfterRun = await sourceBinding(repo);
        assert.deepEqual(
          receipt.sourceAfterRun,
          receipt.sourceBefore,
          'Source changed during Electron run',
        );
        receipt.pass = true;
      };
      await Promise.race([check(), fatal]);
    },
    'Electron launch/evaluation/journey',
    receipt.limits.appBatchMs,
    15000,
  );
} catch (error) {
  receipt.pass = false;
  receipt.error = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  clearInterval(interval);
  let cleanupAllowed = receipt.buildProcess?.cleanupAllowed !== false;
  if (app) {
    try {
      await deadline.run(() => app.close(), 'Owned Electron close', 5000);
      receipt.shutdown = {
        requests: 0,
        confirmed: appChild.exitCode !== null || appChild.signalCode !== null,
      };
    } catch (error) {
      receipt.closeError = error.message;
      try {
        const remaining = deadline.remaining();
        const exitMs = Math.min(3000, Math.floor(remaining / 2));
        const commandMs = Math.min(5000, Math.max(1, remaining - exitMs - 50));
        receipt.shutdown = await deadline.run(
          () => terminateOwned(appChild, { commandMs, exitMs }),
          'Owned Electron termination',
          commandMs + exitMs + 25,
        );
      } catch (failure) {
        receipt.shutdown = { confirmed: false, reason: failure.message };
      }
      receipt.pass = false;
      process.exitCode = 1;
    }
    cleanupAllowed &&= receipt.shutdown.confirmed;
  } else if (deadline) {
    receipt.shutdown = {
      confirmed: false,
      reason: 'Electron launch did not yield an owned process handle',
    };
    cleanupAllowed = false;
  }
  try {
    const drainSampling = async () => {
      while (inFlight) await new Promise((done) => setTimeout(done, 25));
    };
    if (deadline) await deadline.run(drainSampling, 'Storage sampling drain', 1000);
    else await drainSampling();
  } catch (error) {
    receipt.samplingUnconfirmed = error.message;
    cleanupAllowed = false;
  }
  if (deadline) {
    receipt.appBatchElapsedMs = receipt.limits.appBatchMs - deadline.remaining();
    deadline.dispose();
  }
  receipt.samples = samples;
  receipt.storageAfterApp = await storage(scratch);
  if (receipt.storageAfterApp.bytes > receipt.limits.disposableBytes) {
    receipt.pass = false;
    process.exitCode = 1;
  }
  try {
    assert(cleanupAllowed, 'Owned child exit/termination unconfirmed; disposable profile retained');
    await removeScratch(scratch, output);
    receipt.cleanup = true;
  } catch (error) {
    receipt.cleanupError = error.message;
    receipt.pass = false;
    process.exitCode = 1;
  }
  await writeFile(join(output, 'combined.log'), log.content());
  receipt.combinedLogBytes = log.bytes();
  receipt.storageAfter = await storage(output);
  receipt.finishedAt = new Date().toISOString();
  if (process.exitCode) receipt.pass = false;
  await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2));
}
console.log(
  JSON.stringify({
    pass: receipt.pass,
    cleanup: receipt.cleanup,
    receipt: join(output, 'receipt.json'),
  }),
);
// An unresolved Playwright transport must not turn an explicit cleanup uncertainty
// into an indefinitely running parent. Preserve its owned profile and PID receipt.
if (receipt.shutdown?.confirmed === false || receipt.buildProcess?.cleanupAllowed === false)
  process.exit(1);
