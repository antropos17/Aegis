import {
  until,
  evidence,
  displayedRisk,
  prepareNativeReadWindow,
  probeRetainedObjectRelease,
} from './windows-native-read-support.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import { GUI_EXECUTABLE } from '../produce-protected-gui-manifest.mjs';
import { launchNativeReadElectron } from './windows-native-read-launch.mjs';
import { matchingNativeAuditRows } from './windows-native-read-audit.mjs';
import {
  recordScannerReadiness,
  readScannerSnapshotDiagnostic,
  recordIssuerPreparationReadiness,
  recordOperationalAdmission,
} from './windows-native-read-readiness.mjs';
import {
  projectReadFixtureFailure,
  projectReadFixtureCommandDiagnostic,
} from '../../frontend/observatory/tests/etw-read-fixture-protocol.mjs';
import {
  diagnostics,
  readFixture,
  observeQuit,
  matchingRead,
} from '../../frontend/observatory/tests/etw-support.mjs';
import { inspectProfile, exitWithin } from '../../frontend/observatory/tests/sensor-support.mjs';
import { observeCustodian } from '../../frontend/observatory/tests/etw-custodian-support.mjs';

/** Exercise the real marked package through scanner, native capture, consumers and renderer.
 * @param {object} options Owned synthetic workload and immutable candidate inputs.
 * @returns {Promise<object>} Actual event linkage after acknowledged closure.
 * @since v0.20.1
 */
