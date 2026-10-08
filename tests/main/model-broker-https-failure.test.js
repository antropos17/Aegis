import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import {
  createModelFixture,
  INPUT,
  MODEL,
  OUTPUT,
} from '../../scripts/qualification/model-broker-fixture.mjs';
import { createModelOwner } from './fixtures/model-broker-owner.mjs';

const fixtures = [],
  owners = [];
const unknown = { schemaVersion: 1, state: 'outcome-unknown', launchAllowed: false };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
afterEach(async () => {
  for (const owner of owners.splice(0)) owner.close();
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

// The real HTTPS listener uses only checked-in fixture certificates and its own
// descriptor CA. No global trust or authentication setting is modified.
async function make(reply) {
  const fixture = await createModelFixture({ secure: true });
  fixtures.push(fixture);
  const delivered = deferred(),
    disconnected = deferred();
  const state = { deliveries: 0, authorized: 0, requestMatches: true, spentBeforeDelivery: true };
  fixture.server.removeAllListeners('request');
  fixture.server.on('request', async (request, response) => {
    response.on('error', () => {});
    response.on('close', disconnected.resolve);
    try {
      state.deliveries++;
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        if ((size += chunk.length) > 16384) throw Error('fixture-limit');
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      state.authorized += Number(request.headers.authorization === `Bearer ${fixture.token}`);
      state.requestMatches &&=
        request.method === 'POST' &&
        request.url === '/model' &&
        body.toString() ===
          JSON.stringify({
            model: MODEL,
            messages: INPUT.messages,
            max_output_tokens: INPUT.maxOutputTokens,
          });
      body.fill(0);
      state.spentBeforeDelivery &&= (await fs.readdir(fixture.ledgerPath)).some((name) =>
        name.endsWith('.spent'),
      );
      reply(response, fixture);
      delivered.resolve();
    } catch {
      response.destroy();
    }
  });
  const owner = await createModelOwner(fixture);
  owners.push(owner);
  return {
    fixture,
    ...owner,
    state,
    delivered: delivered.promise,
    disconnected: disconnected.promise,
  };
}
async function soon(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve('still-waiting'), 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

it('closes a rejected HTTPS response at headers while its body remains open', async () => {
  const owner = await make((response) => {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.flushHeaders();
    // Intentionally no body/end: rejection must not wait for the body deadline.
  });
  const attempt = owner.prepare();
  const running = owner.broker.request(attempt.capability, attempt.prepared);
  await owner.delivered;
  expect(await soon(running)).toEqual(unknown);
  expect(await soon(owner.disconnected)).not.toBe('still-waiting');
  expect(owner.state).toEqual({
    deliveries: 1,
    authorized: 1,
    requestMatches: true,
    spentBeforeDelivery: true,
  });
  expect(await owner.ledger.inspect(attempt.id)).toEqual({ state: 'outcome-unknown' });
});

it.each([
  ['missing-type', 200, []],
  ['wrong-type', 200, [['Content-Type', 'text/plain']]],
  [
    'duplicate-type',
    200,
    [
      ['Content-Type', 'application/json'],
      ['Content-Type', 'application/json'],
    ],
  ],
  [
    'compression',
    200,
    [
      ['Content-Type', 'application/json'],
      ['Content-Encoding', 'gzip'],
    ],
  ],
  ['server-error', 500, [['Content-Type', 'application/json']]],
])(
  'rejects HTTPS %s headers without consuming an open error body',
  async (_mode, status, headers) => {
    const owner = await make((response, fixture) => {
      response.writeHead(status, headers);
      response.flushHeaders();
      response.write(fixture.token); // Error text is private upstream data, never output.
    });
    const attempt = owner.prepare();
    const running = owner.broker.request(attempt.capability, attempt.prepared);
    await owner.delivered;
    expect(await soon(running)).toEqual(unknown);
    expect(await soon(owner.disconnected)).not.toBe('still-waiting');
    expect(owner.state.authorized).toBe(1);
    expect((await owner.broker.request(attempt.capability, attempt.prepared)).state).toBe(
      'refused',
    );
    expect(owner.state.deliveries).toBe(1);
    for (const name of await fs.readdir(owner.fixture.ledgerPath)) {
      expect((await fs.readFile(`${owner.fixture.ledgerPath}/${name}`)).toString()).not.toContain(
        owner.fixture.token,
      );
    }
  },
);

it.each([301, 302, 303, 307, 308])(
  'closes HTTPS %s redirects without contacting the independent destination',
  async (status) => {
    const target = await createModelFixture({ secure: true });
    fixtures.push(target);
    const owner = await make((response) => {
      response.writeHead(status, {
        'content-type': 'application/json',
        location: target.descriptor.url,
      });
      response.flushHeaders();
    });
    const attempt = owner.prepare();
    const running = owner.broker.request(attempt.capability, attempt.prepared);
    await owner.delivered;
    expect(await soon(running)).toEqual(unknown);
    expect(await soon(owner.disconnected)).not.toBe('still-waiting');
    expect(owner.state).toMatchObject({ deliveries: 1, authorized: 1, requestMatches: true });
    expect(target.state).toMatchObject({ connections: 0, deliveries: 0, authorized: 0 });
  },
);

it.each(['revoke', 'cancel', 'close'])(
  'destroys an in-flight HTTPS socket after %s and retains consumption across a fresh owner',
  async (action) => {
    const owner = await make((response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"model":"dummy-text-model","output":"partial');
    });
    const controller = new AbortController();
    const attempt = owner.prepare();
    const running = owner.broker.request(attempt.capability, attempt.prepared, {
      signal: controller.signal,
    });
    await owner.delivered;
    if (action === 'revoke') owner.authority.revoke();
    if (action === 'cancel') controller.abort();
    if (action === 'close') owner.broker.close();
    expect(await soon(running)).toEqual(unknown);
    expect(await soon(owner.disconnected)).not.toBe('still-waiting');
    expect(await owner.ledger.inspect(attempt.id)).toEqual({ state: 'outcome-unknown' });
    owner.close();
    const next = await createModelOwner(owner.fixture);
    owners.push(next);
    const retry = next.prepare(attempt.id);
    expect((await next.broker.request(retry.capability, retry.prepared)).state).toBe('refused');
    expect(owner.state.deliveries).toBe(1);
  },
);

it.each(['destination', 'credential'])(
  'delivers zero HTTPS requests after a captured %s changes',
  async (field) => {
    const target = await createModelFixture({ secure: true });
    fixtures.push(target);
    const owner = await make((response) => response.end());
    const attempt = owner.prepare();
    await fs.writeFile(
      owner.fixture.endpointPath,
      JSON.stringify({
        ...owner.fixture.descriptor,
        ...(field === 'destination'
          ? { url: target.descriptor.url }
          : { bearerToken: target.token }),
      }),
    );
    expect(await owner.broker.request(attempt.capability, attempt.prepared)).toEqual(unknown);
    expect(owner.state.deliveries).toBe(0);
    expect(owner.fixture.state.connections).toBe(0);
    expect(target.state).toMatchObject({ connections: 0, deliveries: 0, authorized: 0 });
  },
);

it.each(['json', 'sse'])(
  'retains accepted finite HTTPS %s content and never retries a completion',
  async (mode) => {
    const owner = await make((response) => {
      const json = JSON.stringify({ model: MODEL, output: OUTPUT, finishReason: 'stop' });
      const stream = `event: start\ndata: ${JSON.stringify({ model: MODEL })}\n\nevent: delta\ndata: ${JSON.stringify({ text: OUTPUT })}\n\nevent: complete\ndata: {"finishReason":"stop"}\n\n`;
      response.writeHead(200, {
        'content-type':
          mode === 'json' ? 'application/json; charset=utf-8' : 'text/event-stream; charset=utf-8',
      });
      response.end(mode === 'json' ? json : stream);
    });
    const attempt = owner.prepare();
    expect(await owner.broker.request(attempt.capability, attempt.prepared)).toMatchObject({
      state: 'completed',
      text: OUTPUT,
      launchAllowed: false,
    });
    expect(await owner.ledger.inspect(attempt.id)).toEqual({ state: 'completed' });
    expect(owner.state).toEqual({
      deliveries: 1,
      authorized: 1,
      requestMatches: true,
      spentBeforeDelivery: true,
    });
    expect((await owner.broker.request(attempt.capability, attempt.prepared)).state).toBe(
      'refused',
    );
  },
);
