import { expect, it } from 'vitest';
import { fork } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(new URL('./fixtures/session-operation-crash.cjs', import.meta.url));
const deadlineMs = 10000;

function start(mode, directory, operationId) {
  const child = fork(fixture, [mode, directory, operationId], {
    execArgv: [],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
  });
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', () => resolve({ code: null, signal: null }));
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('crash fixture handshake timed out')), deadlineMs);
    child.once('message', (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', () => {
      clearTimeout(timer);
      reject(Error('crash fixture exited before handshake'));
    });
  });
  return { child, exited, ready };
}

async function waitForExit(process) {
  let timer;
  try {
    return await Promise.race([
      process.exited,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('crash fixture exit timed out')), deadlineMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

it('refuses replay after a real process crash between a synced effect and settlement', async () => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-crash-')));
  const children = [];
  try {
    const ledgerDirectory = path.join(directory, 'ledger');
    await fs.mkdir(ledgerDirectory);
    const operationId = randomBytes(16).toString('hex');
    const spentName = createHash('sha256').update(operationId).digest('hex') + '.spent';
    const spentPath = path.join(ledgerDirectory, spentName);
    const effectPath = path.join(directory, 'effect.txt');
    const crashing = start('crash', directory, operationId);
    children.push(crashing);
    expect(await crashing.ready).toEqual({ stage: 'effect-synced', pid: crashing.child.pid });
    expect(crashing.child.exitCode).toBeNull();
    expect(crashing.child.signalCode).toBeNull();
    expect(await fs.readFile(effectPath, 'utf8')).toBe('effect\n');
    const spentBytes = await fs.readFile(spentPath);
    expect(JSON.parse(spentBytes).state).toBe('consumed');
    expect(await fs.readdir(ledgerDirectory)).toEqual([spentName]);

    // Kill only the retained direct child handle; never discover or kill by name.
    expect(crashing.child.kill('SIGKILL')).toBe(true);
    const terminated = await waitForExit(crashing);
    expect(terminated.code === null ? terminated.signal === 'SIGKILL' : terminated.code !== 0).toBe(
      true,
    );
    expect(await fs.readFile(spentPath)).toEqual(spentBytes);
    expect(await fs.readdir(ledgerDirectory)).toEqual([spentName]);

    // A second process excludes live-owner state and Node module caches from recovery.
    const recovered = start('recover', directory, operationId);
    children.push(recovered);
    expect(await recovered.ready).toEqual({
      stage: 'recovered',
      pid: recovered.child.pid,
      before: { state: 'outcome-unknown' },
      after: { state: 'outcome-unknown' },
      receipt: { schemaVersion: 1, state: 'refused', launchAllowed: false },
      effects: 0,
    });
    expect(await waitForExit(recovered)).toEqual({ code: 0, signal: null });
    expect(await fs.readFile(effectPath, 'utf8')).toBe('effect\n');
    expect(await fs.readFile(spentPath)).toEqual(spentBytes);
    expect(await fs.readdir(ledgerDirectory)).toEqual([spentName]);
  } finally {
    for (const process of children) {
      // Mark an unawaited failed handshake handled before killing during cleanup.
      process.ready.catch(() => {});
      if (process.child.exitCode === null && process.child.signalCode === null)
        process.child.kill('SIGKILL');
      await waitForExit(process);
    }
    if (
      path.basename(directory).startsWith('aegis-crash-') &&
      !(await fs.lstat(directory)).isSymbolicLink() &&
      (await fs.realpath(directory)) === directory
    )
      await fs.rm(directory, { recursive: true, force: true });
  }
}, 45000);
