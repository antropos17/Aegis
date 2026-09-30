import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import {
  createModelFixture,
  INPUT,
  OUTPUT,
} from '../../scripts/qualification/model-broker-fixture.mjs';
import { createModelOwner } from './fixtures/model-broker-owner.mjs';
const fixtures = [],
  owners = [];
const make = async (options, wrap) => {
  const fixture = await createModelFixture(options);
  fixtures.push(fixture);
  const owner = await createModelOwner(fixture, wrap);
  owners.push(owner);
  return { fixture, ...owner };
};
afterEach(async () => {
  for (const owner of owners) owner.close();
  owners.length = 0;
  for (const fixture of fixtures) await fixture.close();
  fixtures.length = 0;
  vi.useRealTimers();
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

it.each(['json', 'sse'])(
  'releases scanned %s text after durable completion, with one delivery and no replay',
  async (mode) => {
    const owner = await make({ mode });
    const { prepared, capability, id } = owner.prepare();
    expect(await owner.broker.request(capability, prepared)).toMatchObject({
      state: 'completed',
      text: OUTPUT,
      launchAllowed: false,
    });
    expect(await owner.ledger.inspect(id)).toEqual({ state: 'completed' });
    expect((await owner.broker.request(capability, prepared)).state).toBe('refused');
    expect(owner.fixture.state).toMatchObject({
      deliveries: 1,
      authorized: 1,
      requestMatches: true,
      spentBeforeDelivery: true,
    });
  },
);

it.each([
  'oversized',
  'oversized-headers',
  'duplicate-header',
  'compressed',
  'bad-utf8',
  'wrong-model',
  'incomplete',
  'sse-truncated',
  'sse-reordered',
  'sse-after-complete',
  'secret-raw',
  'secret-base64',
  'secret-base64url',
  'secret-hex',
  'secret-percent',
  'secret-json-escaped',
  'sse-secret-chunks',
  'sse-secret-base64',
  'lost-response',
])('withholds %s output and never retries after reconnect', async (mode) => {
  const owner = await make({ mode });
  const { prepared, capability, id } = owner.prepare();
  const result = await owner.broker.request(capability, prepared);
  expect(result).toEqual({ schemaVersion: 1, state: 'outcome-unknown', launchAllowed: false });
  expect(JSON.stringify(result)).not.toContain(owner.fixture.token);
  owner.close();
  const next = await createModelOwner(owner.fixture);
  owners.push(next);
  const retry = next.prepare(id);
  expect((await next.broker.request(retry.capability, retry.prepared)).state).toBe('refused');
  expect(owner.fixture.state.deliveries).toBe(1);
});

it('pins copied bytes and refuses prepared/capability substitution', async () => {
  const owner = await make({});
  const bytes = Buffer.from(JSON.stringify(INPUT));
  const a = owner.prepare(undefined, bytes);
  bytes.fill(0);
  expect(Object.isFrozen(a.prepared)).toBe(true);
  expect(Object.isFrozen(a.prepared.binding)).toBe(true);
  const b = owner.prepare();
  expect((await owner.broker.request(a.capability, b.prepared)).state).toBe('refused');
  expect(owner.fixture.state.deliveries).toBe(0);
  const c = owner.prepare(undefined, Buffer.from(JSON.stringify(INPUT)));
  expect((await owner.broker.request(c.capability, c.prepared)).text).toBe(OUTPUT);
  expect(owner.fixture.state.requestMatches).toBe(true);
});

it('dispatches the private copied request after the caller overwrites its original bytes', async () => {
  const owner = await make({});
  const bytes = Buffer.from(JSON.stringify(INPUT));
  const a = owner.prepare(undefined, bytes);
  bytes.fill(0);
  expect((await owner.broker.request(a.capability, a.prepared)).text).toBe(OUTPUT);
  expect(owner.fixture.state).toMatchObject({ requestMatches: true, deliveries: 1, authorized: 1 });
});

it('enforces lifetime preparation quotas without refund and rejects closed retained requests', async () => {
  const owner = await make({});
  const retained = [];
  for (let i = 0; i < 16; i++) retained.push(owner.prepare());
  expect(() => owner.prepare()).toThrow('model-request-unavailable');
  owner.broker.close();
  const a = retained[0];
  expect((await owner.broker.request(a.capability, a.prepared)).state).toBe('refused');
  expect(owner.fixture.state.deliveries).toBe(0);
});

it.each(['model', 'tools', 'quota', 'credential'])(
  'refuses %s request expansion before delivery',
  async (mode) => {
    const owner = await make({});
    const value = {
      messages: INPUT.messages,
      maxOutputTokens: mode === 'quota' ? 257 : 32,
      ...(mode === 'model' ? { model: 'other-model' } : {}),
      ...(mode === 'tools' ? { tools: [] } : {}),
    };
    if (mode === 'credential') value.messages = [{ role: 'user', content: owner.fixture.token }];
    expect(() => owner.prepare(undefined, Buffer.from(JSON.stringify(value)))).toThrow(
      'model-request-unavailable',
    );
    expect(owner.fixture.state.deliveries).toBe(0);
  },
);

it.each(['route', 'credential', 'revoke', 'cancel', 'persist'])(
  'dispatches zero requests after %s invalidation',
  async (mode) => {
    const owner = await make(
      {},
      mode === 'persist'
        ? (ledger) => ({
            ...ledger,
            consume: async () => {
              throw Error('injected');
            },
          })
        : undefined,
    );
    const a = owner.prepare();
    const controller = new AbortController();
    if (mode === 'route') await fs.appendFile(owner.fixture.endpointPath, ' ');
    if (mode === 'credential')
      await fs.writeFile(
        owner.fixture.endpointPath,
        JSON.stringify({ ...owner.fixture.descriptor, bearerToken: 'A'.repeat(64) }),
      );
    if (mode === 'revoke') owner.authority.revoke();
    if (mode === 'cancel') controller.abort();
    const result = await owner.broker.request(a.capability, a.prepared, {
      signal: controller.signal,
    });
    expect(result).not.toHaveProperty('text');
    expect(result.state).not.toBe('completed');
    expect(owner.fixture.state.deliveries).toBe(0);
  },
);

it('refuses another simultaneous attempt without aborting the first', async () => {
  const owner = await make({ mode: 'hang' });
  const started = deferred();
  owner.fixture.state.onDelivery = () => started.resolve();
  const a = owner.prepare(),
    b = owner.prepare();
  const running = owner.broker.request(a.capability, a.prepared);
  await started.promise;
  expect((await owner.broker.request(b.capability, b.prepared)).state).toBe('refused');
  expect((await owner.broker.request(a.capability, a.prepared)).state).toBe('refused');
  expect(owner.authority.signal(a.capability).aborted).toBe(false);
  owner.broker.close();
  expect(await running).toEqual({
    schemaVersion: 1,
    state: 'outcome-unknown',
    launchAllowed: false,
  });
  expect(owner.fixture.state.deliveries).toBe(1);
});

it('bounds a missing response by the three-second exchange deadline', async () => {
  vi.useFakeTimers();
  const owner = await make({ mode: 'hang' });
  const started = deferred();
  owner.fixture.state.onDelivery = () => started.resolve();
  const a = owner.prepare();
  const running = owner.broker.request(a.capability, a.prepared);
  await started.promise;
  await vi.advanceTimersByTimeAsync(3001);
  expect(await running).toEqual({
    schemaVersion: 1,
    state: 'outcome-unknown',
    launchAllowed: false,
  });
  expect(owner.fixture.state.deliveries).toBe(1);
});

it('expires unused prepared state at the owner lifetime without dispatch', async () => {
  vi.useFakeTimers();
  const owner = await make({});
  const a = owner.prepare();
  await vi.advanceTimersByTimeAsync(60001);
  expect((await owner.broker.request(a.capability, a.prepared)).state).toBe('refused');
  expect(() => owner.prepare()).toThrow('model-request-unavailable');
  expect(owner.fixture.state.deliveries).toBe(0);
});
