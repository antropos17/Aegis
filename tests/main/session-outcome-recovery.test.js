import { afterEach, beforeEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const storage = require('../../src/main/operation-ledger');
const session = require('../../src/main/session-authority');
const { createSessionOperationBroker } = require('../../src/main/session-operation-broker');
let directory;
const owners = [];
const request = {
  operationId: 'd'.repeat(32),
  operation: 'dummy-edit',
  request: Buffer.from('private request'),
  snapshot: Buffer.from('private snapshot'),
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-outcome-')));
});
afterEach(async () => {
  storage._resetForTest();
  for (const owner of owners) owner.revoke();
  owners.length = 0;
  if (
    path.basename(directory).startsWith('aegis-outcome-') &&
    !(await fs.lstat(directory)).isSymbolicLink()
  )
    await fs.rm(directory, { recursive: true, force: true });
});

async function owner(callback) {
  const authority = session.createSessionAuthority(
    { sessionId: 'a'.repeat(32), epoch: 'b'.repeat(32), policyRevision: 'c'.repeat(64) },
    { operations: ['dummy-edit'] },
  );
  owners.push(authority);
  const ledger = await storage.createOperationLedger(directory);
  const broker = createSessionOperationBroker({
    authority,
    ledger,
    dispatchers: { 'dummy-edit': callback },
  });
  const capability = authority.issue(
    {
      operationId: request.operationId,
      operation: request.operation,
      requestDigest: session.digestSessionBytes(request.request),
      snapshotDigest: session.digestSessionBytes(request.snapshot),
      expiresAt: Date.now() + 30000,
    },
    { decision: 'allow' },
  );
  return { authority, ledger, broker, capability };
}

function wrap(handle, sync) {
  return {
    stat: (...args) => handle.stat(...args),
    read: (...args) => handle.read(...args),
    write: (...args) => handle.write(...args),
    sync,
    close: () => handle.close(),
  };
}

it('does not recover readable completed bytes as confirmed after their sync fails', async () => {
  storage._setDepsForTest({
    fs: {
      ...fs,
      open: async (...args) => {
        const handle = await fs.open(...args);
        if (args[1] !== 'wx' || !/\.(outcome|pending)$/.test(String(args[0]))) return handle;
        return wrap(handle, async () => {
          throw Object.assign(Error('injected sync'), { code: 'EIO' });
        });
      },
    },
  });
  let effects = 0;
  const original = await owner(() => {
    effects++;
    return { status: 'completed' };
  });
  expect((await original.broker.dispatch(original.capability, request)).state).toBe(
    'outcome-unknown',
  );
  const readable = (await fs.readdir(directory)).find((name) => /\.(outcome|pending)$/.test(name));
  expect(JSON.parse(await fs.readFile(path.join(directory, readable), 'utf8')).state).toBe(
    'completed',
  );
  storage._resetForTest();
  const reopened = await owner(() => {
    effects++;
    return { status: 'completed' };
  });
  expect(await reopened.ledger.inspect(request.operationId)).toEqual({ state: 'outcome-unknown' });
  expect((await reopened.broker.dispatch(reopened.capability, request)).state).toBe('refused');
  expect(effects).toBe(1);
});

it('preserves uncertainty after cancellation when the corrected-state publication runs out of space', async () => {
  const written = deferred(),
    release = deferred();
  storage._setDepsForTest({
    fs: {
      ...fs,
      open: async (...args) => {
        if (args[1] === 'wx' && /\.(unknown|pending-unknown)$/.test(String(args[0])))
          throw Object.assign(Error('injected full disk'), { code: 'ENOSPC' });
        const handle = await fs.open(...args);
        if (args[1] !== 'wx' || !/\.(outcome|pending)$/.test(String(args[0]))) return handle;
        return wrap(handle, async () => {
          await handle.sync();
          written.resolve();
          await release.promise;
        });
      },
    },
  });
  let effects = 0;
  const original = await owner(() => {
    effects++;
    return { status: 'completed' };
  });
  const pending = original.broker.dispatch(original.capability, request);
  await written.promise;
  original.authority.revoke();
  release.resolve();
  expect((await pending).state).toBe('outcome-unknown');
  storage._resetForTest();
  const reopened = await owner(() => {
    effects++;
  });
  expect(await reopened.ledger.inspect(request.operationId)).toEqual({ state: 'outcome-unknown' });
  expect((await reopened.broker.dispatch(reopened.capability, request)).state).toBe('refused');
  expect(effects).toBe(1);
});

