import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { delay } from '../../frontend/observatory/tests/etw-support.mjs';
import { boundedCommand } from '../../tools/development/bounded-command.mjs';
import { observePackageWindow } from '../../frontend/observatory/tests/package-window-observation.mjs';
import { projectReadFixtureFailure } from '../../frontend/observatory/tests/etw-read-fixture-protocol.mjs';

/** Create the native phase's fresh Windows home and private AppData tree.
 * @param {string} output Owned phase directory; newRebootOutput already created temp.
 * @param {object} baseEnv Inherited environment copied without credentials.
 * @returns {object} Environment for the owned fixture and application.
 * @since v0.20.1
 */
export function nativeReadEnvironment(output, baseEnv = process.env) {
  const home = path.join(output, 'home');
  const appData = path.join(home, 'AppData');
  for (const directory of [
    home,
    appData,
    path.join(appData, 'Roaming'),
    path.join(appData, 'Local'),
  ])
    fs.mkdirSync(directory);
  const env = {
    ...baseEnv,
    USERPROFILE: home,
    HOME: home,
    APPDATA: path.join(appData, 'Roaming'),
    LOCALAPPDATA: path.join(appData, 'Local'),
    TEMP: path.join(output, 'temp'),
    TMP: path.join(output, 'temp'),
  };
  for (const key of Object.keys(env))
    if (/TOKEN|PASSWORD|SECRET|CREDENTIAL|KEY|ELECTRON_RUN_AS_NODE|NODE_OPTIONS/i.test(key))
      delete env[key];
  return env;
}

