import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { _electron as electron } from 'playwright';
import { exitWithin, ownedPids, inspectProfile } from './sensor-support.mjs';
import {
  delay,
  diagnostics,
  readFixture,
  observe,
  matchingRead,
  observeQuit,
  scenarioPaths,
  traceHelpers,
  remainingPids,
  reliableHealth,
} from './etw-support.mjs';

/** Run the actual read loop, with an optional owner-harness preparation barrier.
 * Missing callback preserves the prior workload sequence. A rejected barrier
 * never reaches fixture.command. @param {object} options Workload resources.
 * @returns {Promise<void>} @since v0.19.2
 */
export async function runReadWorkloads({
  fixture,
  witness,
  observer,
  app,
  receipt: r,
  beforeRead,
  now = Date.now,
  wait = delay,
}) {
  if (beforeRead !== undefined) r.beforeReadPreparations = {};
  for (const mode of ['sync', 'async']) {
    if (beforeRead !== undefined)
      r.beforeReadPreparations[mode] = await beforeRead(app, witness, mode);
    const native = await fixture.command(mode);
    r[mode + 'Native'] = native;
    assert.equal(native.command, mode);
    assert.equal(native.birth, witness.birth);
    assert.equal(native.tid, witness.tid);
    if (mode === 'async')
      assert(native.pending > 0, 'Overlapped fixture never observed ERROR_IO_PENDING');
    const until = now() + 4000;
    let proof;
    while (!(proof = matchingRead(observer.probe.records, native)) && now() < until)
      await wait(100);
    assert(proof, `${mode} issuer/generation/agent proof missing`);
    r[mode + 'Proof'] = { native, record: proof };
  }
  if (beforeRead !== undefined) r.issuerPreparedBeforeRead = true;
}

/** Run one real packaged capture, optionally with a scheduled exit of its own collector.
 * @param {object} options executable, fixtureExe, out, fault.
 * @returns {Promise<object>} Private bounded metadata receipt. @since v0.19.2
 */
