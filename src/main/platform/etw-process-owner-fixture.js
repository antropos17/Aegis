/** @file Fixed synthetic fixture launch seam; no helper/capture command input. */
'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const modes = new Set([
  'normal',
  'blocked-stop',
  'blocked-consumer',
  'partial',
  'malformed',
  'overflow',
]);

/** Validate the closed fixture vocabulary and generation.
 * @param {string} mode Synthetic fixture mode.
 * @param {string} generation Nonzero lowercase N-format GUID.
 * @returns {void}
 * @since v0.19.2
 */
function validateFixture(mode, generation) {
  if (
    !modes.has(mode) ||
    typeof generation !== 'string' ||
    !/^[a-f0-9]{32}$/.test(generation) ||
    /^0+$/.test(generation)
  )
    throw new Error('invalid-fixture');
}

/** Launch only the checked-in, nonprivileged JavaScript fixture.
 * @param {string} mode Synthetic fixture mode.
 * @param {string} generation Fixture generation.
 * @returns {import('node:child_process').ChildProcess} Original child handle.
 * @since v0.19.2
 */
function launchFixture(mode, generation) {
  validateFixture(mode, generation);
  if (process.versions.electron) throw new Error('fixture-requires-node');
  const script = path.resolve(
    __dirname,
    '../../..',
    'sidecar/etw-process/shutdown-fixture/child.cjs',
  );
  // NODE_OPTIONS, preload hooks and user PATH cannot change the fixed fixture.
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return spawn(process.execPath, [script, mode, generation], {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
}
module.exports = { launchFixture, validateFixture };