/** Wait for actual bounded evidence. @param {Function} read @param {Function} accept @param {number} ms @param {string} message @returns {Promise<object>} @since v0.20.1 */
export const until = async (read, accept, ms, message) => {
  const deadline = Date.now() + ms;
  do {
    const value = await read();
    if (accept(value)) return value;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(message);
};
/** Read the marked main projection without adding IPC. @param {object} app @returns {Promise<object>} @since v0.20.1 */
export const evidence = (app) =>
  app.evaluate(async ({ app }) => {
    await new Promise((resolve) => setImmediate(resolve));
    const require = process.mainModule
      .require('node:module')
      .createRequire(app.getAppPath() + '/package.json');
    const fn = require('./src/main/main.js').getNativeFileAdmissionEvidence;
    if (typeof fn !== 'function') throw new Error('Diagnostic admission projection unavailable');
    return fn();
  });
/** Read visible process risk bracketed by exact current OS identity observations.
 * @param {object} page Actual renderer. @param {object} app Actual marked application.
 * @param {object} actor Independently witnessed fixture actor.
 * @returns {Promise<object>} Visible score with exact actor and process-selection witnesses.
 * @since v0.20.1
 */
export async function displayedRisk(page, app, actor) {
  assert(
    typeof app?.evaluate === 'function' &&
      actor?.agent === 'Aider' &&
      Number.isSafeInteger(actor.pid) &&
      actor.pid > 0 &&
      typeof actor.instanceId === 'string' &&
      actor.instanceId.length > 0 &&
      actor.instanceIdSource === 'os' &&
      typeof actor.createTime100ns === 'string' &&
      /^[1-9]\d{0,19}$/.test(actor.createTime100ns),
    'Displayed risk actor witness unavailable',
  );
  const readActor = async () => {
    const value = await evidence(app);
    const agents = value?.agents;
    const peers = Array.isArray(agents) ? agents.filter((row) => row.agent === 'Aider') : [];
    const current = peers[0];
    assert(
      value?.readiness?.populationReliable === true &&
        value.readiness.identityDegraded === false &&
        value.readiness.monitoringPaused === false &&
        Array.isArray(agents) &&
        agents.length < 128 &&
        peers.length === 1 &&
        current.pid === actor.pid &&
        current.instanceId === actor.instanceId &&
        current.createTime100ns === actor.createTime100ns &&
        current.instanceIdSource === 'os',
      'Displayed risk actor changed or is ambiguous',
    );
    return {
      pid: current.pid,
      instanceId: current.instanceId,
      createTime100ns: current.createTime100ns,
    };
  };
  const actorBefore = await readActor();
  const row = page.locator('.investigation-roster .roster-choice[aria-label="Aider"]');
  await row.waitFor({ timeout: 30000 });
  const meta = await row.locator('.roster-meta').innerText();
  assert(
    meta.trim() === '1 worker process · Observed now',
    'Displayed actor is stale or ambiguous',
  );
  await row.click({ timeout: 10000 });
  const header = page.getByRole('region', { name: 'Agent investigation', exact: true });
  const worker = header.getByRole('combobox', { name: 'Worker process', exact: true });
  await worker.selectOption(actor.instanceId, { timeout: 10000 });
  const displayedInstanceId = await worker.inputValue();
  assert.equal(displayedInstanceId, actor.instanceId, 'Displayed risk actor selection changed');
  const state = await header.locator('.observed-state').innerText();
  const scope = await header.locator('.risk-scope').innerText();
  assert(state.trim() === 'Observed now', 'Displayed actor is stale');
  const scopedPid = /^This process\s*·\s*PID\s+(\d+)$/.exec(scope.trim());
  assert(scopedPid && Number(scopedPid[1]) === actor.pid, 'Displayed risk actor scope changed');
  const text = await header.locator('.risk-line strong').innerText();
  const match = /^(\d+)\s*\/100$/.exec(text.trim());
  assert(match && Number(match[1]) <= 100, 'Actual displayed risk unavailable');
  const actorAfter = await readActor();
  assert.equal(
    await worker.inputValue(),
    displayedInstanceId,
    'Displayed risk actor selection changed',
  );
  return {
    score: Number(match[1]),
    text,
    meta,
    workerCount: 1,
    displayedInstanceId,
    displayedPid: Number(scopedPid[1]),
    observedNow: true,
    actorBefore,
    actorAfter,
  };
}
/** Prepare the actual admission window through the shared bounded isolation observer.
 * @param {object} application Owned Electron application. @param {string} destination Fresh flag receipt.
 * @param {object} env Owned environment. @param {object} receipt Scenario receipt updated before guards.
 * @param {Function} readDpi Explicit bounded query on the existing native fixture.
 * @returns {Promise<void>} Exact same-window 1280x800, 100%/96-DPI observation. @since v0.20.1
 */
export async function prepareNativeReadWindow(application, destination, env, receipt, readDpi) {
  assert.equal(typeof readDpi, 'function', 'Native window DPI provider unavailable');
  const windowId = await application.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length !== 1 || windows[0].isDestroyed())
      throw Error('Admission window unavailable');
    const window = windows[0];
    window.setBounds({ width: 1280, height: 800 });
    return window.id;
  });
  receipt.window = await observePackageWindow(application, destination);
  const measure = ({ app, BrowserWindow, screen }, expectedId) => {
    const windows = BrowserWindow.getAllWindows();
    const window = BrowserWindow.fromId(expectedId);
    if (!window || window.isDestroyed() || windows.length !== 1 || windows[0] !== window)
      return { sameWindow: false };
    const bounds = window.getBounds();
    return {
      sameWindow: true,
      packaged: app.isPackaged && app.getAppPath().endsWith('app.asar'),
      mainPid: process.pid,
      width: bounds.width,
      height: bounds.height,
      scaleFactor: screen.getDisplayMatching(bounds).scaleFactor,
      handle: window.getNativeWindowHandle().readBigUInt64LE(0).toString(),
      isolated: !window.isFocused() && !window.isFocusable(),
      visible: window.isVisible(),
    };
  };
  const measured = await application.evaluate(measure, windowId);
  const { handle, ...metadata } = measured;
  Object.assign(receipt.window, metadata);
  assert.equal(receipt.window.sameWindow, true, 'Admission window was replaced');
  assert.equal(receipt.window.packaged, true, 'Admission window is not packaged');
  assert.equal(receipt.window.isolated, true, 'Admission window input isolation was lost');
  assert.equal(receipt.window.visible, true, 'Admission window is not visible');
  assert.equal(receipt.window.width, 1280, 'Admission window width changed');
  assert.equal(receipt.window.height, 800, 'Admission window height changed');
  assert.equal(receipt.window.scaleFactor, 1, 'Only 100% display scaling is qualified');
  assert(
    Number.isInteger(measured.mainPid) && measured.mainPid > 0 && measured.mainPid <= 2147483647,
    'Native window DPI target invalid',
  );
  assert(
    typeof handle === 'string' &&
      /^[1-9]\d{0,18}$/.test(handle) &&
      BigInt(handle) <= 9223372036854775807n,
    'Native window DPI target invalid',
  );
  receipt.window.dpiQuery = {
    responseValid: false,
    windowExists: null,
    ownerMatched: null,
    completed: false,
    sameWindowAfter: false,
  };
  let native;
  try {
    native = await readDpi({ handle, mainPid: measured.mainPid }, env);
  } catch (error) {
    if (projectReadFixtureFailure(error)) throw error;
    // eslint-disable-next-line preserve-caught-error -- Unrecognized causes may contain private target or environment data.
    throw new Error('Native window DPI query failed');
  }
  receipt.window.dpiQuery.completed = true;
  const keys = ['command', 'schema', 'windowExists', 'ownerMatched', 'dpi'];
  const valid =
    native !== null &&
    typeof native === 'object' &&
    !Array.isArray(native) &&
    Object.keys(native).length === keys.length &&
    keys.every((key) => Object.hasOwn(native, key)) &&
    native.command === 'window-dpi' &&
    native.schema === 'aegis-window-dpi/1' &&
    typeof native.windowExists === 'boolean' &&
    typeof native.ownerMatched === 'boolean' &&
    Number.isInteger(native.dpi) &&
    native.dpi >= 0 &&
    native.dpi <= 4294967295;
  receipt.window.dpiQuery.responseValid = valid;
  assert(valid, 'Native window DPI response invalid');
  receipt.window.dpiQuery.windowExists = native.windowExists;
  receipt.window.dpiQuery.ownerMatched = native.ownerMatched;
  receipt.window.dpi = native.dpi;
  assert(native.windowExists, 'Native window DPI window unavailable');
  assert(native.ownerMatched, 'Native window DPI owner mismatch');
  assert.equal(receipt.window.dpi, 96, 'Only 100% window DPI is qualified');
  const after = await application.evaluate(measure, windowId);
  receipt.window.dpiQuery.sameWindowAfter =
    after.sameWindow === true &&
    [
      'handle',
      'mainPid',
      'packaged',
      'isolated',
      'visible',
      'width',
      'height',
      'scaleFactor',
    ].every((key) => after[key] === measured[key]);
  assert(
    receipt.window.dpiQuery.sameWindowAfter,
    'Admission window changed during native DPI query',
  );
}

