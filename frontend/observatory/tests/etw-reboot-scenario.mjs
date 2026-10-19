import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { durableLaunch, durableExit, durableClosure } from './etw-durable-support.mjs';
import { inspectSession, compileReadFixture } from './etw-failure-support.mjs';
import { inspectProfile } from './sensor-support.mjs';
import { runScenario } from './etw-scenario.mjs';
import { rebootRecoveryObserved } from '../../../tools/development/etw-reboot-contract.mjs';
import { waitRebootIssuer } from '../../../tools/development/etw-reboot-support.mjs';
import { diagnostics } from './etw-support.mjs';

function privacy(launch, canary) {
  const rows = inspectProfile(launch.p.profile, launch.p.home, launch.observed.mainPid, canary);
  assert(
    rows.every(
      (row) =>
        !row.type?.startsWith('etw-') &&
        !(row.type === 'file-access' && row.path?.startsWith(launch.p.fixture + path.sep)),
    ),
  );
  let total = 0;
  function visit(folder) {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      assert(!entry.isSymbolicLink(), 'Unexpected profile link');
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(file);
      else {
        const size = fs.statSync(file).size;
        assert(size <= 16 * 1024 ** 2, 'Profile file budget exceeded');
        total += size;
        assert(total <= 64 * 1024 ** 2, 'Profile total budget exceeded');
      }
    }
  }
  visit(launch.p.profile);
  return { contentExcluded: true, noDiagnosticAudit: true, profileBytes: total };
}

async function prepare(executable, out, canary, r) {
  const helper = path.join(path.dirname(executable), 'resources/etw-file/EtwFile.exe');
  r.before = await inspectSession(helper, out, 'before', process.env);
  assert.equal(r.before.status, 4201);
  const launch = await durableLaunch({
    executable,
    out: path.join(out, 'lost'),
    canary,
    fault: 'orphan-total-running',
    total: true,
  });
  try {
    Object.assign(r, launch.observed);
    r.reserved = launch.reserved;
    r.originalObjectsObserved = launch.reserved.originalObjectsObserved;
    await launch.observer.until((m) => m.type === 'phase' && m.kind === 'running', 15000);
    const denied = JSON.parse(
      execFileSync(helper, ['inspect-journal'], {
        env: launch.env,
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 2048,
        encoding: 'utf8',
      }),
    );
    assert.equal(denied.writeDenied, true);
    r.journalWriteAccessDenied = true;
    r.appExitCode = await durableExit(launch);
    r.peerExit = await launch.observer.until((m) => m.type === 'peer-exit', 45000);
    assert.equal(r.peerExit.custodianExit, 76);
    await durableClosure(launch);
    r.allSixExited = true;
    r.beforeReboot = await inspectSession(helper, out, 'before-reboot', launch.env);
    assert.equal(r.beforeReboot.status, 0);
    Object.assign(r, privacy(launch, canary));
    // No reboot, service, task or autostart is installed or invoked here.
    r.status = 'PREPARED';
  } catch (error) {
    r.observerEvents = launch.observer.events();
    if (launch.child.exitCode === null) await durableExit(launch).catch(() => {});
    throw error;
  } finally {
    launch.observer.stop();
  }
}

async function resume(executable, out, canary, r, cancel) {
  const helper = path.join(path.dirname(executable), 'resources/etw-file/EtwFile.exe');
  const recovery = { observationGap: true, finalTotals: null };
  r.recovery = recovery;
  recovery.beforeNewMain = await inspectSession(helper, out, 'before-new-main', process.env);
  assert.equal(recovery.beforeNewMain.status, cancel ? 0 : 4201);
  assert.equal(recovery.beforeNewMain.present, cancel);
  const launch = await durableLaunch({
    executable,
    out: path.join(out, 'recovery'),
    canary,
    fault: 'orphan-before-start',
  });
  try {
    Object.assign(recovery, {
      journalDigest: launch.reserved.journalDigest,
      previousJournalDigest: launch.reserved.previousJournalDigest,
      previousSameScope: launch.reserved.previousSameScope,
    });
    await launch.observer.until((m) => m.type === 'phase' && m.kind === 'journal-recovered', 15000);
    recovery.journalRecovered = true;
    await launch.observer.until((m) => m.type === 'phase' && m.kind === 'before-start', 15000);
    recovery.beforeNewTrace = await inspectSession(helper, out, 'before-new-trace', launch.env);
    assert.equal(recovery.beforeNewTrace.status, 4201);
    await durableExit(launch);
    recovery.terminal = await launch.observer.until((m) => m.type === 'terminal', 45000);
    assert([0, 4].includes(recovery.terminal.custodianExit));
    await durableClosure(launch);
    recovery.closureConfirmed = true;
    recovery.afterRecovery = await inspectSession(helper, out, 'after-recovery', launch.env);
    Object.assign(recovery, privacy(launch, canary));
    assert(
      rebootRecoveryObserved(recovery, cancel ? 'cancel' : 'resume'),
      'Incomplete journal recovery evidence',
    );
  } catch (error) {
    r.observerEvents = launch.observer.events();
    if (launch.child.exitCode === null) await durableExit(launch).catch(() => {});
    throw error;
  } finally {
    launch.observer.stop();
  }
  if (!cancel) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const fixtureExe = compileReadFixture(root, out, process.env);
    r.normal = await runScenario({
      executable,
      fixtureExe,
      out: path.join(out, 'normal'),
      fault: false,
      beforeRead: (app, witness) => waitRebootIssuer(() => diagnostics(app), witness),
    });
    assert.equal(r.normal.status, 'PASS');
  }
  r.status = cancel ? 'CANCELLED' : 'PASS';
}

const { values } = parseArgs({
  options: {
    executable: { type: 'string' },
    output: { type: 'string' },
    phase: { type: 'string' },
  },
});
assert(['prepare', 'resume', 'cancel'].includes(values.phase));
assert(path.isAbsolute(values.executable ?? '') && path.isAbsolute(values.output ?? ''));
const out = path.resolve(values.output);
fs.mkdirSync(out);
const r = {
  status: 'FAIL',
  phase: values.phase,
  productionAdmission: false,
  startedAt: new Date().toISOString(),
};
const canary = 'AEGIS_ETW_REBOOT_' + crypto.randomUUID();
try {
  if (values.phase === 'prepare') await prepare(values.executable, out, canary, r);
  else await resume(values.executable, out, canary, r, values.phase === 'cancel');
} catch (error) {
  r.status = 'FAIL';
  r.failure = error.message;
  process.exitCode = 1;
} finally {
  r.completedAt = new Date().toISOString();
  const bytes = JSON.stringify(r, null, 2) + '\n';
  assert(Buffer.byteLength(bytes) <= 262144);
  fs.writeFileSync(path.join(out, 'receipt.json'), bytes, { flag: 'wx' });
  console.log(JSON.stringify({ status: r.status, phase: values.phase, failure: r.failure }));
}
