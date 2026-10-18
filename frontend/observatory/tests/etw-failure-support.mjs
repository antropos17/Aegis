import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { boundedCommand } from '../../../tools/development/bounded-command.mjs';
import { delay, remainingPids } from './etw-support.mjs';

/** Query the fixed session independently; denial stays unknown, never absent.
 * An explicitly requested elevated witness only queries and writes to its pipe.
 * @param {string} helper @param {string} out @param {string} label @param {object} env
 * @returns {Promise<object>} Native status/boolean receipt. @since v0.19.2
 */
export async function inspectSession(helper, out, label, env) {
  async function run(mode) {
    const log = path.join(out, label + '-' + mode + '.log');
    const r = await boundedCommand(helper, [mode], { cwd: out, env, log, timeoutMs: 135000 });
    assert(r.code === 0 && !r.reason && !r.error, 'Read-only session witness failed');
    assert(fs.statSync(log).size <= 2048, 'Read-only witness output exceeded budget');
    return JSON.parse(fs.readFileSync(log, 'utf8'));
  }
  let value = await run('inspect');
  if (value.status === 5) {
    console.log('Explicit read-only session witness requires one same-account UAC decision.');
    value = await run('inspect-elevated');
  }
  assert(
    (value.status === 0 && value.present === true) ||
      (value.status === 4201 && value.present === false),
    'Session query is unknown, not absence',
  );
  return value;
}

/** Wait only for observed owned IDs using read-only enumeration.
 * @param {number[]} pids @param {object} env @returns {Promise<void>} @since v0.19.2
 */
export async function waitOwnedExit(pids, env) {
  const until = Date.now() + 25000;
  while (remainingPids(pids, env).length && Date.now() < until) await delay(100);
  assert.equal(remainingPids(pids, env).length, 0, 'An observed owned app/helper remains');
}

/** Compile the existing normal-token synthetic read initiator in a private folder.
 * @param {string} root @param {string} out @param {object} env @returns {string} @since v0.19.2
 */
export function compileReadFixture(root, out, env) {
  const file = path.join(out, 'aider.exe');
  execFileSync(
    path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    [
      '/nologo',
      '/target:exe',
      '/platform:x64',
      '/warnaserror+',
      '/out:' + file,
      path.join(root, 'tests/fixtures/etw-read-process.cs'),
    ],
    { env, windowsHide: true, timeout: 30000, maxBuffer: 65536 },
  );
  return file;
}
