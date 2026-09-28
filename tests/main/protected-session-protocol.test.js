import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  encodeProtectedSessionRequest,
  decodeProtectedSessionResponse,
} = require('../../src/main/protected-session-protocol');
const request = Object.freeze({
  operation: 'prepare',
  requestId: 'a'.repeat(32),
  sessionId: 'b'.repeat(32),
});
const message = (operation = 'prepare') => ({
  protocol: 'aegis-protected-session',
  version: 1,
  operation,
  requestId: request.requestId,
  sessionId: request.sessionId,
});
function frame(value) {
  const bytes = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(bytes.length);
  return Buffer.concat([header, bytes]);
}
const refusal = (overrides = {}) => ({
  ...message(),
  state: 'unavailable',
  reason: 'containment-unavailable',
  launchAllowed: false,
  ...overrides,
});

describe('Protected Session protocol, inactive v1', () => {
  it('requests preparation and accepts only an explicit correlated refusal', () => {
    expect(encodeProtectedSessionRequest(request)).toEqual(frame(message()));
    const result = decodeProtectedSessionResponse(frame(refusal()), request);
    expect(result.launchAllowed).toBe(false);
    expect(result.state).toBe('unavailable');
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('can probe the same unavailable backend without granting permission', () => {
    const probe = { ...request, operation: 'probe' };
    expect(encodeProtectedSessionRequest(probe)).toEqual(frame(message('probe')));
    expect(
      decodeProtectedSessionResponse(frame(refusal({ operation: 'probe' })), probe),
    ).toMatchObject({ launchAllowed: false, reason: 'containment-unavailable' });
  });

  it.each([
    { ...request, operation: 'launch' },
    { ...request, ownerSid: 'S-1-5-18' },
    { ...request, ownerPid: 1 },
    { ...request, executable: 'untrusted.exe' },
    { ...request, version: 2 },
    { ...request, sessionId: 'b'.repeat(31) },
    { ...request, sessionId: 'b'.repeat(32) + '\n' },
    { ...request, requestId: 'a'.repeat(32) + '\n' },
    { ...request, requestId: 'A'.repeat(32) },
    { ...request, policy: { decision: 'allow' } },
    null,
    [],
  ])('rejects unsupported request input %#', (invalid) => {
    expect(() => encodeProtectedSessionRequest(invalid)).toThrow(
      'protected-session-protocol-invalid',
    );
  });

  it.each([
    { launchAllowed: true },
    { state: 'running' },
    { state: 'prepared' },
    { version: 2 },
    { protocol: 'aegis-mcpjob' },
    { operation: 'probe' },
    { sessionId: 'c'.repeat(32) },
    { requestId: 'd'.repeat(32) },
    { ownerSid: 'S-1-5-18' },
    { policyRevision: 'forged' },
    { reason: 'ready' },
  ])('refuses response substitution or claimed authority %#', (changes) => {
    expect(() => decodeProtectedSessionResponse(frame(refusal(changes)), request)).toThrow(
      'protected-session-protocol-invalid',
    );
  });

  it.each([
    Buffer.alloc(0),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from([1, 8, 0, 0]),
    frame('{}'),
    frame('null'),
    frame('[]'),
    frame('{'),
    frame(JSON.stringify(refusal()).replace('"version":1', '"version":2,"version":1')),
    frame(' ' + JSON.stringify(refusal())),
    Buffer.concat([frame(refusal()), frame(refusal())]),
    frame(refusal()).subarray(0, -1),
    Buffer.concat([Buffer.from([2, 0, 0, 0]), Buffer.from([0xc0, 0xaf])]),
  ])('rejects malformed framing, duplicate fields and noncanonical JSON %#', (invalid) => {
    expect(() => decodeProtectedSessionResponse(invalid, request)).toThrow(
      'protected-session-protocol-invalid',
    );
  });
});
