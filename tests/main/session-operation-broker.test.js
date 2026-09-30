import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const session = require('../../src/main/session-authority');
const storage = require('../../src/main/operation-ledger');
const { createSessionOperationBroker } = require('../../src/main/session-operation-broker');
let directory;
const owners = [];
const context = {
  sessionId: 'a'.repeat(32),
  epoch: 'b'.repeat(32),
  policyRevision: 'c'.repeat(64),
};
const operation = () => ({
  operationId: randomBytes(16).toString('hex'),
  operation: 'dummy-edit',
  request: Buffer.from('private request canary'),
  snapshot: Buffer.from('private snapshot canary'),
});
const hash = (value) => createHash('sha256').update(value).digest('hex');
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-operation-')));
});
afterEach(async () => {
  for (const owner of owners) owner.revoke();
  owners.length = 0;
  storage._resetForTest();
  session._resetForTest();
  vi.useRealTimers();
  if (
    path.basename(directory).startsWith('aegis-operation-') &&
    !(await fs.lstat(directory)).isSymbolicLink()
  )
    await fs.rm(directory, { recursive: true, force: true });
});

async function setup(callback, ledgerOverride, scope = context) {
  const authority = session.createSessionAuthority(scope, { operations: ['dummy-edit'] });
  owners.push(authority);
  const ledger = await storage.createOperationLedger(directory);
  const broker = createSessionOperationBroker({
    authority,
    ledger: ledgerOverride?.(ledger) || ledger,
    dispatchers: { 'dummy-edit': callback },
  });
  const issue = (request, outcome = { decision: 'allow' }, options = {}) =>
    authority.issue(
      {
        operationId: request.operationId,
        operation: request.operation,
        requestDigest: hash(request.request),
        snapshotDigest: hash(request.snapshot),
        expiresAt: Date.now() + 30000,
      },
      outcome,
      options,
    );
  return { authority, ledger, broker, issue };
}

