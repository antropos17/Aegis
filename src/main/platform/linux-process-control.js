'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
let run = execFile;
const WITNESS = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}:\d+$/i;

/** Resolve the real helper file that an external Python process can read.
 * @param {{resourcesPath?: string, defaultApp?: boolean}} runtime Electron runtime.
 * @returns {string} Packaged resource or development source path.
 * @since v0.19.2-beta
 */
function resolveHelperPath(runtime = process) {
  return runtime.resourcesPath && !runtime.defaultApp
    ? path.join(runtime.resourcesPath, 'linux-process-control.py')
    : path.join(__dirname, 'linux-process-control.py');
}

/** Send a signal through a Linux pidfd after checking the observed generation.
 * @param {number} pid Positive kernel PID.
 * @param {string} witness Observed boot ID and kernel start ticks.
 * @param {'kill'|'suspend'|'resume'} action Fixed signal operation.
 * @returns {Promise<{success: boolean, error?: string}>} Confirmed syscall outcome.
 * @since v0.19.2-beta
 */
function signalProcess(pid, witness, action) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 2147483647)
    return Promise.resolve({ success: false, error: 'Invalid PID' });
  if (typeof witness !== 'string' || witness.length > 80 || !WITNESS.test(witness))
    return Promise.resolve({ success: false, error: 'Invalid process generation' });
  if (!['kill', 'suspend', 'resume'].includes(action))
    return Promise.resolve({ success: false, error: 'Invalid process action' });
  return new Promise((resolve) => {
    try {
      run(
        '/usr/bin/python3',
        ['-I', resolveHelperPath(), String(pid), witness, action],
        { timeout: 5000, maxBuffer: 4096, windowsHide: true },
        (error) => {
          if (!error) resolve({ success: true });
          else if (error.code === 3)
            resolve({ success: false, error: 'Process instance changed or is no longer observed' });
          else if (error.code === 4 || error.code === 'ENOENT')
            resolve({
              success: false,
              error: 'Linux process control requires Python 3.9 and pidfd support',
            });
          else resolve({ success: false, error: 'Linux process action failed' });
        },
      );
    } catch {
      resolve({ success: false, error: 'Linux process action failed' });
    }
  });
}

/** @internal Replace the syscall launcher in unit tests. */
function _setExecFileForTest(dependency) {
  run = dependency || execFile;
}

module.exports = { signalProcess, resolveHelperPath, _setExecFileForTest };
