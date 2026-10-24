import assert from 'node:assert/strict';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import { scenarioPaths, diagnostics, traceHelpers } from './etw-support.mjs';
import { ownedPids, exitWithin } from './sensor-support.mjs';
import { observeCustodian } from './etw-custodian-support.mjs';
import { waitOwnedExit } from './etw-failure-support.mjs';
import { observePackageWindow } from './package-window-observation.mjs';
import { retainStartupFailure, waitForJournalReservation } from './etw-startup-evidence.mjs';

/** Launch an owned, marked package with a normal read-only witness.
 * @param {object} options Executable/output/canary/fault/total.
 * @returns {Promise<object>} Owned process resources. @since v0.19.2
 */
export async function durableLaunch({ executable, out, canary, fault, total = false }) {
  const p = scenarioPaths(out, canary);
  const env = { ...process.env, USERPROFILE: p.home, HOME: p.home, TEMP: p.temp, TMP: p.temp };
  delete env.ELECTRON_RUN_AS_NODE;
  const helper = path.join(path.dirname(executable), 'resources/etw-file/EtwFile.exe');
  const observer = observeCustodian(helper, out, env, total);
  let app;
  let lastObserved = null,
    stage = 'observer-endpoint';
  try {
    const endpoint = await observer.until((m) => m.type === 'endpoint', 10000);
    stage = 'app-launch';
    app = await electron.launch({
      executablePath: executable,
      env,
      timeout: 30000,
      args: [
        '--user-data-dir=' + p.profile,
        '--etw-file-diagnostic-root=' + p.fixture,
        '--etw-file-diagnostic-fault=' + fault,
        '--etw-file-diagnostic-observer=' + endpoint.address,
      ],
    });
    const child = app.process();
    stage = 'window';
    const observed = await observePackageWindow(app, path.join(out, 'window-observation.json'));
    const page = await app.firstWindow();
    stage = 'monitoring-heading';
    await page.getByRole('heading', { name: 'Monitoring', level: 1, exact: true }).waitFor();
    stage = 'journal-reservation';
    const reserved = await waitForJournalReservation({
      observer,
      readDiagnostics: () => diagnostics(app),
      onSnapshot: (data) => {
        lastObserved = data;
      },
    });
    stage = 'process-inventory';
    const own = await ownedPids(app, child.pid, env);
    const helpers = traceHelpers(own, env, (await diagnostics(app)).nativeProcessIds);
    return { app, child, page, p, env, helper, observer, reserved, own, helpers, observed };
  } catch (error) {
    try {
      await retainStartupFailure({
        out,
        stage,
        lastObserved,
        observer,
        readDiagnostics: () => (app ? diagnostics(app) : null),
        closeMain: async () => {
          if (app) await app.evaluate(() => process.exit(73)).catch(() => {});
        },
      });
    } catch {
      /* The owned main/observer are closed by the retention helper even if evidence I/O fails. */
    }
    throw error;
  }
}

/** Exit only the owned normal main; native diagnostic modes exit themselves.
 * @param {object} launch Owned resources. @returns {Promise<number>} Exit code. @since v0.19.2
 */
export async function durableExit(launch) {
  await launch.app.evaluate(() => process.exit(73)).catch(() => {});
  const code = await exitWithin(launch.child);
  assert.equal(code, 73);
  return code;
}

/** Confirm disappearance; interventions never target observed PIDs.
 * @param {object} launch Owned resources. @returns {Promise<void>} @since v0.19.2
 */
export async function durableClosure(launch) {
  await waitOwnedExit(
    [
      ...new Set([
        ...launch.own,
        ...launch.helpers,
        ...launch.reserved.originalPids,
        launch.reserved.custodianPid,
      ]),
    ],
    launch.env,
  );
  await launch.observer.settled();
}
