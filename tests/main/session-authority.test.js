import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const subject = require('../../src/main/session-authority');
const scope = { sessionId: 'a'.repeat(32), epoch: 'b'.repeat(32), policyRevision: 'c'.repeat(64) };
const owners = [];
const request = () => ({
  operationId: 'd'.repeat(32),
  operation: 'dummy-edit',
  requestDigest: 'e'.repeat(64),
  snapshotDigest: 'f'.repeat(64),
  expiresAt: Date.now() + 1000,
});
function owner() {
  const value = subject.createSessionAuthority(scope, { operations: ['dummy-edit'] });
  owners.push(value);
  return value;
}
afterEach(() => {
  for (const value of owners) value.revoke();
  owners.length = 0;
  subject._resetForTest();
  vi.useRealTimers();
});

it('allows a dotted operation only through the exact owner allowlist', () => {
  const value = subject.createSessionAuthority(scope, { operations: ['model.request'] });
  owners.push(value);
  const input = { ...request(), operation: 'model.request' };
  expect(value.issue(input, { decision: 'allow' })).toBeDefined();
  for (const operation of [
    'model-request',
    'model.request.other',
    'Model.request',
    'model/request',
    'model.request\n',
  ]) {
    expect(() => value.issue({ ...input, operation }, { decision: 'allow' })).toThrow();
  }
});

it('expires the actual capability signal and rejects a late reservation', async () => {
  vi.useFakeTimers();
  const value = owner(),
    capability = value.issue(request(), { decision: 'allow' });
  const signal = value.signal(capability);
  expect(signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(signal.aborted).toBe(true);
  const expected = { ...request() };
  delete expected.expiresAt;
  expect(() => value.reserve(capability, expected)).toThrow();
});

it('binds every owner field and keeps capabilities opaque, unique and nonserializable', () => {
  const value = owner(),
    input = request();
  const capability = value.issue(input, { decision: 'allow' });
  const second = value.issue(input, { decision: 'allow' });
  const { expiresAt, ...expected } = input;
  const binding = value.reserve(capability, expected);
  const other = value.reserve(second, expected);
  expect(Object.keys(capability)).toEqual([]);
  expect(Object.isFrozen(capability)).toBe(true);
  expect(binding).toMatchObject({ ...scope, ...input });
  expect(binding.nonce).not.toBe(other.nonce);
  expect(binding.expiresAt).toBe(expiresAt);
  expect(() => value.reserve(JSON.parse(JSON.stringify(capability)), expected)).toThrow();
});

it.each(['operationId', 'operation', 'requestDigest', 'snapshotDigest'])(
  'a %s mismatch permanently invalidates the original capability',
  (key) => {
    const value = owner(),
      input = request(),
      capability = value.issue(input, { decision: 'allow' });
    const expected = { ...input };
    delete expected.expiresAt;
    expect(() => value.reserve(capability, { ...expected, [key]: 'substituted' })).toThrow();
    expect(() => value.reserve(capability, expected)).toThrow();
  },
);

it('rejects unknown/accessor fields, unsupported operations and out-of-bounds expiry', () => {
  const value = owner();
  for (const input of [
    { ...request(), extra: true },
    { ...request(), operation: 'unsupported' },
    { ...request(), expiresAt: Date.now() },
    { ...request(), expiresAt: Date.now() + subject.LIMITS.ttlMs + 1000 },
    { ...request(), requestDigest: 'short' },
  ])
    expect(() => value.issue(input, { decision: 'allow' })).toThrow();
  let getterReads = 0;
  const input = request();
  Object.defineProperty(input, 'requestDigest', {
    get: () => {
      getterReads++;
      return 'e'.repeat(64);
    },
  });
  expect(() => value.issue(input, { decision: 'allow' })).toThrow();
  expect(getterReads).toBe(0);
  expect(() =>
    subject.createSessionAuthority({ ...scope, forged: true }, { operations: ['dummy-edit'] }),
  ).toThrow();
});

it('keeps issuance bounded after completed capabilities and revocation rejects future minting', () => {
  const value = owner();
  for (let i = 0; i < subject.LIMITS.issued; i++)
    value.finish(value.issue(request(), { decision: 'allow' }));
  expect(() => value.issue(request(), { decision: 'allow' })).toThrow();
  const fresh = owner();
  fresh.revoke();
  expect(() => fresh.issue(request(), { decision: 'allow' }, { approved: true })).toThrow();
});
