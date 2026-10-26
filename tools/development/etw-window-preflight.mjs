import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { rebootBinding } from './etw-reboot-support.mjs';
import {
  observePackageWindow,
  projectWindowObservation,
} from '../../frontend/observatory/tests/package-window-observation.mjs';

export const MAX_PREFLIGHT_RECEIPT_BYTES = 16384;
const WINDOW_CODES = new Map([
  ['observationValid', 'window-observation-invalid'],
  ['packaged', 'window-not-packaged'],
  ['diagnosticBuild', 'window-not-diagnostic'],
  ['windowPresent', 'window-missing'],
  ['sameWindow', 'window-replaced'],
  ['windowStateObserved', 'window-state-unobserved'],
  ['visible', 'window-not-visible'],
  ['isolationRequested', 'window-isolation-not-requested'],
  ['windowInputIsolated', 'window-isolation-unconfirmed'],
  ['settled', 'window-settling-unconfirmed'],
  ['timedOut', 'window-settling-timeout'],
  ['focusable', 'window-isolation-unconfirmed'],
  ['focused', 'window-isolation-unconfirmed'],
]);

function bounded(promise, milliseconds) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('bounded-operation-timeout')), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function originalExit(child, milliseconds) {
  if (child.exitCode !== null) return child.exitCode;
  return (await bounded(once(child, 'exit'), milliseconds))[0];
}

/** Launch only the marked candidate's ordinary window in a fresh owned profile.
 * Dependency seams are for unit tests; the CLI supplies real Playwright, never flags.
 * @param {object} options Candidate executable, fresh output, actual launch and env.
 * @returns {Promise<object>} Closed actual observations and ordinary-close result.
 * @since v0.20.1
 */
export async function runWindowPreflightSession({
  executable,
  output,
  launch,
  baseEnv = process.env,
}) {
  const directory = (parent, name) => {
    const location = path.join(parent, name);
    assert(path.dirname(location) === parent);
    fs.mkdirSync(location); // Refuse existing paths; never reuse a private profile.
    return location;
  };
  const home = directory(output, 'home');
  // Windows known-folder lookup uses this tree even with APPDATA redirected.
  // Sibling AppData folders leave app.getPath('appData') unavailable at startup.
  const appData = directory(home, 'AppData');
  const privatePaths = {
    profile: directory(output, 'profile'),
    home,
    appData: directory(appData, 'Roaming'),
    localAppData: directory(appData, 'Local'),
    temp: directory(output, 'temp'),
  };
  const env = {
    ...baseEnv,
    USERPROFILE: privatePaths.home,
    HOME: privatePaths.home,
    APPDATA: privatePaths.appData,
    LOCALAPPDATA: privatePaths.localAppData,
    TEMP: privatePaths.temp,
    TMP: privatePaths.temp,
  };
  for (const key of Object.keys(env))
    if (/TOKEN|PASSWORD|SECRET|CREDENTIAL|KEY|ELECTRON_RUN_AS_NODE|NODE_OPTIONS/i.test(key))
      delete env[key];
  const receipt = {
    window: null,
    normalCloseRequested: false,
    normalCloseObserved: false,
    exitCode: null,
    forcedCleanupRequested: false,
    forcedCleanupObserved: false,
    monitoringHeadingObserved: false,
    outputWithinBudget: true,
    noEtwArguments: true,
    failureCode: null,
    closeFailureCode: null,
  };
  let application, child;
  let stage = 'launch';
  let outputBytes = 0;
  const collect = (bytes) => {
    outputBytes += bytes.length;
    if (outputBytes > 1024 * 1024) receipt.outputWithinBudget = false;
  };
  try {
    application = await launch({
      executablePath: executable,
      env,
      timeout: 30000,
      args: ['--user-data-dir=' + privatePaths.profile],
    });
    child = application.process();
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    stage = 'observation';
    const observed = await observePackageWindow(
      application,
      path.join(output, 'window-observation.json'),
    );
    receipt.window = projectWindowObservation(observed);
    stage = 'heading';
    const page = await bounded(application.firstWindow(), 15000);
    await bounded(
      page
        .getByRole('heading', { name: 'Monitoring', level: 1, exact: true })
        .waitFor({ timeout: 15000 }),
      16000,
    );
    receipt.monitoringHeadingObserved = true;
    if (!receipt.outputWithinBudget) receipt.failureCode = 'output-budget-exceeded';
  } catch (error) {
    const file = path.join(output, 'window-observation.json');
    if (fs.existsSync(file) && fs.statSync(file).size <= 4096)
      receipt.window = JSON.parse(fs.readFileSync(file, 'utf8'));
    const field =
      error instanceof Error && error.message.startsWith('Package window guard failed: ')
        ? error.message.split(/\r?\n/, 1)[0].slice('Package window guard failed: '.length)
        : null;
    receipt.failureCode =
      WINDOW_CODES.get(field) ??
      (stage === 'heading'
        ? 'monitoring-heading-unobserved'
        : application
          ? 'observation-failed'
          : 'launch-failed');
  } finally {
    if (application) {
      receipt.normalCloseRequested = true;
      try {
        await bounded(application.close(), 15000);
        receipt.exitCode = await originalExit(child, 10000);
        receipt.normalCloseObserved = receipt.exitCode === 0 && child.signalCode == null;
        if (!receipt.normalCloseObserved) receipt.closeFailureCode = 'normal-close-failed';
      } catch {
        receipt.closeFailureCode = 'normal-close-failed';
        if (child && child.exitCode === null) {
          receipt.forcedCleanupRequested = true;
          try {
            child.kill(); // Original retained child handle only; never a discovered PID.
            await originalExit(child, 5000);
            receipt.forcedCleanupObserved = true;
          } catch {
            receipt.forcedCleanupObserved = false;
          }
        }
      }
      child?.stdout?.removeListener('data', collect);
      child?.stderr?.removeListener('data', collect);
    }
  }
  receipt.failureCode ??= receipt.closeFailureCode;
  if (!receipt.outputWithinBudget) receipt.failureCode ??= 'output-budget-exceeded';
  return receipt;
}