export async function runScenario({ executable, fixtureExe, out, fault, beforeRead }) {
  const canary = 'AEGIS_ETW_CANARY_' + crypto.randomUUID();
  const locations = scenarioPaths(out, canary);
  const { file, fixture: root, profile, home, temp } = locations;
  const final = path.join(out, 'shutdown.json');
  const env = { ...process.env, USERPROFILE: home, HOME: home, TEMP: temp, TMP: temp };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = {
    status: 'FAIL',
    fault,
    startedAt: new Date().toISOString(),
    productionAdmission: false,
    independentSessionAbsence: 'original-handle-query-by-authenticated-guard',
  };
  let app, appProcess, page, fixture, observer, short;
  const errors = [];
  try {
    fixture = readFixture(fixtureExe, file, env);
    const witness = await fixture.next();
    r.fixturePid = fixture.child.pid;
    assert.equal(witness.pid, fixture.child.pid);
    app = await electron.launch({
      executablePath: executable,
      args: [
        '--user-data-dir=' + profile,
        '--etw-file-diagnostic-root=' + root,
        ...(fault ? ['--etw-file-diagnostic-fault=collector-exit'] : []),
      ],
      env,
      timeout: 30000,
    });
    appProcess = app.process();
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
          windowInputIsolated: !w.isFocusable() && !w.isFocused(),
          bundleSelfContained: ['EtwFile.exe', 'coreclr.dll'].every((name) =>
            require('node:fs').existsSync(
              require('node:path').join(process.resourcesPath, 'etw-file', name),
            ),
          ),
        };
      }),
    );
    assert(r.packaged && r.diagnosticBuild && r.bundleSelfContained && r.windowInputIsolated);
    page = await app.firstWindow();
    await observeQuit(app, final);
    page.on('pageerror', (error) => {
      if (errors.length < 20) errors.push(error.message);
    });
    await page.getByRole('heading', { name: 'Monitoring', level: 1, exact: true }).waitFor();
    console.log(
      `Waiting for one same-account UAC decision for ${fault ? 'collector-crash' : 'post-recovery'} capture.`,
    );
    const deadline = Date.now() + 135000;
    let data;
    do {
      data = await diagnostics(app);
      if (['running', 'failed', 'recovered'].includes(data?.phase)) break;
      await delay(200);
    } while (Date.now() < deadline);
    assert.equal(data?.phase, 'running', 'Live collector/guard did not become ready');
    r.liveReady = true;
    observer = observe(app, fixture.child.pid, root, canary);
    await runReadWorkloads({ fixture, witness, observer, app, receipt: r, beforeRead });
    r.readCandidate = true;
    r.candidateMetadataOnly = true;
    r.scopeExcluded = true;
    r.ringBounded = true;
    // A short-lived native reader exits before most real-time delivery. Every
    // verified row must still match its own generation; unavailable proof stays null.
    if (fault) {
      short = readFixture(fixtureExe, file, env, true);
      const born = await short.next();
      const read = await short.next();
      assert.equal(await exitWithin(short.child), 0);
      r.rapidExitNative = read;
      const until = Date.now() + 3500;
      let rows = [];
      while (!rows.length && Date.now() < until) {
        rows = (await diagnostics(app)).records.filter(
          (row) =>
            row.eventId === 15 &&
            row.version === 1 &&
            row.issuingTid === born.tid &&
            BigInt(row.qpc) >= BigInt(read.fromQpc) &&
            BigInt(row.qpc) <= BigInt(read.toQpc),
        );
        if (!rows.length) await delay(100);
      }
      assert(rows.length, 'Rapid-exit read was not observed');
      assert(
        rows.every(
          (row) =>
            row.issuerStatus !== 'verified' ||
            (row.issuerPid === born.pid && row.generationWitness === born.birth),
        ),
        'Rapid-exit generation was misattributed',
      );
      assert(
        rows.some(
          (row) => row.issuerStatus !== 'verified' && row.agent === null && row.instanceId === null,
        ),
        'No unresolved rapid-exit observation',
      );
      r.rapidExitNoWrongGeneration = true;
      r.rapidExitUnresolved = true;
      r.rapidExitObserved = rows.length;
      r.rapidExitRead = rows.find(
        (row) => row.issuerStatus !== 'verified' && row.agent === null && row.instanceId === null,
      );
    }
    const health = await reliableHealth(page);
    r.health = health.sensors.byId['etw-file'];
    r.populationReliable = health.populationReliable === true;
    assert.equal(r.health.state, 'DEGRADED');
    assert(r.populationReliable);
    await page.locator('.sidebar').getByRole('button', { name: 'Statistics', exact: true }).click();
    await page
      .getByRole('navigation', { name: 'Statistics sections', exact: true })
      .getByRole('button', { name: 'Sensors', exact: true })
      .click();
    const card = page.locator('article').filter({ hasText: 'Windows file events' });
    await card.getByText('Degraded', { exact: true }).waitFor({ timeout: 10000 });
    r.healthVisible = true;
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, 'etw.png') });
    r.ownedPids = await ownedPids(app, appProcess.pid, env);
    r.traceHelperPids = traceHelpers(r.ownedPids, env, (await diagnostics(app)).nativeProcessIds);
    assert(
      r.traceHelperPids.length >= 3,
      'Broker, collector and independent guard were not observed',
    );
    if (fault) {
      const until = Date.now() + 45000;
      do {
        data = await diagnostics(app);
        if (data.summaries.length) break;
        await delay(100);
      } while (Date.now() < until);
      r.summary = data.summaries.at(-1);
      assert.equal(r.summary?.recoveryVerified, true, 'Independent cleanup was not verified');
      assert.equal(r.summary.collectorExit, 70);
      assert.equal(r.summary.exitCode, 4);
      assert.equal(r.summary.stopVerified, false);
      assert.equal(r.summary.finalTotals, null);
      assert.equal(r.summary.observationGap, true);
      assert.equal(data.phase, 'recovered');
      assert.equal(data.records.length, 0);
      const failedAt = Date.now();
      await card.getByText('Failed', { exact: true }).waitFor({ timeout: 10000 });
      r.failureVisibilityMs = Date.now() - failedAt;
      r.failureVisible = true;
      await page.screenshot({ path: path.join(out, 'recovered.png') });
      const after = await reliableHealth(page);
      assert.equal(after.sensors.byId['etw-file'].state, 'FAILED');
      assert.equal(after.populationReliable, true);
      await delay(1500);
      const still = await diagnostics(app);
      assert.equal(still.phase, 'recovered');
      assert.equal(still.summaries.length, 1);
      assert.equal(still.restartBlocked, false);
      r.noAutomaticRestart = true;
      assert(remainingPids(r.traceHelperPids, env).length === 0, 'Recovered helper remains');
      r.guardClosureConfirmed = true;
    } else {
      assert.equal((await diagnostics(app)).phase, 'running');
      r.quitDuringCapture = true;
    }
    await observer.close();
    observer = null;
    await fixture.close();
    r.fixtureExited = true;
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
    if (!fault) r.summary = ended.summaries.at(-1);
    assert.equal(ended.records.length, 0);
    const until = Date.now() + 10000;
    while (remainingPids([...r.ownedPids, ...r.traceHelperPids], env).length && Date.now() < until)
      await delay(100);
    assert(
      remainingPids([...r.ownedPids, ...r.traceHelperPids], env).length === 0,
      'Owned app/helper remains',
    );
    r.closureConfirmed = true;
    const audit = inspectProfile(profile, root, fixture.child.pid, canary);
    assert(
      !audit.some((row) => row.type === 'file-access' || row.type?.startsWith('etw-')),
      'Diagnostic path entered audit',
    );
    r.noDiagnosticAudit = true;
    r.contentExcluded = true;
    assert.deepEqual(errors, []);
    r.status = 'PASS';
  } catch (error) {
    r.failure = error.message;
    r.pageErrors = errors;
    process.exitCode = 1;
    if (app && appProcess?.exitCode === null) {
      r.lastDiagnostics = await diagnostics(app)
        .then((data) => ({ ...data, records: data.records.slice(-32) }))
        .catch(() => null);
      await page
        ?.screenshot({ path: path.join(out, 'failure.png'), timeout: 5000 })
        .catch(() => {});
    }
  } finally {
    if (observer)
      await observer.close().catch((error) => {
        r.observerFailure = error.message;
      });
    if (fixture?.child.exitCode === null)
      await fixture.close().catch(() => {
        r.fixtureCleanupUnconfirmed = true;
      });
    if (short?.child.exitCode === null)
      await short.close().catch(() => {
        r.fixtureCleanupUnconfirmed = true;
      });
    if (app && appProcess?.exitCode === null) {
      await app.close().catch(() => {
        r.appCleanupUnconfirmed = true;
      });
      await exitWithin(appProcess).catch(() => {
        r.appCleanupUnconfirmed = true;
      });
    }
    if (r.status !== 'PASS' && fs.existsSync(final) && fs.statSync(final).size <= 262144) {
      r.failureShutdown = JSON.parse(fs.readFileSync(final)).summaries.at(-1);
    }
    if (r.appCleanupUnconfirmed || r.fixtureCleanupUnconfirmed || r.observerFailure) {
      r.status = 'FAIL';
      process.exitCode = 1;
    }
    r.completedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify(r, null, 2));
    console.log(JSON.stringify({ status: r.status, fault, failure: r.failure }));
  }
  return r;
}
