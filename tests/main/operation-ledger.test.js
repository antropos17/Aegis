import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const storage = require('../../src/main/operation-ledger');
const fixture = fileURLToPath(new URL('./fixtures/session-ledger-consumer.cjs', import.meta.url));
let directory;
const children = new Set();
const binding = () => ({
  sessionId: 'a'.repeat(32),
  epoch: 'b'.repeat(32),
  policyRevision: 'c'.repeat(64),
  operationId: randomBytes(16).toString('hex'),
  operation: 'dummy-edit',
  requestDigest: 'd'.repeat(64),
  snapshotDigest: 'e'.repeat(64),
  nonce: randomBytes(16).toString('hex'),
  expiresAt: Date.now() + 60000,
});

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-ledger-')));
});
afterEach(async () => {
  storage._resetForTest();
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
  children.clear();
  if (
    path.basename(directory).startsWith('aegis-ledger-') &&
    !(await fs.lstat(directory)).isSymbolicLink()
  )
    await fs.rm(directory, { recursive: true, force: true });
});

function consume(value) {
  const child = fork(fixture, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  children.add(child);
  const exited = once(child, 'exit');
  const result = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.on('message', (message) => {
      if (message === 'ready') child.send({ directory, binding: value });
      else resolve(message);
    });
    child.once('exit', () => reject(Error('consumer exited before reply')));
  });
  return { result, exited };
}

describe('bounded redacted operation ledger', () => {
  it('binds private consumption reservations to their exact ledger and operation', async () => {
    const ledger = await storage.createOperationLedger(directory);
    const other = await storage.createOperationLedger(directory);
    const first = binding();
    const second = binding();
    const reservation = await ledger.consume(first);
    const next = await ledger.consume(second);
    expect(Object.isFrozen(reservation)).toBe(true);
    expect(Reflect.ownKeys(reservation)).toEqual([]);
    await expect(ledger.recheckConsumption(reservation, first)).resolves.toBeUndefined();
    await expect(ledger.recheckConsumption(next, second)).resolves.toBeUndefined();
    await expect(ledger.recheckConsumption({}, first)).rejects.toThrow();
    await expect(other.recheckConsumption(reservation, first)).rejects.toThrow();
    await expect(ledger.recheckConsumption(reservation, second)).rejects.toThrow();
    const spent = path.join(
      directory,
      createHash('sha256').update(first.operationId).digest('hex') + '.spent',
    );
    await fs.unlink(spent);
    await expect(ledger.recheckConsumption(reservation, first)).rejects.toThrow();
    await expect(ledger.recheckConsumption(next, second)).resolves.toBeUndefined();
    await ledger.settle(second, 'completed');
    await expect(ledger.recheckConsumption(next, second)).rejects.toThrow();
  });

  it('spends exactly once across competing actual processes and keeps post-exit intent unknown', async () => {
    const value = binding();
    const work = [consume(value), consume(value)];
    expect((await Promise.all(work.map((item) => item.result))).sort()).toEqual([
      'consumed',
      'refused',
    ]);
    await Promise.all(work.map((item) => item.exited));
    const ledger = await storage.createOperationLedger(directory);
    expect(await ledger.inspect(value.operationId)).toEqual({ state: 'outcome-unknown' });
    await expect(
      ledger.consume({ ...value, epoch: 'f'.repeat(32), nonce: 'f'.repeat(32) }),
    ).rejects.toThrow();
    expect((await fs.readdir(directory)).filter((name) => name.endsWith('.spent'))).toHaveLength(1);
  });

  it('retains malformed/torn receipts and fails inspection without deleting or renewing them', async () => {
    const ledger = await storage.createOperationLedger(directory),
      value = binding();
    await ledger.consume(value);
    const name = (await fs.readdir(directory)).find((entry) => entry.endsWith('.spent'));
    await fs.writeFile(path.join(directory, name), '{torn');
    expect(await ledger.inspect(value.operationId)).toEqual({ state: 'unavailable' });
    await expect(ledger.consume(value)).rejects.toThrow();
    expect(await fs.readFile(path.join(directory, name), 'utf8')).toBe('{torn');
  });

  it('refuses an existing lock and unknown directory entries without modifying them', async () => {
    const ledger = await storage.createOperationLedger(directory),
      value = binding();
    await fs.writeFile(path.join(directory, '.operation-lock'), 'preserved');
    await expect(ledger.consume(value)).rejects.toThrow();
    expect(await fs.readFile(path.join(directory, '.operation-lock'), 'utf8')).toBe('preserved');
    await fs.unlink(path.join(directory, '.operation-lock'));
    await fs.writeFile(path.join(directory, 'unowned'), 'preserved');
    await expect(ledger.consume(value)).rejects.toThrow();
    expect(await fs.readdir(directory)).toEqual(['unowned']);
  });

  it('refuses a replaced directory without writing into its replacement', async () => {
    const ledger = await storage.createOperationLedger(directory),
      value = binding();
    const retained = path.join(directory, 'old');
    await fs.mkdir(retained);
    const replacement = path.join(directory, 'replacement');
    await fs.mkdir(replacement);
    const childLedger = await storage.createOperationLedger(retained);
    await fs.rename(retained, path.join(directory, 'retained'));
    await fs.rename(replacement, retained);
    await expect(childLedger.consume(value)).rejects.toThrow();
    expect(await fs.readdir(retained)).toEqual([]);
    // Parent ledger also refuses unexpected nested directories.
    await expect(ledger.consume(value)).rejects.toThrow();
  });

  it('handles actual short writes and refuses oversized/corrupted outcomes', async () => {
    storage._setDepsForTest({
      fs: {
        ...fs,
        open: async (...args) => {
          const handle = await fs.open(...args);
          return {
            stat: (...p) => handle.stat(...p),
            read: (...p) => handle.read(...p),
            sync: () => handle.sync(),
            close: () => handle.close(),
            write: (bytes, offset, length, position) =>
              handle.write(bytes, offset, Math.min(length, 7), position),
          };
        },
      },
    });
    const ledger = await storage.createOperationLedger(directory),
      value = binding();
    await ledger.consume(value);
    await ledger.settle(value, 'completed');
    expect(await ledger.inspect(value.operationId)).toEqual({ state: 'completed' });
    const name = (await fs.readdir(directory)).find((entry) => entry.endsWith('.outcome'));
    await fs.writeFile(path.join(directory, name), 'x'.repeat(storage.LIMITS.recordBytes + 1));
    expect(await ledger.inspect(value.operationId)).toEqual({ state: 'unavailable' });
  });

  it('bounds directory admission before creating a spend record', async () => {
    for (let i = 0; i < storage.LIMITS.entries; i++)
      await fs.writeFile(path.join(directory, i.toString(16).padStart(64, '0') + '.spent'), '');
    const ledger = await storage.createOperationLedger(directory);
    await expect(ledger.consume(binding())).rejects.toThrow();
    expect(await fs.readdir(directory)).toHaveLength(storage.LIMITS.entries);
  });
});

