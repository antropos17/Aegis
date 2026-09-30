import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const { createGatewayEvidence } = require('../../src/main/mcp-gateway-evidence');
it('emits immutable fixed codes with owner UUID and monotonic sequence', async () => {
  const events = [],
    observer = createGatewayEvidence((event) => events.push(event)),
    id = randomUUID();
  observer.emit('consumed', id);
  observer.emit('dispatch', id);
  observer.emit('completed', id);
  expect(events.map((e) => e.seq)).toEqual([0, 1, 2]);
  expect(Object.isFrozen(events[0])).toBe(true);
  expect(await observer.finish()).toMatchObject({ emitted: 3, lost: 0, pending: 0, sealed: true });
  observer.emit('failed', id);
  expect(observer.status().lost).toBe(1);
});
it.each(['throw', 'reject'])(
  'records %s observer loss without throwing into gateway control flow',
  async (mode) => {
    const observer = createGatewayEvidence(() => {
      if (mode === 'throw') throw Error('private');
      return Promise.reject(Error('private'));
    });
    observer.emit('consumed', randomUUID());
    expect((await observer.finish()).lost).toBe(1);
    expect(JSON.stringify(observer.status())).not.toContain('private');
  },
);
it('bounds unresolved observers and accounts rejection after finalization exactly once', async () => {
  let reject;
  const observer = createGatewayEvidence(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  observer.emit('consumed', randomUUID());
  const started = Date.now(),
    result = await observer.finish();
  expect(Date.now() - started).toBeLessThan(1500);
  expect(result).toMatchObject({ lost: 1, pending: 1, sealed: true });
  reject(Error('late'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(observer.status()).toMatchObject({ lost: 1, pending: 0 });
});
it('bounds advisory counters and disables events when no owner callback is supplied', () => {
  const observer = createGatewayEvidence(() => {});
  for (let i = 0; i < 300; i++) observer.emit('dispatch', randomUUID());
  expect(observer.status()).toMatchObject({ emitted: 256, lost: 44 });
  const disabled = createGatewayEvidence();
  disabled.emit('dispatch', randomUUID());
  expect(disabled.status()).toMatchObject({ enabled: false, emitted: 0 });
});