it('does not recover completion after terminal publication fails', async () => {
  storage._setDepsForTest({
    fs: {
      ...fs,
      rename: async () => {
        throw Object.assign(Error('injected rename'), { code: 'EIO' });
      },
    },
  });
  let effects = 0;
  const original = await owner(() => {
    effects++;
    return { status: 'completed' };
  });
  expect((await original.broker.dispatch(original.capability, request)).state).toBe(
    'outcome-unknown',
  );
  expect((await fs.readdir(directory)).some((name) => name.endsWith('.outcome'))).toBe(false);
  storage._resetForTest();
  const reopened = await owner(() => {
    effects++;
  });
  expect(await reopened.ledger.inspect(request.operationId)).toEqual({ state: 'outcome-unknown' });
  expect((await reopened.broker.dispatch(reopened.capability, request)).state).toBe('refused');
  expect(effects).toBe(1);
});

it('linearizes completion before publication and treats a subsequent abort as too late', async () => {
  const publishing = deferred(),
    release = deferred();
  storage._setDepsForTest({
    fs: {
      ...fs,
      rename: async (...args) => {
        publishing.resolve();
        await release.promise;
        await fs.rename(...args);
      },
    },
  });
  let effects = 0;
  const original = await owner(() => {
    effects++;
    return { status: 'completed' };
  });
  const pending = original.broker.dispatch(original.capability, request);
  await publishing.promise;
  original.authority.revoke();
  release.resolve();
  expect((await pending).state).toBe('completed');
  storage._resetForTest();
  const reopened = await owner(() => {
    effects++;
  });
  expect(await reopened.ledger.inspect(request.operationId)).toEqual({ state: 'completed' });
  expect((await reopened.broker.dispatch(reopened.capability, request)).state).toBe('refused');
  expect(effects).toBe(1);
});

it('preserves published completion if subsequent lock cleanup fails and blocks further writes', async () => {
  let released = 0;
  storage._setDepsForTest({
    fs: {
      ...fs,
      unlink: async (...args) => {
        if (++released === 2) throw Object.assign(Error('injected cleanup'), { code: 'EIO' });
        await fs.unlink(...args);
      },
    },
  });
  let effects = 0;
  const original = await owner(() => {
    effects++;
    return { status: 'completed' };
  });
  expect((await original.broker.dispatch(original.capability, request)).state).toBe('completed');
  expect(await original.ledger.inspect(request.operationId)).toEqual({ state: 'completed' });
  storage._resetForTest();
  const reopened = await owner(() => {
    effects++;
  });
  expect(await reopened.ledger.inspect(request.operationId)).toEqual({ state: 'completed' });
  expect((await reopened.broker.dispatch(reopened.capability, request)).state).toBe('refused');
  expect(effects).toBe(1);
  expect(await fs.readFile(path.join(directory, '.operation-lock'))).toHaveLength(0);
});

it('refuses a pre-finalization-schema terminal record rather than trusting readable completion', async () => {
  const original = await owner(() => ({ status: 'completed' }));
  expect((await original.broker.dispatch(original.capability, request)).state).toBe('completed');
  const filename = path.join(
    directory,
    (await fs.readdir(directory)).find((name) => name.endsWith('.outcome')),
  );
  const old = JSON.parse(await fs.readFile(filename, 'utf8'));
  old.schemaVersion = 1;
  await fs.writeFile(filename, JSON.stringify(old) + '\n');
  const reopened = await storage.createOperationLedger(directory);
  expect(await reopened.inspect(request.operationId)).toEqual({ state: 'unavailable' });
});
