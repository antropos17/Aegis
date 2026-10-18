import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import { scenarioPaths, diagnostics, delay } from './etw-support.mjs';
import { inspectSession, waitOwnedExit } from './etw-failure-support.mjs';
import { inspectProfile, ownedPids, exitWithin } from './sensor-support.mjs';
import { durableLaunch, durableExit, durableClosure } from './etw-durable-support.mjs';
import { etwDurableCasePassed } from '../../../tools/development/etw-durable-contract.mjs';

async function liveOwnerBlock(executable, out, canary, first) {
  const p = scenarioPaths(out, canary);
  const env = { ...first.env, USERPROFILE: p.home, HOME: p.home, TEMP: p.temp, TMP: p.temp };
  const app = await electron.launch({
    executablePath: executable,
    env,
    timeout: 30000,
    args: ['--user-data-dir=' + p.profile, '--etw-file-diagnostic-root=' + p.fixture],
  });
  const child = app.process();
  let own = [];
  try {
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.setIgnoreMouseEvents(true);
      w.setFocusable(false);
      w.blur();
    });
    own = await ownedPids(app, child.pid, env);
    const end = Date.now() + 25000;
    let data;
    do {
      data = await diagnostics(app);
      if (data.summaries.length) break;
      await delay(100);
    } while (Date.now() < end);
    assert(
      data.summaries.length && data.phase !== 'running',
      'An active original owner must block new capture',
    );
    assert.equal((await diagnostics(first.app)).phase, 'running');
    assert.equal((await inspectSession(first.helper, out, 'live-owner', env)).status, 0);
    assert(!first.observer.events().some((m) => m.type === 'terminal'));
    return {
      p,
      env,
      mainPid: await app.evaluate(() => process.pid),
      blocked: true,
      unaffected: true,
    };
  } finally {
    await app.evaluate(() => process.exit(73)).catch(() => {});
    await exitWithin(child);
    if (own.length) await waitOwnedExit(own, env);
  }
}

/** Lose all six original processes; recover only from protected durable state.
 * @param {object} options Executable/output/mode. @returns {Promise<object>} @since v0.19.2
 */
export async function runDurableFailure({ executable, out, mode }) {
  fs.mkdirSync(out);
  const canary = 'AEGIS_ETW_DURABLE_' + crypto.randomUUID();
  const helper = path.join(path.dirname(executable), 'resources/etw-file/EtwFile.exe');
  const r = {
    status: 'FAIL',
    mode,
    productionAdmission: false,
    startedAt: new Date().toISOString(),
    observationGap: true,
    finalTotals: null,
  };
  let first, next, blocked;
  try {
    r.before = await inspectSession(helper, out, 'before', process.env);
    assert.equal(r.before.status, 4201);
    first = await durableLaunch({
      executable,
      out: path.join(out, 'lost'),
      canary,
      fault: mode,
      total: true,
    });
    Object.assign(r, first.observed);
    r.reserved = first.reserved;
    r.originalObjectsObserved = first.reserved.originalObjectsObserved;
    const phase = mode.endsWith('before-start')
      ? 'before-start'
      : mode.endsWith('before-arm')
        ? 'before-arm'
        : 'running';
    await first.observer.until((m) => m.type === 'phase' && m.kind === phase, 15000);
    const denied = JSON.parse(
      execFileSync(helper, ['inspect-journal'], {
        env: first.env,
        windowsHide: true,
        timeout: 10000,
        encoding: 'utf8',
      }),
    );
    assert.equal(denied.writeDenied, true);
    r.journalWriteAccessDenied = true;
    if (mode === 'orphan-total-running') {
      blocked = await liveOwnerBlock(executable, path.join(out, 'blocked'), canary, first);
      r.liveOwnerBlocked = blocked.blocked;
      r.liveOwnerUnaffected = blocked.unaffected;
    }
    await first.page.screenshot({ path: path.join(out, 'before-loss.png') });
    r.appExitCode = await durableExit(first);
    r.peerExit = await first.observer.until((m) => m.type === 'peer-exit', 45000);
    assert.equal(r.peerExit.custodianExit, 76);
    await durableClosure(first);
    r.allSixExited = true;
    r.beforeRecovery = await inspectSession(helper, out, 'before-recovery', first.env);
    assert.equal(r.beforeRecovery.status, mode.endsWith('before-start') ? 4201 : 0);
    // A new packaged main/collector is the recovery authority. The normal test
    // witness has already exited and had no ETW control capability.
    next = await durableLaunch({
      executable,
      out: path.join(out, 'recovered'),
      canary,
      fault: mode === 'orphan-total-denial' ? 'orphan-recovery-denial' : 'orphan-before-start',
    });
    await next.observer.until((m) => m.type === 'phase' && m.kind === 'journal-recovered', 15000);
    await next.observer.until((m) => m.type === 'phase' && m.kind === 'before-start', 15000);
    const presence = await inspectSession(helper, out, 'after-recovery-before-start', next.env);
    assert.equal(presence.status, 4201);
    r.recovery = {
      mainPid: next.observed.mainPid,
      journalRecovered: true,
      presence,
      restrictedProbeStatus: next.observer
        .events()
        .some((m) => m.type === 'phase' && m.kind === 'journal-denied')
        ? 5
        : null,
    };
    r.recoveryMainWasFresh = next.observed.mainPid !== r.mainPid;
    r.recoveryBeforeNewTrace = true;
    await durableExit(next);
    r.recovery.terminal = await next.observer.until((m) => m.type === 'terminal', 45000);
    assert.equal(r.recovery.terminal.custodianExit, 4);
    await durableClosure(next);
    r.closureConfirmed = true;
    r.after = await inspectSession(helper, out, 'after', next.env);
    assert.equal(r.after.status, 4201);
    for (const launch of [first, next, blocked].filter(Boolean)) {
      const audit = inspectProfile(
        launch.p.profile,
        launch.p.home,
        launch.observed?.mainPid ?? launch.mainPid,
        canary,
      );
      assert(
        audit.every(
          (row) =>
            !row.type?.startsWith('etw-') &&
            !(row.type === 'file-access' && row.path?.startsWith(launch.p.fixture + path.sep)),
        ),
      );
    }
    r.contentExcluded = true;
    r.noDiagnosticAudit = true;
    r.status = 'PASS';
    assert(etwDurableCasePassed(r), 'Incomplete durable receipt');
  } catch (error) {
    r.status = 'FAIL';
    r.failure = error.message;
    if (first) r.observerEvents = first.observer.events();
    if (next) r.recoveryObserverEvents = next.observer.events();
    for (const launch of [first, next].filter(Boolean)) {
      try {
        if (launch.child.exitCode === null) await durableExit(launch);
      } catch (cleanup) {
        r.exitCleanupFailure ??= cleanup.message;
      }
    }
    try {
      r.failureAfter = await inspectSession(
        helper,
        out,
        'failure-after',
        first?.env ?? process.env,
      );
    } catch (cleanup) {
      r.cleanupQueryFailure = cleanup.message;
    }
  } finally {
    first?.observer.stop();
    next?.observer.stop();
    r.completedAt = new Date().toISOString();
    const bytes = JSON.stringify(r, null, 2);
    assert(Buffer.byteLength(bytes) <= 65536);
    fs.writeFileSync(path.join(out, 'receipt.json'), bytes + '\n', { flag: 'wx' });
  }
  console.log(JSON.stringify({ status: r.status, mode, failure: r.failure }));
  return r;
}
