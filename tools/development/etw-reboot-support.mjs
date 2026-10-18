import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { produceGuiManifest } from '../../scripts/produce-protected-gui-manifest.mjs';

/** Hash immutable receipt/package bytes. @param {Buffer|string} bytes
 * @returns {string} @since v0.19.2
 */
export const rebootHash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/** Read bounded private evidence without silently accepting a link or oversized file.
 * @param {string} file @returns {object} @since v0.19.2
 */
export function readRebootReceipt(file) {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 262144);
  const bytes = fs.readFileSync(file);
  return { bytes, value: JSON.parse(bytes) };
}

/** Require ordinary local ancestor directories; never overwrite a previous attempt.
 * @param {string} output @param {string} root Source checkout.
 * @returns {void} @since v0.19.2
 */
export function newRebootOutput(output, root) {
  assert(path.isAbsolute(output) && !output.startsWith('\\\\'));
  const relative = path.relative(root, output);
  assert(
    relative.startsWith('..' + path.sep) || path.isAbsolute(relative),
    'Output must be outside source',
  );
  for (let cursor = path.dirname(output); ; cursor = path.dirname(cursor)) {
    const stat = fs.lstatSync(cursor);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Ordinary output ancestors required');
    if (cursor === path.dirname(cursor)) break;
  }
  fs.mkdirSync(output);
  fs.mkdirSync(path.join(output, 'temp'));
}

/** Read the supported OS boot timestamp directly, without a user-supplied boot override.
 * Clock changes or unavailable CIM remain unverified; this is an observation, not authority.
 * @param {object} env @returns {object} @since v0.19.2
 */
export function observeWindowsBoot(env) {
  const script =
    "$ErrorActionPreference='Stop'; $os=Get-CimInstance Win32_OperatingSystem; " +
    "[ordered]@{lastBootUtc=$os.LastBootUpTime.ToUniversalTime().ToString('o'); " +
    "observedAt=[DateTime]::UtcNow.ToString('o'); version=$os.Version} | ConvertTo-Json -Compress";
  return JSON.parse(
    execFileSync(
      path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { env, windowsHide: true, timeout: 15000, maxBuffer: 4096, encoding: 'utf8' },
    ),
  );
}

/** Freeze the entire package and exact clean harness/source revision across the restart.
 * @param {string} root @param {string} candidate @param {string} expectedHead
 * @returns {object} @since v0.19.2
 */
export function rebootBinding(root, candidate, expectedHead) {
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 20000 }).trim();
  assert(/^[a-f0-9]{40}$/.test(expectedHead));
  assert.equal(git('rev-parse', 'HEAD'), expectedHead);
  assert.equal(
    git('status', '--porcelain', '--untracked-files=normal'),
    '',
    'Clean source required',
  );
  return {
    sourceHead: expectedHead,
    packageManifestSha256: rebootHash(produceGuiManifest(candidate)),
  };
}