// A surviving terminal/staging record proves that missing spent bytes are not
// evidence of a fresh operation. No reconstruction or deletion is authorized.
describe('operation ledger partial-history recovery', () => {
  it.each(
    ['outcome', 'pending', 'pending-unknown'].flatMap((suffix) =>
      ['canonical', 'malformed', 'oversized'].map((content) => [suffix, content]),
    ),
  )('refuses missing-spent recovery with preserved %s/%s evidence', async (suffix, content) => {
    const value = binding();
    const ledger = await storage.createOperationLedger(directory);
    await ledger.consume(value);
    await ledger.settle(value, 'completed');
    const name = createHash('sha256').update(value.operationId).digest('hex');
    const outcome = path.join(directory, name + '.outcome');
    const survivor = path.join(directory, name + '.' + suffix);
    if (suffix !== 'outcome') await fs.rename(outcome, survivor);
    if (content === 'malformed') await fs.writeFile(survivor, '{torn');
    if (content === 'oversized')
      await fs.writeFile(survivor, 'x'.repeat(storage.LIMITS.recordBytes + 1));
    const before = await fs.readFile(survivor);
    await fs.unlink(path.join(directory, name + '.spent'));
    const reopened = await storage.createOperationLedger(directory);
    expect(await reopened.inspect(value.operationId)).toEqual({
      state: 'unavailable',
    });
    await expect(reopened.consume(value)).rejects.toThrow('operation-ledger-unavailable');
    expect(await fs.readdir(directory)).toEqual([name + '.' + suffix]);
    expect(await fs.readFile(survivor)).toEqual(before);
  });
});