/** Run the actual host-only package check before downloading an ISO or creating a VM.
 * @param {string[]} argv CLI arguments.
 * @returns {Promise<void>} Emits one bounded private receipt; no ETW capture args.
 * @since v0.20.1
 */
async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'source-sha': { type: 'string' },
      candidate: { type: 'string' },
      output: { type: 'string' },
      'build-receipt': { type: 'string' },
      config: { type: 'string' },
    },
  });
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  assert(
    process.platform === 'win32' &&
      process.arch === 'x64' &&
      process.env.GITHUB_ACTIONS === 'true' &&
      process.env.CI === 'true' &&
      process.env.GITHUB_SHA === values['source-sha'] &&
      process.env.GITHUB_WORKSPACE &&
      fs.realpathSync(process.env.GITHUB_WORKSPACE) === fs.realpathSync(root),
    'Disposable Windows Actions checkout required',
  );
  for (const key of ['candidate', 'output', 'build-receipt', 'config'])
    assert(path.isAbsolute(values[key] ?? ''));
  const output = path.resolve(values.output);
  for (const parent of [root, path.resolve(values.candidate)]) {
    const relative = path.relative(parent, output);
    assert(
      relative && (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)),
      'Fresh output must be outside source and candidate',
    );
  }
  fs.mkdirSync(output);
  const receipt = {
    schema: 'aegis-package-window-preflight/1',
    status: 'FAIL',
    sourceHead: values['source-sha'],
    startedAt: new Date().toISOString(),
    bindingObserved: false,
    bindingUnchanged: false,
    window: null,
    normalCloseRequested: false,
    normalCloseObserved: false,
    exitCode: null,
    failureCode: null,
    closeFailureCode: null,
  };
  try {
    const binding = () =>
      rebootBinding(
        root,
        values.candidate,
        values['source-sha'],
        values['build-receipt'],
        values.config,
      );
    const initial = binding();
    receipt.bindingObserved = true;
    receipt.sourceTree = initial.sourceTree;
    receipt.packageManifestSha256 = initial.packageManifestSha256;
    const { _electron } = await import('playwright');
    Object.assign(
      receipt,
      await runWindowPreflightSession({
        output,
        executable: path.join(values.candidate, 'AEGIS - AI Monitoring & Threat Detection.exe'),
        launch: (options) => _electron.launch(options),
      }),
    );
    receipt.bindingUnchanged = JSON.stringify(binding()) === JSON.stringify(initial);
    if (!receipt.bindingUnchanged) receipt.failureCode ??= 'binding-changed';
    if (
      !receipt.failureCode &&
      receipt.normalCloseObserved &&
      receipt.monitoringHeadingObserved &&
      receipt.window?.settled &&
      receipt.bindingUnchanged
    )
      receipt.status = 'PASS';
  } catch {
    receipt.failureCode ??= receipt.bindingObserved ? 'preflight-failed' : 'binding-refused';
  }
  receipt.completedAt = new Date().toISOString();
  const bytes = JSON.stringify(receipt, null, 2) + '\n';
  assert(
    Buffer.byteLength(bytes) <= MAX_PREFLIGHT_RECEIPT_BYTES,
    'Preflight receipt budget exceeded',
  );
  fs.writeFileSync(path.join(output, 'receipt.json'), bytes, { flag: 'wx', mode: 0o600 });
  console.log(
    JSON.stringify({
      status: receipt.status,
      failureCode: receipt.failureCode,
      normalCloseObserved: receipt.normalCloseObserved,
    }),
  );
  process.exitCode = receipt.status === 'PASS' ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch(() => {
    process.exitCode = 1;
  });
