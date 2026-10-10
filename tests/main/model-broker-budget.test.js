import { afterEach, expect, it } from 'vitest';
import {
  createModelFixture,
  INPUT,
  MODEL,
  OUTPUT,
} from '../../scripts/qualification/model-broker-fixture.mjs';
import { createModelOwner } from './fixtures/model-broker-owner.mjs';

const fixtures = [],
  owners = [];
const make = async (mode = 'json') => {
  const fixture = await createModelFixture({ mode });
  fixtures.push(fixture);
  const owner = await createModelOwner(fixture);
  owners.push(owner);
  const received = [];
  fixture.server.prependListener('request', (request) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    });
  });
  return { fixture, received, ...owner };
};
const prepare = (owner, maxOutputTokens) =>
  owner.prepare(undefined, Buffer.from(JSON.stringify({ ...INPUT, maxOutputTokens })));
const deliver = async (owner, request) => {
  expect(await owner.broker.request(request.capability, request.prepared)).toMatchObject({
    state: 'completed',
    text: OUTPUT,
    launchAllowed: false,
  });
};
const expectDeliveries = (owner, allowances) => {
  expect(owner.received).toEqual(
    allowances.map((max_output_tokens) => ({
      model: MODEL,
      messages: INPUT.messages,
      max_output_tokens,
    })),
  );
  expect(owner.fixture.state).toMatchObject({
    deliveries: allowances.length,
    authorized: allowances.length,
    spentBeforeDelivery: true,
  });
};
afterEach(async () => {
  for (const owner of owners) owner.close();
  owners.length = 0;
  for (const fixture of fixtures) await fixture.close();
  fixtures.length = 0;
});

it('admits exactly 1024 requested output tokens across retained requests, without replay or close refund', async () => {
  const owner = await make();
  const allowances = [256, 256, 256, 255, 1];
  const requests = allowances.slice(0, 4).map((allowance) => prepare(owner, allowance));
  expect(() => prepare(owner, 2)).toThrow('model-request-unavailable');
  requests.push(prepare(owner, 1));
  expect(() => prepare(owner, 1)).toThrow('model-request-unavailable');
  expectDeliveries(owner, []);
  for (const request of requests) await deliver(owner, request);
  expectDeliveries(owner, allowances);
  expect((await owner.broker.request(requests[0].capability, requests[0].prepared)).state).toBe(
    'refused',
  );
  expect(() => prepare(owner, 1)).toThrow('model-request-unavailable');
  owner.broker.close();
  expect(() => prepare(owner, 1)).toThrow('model-request-unavailable');
  expectDeliveries(owner, allowances);
});

it('refuses invalid and unsafe output allowances without changing the valid owner budget', async () => {
  const owner = await make();
  for (const allowance of [-1, 0, 1.5, 257, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE])
    expect(() => prepare(owner, allowance)).toThrow('model-request-unavailable');
  const allowances = [256, 256, 256, 255, 1];
  for (const allowance of allowances) await deliver(owner, prepare(owner, allowance));
  expect(() => prepare(owner, 1)).toThrow('model-request-unavailable');
  expectDeliveries(owner, allowances);
});

it('reserves synchronously when preparation calls are queued together at the exact bound', async () => {
  const owner = await make();
  const attempts = await Promise.allSettled(
    Array.from({ length: 5 }, () => Promise.resolve().then(() => prepare(owner, 256))),
  );
  expect(attempts.map((attempt) => attempt.status)).toEqual([
    'fulfilled',
    'fulfilled',
    'fulfilled',
    'fulfilled',
    'rejected',
  ]);
  expect(attempts[4].reason.message).toBe('model-request-unavailable');
  for (const attempt of attempts.slice(0, 4)) await deliver(owner, attempt.value);
  expectDeliveries(owner, [256, 256, 256, 256]);
});

it('charges fresh preparations for an already consumed operation without permitting another delivery', async () => {
  const owner = await make();
  const first = prepare(owner, 256);
  await deliver(owner, first);
  const replay = owner.prepare(
    first.id,
    Buffer.from(JSON.stringify({ ...INPUT, maxOutputTokens: 256 })),
  );
  expect((await owner.broker.request(replay.capability, replay.prepared)).state).toBe('refused');
  await deliver(owner, prepare(owner, 256));
  await deliver(owner, prepare(owner, 256));
  expect(() => prepare(owner, 1)).toThrow('model-request-unavailable');
  expectDeliveries(owner, [256, 256, 256]);
});

it.each(['cancel-before-delivery', 'cancel-after-delivery', 'lost-response'])(
  'keeps the full reservation after %s while later valid requests reach the receiver',
  async (mode) => {
    const owner = await make(
      mode === 'cancel-after-delivery' ? 'hang' : mode === 'lost-response' ? mode : 'json',
    );
    const request = prepare(owner, 256);
    const controller = new AbortController();
    let delivered;
    const started = new Promise((done) => {
      delivered = done;
    });
    owner.fixture.state.onDelivery = delivered;
    if (mode === 'cancel-before-delivery') controller.abort();
    const running = owner.broker.request(request.capability, request.prepared, {
      signal: controller.signal,
    });
    if (mode === 'cancel-after-delivery') {
      await started;
      controller.abort();
    }
    const result = await running;
    expect(result).not.toHaveProperty('text');
    expect(result.state).not.toBe('completed');
    const firstDeliveries = mode === 'cancel-before-delivery' ? [] : [256];
    expectDeliveries(owner, firstDeliveries);
    owner.fixture.state.mode = 'json';
    for (let i = 0; i < 3; i++) await deliver(owner, prepare(owner, 256));
    expect(() => prepare(owner, 1)).toThrow('model-request-unavailable');
    expect((await owner.broker.request(request.capability, request.prepared)).state).toBe(
      'refused',
    );
    expectDeliveries(owner, [...firstDeliveries, 256, 256, 256]);
  },
);

it('keeps prepared reservations after concurrent refusal and cancellation of the active exchange', async () => {
  const owner = await make('hang');
  const requests = Array.from({ length: 4 }, () => prepare(owner, 256));
  let delivered;
  const started = new Promise((done) => {
    delivered = done;
  });
  owner.fixture.state.onDelivery = delivered;
  const controller = new AbortController();
  const running = owner.broker.request(requests[0].capability, requests[0].prepared, {
    signal: controller.signal,
  });
  await started;
  expect((await owner.broker.request(requests[1].capability, requests[1].prepared)).state).toBe(
    'refused',
  );
  expect(owner.authority.signal(requests[0].capability).aborted).toBe(false);
  controller.abort();
  expect((await running).state).toBe('outcome-unknown');
  owner.fixture.state.mode = 'json';
  await deliver(owner, requests[2]);
  await deliver(owner, requests[3]);
  expect(() => prepare(owner, 1)).toThrow('model-request-unavailable');
  expectDeliveries(owner, [256, 256, 256]);
});