/** Measure release using only the closed issuer's owned synthetic file.
 * Immediate rename remains an observation without a demonstrated lock delay.
 * @param {string} file Owned synthetic .env. @param {string} out Owned probe output.
 * @param {object} env Cloud-only process environment. @returns {Promise<object>}
 * @since v0.20.1
 */
export async function probeRetainedObjectRelease(file, out, env) {
  assert(path.dirname(path.dirname(file)) === out && path.basename(file) === '.env');
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size === 4096);
  const destination = path.join(path.dirname(file), '.env-after-issuer-close');
  assert(!fs.existsSync(destination));
  const source = `param([string]$SourceFile,[string]$Destination)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$policyBefore=(Get-ExecutionPolicy).ToString()
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class NativeReadRename{[DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]public static extern bool MoveFileEx(string source,string destination,uint flags);}'
$watch=[Diagnostics.Stopwatch]::StartNew();$first=$null;$attempts=0;$released=$false
do {
  $attempts++;$released=[NativeReadRename]::MoveFileEx($SourceFile,$Destination,0)
  $code=if($released){0}else{[Runtime.InteropServices.Marshal]::GetLastWin32Error()}
  if($null -eq $first){$first=@{released=$released;win32Error=$code;elapsedMs=$watch.Elapsed.TotalMilliseconds}}
  if($released){break}
  if($code -notin @(32,33)){throw ('Unexpected owned rename error '+$code)}
  Start-Sleep -Milliseconds 50
} while($watch.Elapsed.TotalMilliseconds -lt 15000)
@{released=$released;firstAttempt=$first;elapsedMs=$watch.Elapsed.TotalMilliseconds;attempts=$attempts;deadlineMs=15000;observedDelay=(-not $first.released);policyBefore=$policyBefore;policyAfter=(Get-ExecutionPolicy).ToString();sharingMode='explicit deny-delete-share synthetic reader mode; immediate success does not prove an observed release delay'} | ConvertTo-Json -Depth 5 -Compress
if(-not $released -or $watch.Elapsed.TotalMilliseconds -gt 15000){exit 2}
`;
  const commandText =
    '& {\n' +
    source +
    "\n} -SourceFile '" +
    file.replaceAll("'", "''") +
    "' -Destination '" +
    destination.replaceAll("'", "''") +
    "'";
  const encoded = Buffer.from(commandText, 'utf16le').toString('base64');
  assert(encoded.length <= 24 * 1024, 'Owned retention command budget');
  const log = path.join(out, 'retention-probe.log');
  const command = await boundedCommand(
    path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', encoded],
    { cwd: out, env, log, timeoutMs: 25000, maxBytes: 8192 },
  );
  assert(
    command.code === 0 && !command.error && !command.reason,
    'Owned retained-object release probe failed',
  );
  const receipt = JSON.parse(fs.readFileSync(log, 'utf8'));
  assert(
    receipt.released === true &&
      Number.isFinite(receipt.elapsedMs) &&
      receipt.elapsedMs <= 15000 &&
      receipt.policyAfter === receipt.policyBefore &&
      fs.existsSync(destination) &&
      !fs.existsSync(file),
    'Owned rename release was not confirmed within the measured bound',
  );
  return receipt;
}
