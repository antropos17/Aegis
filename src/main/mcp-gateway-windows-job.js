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

function actionStatus(bytes) {
  const match =
    /^A,(C|U),([01]),(-|-?(?:0|[1-9]\d{0,9})),(\d{1,5}),(\d{1,5}),([01]),([01])\n$/.exec(
      bytes.toString('ascii'),
    );
  if (!match) return null;
  const exited = match[2] === '1';
  const exitCode = exited ? Number(match[3]) : null;
  const stdoutBytes = Number(match[4]);
  const stderrBytes = Number(match[5]);
  const outputComplete = match[6] === '1';
  const outputLimit = match[7] === '1';
  if (
    (exited && (!Number.isInteger(exitCode) || exitCode < -2147483648 || exitCode > 2147483647)) ||
    (!exited && match[3] !== '-') ||
    stdoutBytes + stderrBytes > 65536 ||
    (outputLimit && (outputComplete || stdoutBytes + stderrBytes !== 65536))
  )
    return null;
  return {
    cleanupConfirmed: match[1] === 'C',
    exited,
    exitCode,
    stdoutBytes,
    stderrBytes,
    outputComplete,
    outputLimit,
  };
}

function spawnProtected(launch, helper, purpose) {
  if (!existsSync(helper)) throw Error('gateway-protected-launch-unavailable');
  // The .NET Framework reads profiler controls before the helper's Main runs.
  // Never pass the parent process environment to this privileged launch boundary.
  const roots = Object.entries(process.env).filter(([name]) => name.toLowerCase() === 'systemroot');
  if (roots.length !== 1 || !path.win32.isAbsolute(roots[0][1]))
    throw Error('gateway-protected-launch-unavailable');
  const frame = JSON.stringify({
    executable: launch.executable,
    cwd: launch.cwd,
    args: launch.args,
    env: launch.env,
    ...(purpose === 'action' ? { purpose } : {}),
  });
  if (Buffer.byteLength(frame) + 1 > MAX_LAUNCH_BYTES)
    throw Error('gateway-protected-launch-unavailable');
  const helperProcess = spawn(helper, [], {
    shell: false,
    windowsHide: true,
    cwd: path.dirname(helper),
    env: { SystemRoot: roots[0][1] },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const peer = new EventEmitter();
  peer.stdin = helperProcess.stdin;
  peer.stdout = new PassThrough();
  peer.stderr = new PassThrough();
  peer.cleanupConfirmed = false;
  peer.actionOutcome = null;
  peer.stop = () => helperProcess.stdin.end();
  peer.kill = (signal) => helperProcess.kill(signal);
  peer.unref = () => helperProcess.unref();
  let ready = false;
  let statusSeen = false;
  let helperExitCode = null;
  let actionStatusBytes = Buffer.alloc(0);
  let protocolFailed = false;
  const fail = () => {
    protocolFailed = true;
    peer.emit('error', Error('gateway-protected-launch-unavailable'));
  };
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
    if (chunk.length) {
      if (purpose === 'action') {
        fail();
        helperProcess.kill('SIGKILL');
      } else peer.stdout.write(chunk);
    }
  });
  helperProcess.stdout.on('end', () => peer.stdout.end());
  helperProcess.stderr.on('data', (chunk) => {
    // The selected process's stderr never enters this control channel.
    if (purpose === 'action') {
      if (actionStatusBytes.length + chunk.length > 128) {
        fail();
        helperProcess.kill('SIGKILL');
        return;
      }
      actionStatusBytes = Buffer.concat([actionStatusBytes, chunk]);
      return;
    }
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
    if (purpose === 'action') {
      peer.actionOutcome = actionStatus(actionStatusBytes);
      statusSeen = !!peer.actionOutcome;
      peer.cleanupConfirmed = !!peer.actionOutcome?.cleanupConfirmed;
      actionStatusBytes.fill(0);
    }
    peer.cleanupConfirmed =
      !protocolFailed && ready && statusSeen && peer.cleanupConfirmed && helperExitCode === 0;
    peer.emit('close', code, signal);
  });
  helperProcess.stdin.write(frame + '\n', (error) => {
    if (error) fail();
  });
  return peer;
}

/** Start one selected upstream through the Windows Job helper.
 * @param {object} launch Exact policy-authorized launch.
 * @param {string} [helper] Explicit path for native smoke tests only.
 * @returns {object} Child-like stdio and verified cleanup state. @since v0.16.0 */
function spawnInWindowsJob(launch, helper = helperPath()) {
  return spawnProtected(launch, helper, 'gateway');
}

/** Start a selected action with private output accounting and descendant cleanup.
 * @param {object} launch Exact policy-authorized launch.
 * @param {string} [helper] Explicit path for native smoke tests only.
 * @returns {object} Child-like control and verified action outcome. @since v0.16.0 */
function spawnActionInWindowsJob(launch, helper = helperPath()) {
  return spawnProtected(launch, helper, 'action');
}

module.exports = { helperPath, spawnInWindowsJob, spawnActionInWindowsJob };
