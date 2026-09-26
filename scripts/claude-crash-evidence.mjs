/** TEST ONLY: abrupt provider death, independent child handle and observation evidence. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { frame } from './claude-cancellation-evidence.mjs';

/** Kill only the held provider after acquiring an independent handle to its running action.
 * @param {object} context Private fixture controls. @returns {Promise<void>} Fixed evidence only.
 * @since v0.15.1 */
export async function crashProvider({ child, identity, e, until }) {
  const pid = Number(fs.readFileSync(identity, 'utf8'));
  if (!Number.isSafeInteger(pid) || pid < 1) throw Error('child-identity');
  const witness = spawn(
    path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      fileURLToPath(new URL('../tests/fixtures/action-child-exit-witness.ps1', import.meta.url)),
      String(pid),
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  let output = '',
    code = null;
  witness.stdout.on('data', (chunk) => {
    output = (output + chunk).slice(0, 1024);
  });
  const done = new Promise((resolve) => {
    witness.once('error', () => {
      code = -1;
      resolve();
    });
    witness.once('close', (value) => {
      code = value;
      resolve();
    });
  });
  try {
    await until(() => output.includes('ready'), 3000);
    e.childHandleHeld = true;
    const providerExit = new Promise((resolve) => child.once('exit', resolve));
    e.providerKilled = child.kill('SIGKILL');
    if (!e.providerKilled) throw Error('provider-kill');
    await providerExit;
    e.providerExitObserved = true;
    await until(() => code !== null, 3500);
    e.childExitObserved =
      code === 0 && output.trim().split(/\r?\n/).join(',') === 'ready,terminated';
    if (!e.childExitObserved) throw Error('child-exit');
  } finally {
    if (witness.exitCode === null && witness.signalCode === null) witness.kill('SIGKILL');
    await done;
  }
}

/** Do not accept ordinary timeout/cleanup as provider-crash evidence.
 * @param {object} e Fixed scenario receipt. @returns {boolean} Complete evidence.
 * @since v0.15.1 */
export function crashPassed(e) {
  if (
    !e ||
    e.crash !== true ||
    typeof e.catalog !== 'boolean' ||
    typeof e.review !== 'boolean' ||
    e.failure !== null ||
    e.timedOut ||
    e.cancelled ||
    e.exceeded ||
    e.providerIdentity !== 'unverified' ||
    e.requests !== 1 ||
    !e.toolDiscovered ||
    e.interruptSent ||
    e.interruptAcknowledged ||
    e.after !== null ||
    e.unusedBytes !== 0 ||
    ![
      'childHandleHeld',
      'providerKilled',
      'providerExitObserved',
      'childExitObserved',
      'progressObserved',
      'progressStopped',
      'stickyLoss',
      'deadlineAbsent',
    ].every((k) => e[k] === true) ||
    !['removed', 'unchanged-stale'].includes(e.endpointDisposition)
  )
    return false;
  if (e.endpointRemoved !== (e.endpointDisposition === 'removed')) return false;
  const route = e.review ? 'mcp-review' : 'mcp-stdio';
  if (
    !frame(e.before, e.catalog, 0, 0, 0, route) ||
    !frame(e.pending, e.catalog, 1, 0, 0, route) ||
    ![0, 1].some((settled) => frame(e.lost, e.catalog, 1, settled, 0, route))
  )
    return false;
  if (
    ![e.before, e.pending].every(
      (value) => value.reason === null && value.snapshot.state === 'observed',
    ) ||
    e.before.state !== 'observed' ||
    e.pending.state !== 'observed' ||
    e.lost.state !== 'coverage-lost' ||
    !['connection-closed', 'owner-closed'].includes(e.lost.reason)
  )
    return false;
  return (
    [e.pending, e.lost].every(
      (value) =>
        value.snapshot.connectionId === e.before.snapshot.connectionId &&
        JSON.stringify(value.snapshot.client) === JSON.stringify(e.before.snapshot.client),
    ) &&
    e.pending.snapshot.sequence > e.before.snapshot.sequence &&
    e.lost.snapshot.sequence >= e.pending.snapshot.sequence
  );
}
