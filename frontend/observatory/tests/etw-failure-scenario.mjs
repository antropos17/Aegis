import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { _electron as electron } from 'playwright';
import { exitWithin, ownedPids, inspectProfile } from './sensor-support.mjs';
import { delay, diagnostics, scenarioPaths, observeQuit, traceHelpers } from './etw-support.mjs';
import { inspectSession, waitOwnedExit } from './etw-failure-support.mjs';

/** Exercise one actual fault in a marked packaged app; no provider/backend injection.
 * @param {object} options executable/out/mode. @returns {Promise<object>} @since v0.19.2
 */
export async function runFailure({ executable, out, mode }) {
  const canary = 'AEGIS_ETW_FAILURE_' + crypto.randomUUID();
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
  let app, child, page;
  const final = path.join(out, 'shutdown.json');
  const errors = [];
  try {
    r.before = await inspectSession(helper, out, 'before', env);
    assert.equal(r.before.present, false);
    app = await electron.launch({
      executablePath: executable,
      env,
      timeout: 30000,
      args: [
        '--user-data-dir=' + p.profile,
        '--etw-file-diagnostic-root=' + p.fixture,
        ...(mode === 'app-exit' ? [] : ['--etw-file-diagnostic-fault=' + mode]),
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
    page = await app.firstWindow();
    page.on('pageerror', (e) => {
      if (errors.length < 10) errors.push(e.message);
    });
    await observeQuit(app, final);
    await page.getByRole('heading', { name: 'Monitoring', level: 1, exact: true }).waitFor();
    console.log('Waiting for one same-account capture UAC decision: ' + mode);
    const dual = mode.startsWith('dual-');
    const triple = mode.startsWith('triple-');
    const group = mode.startsWith('group-');
    const early = mode.includes('-before-');
    let data;
    const readyUntil = Date.now() + 135000;
    do {
      data = await diagnostics(app);
      if (early ? data.summaries.length : data.phase === 'running') break;
      if (!early && data.summaries.length) throw Error('Capture failed before ready');
      await delay(100);
    } while (Date.now() < readyUntil);
    r.ownedPids = await ownedPids(app, child.pid, env);
    r.helperPids = early ? [] : traceHelpers(r.ownedPids, env);
    r.mainCustodyObserved = data.custodyObserved === true;
    if (early) {
      r.summary = data.summaries.at(-1);
      assert.equal(r.summary?.recoveryVerified, true, 'Reservation cleanup not verified');
      assert.equal(r.summary.capture, null, 'Pre-ready fault produced a ready capture');
      assert.equal(r.summary.exitCode, 4);
      assert.equal(r.summary.collectorExit, 70);
      assert.equal(r.summary.finalTotals, null);
      assert.equal(r.summary.observationGap, true);
      assert.equal(data.restartBlocked, false);
      assert.equal(r.summary.finalCounters.queryStatus, mode.endsWith('before-start') ? 4201 : 0);
      if (dual) assert.equal(r.summary.recoveryCause, 'collector-and-guard-exited');
      if (triple) assert.equal(r.summary.recoveryCause, 'all-three-helpers-exited');
      if (group) {
        assert.equal(r.summary.recoveryCause, 'broker-and-all-helpers-exited');
        assert.equal(r.summary.brokerExit, 75);
        assert.equal(r.mainCustodyObserved, true);
      }
      r.nativeHelperClosure = group
        ? 'cleanup controller verified all four original main-held process object exits'
        : 'broker verified retained collector, primary guard and fallback exits';
    } else {
      assert.equal(data.phase, 'running');
      assert(r.helperPids.length >= 4);
      r.liveReady = true;
      r.presence = await inspectSession(helper, out, 'during', env);
      assert.equal(r.presence.present, true);
    }
    await page.locator('.sidebar').getByRole('button', { name: 'Statistics', exact: true }).click();
    await page
      .getByRole('navigation', { name: 'Statistics sections', exact: true })
      .getByRole('button', { name: 'Sensors', exact: true })
      .click();
    const card = page.locator('article').filter({ hasText: 'Windows file events' });
    if (mode === 'app-exit') {
      await card.getByText('Degraded', { exact: true }).waitFor({ timeout: 10000 });
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(out, 'before-exit.png') });
      // Exit only this owned Electron main process, bypassing its normal quit path.
      await app.evaluate(() => process.exit(73)).catch(() => {});
      r.appExitCode = await exitWithin(child);
      assert.equal(r.appExitCode, 73);
      r.abruptAppExit = true;
    } else {
      const until = Date.now() + (mode.endsWith('-access-denied') ? 185000 : 55000);
      while (!data.summaries.length && Date.now() < until) {
        if (data.recoveryPending) r.recoveryPendingObserved = true;
        if (data.cleanupConsentPending) r.cleanupConsentPendingObserved = true;
        await delay(100);
        data = await diagnostics(app);
      }
      r.summary = data.summaries.at(-1);
      assert(r.summary, 'No ended capture summary');
      assert.equal(data.records.length, 0);
      if (group) {
        assert.equal(r.mainCustodyObserved, true);
        assert.equal(data.restartBlocked, false);
        assert.equal(r.summary.recoveryVerified, true);
        assert.equal(r.summary.recoveryCause, 'broker-and-all-helpers-exited');
        assert.equal(r.summary.brokerExit, 75);
        assert.equal(r.summary.collectorExit, 70);
        assert.equal(r.summary.exitCode, 4);
        assert.equal(r.summary.finalCounters.queryStatus, mode.endsWith('before-start') ? 4201 : 0);
        assert.equal(r.summary.finalTotals, null);
        assert.equal(r.summary.observationGap, true);
        assert.deepEqual(r.summary.recoveryPeers, {
          guardExit: 71,
          fallbackExit: 74,
          brokerElevated: false,
          cleanupElevated: mode === 'group-access-denied',
          accessDenied: mode === 'group-access-denied',
        });
      } else if (mode === 'broker-exit') {
        assert.equal(r.mainCustodyObserved, true);
        assert.equal(data.restartBlocked, false);
        assert.equal(r.summary.recoveryVerified, true);
        assert.equal(r.summary.recoveryCause, 'broker-and-all-helpers-exited');
        assert.equal(r.summary.brokerExit, 72);
        assert.equal(r.summary.collectorExit, 2);
        assert.equal(r.summary.exitCode, 4);
        assert.equal(r.summary.finalCounters.queryStatus, 4201);
        // A failed fallback may exit 2 before main verifies recovery itself.
        // Its code is recorded as failure; it is never the cleanup proof here.
        assert([0, 2].includes(r.summary.recoveryPeers.fallbackExit));
        assert.deepEqual(r.summary.recoveryPeers, {
          guardExit: 0,
          fallbackExit: r.summary.recoveryPeers.fallbackExit,
          brokerElevated: false,
          cleanupElevated: false,
          accessDenied: false,
        });
      } else if (triple) {
        assert.equal(data.restartBlocked, false);
        assert.equal(r.summary.recoveryVerified, true);
        assert.equal(r.summary.recoveryCause, 'all-three-helpers-exited');
        assert.deepEqual(r.summary.recoveryPeers, {
          guardExit: 71,
          fallbackExit: 74,
          brokerElevated: false,
          cleanupElevated: mode === 'triple-access-denied',
          accessDenied: mode === 'triple-access-denied',
        });
        assert.equal(r.summary.exitCode, 4);
        assert.equal(r.summary.collectorExit, 70);
        assert.equal(r.summary.finalCounters.queryStatus, mode.endsWith('before-start') ? 4201 : 0);
        assert.equal(r.summary.finalTotals, null);
        assert.equal(r.summary.observationGap, true);
      } else if (dual || mode === 'guard-exit') {
        assert.equal(data.restartBlocked, false);
        assert.equal(r.summary.recoveryVerified, true);
        assert.equal(r.summary.recoveryCause, 'collector-and-guard-exited');
        assert.equal(r.summary.exitCode, 4);
        assert.equal(r.summary.collectorExit, mode === 'guard-exit' ? 2 : 70);
        assert.equal(
          r.summary.finalCounters.queryStatus,
          mode === 'guard-exit' || mode === 'dual-before-start' ? 4201 : 0,
        );
        assert.equal(r.summary.finalTotals, null);
        assert.equal(r.summary.observationGap, true);
      } else if (!early) {
        assert.equal(data.restartBlocked, true, 'Unverified cleanup permitted retry');
        assert.equal(r.summary.recoveryVerified, false);
        assert.equal(r.summary.exitCode, mode === 'broker-exit' ? 72 : 2);
        assert.equal(r.summary.finalCounters, null);
        assert.equal(r.summary.finalTotals, null);
        assert.equal(r.summary.observationGap, true);
        r.restartBlocked = true;
      }
      r.restartBlocked = data.restartBlocked;
      r.mainSurvived =
        (await app.evaluate(() => process.pid)) === r.mainPid && child.exitCode === null;
      assert.equal(r.mainSurvived, true);
      const health = await page.evaluate(async () => (await window.aegis.getStats()).appHealth);
      assert.equal(health.sensors.byId['etw-file'].state, 'FAILED');
      assert.equal(health.populationReliable, true);
      await card.getByText('Failed', { exact: true }).waitFor({ timeout: 10000 });
      r.failureVisible = true;
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(out, 'failed.png') });
      const sessions = data.summaries.length;
      await delay(1500);
      const still = await diagnostics(app);
      assert.equal(still.summaries.length, sessions);
      assert.equal(still.restartBlocked, !!r.restartBlocked);
      r.noAutomaticRestart = true;
      if (r.helperPids.length) await waitOwnedExit(r.helperPids, env);
      const closed = app.waitForEvent('close', { timeout: 22000 });
      await page.getByRole('button', { name: 'Quit AEGIS', exact: true }).click();
      await page
        .getByRole('dialog', { name: 'Quit AEGIS?', exact: true })
        .getByRole('button', { name: 'Quit AEGIS', exact: true })
        .click();
      await closed;
      assert.equal(await exitWithin(child), 0);
    }
    await waitOwnedExit([...new Set([...r.ownedPids, ...r.helperPids])], env);
    r.closureConfirmed = true;
    r.after = await inspectSession(helper, out, 'after', env);
    assert.equal(r.after.present, false, 'ETW session remains after fault');
    const audit = inspectProfile(p.profile, p.fixture, -1, canary);
    assert(!audit.some((row) => row.type === 'file-access' || row.type?.startsWith('etw-')));
    r.contentExcluded = true;
    r.noDiagnosticAudit = true;
    assert.deepEqual(errors, []);
    r.status = 'PASS';
  } catch (error) {
    r.failure = error.message;
    r.pageErrors = errors;
    process.exitCode = 1;
    if (app && child?.exitCode === null) {
      r.lastDiagnostics = await diagnostics(app)
        .then((d) => ({ ...d, records: d.records.slice(-16) }))
        .catch(() => null);
      await page
        ?.screenshot({ path: path.join(out, 'failure.png'), timeout: 5000 })
        .catch(() => {});
    }
  } finally {
    if (app && child?.exitCode === null) {
      await app.close().catch(() => {
        r.appCleanupUnconfirmed = true;
      });
      await exitWithin(child).catch(() => {
        r.appCleanupUnconfirmed = true;
      });
    }
    if (r.status !== 'PASS' && fs.existsSync(final) && fs.statSync(final).size <= 262144)
      r.failureShutdown = JSON.parse(fs.readFileSync(final)).summaries.at(-1);
    if (r.appCleanupUnconfirmed) {
      r.status = 'FAIL';
      process.exitCode = 1;
    }
    r.completedAt = new Date().toISOString();
    const json = JSON.stringify(r, null, 2);
    assert(Buffer.byteLength(json) <= 262144);
    fs.writeFileSync(path.join(out, 'receipt.json'), json, { flag: 'wx' });
    console.log(JSON.stringify({ status: r.status, mode, failure: r.failure }));
  }
  return r;
}
