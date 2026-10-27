import { expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
const require = createRequire(import.meta.url);
const { createGatewayOutcomeReporter, LIMITS } = require('../../src/main/mcp-gateway-outcomes');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const event = (seq, code, operationId = A) => ({ schemaVersion: 1, seq, code, operationId });
const evidence = (emitted, changes = {}) => ({
  enabled: true,
  emitted,
  lost: 0,
  pending: 0,
  sealed: true,
  ...changes,
});
function fixture(write) {
  const output = new EventEmitter();
  let text = '';
  output.write =
    write ||
    ((value, cb) => {
      text += value;
      queueMicrotask(() => cb());
      return true;
    });
  const onFailure = vi.fn();
  const reporter = createGatewayOutcomeReporter({ output, onFailure });
  return { output, reporter, onFailure, text: () => text };
}

it('reports accepted responses and dispatch attempts without making effect or delivery claims', async () => {
  const f = fixture();
  f.reporter.onEvidence(event(0, 'consumed'));
  f.reporter.onEvidence(event(1, 'dispatch'));
  f.reporter.onEvidence(event(2, 'completed'));
  f.reporter.onEvidence(event(3, 'consumed', B));
  f.reporter.onEvidence(event(4, 'dispatch', B));
  f.reporter.onEvidence(event(5, 'failed', B));
  expect(await f.reporter.finish(evidence(6), true)).toMatchObject({
    incomplete: false,
    sealed: true,
    pending: 0,
  });
  expect(f.text()).toContain(`Attempt ${A}: Upstream response accepted; effect unverified.`);
  expect(f.text()).toContain(`Attempt ${B}: Dispatch attempted; outcome unknown.`);
  expect(f.text()).toContain('per-attempt, not a stable operation ID');
  expect(f.text()).toContain('No automatic retry');
  expect(f.text()).toContain('Fresh approval does not prevent duplicate effects');
  expect(f.text()).toContain('Idempotency and reconciliation are unsupported');
});

it.each([
  ['clean', evidence(2), true, true],
  ['unconfirmed cleanup', evidence(2), false, false],
  ['lost evidence', evidence(2, { lost: 1 }), true, false],
  ['unfinished consumer', evidence(2, { pending: 1 }), true, false],
  ['wrong count', evidence(3), true, false],
  ['unsealed evidence', evidence(2, { sealed: false }), true, false],
])('classifies pre-dispatch failure only after %s', async (_name, status, clean, expected) => {
  const f = fixture();
  f.reporter.onEvidence(event(0, 'consumed'));
  f.reporter.onEvidence(event(1, 'failed'));
  expect(f.text()).toBe('');
  const final = await f.reporter.finish(status, clean);
  expect(f.text().includes('Not dispatched by this gateway.')).toBe(expected);
  if (!expected) {
    expect(final.incomplete).toBe(true);
    expect(f.text()).toContain('Outcome evidence is incomplete');
  }
});

it('never interprets missing, invalid or out-of-order evidence as not dispatched', async () => {
  const f = fixture();
  f.reporter.onEvidence(event(0, 'failed'));
  f.reporter.onEvidence({ ...event(2, 'dispatch', B), privateCanary: 'PRIVATE_SECRET_847' });
  const final = await f.reporter.finish(evidence(3), true);
  expect(final.incomplete).toBe(true);
  expect(f.text()).not.toContain('Not dispatched by this gateway');
  expect(f.text()).not.toContain('PRIVATE_SECRET_847');
  expect(f.text()).toContain('Outcome unknown; evidence is incomplete.');
});

it('reports an unfinished dispatch as unknown and marks final evidence incomplete', async () => {
  const f = fixture();
  f.reporter.onEvidence(event(0, 'consumed'));
  f.reporter.onEvidence(event(1, 'dispatch'));
  const final = await f.reporter.finish(evidence(2), true);
  expect(final.incomplete).toBe(true);
  expect(f.text()).toContain('Dispatch attempted; outcome unknown.');
  expect(f.text()).toContain('Outcome evidence is incomplete');
});

it('blocks further writes synchronously before an owner prompt and waits for the active write', async () => {
  const writes = [],
    callbacks = [];
  const f = fixture((value, cb) => {
    writes.push(value);
    callbacks.push(cb);
    return true;
  });
  f.reporter.onEvidence(event(0, 'dispatch'));
  f.reporter.onEvidence(event(1, 'completed'));
  expect(writes).toHaveLength(1);
  const paused = f.reporter.pauseBeforePrompt();
  expect(f.reporter.status().paused).toBe(true);
  f.reporter.onEvidence(event(2, 'dispatch', B));
  f.reporter.onEvidence(event(3, 'failed', B));
  expect(writes).toHaveLength(1);
  callbacks.shift()();
  expect(await paused).toBe(true);
  expect(writes).toHaveLength(1);
  f.reporter.resumeAfterPrompt();
  expect(writes).toHaveLength(2);
  callbacks.shift()();
  expect(await f.reporter.finish(evidence(4), true)).toMatchObject({
    incomplete: false,
    pending: 0,
  });
});

it.each(['throw', 'callback', 'timeout'])(
  'aborts once and reports incomplete when a terminal write has %s failure',
  async (kind) => {
    const f = fixture((_value, cb) => {
      if (kind === 'throw') throw Error('PRIVATE_ERROR');
      if (kind === 'callback') queueMicrotask(() => cb(Error('PRIVATE_ERROR')));
      return true;
    });
    f.reporter.onEvidence(event(0, 'dispatch'));
    f.reporter.onEvidence(event(1, 'completed'));
    const start = Date.now();
    const final = await f.reporter.finish(evidence(2), true);
    expect(Date.now() - start).toBeLessThan(2500);
    expect(final).toMatchObject({ broken: true, incomplete: true });
    expect(f.onFailure).toHaveBeenCalledOnce();
    expect(JSON.stringify(final)).not.toContain('PRIVATE_ERROR');
  },
);

it('bounds stalled prompts and queued output during finalization', async () => {
  const f = fixture();
  expect(await f.reporter.pauseBeforePrompt()).toBe(true);
  for (let i = 0; i < LIMITS.queued + 1; i++) {
    const id = `33333333-3333-4333-8333-${i.toString(16).padStart(12, '0')}`;
    f.reporter.onEvidence(event(i * 2, 'dispatch', id));
    f.reporter.onEvidence(event(i * 2 + 1, 'failed', id));
  }
  const final = await f.reporter.finish(evidence((LIMITS.queued + 1) * 2), true);
  expect(final).toMatchObject({ incomplete: true, broken: true });
  expect(f.onFailure).toHaveBeenCalledOnce();
});

it('bounds a paused finalization even if the wall clock does not advance', async () => {
  const f = fixture();
  const wallClock = vi.spyOn(Date, 'now').mockReturnValue(1);
  try {
    expect(await f.reporter.pauseBeforePrompt()).toBe(true);
    f.reporter.onEvidence(event(0, 'dispatch'));
    f.reporter.onEvidence(event(1, 'failed'));
    const started = performance.now();
    const final = await f.reporter.finish(evidence(2), true);
    expect(performance.now() - started).toBeLessThan(2500);
    expect(final).toMatchObject({ broken: true, incomplete: true });
    expect(f.onFailure).toHaveBeenCalledOnce();
  } finally {
    wallClock.mockRestore();
  }
});

it('handles a Writable error arriving after the write timeout', async () => {
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      setTimeout(() => callback(Error('PRIVATE_LATE_ERROR')), LIMITS.writeMs + 100);
    },
  });
  const onFailure = vi.fn();
  const reporter = createGatewayOutcomeReporter({ output, onFailure });
  const closed = new Promise((resolve) => output.once('close', resolve));
  reporter.onEvidence(event(0, 'dispatch'));
  reporter.onEvidence(event(1, 'completed'));
  const result = await reporter.finish(evidence(2), true);
  expect(result).toMatchObject({ incomplete: true, broken: true });
  await closed;
  expect(onFailure).toHaveBeenCalledOnce();
});

