import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { delay } from '../../frontend/observatory/tests/etw-support.mjs';
import { boundedCommand } from '../../tools/development/bounded-command.mjs';

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
/** Read the actual fresh roster assessment. @param {object} page @returns {Promise<object>} @since v0.20.1 */
export async function displayedRisk(page) {
  const row = page.locator('.investigation-roster .roster-choice[aria-label="Aider"]');
  await row.waitFor({ timeout: 30000 });
  const meta = await row.locator('.roster-meta').innerText();
  const text = await row.locator('.roster-risk').innerText();
  assert(meta.includes('Observed now') && !text.includes('Retained'), 'Displayed actor is stale');
  const match = /^Highest risk\s*·\s*(\d+)\/100$/.exec(text.trim());
  assert(match && Number(match[1]) <= 100, 'Actual displayed risk unavailable');
  return { score: Number(match[1]), text, meta };
}
/** Query the actual owned window DPI. @param {string} handle @param {object} env @returns {number} @since v0.20.1 */
export function windowDpi(handle, env) {
  assert(/^\d{1,20}$/.test(handle));
  const script =
    'Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;public static class NativeReadDpi{[DllImport("user32.dll")]public static extern uint GetDpiForWindow(IntPtr hwnd);}\';' +
    '[NativeReadDpi]::GetDpiForWindow([IntPtr]::new([long]' +
    handle +
    '))';
  return Number(
    execFileSync(
      path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { env, windowsHide: true, timeout: 30000, maxBuffer: 4096, encoding: 'utf8' },
    ).trim(),
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
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
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
