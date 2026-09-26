'use strict';
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');

const HELPER = 'aegis-mcpjob.exe';
const STARTUP_MS = 1800;
const MAX_LAUNCH_BYTES = 131072;

/** Find the shipped helper in the packaged or source checkout.
 * @param {object} [runtime] Process state, injectable for path tests.
 * @returns {string} Absolute helper path. @since v0.16.0 */
function helperPath(runtime = process) {
  return runtime.resourcesPath && !runtime.defaultApp
    ? path.join(runtime.resourcesPath, 'sidecar', HELPER)
    : path.resolve(__dirname, '..', '..', 'build', 'sidecar', HELPER);
}

/** Start one selected upstream through the Windows Job helper.
 * @param {object} launch Exact policy-authorized launch.
 * @param {string} [helper] Explicit path for native smoke tests only.
 * @returns {object} Child-like stdio and verified cleanup state. @since v0.16.0 */
function spawnInWindowsJob(launch, helper = helperPath()) {
  if (!existsSync(helper)) throw Error('gateway-protected-launch-unavailable');
  const frame = JSON.stringify({
    executable: launch.executable,
    cwd: launch.cwd,
    args: launch.args,
    env: launch.env,
  });
  if (Buffer.byteLength(frame) + 1 > MAX_LAUNCH_BYTES)
    throw Error('gateway-protected-launch-unavailable');
  const helperProcess = spawn(helper, [], {
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const peer = new EventEmitter();
  peer.stdin = helperProcess.stdin;
  peer.stdout = new PassThrough();
  peer.stderr = new PassThrough();
  peer.cleanupConfirmed = false;
  peer.stop = () => helperProcess.stdin.end();
  peer.kill = (signal) => helperProcess.kill(signal);
  peer.unref = () => helperProcess.unref();
  let ready = false;
  let statusSeen = false;
  let helperExitCode = null;
  const fail = () => peer.emit('error', Error('gateway-protected-launch-unavailable'));
  const startup = setTimeout(() => {
    if (ready) return;
    fail();
    helperProcess.kill('SIGKILL');
  }, STARTUP_MS);
  helperProcess.stdout.on('data', (chunk) => {
    if (!ready) {
      if (chunk[0] !== 0x52) {
        clearTimeout(startup);
        fail();
        helperProcess.kill('SIGKILL');
        return;
      }
      ready = true;
      clearTimeout(startup);
      chunk = chunk.subarray(1);
    }
    if (chunk.length) peer.stdout.write(chunk);
  });
  helperProcess.stdout.on('end', () => peer.stdout.end());
  helperProcess.stderr.on('data', (chunk) => {
    // The selected process's stderr never enters this control channel.
    if (statusSeen || chunk.length !== 1 || (chunk[0] !== 0x43 && chunk[0] !== 0x55)) {
      peer.cleanupConfirmed = false;
      fail();
      return;
    }
    statusSeen = true;
    peer.cleanupConfirmed = chunk[0] === 0x43;
  });
  helperProcess.stderr.on('end', () => peer.stderr.end());
  helperProcess.on('error', fail);
  helperProcess.on('exit', (code, signal) => {
    helperExitCode = code;
    peer.emit('exit', code, signal);
  });
  helperProcess.on('close', (code, signal) => {
    clearTimeout(startup);
    peer.cleanupConfirmed = ready && statusSeen && peer.cleanupConfirmed && helperExitCode === 0;
    peer.emit('close', code, signal);
  });
  helperProcess.stdin.write(frame + '\n', (error) => {
    if (error) fail();
  });
  return peer;
}

module.exports = { helperPath, spawnInWindowsJob };