it('shares one late-error guardian across stuck writes to the same stream', async () => {
  const output = new EventEmitter();
  const callbacks = [];
  output.write = (_value, callback) => {
    callbacks.push(callback);
    return true;
  };
  const reporters = Array.from({ length: 3 }, () => createGatewayOutcomeReporter({ output }));
  for (const reporter of reporters) {
    reporter.onEvidence(event(0, 'dispatch'));
    reporter.onEvidence(event(1, 'completed'));
  }
  await Promise.all(reporters.map((reporter) => reporter.finish(evidence(2), true)));
  await new Promise((resolve) => setImmediate(resolve));
  expect(output.listenerCount('error')).toBe(1);
  expect(() => output.emit('error', Error('PRIVATE_LATE_ERROR'))).not.toThrow();
  for (const callback of callbacks) callback();
  await new Promise((resolve) => setImmediate(resolve));
  expect(output.listenerCount('error')).toBe(0);
});

it('keeps a guardian when the terminal closes before its outstanding write settles', async () => {
  const output = new EventEmitter();
  let callback;
  output.write = (_value, cb) => {
    callback = cb;
    return true;
  };
  const reporter = createGatewayOutcomeReporter({ output });
  reporter.onEvidence(event(0, 'dispatch'));
  reporter.onEvidence(event(1, 'completed'));
  output.emit('close');
  expect((await reporter.finish(evidence(2), true)).incomplete).toBe(true);
  await new Promise((resolve) => setImmediate(resolve));
  expect(output.listenerCount('error')).toBe(1);
  expect(() => output.emit('error', Error('PRIVATE_LATE_ERROR'))).not.toThrow();
  callback();
  await new Promise((resolve) => setImmediate(resolve));
  expect(output.listenerCount('error')).toBe(0);
});

it('does not expose fields or invoke getters from malformed input', async () => {
  const f = fixture();
  const bad = event(0, 'dispatch');
  Object.defineProperty(bad, 'operationId', {
    enumerable: true,
    get() {
      throw Error('PRIVATE_SECRET_847');
    },
  });
  expect(() => f.reporter.onEvidence(bad)).not.toThrow();
  const final = await f.reporter.finish(evidence(1), true);
  expect(final.incomplete).toBe(true);
  expect(f.text()).not.toContain('PRIVATE_SECRET_847');
});
