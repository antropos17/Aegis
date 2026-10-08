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

describe('session-operation lifetime races', () => {
  it.each(['revoke', 'cancel', 'expire'])(
    'rechecks %s after the final consumed-record observation',
    async (mode) => {
      let effects = 0;
      let time = Date.now();
      session._setDepsForTest({ now: () => time });
      const entered = deferred();
      const release = deferred();
      const owner = await setup(
        () => {
          effects++;
        },
        (ledger) => ({
          ...ledger,
          recheckConsumption: async (...args) => {
            await ledger.recheckConsumption(...args);
            entered.resolve();
            await release.promise;
          },
        }),
      );
      const request = operation();
      const capability = owner.issue(request);
      const controller = new AbortController();
      const pending = owner.broker.dispatch(capability, request, { signal: controller.signal });
      await entered.promise;
      if (mode === 'revoke') owner.authority.revoke();
      if (mode === 'cancel') controller.abort();
      if (mode === 'expire') time += 60000;
      release.resolve();
      expect((await pending).state).toBe('refused');
      expect(effects).toBe(0);
      expect(await owner.ledger.inspect(request.operationId)).toEqual({ state: 'not-dispatched' });
    },
  );

  it.each(['revoke', 'cancel', 'expire'])(
    'rechecks %s while persistence is pending and dispatches zero effects',
    async (mode) => {
      let effects = 0;
      let time = Date.now();
      session._setDepsForTest({ now: () => time });
      const entered = deferred(),
        release = deferred();
      const owner = await setup(
        () => {
          effects++;
        },
        (ledger) => ({
          ...ledger,
          consume: async (binding) => {
            const reservation = await ledger.consume(binding);
            entered.resolve();
            await release.promise;
            return reservation;
          },
        }),
      );
      const request = operation();
      const capability = owner.issue(request);
      const controller = new AbortController();
      const pending = owner.broker.dispatch(capability, request, { signal: controller.signal });
      await entered.promise;
      if (mode === 'revoke') owner.authority.revoke();
      if (mode === 'cancel') controller.abort();
      if (mode === 'expire') time += 60000;
      release.resolve();
      expect((await pending).state).toBe('refused');
      expect(effects).toBe(0);
      expect(await owner.ledger.inspect(request.operationId)).toEqual({ state: 'not-dispatched' });
    },
  );

  it('owns exact bytes before awaiting persistence', async () => {
    const entered = deferred(),
      release = deferred();
    let observed;
    const owner = await setup(
      ({ request, snapshot }) => {
        observed = [request.toString(), snapshot.toString()];
        return { status: 'completed' };
      },
      (ledger) => ({
        ...ledger,
        consume: async (binding) => {
          entered.resolve();
          await release.promise;
          return ledger.consume(binding);
        },
      }),
    );
    const request = operation();
    const capability = owner.issue(request);
    const pending = owner.broker.dispatch(capability, request);
    await entered.promise;
    request.request.fill(0);
    request.snapshot.fill(0);
    request.operation = 'other-op';
    release.resolve();
    expect((await pending).state).toBe('completed');
    expect(observed).toEqual(['private request canary', 'private snapshot canary']);
  });

  it('bounds an abort-ignoring dispatcher by the actual expiry signal and preserves unknown outcome', async () => {
    vi.useFakeTimers();
    const started = deferred();
    let effects = 0,
      receivedSignal;
    const owner = await setup(({ signal }) => {
      receivedSignal = signal;
      effects++;
      started.resolve();
      return new Promise(() => {});
    });
    const request = operation(),
      capability = owner.issue(request);
    const pending = owner.broker.dispatch(capability, request);
    await started.promise;
    await vi.advanceTimersByTimeAsync(30001);
    expect((await pending).state).toBe('outcome-unknown');
    expect(receivedSignal.aborted).toBe(true);
    expect(effects).toBe(1);
    expect(await owner.ledger.inspect(request.operationId)).toEqual({ state: 'outcome-unknown' });
  });

  it('keeps the terminal decision when cancellation arrives after publication', async () => {
    const written = deferred(),
      release = deferred();
    let effects = 0;
    const owner = await setup(
      () => {
        effects++;
        return { status: 'completed' };
      },
      (ledger) => ({
        ...ledger,
        settle: async (binding, state, options) => {
          const result = await ledger.settle(binding, state, options);
          if (state === 'completed') {
            written.resolve();
            await release.promise;
          }
          return result;
        },
      }),
    );
    const request = operation(),
      capability = owner.issue(request);
    const pending = owner.broker.dispatch(capability, request);
    await written.promise;
    owner.authority.revoke();
    release.resolve();
    expect((await pending).state).toBe('completed');
    expect(await owner.ledger.inspect(request.operationId)).toEqual({ state: 'completed' });
    expect(effects).toBe(1);
  });
});
