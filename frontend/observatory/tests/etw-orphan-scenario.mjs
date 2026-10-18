import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { _electron as electron } from 'playwright';
import { exitWithin, ownedPids, inspectProfile } from './sensor-support.mjs';
import {
  delay,
  diagnostics,
  scenarioPaths,
  observeQuit,
  traceHelpers,
  remainingPids,
} from './etw-support.mjs';
import { inspectSession, waitOwnedExit } from './etw-failure-support.mjs';
import { observeCustodian } from './etw-custodian-support.mjs';
import { etwOrphanCasePassed } from '../../../tools/development/etw-orphan-contract.mjs';

/** Observe real original-main/native loss; no provider events or recovery are injected.
 * @param {object} options executable/out/mode. @returns {Promise<object>} @since v0.19.2
 */
export async function runOrphanFailure({ executable, out, mode }) {
  const canary = 'AEGIS_ETW_ORPHAN_' + crypto.randomUUID();
  const p = scenarioPaths(out, canary);
  const env = { ...process.env, USERPROFILE: p.home, HOME: p.home, TEMP: p.temp, TMP: p.temp };
  delete env.ELECTRON_RUN_AS_NODE;
  const helper = path.join(path.dirname(executable), 'resources/etw-file/EtwFile.exe');
  const r = {
    status: 'FAIL',
    mode,
    startedAt: new Date().toISOString(),
    productionAdmission: false,
  };
  const early = mode.includes('-before-'),
    guardianOnly = mode === 'custodian-exit';
  let app, child, observer;
  const errors = [];
  try {
    r.before = await inspectSession(helper, out, 'before', env);
    assert.equal(r.before.present, false);
    observer = observeCustodian(helper, out, env);
    const endpoint = await observer.until((m) => m.type === 'endpoint', 30000);
    assert(/^[0-9a-f]{32}:[1-9]\d*:[1-9]\d*$/.test(endpoint.address));
    app = await electron.launch({
      executablePath: executable,
      env,
      timeout: 30000,
      args: [
        '--user-data-dir=' + p.profile,
        '--etw-file-diagnostic-root=' + p.fixture,
        '--etw-file-diagnostic-fault=' + mode,
        '--etw-file-diagnostic-observer=' + endpoint.address,
      ],
    });
    child = app.process();
    Object.assign(
      r,
      await app.evaluate(({ app, BrowserWindow }) => {
        const require = process.mainModule
          .require('node:module')
          .createRequire(app.getAppPath() + '/package.json');
        const w = BrowserWindow.getAllWindows()[0];
        w.setIgnoreMouseEvents(true);
        w.setFocusable(false);
        w.blur();
        return {
          packaged: app.isPackaged && app.getAppPath().endsWith('app.asar'),
          diagnosticBuild: require('./package.json').aegisEtwDiagnostic === true,
          mainPid: process.pid,
          windowInputIsolated: !w.isFocusable() && !w.isFocused(),
        };
      }),
    );
    assert(r.packaged && r.diagnosticBuild && r.windowInputIsolated);
    await observeQuit(app, path.join(out, 'shutdown.json'));
    const page = await app.firstWindow();
    page.on('pageerror', (e) => {
      if (errors.length < 10) errors.push(e.message);
    });
    await page.getByRole('heading', { name: 'Monitoring', level: 1, exact: true }).waitFor();
    console.log('Waiting for one same-account capture UAC decision: ' + mode);
    r.reserved = await observer.until((m) => m.type === 'reserved', 135000);
    assert.equal(r.reserved.originalPids[0], r.mainPid);
    const phase =
      mode === 'orphan-before-start'
        ? 'before-start'
        : mode === 'orphan-before-arm'
          ? 'before-arm'
          : 'running';
    await observer.until((m) => m.type === 'phase' && m.kind === phase, 15000);
    let data = await diagnostics(app);
    const readyUntil = Date.now() + 10000;
    while (!early && data.phase !== 'running' && Date.now() < readyUntil) {
      await delay(100);
      data = await diagnostics(app);
    }
    r.mainCustodyObserved = data.custodyObserved === true;
    assert(r.mainCustodyObserved);
    r.liveReady = data.phase === 'running';
    assert.equal(r.liveReady, !early);
    r.boundary = phase;
    r.ownedPids = await ownedPids(app, child.pid, env);
    r.helperPids = traceHelpers(r.ownedPids, env, data.nativeProcessIds);
    assert(r.helperPids.length >= 5 && r.helperPids.includes(r.reserved.custodianPid));
    assert(r.reserved.originalPids.slice(1).every((pid) => r.helperPids.includes(pid)));
    r.presence = await inspectSession(helper, out, 'during', env);
    assert.equal(r.presence.present, mode !== 'orphan-before-start');
    await page.screenshot({ path: path.join(out, 'before-loss.png') });
    if (mode === 'orphan-native-first') {
      await observer.until((m) => m.type === 'phase' && m.kind === 'triple-exited', 40000);
      assert.equal(await app.evaluate(() => process.pid), r.mainPid);
      assert.equal(remainingPids([r.reserved.originalPids[1]], env).length, 1);
      r.mainAndBrokerSurvivedUntilTripleExit = true;
    }
    if (guardianOnly) {
      const exited = await observer.until((m) => m.type === 'peer-exit', 45000);
      assert.equal(exited.custodianExit, 76);
      r.custodianExit = 76;
      const until = Date.now() + 55000;
      while (!data.summaries.length && Date.now() < until) {
        await delay(100);
        data = await diagnostics(app);
      }
      r.summary = data.summaries.at(-1);
      assert.equal(r.summary?.recoveryVerified, true);
      assert.equal(r.summary.exitCode, 4);
      assert.equal(r.summary.finalTotals, null);
      assert.equal(r.summary.observationGap, true);
      assert.equal(data.restartBlocked, false);
      r.mainSurvived = (await app.evaluate(() => process.pid)) === r.mainPid;
      assert(r.mainSurvived);
      const health = await page.evaluate(async () => (await window.aegis.getStats()).appHealth);
      assert.equal(health.sensors.byId['etw-file'].state, 'FAILED');
      r.failureVisible = true;
      const count = data.summaries.length;
      await delay(1500);
      assert.equal((await diagnostics(app)).summaries.length, count);
      r.noAutomaticRestart = true;
      await page
        .locator('.sidebar')
        .getByRole('button', { name: 'Statistics', exact: true })
        .click();
      await page
        .getByRole('navigation', { name: 'Statistics sections', exact: true })
        .getByRole('button', { name: 'Sensors', exact: true })
        .click();
      const card = page.locator('article').filter({ hasText: 'Windows file events' });
      await card.getByText('Failed', { exact: true }).waitFor({ timeout: 10000 });
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(out, 'failed.png') });
      const closed = app.waitForEvent('close', { timeout: 22000 });
      await page.getByRole('button', { name: 'Quit AEGIS', exact: true }).click();
      await page
        .getByRole('dialog', { name: 'Quit AEGIS?', exact: true })
        .getByRole('button', { name: 'Quit AEGIS', exact: true })
        .click();
      await closed;
      r.appExitCode = await exitWithin(child);
      assert.equal(r.appExitCode, 0);
    } else {
      // Only the owned normal Electron main exits here. Native fault modes exit themselves.
      await app.evaluate(() => process.exit(73)).catch(() => {});
      r.appExitCode = await exitWithin(child);
      assert.equal(r.appExitCode, 73);
      r.abruptAppExit = true;
      const terminal = await observer.until((m) => m.type === 'terminal', 45000);
      r.terminal = terminal;
      assert.equal(terminal.custodianExit, 4);
    }
    await observer.settled();
    r.observerExited = true;
    r.observerEvents = observer.events();
    await waitOwnedExit(
      [...new Set([...r.ownedPids, ...r.helperPids, ...r.reserved.originalPids])],
      env,
    );
    r.closureConfirmed = true;
    r.after = await inspectSession(helper, out, 'after', env);
    assert.equal(r.after.present, false);
    const audit = inspectProfile(p.profile, p.home, r.mainPid, canary);
    assert(
      audit.every(
        (row) =>
          !row.type?.startsWith('etw-') &&
          !(row.type === 'file-access' && row.path?.startsWith(p.fixture + path.sep)),
      ),
    );
    r.contentExcluded = true;
    r.noDiagnosticAudit = true;
    assert.deepEqual(errors, []);
    r.status = 'PASS';
    assert(etwOrphanCasePassed(r), 'Incomplete orphan receipt');
  } catch (error) {
    r.status = 'FAIL';
    r.failure = error.message;
    r.pageErrors = errors;
    if (child?.exitCode === null) {
      try {
        await app.evaluate(() => process.exit(73));
      } catch {
        /* The owned main may already have exited. */
      }
    }
    try {
      const pids = [
        ...new Set([
          ...(r.ownedPids ?? []),
          ...(r.helperPids ?? []),
          ...(r.reserved?.originalPids ?? []),
        ]),
      ];
      if (pids.length) await waitOwnedExit(pids, env);
      r.failureAfter = await inspectSession(helper, out, 'failure-after', env);
    } catch (cleanup) {
      r.cleanupFailure = cleanup.message;
    }
    if (observer) r.observerEvents = observer.events();
  } finally {
    observer?.stop();
    r.completedAt = new Date().toISOString();
    const json = JSON.stringify(r, null, 2);
    assert(Buffer.byteLength(json) <= 262144);
    fs.writeFileSync(path.join(out, 'receipt.json'), json + '\n', { flag: 'wx' });
  }
  console.log(JSON.stringify({ status: r.status, mode, failure: r.failure }));
  return r;
}