export async function runNativeReadScenario({
  fixtureExe,
  file,
  out,
  env: hostEnv,
  r,
  canary,
  candidate,
  helper,
}) {
  let app, fixture, appProcess, page, observer;
  let failure;
  try {
    fixture = readFixture(fixtureExe, file, hostEnv, false, true);
    const witness = await fixture.next();
    assert.equal(witness.pid, fixture.child.pid);
    r.witness = witness;
    assert.equal(
      witness.shareDelete,
      false,
      'Synthetic reader must deny delete sharing for release observation',
    );
    observer = observeCustodian(helper, out, hostEnv, true);
    const endpoint = await observer.until((message) => message.type === 'endpoint', 10000);
    r.launch = {};
    app = await launchNativeReadElectron({
      launch: (options) => electron.launch(options),
      options: {
        executablePath: path.join(candidate, GUI_EXECUTABLE),
        args: [
          '--user-data-dir=' + path.join(out, 'profile'),
          '--etw-file-diagnostic-root=' + path.dirname(file),
          '--etw-file-object-policy',
          '--etw-file-diagnostic-observer=' + endpoint.address,
        ],
        env: hostEnv,
      },
      observation: r.launch,
    });
    appProcess = app.process();
    await prepareNativeReadWindow(
      app,
      path.join(out, 'window-observation.json'),
      hostEnv,
      r,
      (query) => fixture.windowDpi(query),
    );
    page = await app.firstWindow();
    await observeQuit(app, path.join(out, 'shutdown.json'));
    await page.getByRole('heading', { name: 'Monitoring', level: 1, exact: true }).waitFor();
    const navigation = page.getByRole('navigation', { name: 'Main navigation' });
    await navigation
      .getByRole('button', { name: 'Settings', exact: true })
      .click({ timeout: 10_000 });
    await page.getByRole('checkbox', { name: 'Simple interface', exact: true }).check({
      timeout: 10_000,
    });
    await navigation.getByRole('button', { name: 'Investigate', exact: true }).click({
      timeout: 10_000,
    });
    await page
      .getByRole('region', { name: 'Investigation workspace' })
      .waitFor({ timeout: 10_000 });
    await page.evaluate((pid) => {
      window.__nativeReadProbe = { object: [], legacy: [], overflow: false };
      window.aegis.onFileAccess((value) => {
        for (const row of Array.isArray(value) ? value : [value]) {
          if (row.pid !== pid) continue;
          const target =
            row.observationKind === 'bound-object-read'
              ? window.__nativeReadProbe.object
              : window.__nativeReadProbe.legacy;
          if (target.length >= 128) window.__nativeReadProbe.overflow = true;
          else target.push(row);
        }
      });
    }, witness.pid);
    r.identityWait = { samples: 0, last: null };
    let ready;
    try {
      ready = await until(
        () => evidence(app),
        (value) => recordScannerReadiness(value, witness, r.identityWait),
        30000,
        'Actual reliable scanner identity unavailable',
      );
    } catch (error) {
      let diagnosticTimer;
      const unavailable = () => readScannerSnapshotDiagnostic({});
      try {
        r.identityWait.snapshotDiagnostic = await Promise.race([
          app.evaluate(readScannerSnapshotDiagnostic),
          new Promise((resolve) => {
            diagnosticTimer = setTimeout(() => resolve(unavailable()), 1000);
          }),
        ]);
      } catch {
        r.identityWait.snapshotDiagnostic = unavailable();
      } finally {
        clearTimeout(diagnosticTimer);
      }
      throw error;
    }
    r.actor = ready.agents.find((agent) => agent.pid === witness.pid);
    r.issuerPreparationWait = { samples: 0, first: null, last: null };
    await until(
      () => diagnostics(app),
      (value) => recordIssuerPreparationReadiness(value, witness, r.issuerPreparationWait),
      30000,
      'Native issuer preparation did not complete',
    );
    const view = await page.evaluate(
      async () => (await window.aegis.getStats()).fileReadDiagnostics,
    );
    recordOperationalAdmission(view, r);
    r.originalCohort = await observer.until((message) => message.type === 'reserved', 10000);
    assert(
      r.originalCohort.originalObjectsObserved === true &&
        r.originalCohort.originalPids.length === 5 &&
        r.originalCohort.originalPids.includes(r.window.mainPid),
      'Original retained process cohort unavailable',
    );
    r.beforeRisk = await displayedRisk(page, app, r.actor);
    r.beforeAdmission = ready.admission;
    assert(
      !ready.observations.some((event) => event.instanceId === r.actor.instanceId),
      'Fresh actor already has operational object history',
    );
    for (const mode of ['sync', 'async']) {
      const command = fixture.command(mode);
      const native = await command;
      assert.equal(native.pid, witness.pid);
      assert.equal(native.birth, witness.birth);
      assert.equal(native.reads, 160);
      if (mode === 'async') assert(native.pending > 0, 'Pending I/O was not observed');
      const captured = await until(
        () => diagnostics(app),
        (value) =>
          matchingRead(
            value.records?.filter((record) => record.objectProof),
            native,
          ),
        5000,
        'Actual bound-object native read proof unavailable',
      );
      const record = matchingRead(
        captured.records.filter((record) => record.objectProof),
        native,
      );
      assert(
        BigInt(record.objectProof.fromQpc) < BigInt(record.qpc) &&
          BigInt(record.qpc) <= BigInt(record.objectProof.toQpc),
      );
      const consumed = await until(
        () => evidence(app),
        (value) =>
          value.observations?.some(
            (event) =>
              event.instanceId === r.actor.instanceId &&
              event.observationKind === 'bound-object-read' &&
              event.object?.bindingId === record.objectProof.bindingId,
          ),
        10000,
        'Native workload proof did not reach an operational object event',
      );
      const operational = consumed.observations.find(
        (event) =>
          event.instanceId === r.actor.instanceId &&
          event.object?.bindingId === record.objectProof.bindingId,
      );
      r.reads.push({ mode, native, record, event: operational });
    }
    const accepted = await until(
      () => evidence(app),
      (value) =>
        value.observations?.some(
          (event) =>
            event.instanceId === r.actor.instanceId &&
            event.observationKind === 'bound-object-read' &&
            event.sensitive === true,
        ),
      10000,
      'Actual operational object event was not accepted',
    );
    const event = accepted.observations.find(
      (event) =>
        event.instanceId === r.actor.instanceId &&
        event.observationKind === 'bound-object-read' &&
        event.sensitive === true,
    );
    assert(
      event.eventId &&
        !Object.hasOwn(event, 'file') &&
        event.object?.objectKey &&
        event.object.policy.sensitive === true,
    );
    assert(accepted.alerts.success === true && accepted.alerts.status === 'ready');
    const alert = accepted.alerts.items.find((alert) => alert.eventId === event.eventId);
    const baseline = accepted.baselines.find((row) => row.instanceId === event.instanceId);
    assert(
      alert &&
        baseline &&
        baseline.generationCurrent === true &&
        baseline.sensitiveObjectReads > 0 &&
        baseline.objectBindings > 0,
      'Actual journal or object baseline did not receive the event',
    );
    r.event = event;
    r.alert = alert;
    r.baseline = baseline;
    r.admission = accepted.admission;
    r.afterRisk = await until(
      () => displayedRisk(page, app, r.actor),
      (risk) => risk.score > r.beforeRisk.score,
      10000,
      'Displayed risk did not increase',
    );
    const delivered = await page.evaluate(() => window.__nativeReadProbe);
    assert(
      !delivered.overflow && delivered.object.some((row) => row.eventId === event.eventId),
      'Actual preload delivery missing',
    );
    r.legacyReadDeliveries = delivered.legacy.length;
    const retainedCounts = accepted.eventCountsByInstance.find(
      (row) => row.instanceId === event.instanceId,
    );
    assert(
      retainedCounts && retainedCounts.pathObservations === 0,
      'Competing retained path events prevent isolated object-risk qualification',
    );
    r.retainedPathObservationCount = retainedCounts.pathObservations;
    assert.equal(
      r.legacyReadDeliveries,
      0,
      'Competing legacy file observations prevent isolated object-risk qualification',
    );
    r.noCompetingLegacyFileObservation = true;
    assert(
      !JSON.stringify({ accepted, delivered }).includes(canary),
      'Synthetic contents entered operational metadata',
    );
    assert(
      !/"(?:volumeSerial|fileId128|fileObject)"/.test(JSON.stringify({ event, alert, delivered })),
      'Raw filesystem identity entered public metadata',
    );
    r.contentExcluded = true;
    r.publicIdentityRedacted = true;
    await page.screenshot({ path: path.join(out, 'view.png'), fullPage: false });
    r.actualPreloadDelivery = true;
    r.objectAlertObserved = true;
    r.displayedRiskIncreased = true;
    await fixture.close();
    r.fixtureExit = fixture.child.exitCode;
    assert.equal(r.fixtureExit, 0);
    assert.equal(
      (await diagnostics(app)).phase,
      'running',
      'Capture must continue during release observation',
    );
    r.retention = await probeRetainedObjectRelease(file, out, hostEnv);
    r.retention.sourceShareDelete = witness.shareDelete;
    r.retention.captureContinued = (await diagnostics(app)).phase === 'running';
    assert(r.retention.captureContinued, 'Capture ended during release observation');
  } catch (error) {
    const fixtureFailure = projectReadFixtureFailure(error);
    if (fixtureFailure && !r.fixtureFailure) r.fixtureFailure = fixtureFailure;
    failure =
      r.launch?.phase === 'failed'
        ? new Error(
            r.launch.failureCode === 'timeout'
              ? 'Native-read Electron launch timed out'
              : 'Native-read Electron launch failed',
          )
        : error;
  } finally {
    if (fixture && fixture.child.exitCode === null) {
      try {
        await fixture.close();
        r.fixtureExit = fixture.child.exitCode;
      } catch (error) {
        const fixtureFailure = projectReadFixtureFailure(error);
        if (fixtureFailure && !r.fixtureFailure) r.fixtureFailure = fixtureFailure;
        r.fixtureCleanupUnconfirmed = true;
        failure ??= error;
      }
    }
    if (r.fixtureFailure) {
      const diagnostic = projectReadFixtureCommandDiagnostic(fixture?.commandDiagnostic?.());
      if (diagnostic) r.fixtureCommandDiagnostic = diagnostic;
    }
    if (app) {
      try {
        await app.close();
        r.appExit = await exitWithin(appProcess, 15000);
      } catch (error) {
        r.appCleanupUnconfirmed = true;
        failure ??= error;
      }
    }
  }
  if (observer) {
    try {
      if (failure) {
        observer.stop();
        await exitWithin(observer.child, 10000);
      } else {
        const terminal = await observer.until((message) => message.type === 'terminal', 45000);
        assert.deepEqual(terminal.originalExits, [0, 0, 0, 0, 0]);
        assert.equal(terminal.custodianExit, 0);
        r.peerClosure = {
          originalExits: terminal.originalExits,
          custodianExit: terminal.custodianExit,
        };
        await observer.settled();
        r.observerExit = observer.child.exitCode;
      }
    } catch (error) {
      observer.stop();
      r.observerCleanupUnconfirmed = true;
      failure ??= error;
    }
  }
  if (failure) throw failure;
  assert.equal(r.fixtureExit, 0);
  assert.equal(r.appExit, 0);
  const terminal = JSON.parse(fs.readFileSync(path.join(out, 'shutdown.json'), 'utf8'));
  assert(terminal.summaries?.at(-1)?.stopVerified === true, 'Native capture stop unconfirmed');
  r.stopVerified = true;
  const audit = inspectProfile(
    path.join(out, 'profile'),
    path.dirname(file),
    r.witness.pid,
    canary,
  );
  const matchingAudit = matchingNativeAuditRows(audit, r.event);
  r.auditCustody = { ownedRows: audit.length, matchingRows: matchingAudit.length };
  assert.equal(matchingAudit.length, 1, 'Persisted audit custody missing or ambiguous');
  r.persistedAuditObserved = true;
  return { actualObjectEventId: r.event.eventId };
}
