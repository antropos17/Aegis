import { describe, expect, it } from 'vitest';
import { createVmVerifier, encodeVmFrame } from '../../scripts/qualification/vm-wire.mjs';
import { evidence, key } from '../fixtures/vm-synthetic-backend.mjs';

function rawFrame(value) {
  const bytes = Buffer.from(value);
  const header = Buffer.alloc(4);
  header.writeUInt32LE(bytes.length);
  return Buffer.concat([header, bytes]);
}

describe('challenge-bound synthetic guest evidence', () => {
  it('accepts exactly once and copies caller-owned credentials and pins', () => {
    const owned = Buffer.from(key);
    const expected = evidence();
    const verifier = createVmVerifier(owned, expected);
    owned.fill(0);
    expected.challenge = '2'.repeat(64);
    const frame = encodeVmFrame(key, evidence());
    expect(() => verifier.accept(frame)).not.toThrow();
    expect(() => verifier.accept(frame)).toThrow();
    expect(Object.keys(verifier)).toEqual(['accept', 'close']);
  });

  it.each([
    ['sessionId', 'c'.repeat(32)],
    ['vmId', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'],
    ['epoch', 'd'.repeat(32)],
    ['challenge', '2'.repeat(64)],
    ['imageSha256', '3'.repeat(64)],
    ['runtimeSha256', '4'.repeat(64)],
    ['principalSha256', '5'.repeat(64)],
    ['jobSha256', '6'.repeat(64)],
  ])('rejects a valid MAC bound to the wrong %s', (name, value) => {
    expect(() =>
      createVmVerifier(key, evidence()).accept(
        encodeVmFrame(key, evidence(undefined, { [name]: value })),
      ),
    ).toThrow();
  });

  it('rejects a different key and changed payload', () => {
    const frame = encodeVmFrame(Buffer.alloc(32, 18), evidence());
    expect(() => createVmVerifier(key, evidence()).accept(frame)).toThrow();
    const changed = encodeVmFrame(key, evidence());
    changed[40] ^= 1;
    expect(() => createVmVerifier(key, evidence()).accept(changed)).toThrow();
  });

  it.each(['truncated', 'trailing', 'zero', 'oversized', 'duplicate', 'noncanonical', 'authority'])(
    'rejects %s framing before admission',
    (kind) => {
      const frame = encodeVmFrame(key, evidence());
      let damaged = frame;
      if (kind === 'truncated') damaged = frame.subarray(0, -1);
      if (kind === 'trailing') damaged = Buffer.concat([frame, Buffer.from([0])]);
      if (kind === 'zero') damaged = Buffer.alloc(4);
      if (kind === 'oversized') {
        damaged = Buffer.alloc(4101);
        damaged.writeUInt32LE(4097);
      }
      const text = frame.subarray(4).toString();
      if (kind === 'duplicate')
        damaged = rawFrame(text.replace('"version":1', '"version":1,"version":1'));
      if (kind === 'noncanonical') damaged = rawFrame(' ' + text);
      if (kind === 'authority')
        damaged = rawFrame(text.replace('"version":1', '"version":1,"launchAllowed":true'));
      expect(() => createVmVerifier(key, evidence()).accept(damaged)).toThrow();
    },
  );

  it.each([{ sequence: 2 }, { phase: 'ready' }, { version: 2 }])(
    'refuses unsupported message semantics %j',
    (change) => {
      expect(() => encodeVmFrame(key, evidence(undefined, change))).toThrow();
    },
  );

  it('invalidates the challenge when canceled', () => {
    const verifier = createVmVerifier(key, evidence());
    verifier.close();
    expect(() => verifier.accept(encodeVmFrame(key, evidence()))).toThrow();
  });
});