describe('durable bound session-operation dispatch', () => {
  it('persists the irreversible attempt before invoking the effect callback', async () => {
    let persistedBeforeEffect = false;
    let effects = 0;
    const owner = await setup(async () => {
      const name = (await fs.readdir(directory)).find((entry) => entry.endsWith('.spent'));
      persistedBeforeEffect =
        name && JSON.parse(await fs.readFile(path.join(directory, name))).state === 'consumed';
      effects++;
      return { status: 'completed', ignoredPrivateText: 'never export this' };
    });
    const request = operation();
    expect(await owner.broker.dispatch(owner.issue(request), request)).toEqual({
      schemaVersion: 1,
      state: 'completed',
      launchAllowed: false,
    });
    expect(effects).toBe(1);
    expect(persistedBeforeEffect).toBe(true);
    expect(await owner.ledger.inspect(request.operationId)).toEqual({ state: 'completed' });
    for (const name of await fs.readdir(directory)) {
      const bytes = await fs.readFile(path.join(directory, name), 'utf8');
      expect(bytes).not.toMatch(/private|never export|dummy-edit/);
    }
  });

  it.each([
    'forged',
    'request',
    'snapshot',
    'operationId',
    'operation',
    'revoked',
    'cancelled',
    'pre-abort',
    'restart',
    'foreign-epoch',
    'foreign-policy',
  ])('dispatches zero callbacks for %s authority', async (mode) => {
    let effects = 0;
    const owner = await setup(() => {
      effects++;
      return { status: 'completed' };
    });
    const request = operation();
    let capability = owner.issue(request);
    let broker = owner.broker;
    const signal = new AbortController();
    if (mode === 'forged') capability = Object.freeze({});
    if (mode === 'request' || mode === 'snapshot') request[mode] = Buffer.from('substitution');
    if (mode === 'operationId') request.operationId = 'd'.repeat(32);
    if (mode === 'operation') request.operation = 'other-op';
    if (mode === 'revoked') owner.authority.revoke();
    if (mode === 'cancelled') owner.authority.cancel(capability);
    if (mode === 'pre-abort') signal.abort();
    if (['restart', 'foreign-epoch', 'foreign-policy'].includes(mode)) {
      const scope = {
        ...context,
        ...(mode === 'foreign-epoch' ? { epoch: 'd'.repeat(32) } : {}),
        ...(mode === 'foreign-policy' ? { policyRevision: 'd'.repeat(64) } : {}),
      };
      broker = (
        await setup(
          () => {
            effects++;
          },
          null,
          scope,
        )
      ).broker;
    }
    expect((await broker.dispatch(capability, request, { signal: signal.signal })).state).toBe(
      'refused',
    );
    expect(effects).toBe(0);
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it('never mints a deny or an unapproved ask; existing ask outcomes need explicit approval', async () => {
    let effects = 0;
    const owner = await setup(() => {
      effects++;
      return { status: 'completed' };
    });
    const request = operation();
    expect(() => owner.issue(request, { decision: 'deny' }, { approved: true })).toThrow();
    expect(() => owner.issue(request, { decision: 'ask' })).toThrow();
    expect(effects).toBe(0);
    expect(
      (
        await owner.broker.dispatch(
          owner.issue(request, { decision: 'ask' }, { approved: true }),
          request,
        )
      ).state,
    ).toBe('completed');
    expect(effects).toBe(1);
  });

  it('allows exactly one concurrent dispatch and refuses consumed IDs after a fresh owner/ledger', async () => {
    let effects = 0;
    const owner = await setup(() => {
      effects++;
      return { status: 'completed' };
    });
    const request = operation();
    const capability = owner.issue(request);
    const replies = await Promise.all([
      owner.broker.dispatch(capability, request),
      owner.broker.dispatch(capability, request),
    ]);
    expect(replies.map((reply) => reply.state).sort()).toEqual(['completed', 'refused']);
    expect(effects).toBe(1);
    const restarted = await setup(() => {
      effects++;
    });
    expect((await restarted.broker.dispatch(capability, request)).state).toBe('refused');
    expect((await restarted.broker.dispatch(restarted.issue(request), request)).state).toBe(
      'refused',
    );
    expect(effects).toBe(1);
  });

  it.each(['throw', 'missing-reply', 'revoke-running', 'settle-failure'])(
    'retains unknown one-attempt outcomes after %s without retrying',
    async (mode) => {
      let effects = 0;
      const started = deferred();
      let receivedSignal;
      const owner = await setup(
        ({ signal }) => {
          effects++;
          receivedSignal = signal;
          started.resolve();
          if (mode === 'throw') throw Error('private callback error');
          if (mode === 'missing-reply') return undefined;
          if (mode === 'revoke-running') return new Promise(() => {});
          return { status: 'completed' };
        },
        mode === 'settle-failure'
          ? (ledger) => ({
              ...ledger,
              settle: async () => {
                throw Error('private disk error');
              },
            })
          : null,
      );
      const request = operation(),
        capability = owner.issue(request);
      const pending = owner.broker.dispatch(capability, request);
      await started.promise;
      if (mode === 'revoke-running') owner.authority.revoke();
      expect((await pending).state).toBe('outcome-unknown');
      expect(receivedSignal.aborted).toBe(true);
      expect(await owner.ledger.inspect(request.operationId)).toEqual({ state: 'outcome-unknown' });
      const restarted = await setup(() => {
        effects++;
      });
      expect((await restarted.broker.dispatch(restarted.issue(request), request)).state).toBe(
        'refused',
      );
      expect(effects).toBe(1);
    },
  );

  it.each(['open', 'write', 'sync', 'close'])(
    'dispatches zero effects on actual ledger %s failure',
    async (mode) => {
      storage._setDepsForTest({
        fs: {
          ...fs,
          open: async (...args) => {
            if (String(args[0]).endsWith('.spent') && mode === 'open')
              throw Error('private disk error');
            const handle = await fs.open(...args);
            if (!String(args[0]).endsWith('.spent')) return handle;
            return {
              stat: (...params) => handle.stat(...params),
              read: (...params) => handle.read(...params),
              write: (...params) =>
                mode === 'write' ? Promise.resolve({ bytesWritten: 0 }) : handle.write(...params),
              sync: () =>
                mode === 'sync' ? Promise.reject(Error('private sync error')) : handle.sync(),
              close: async () => {
                await handle.close();
                if (mode === 'close') throw Error('private close error');
              },
            };
          },
        },
      });
      let effects = 0;
      const owner = await setup(() => {
        effects++;
      });
      const request = operation(),
        capability = owner.issue(request);
      expect((await owner.broker.dispatch(capability, request)).state).toBe('refused');
      expect((await owner.broker.dispatch(capability, request)).state).toBe('refused');
      expect(effects).toBe(0);
    },
  );
});
