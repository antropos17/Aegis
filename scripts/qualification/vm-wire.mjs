import { createHmac, timingSafeEqual } from 'node:crypto';
import { binding, exactKeys, HEX64, requireVm } from './vm-contract.mjs';

const names = [
  'version',
  'sessionId',
  'vmId',
  'epoch',
  'sequence',
  'challenge',
  'phase',
  'imageSha256',
  'runtimeSha256',
  'principalSha256',
  'jobSha256',
];

function canonical(evidence) {
  exactKeys(evidence, names);
  binding({ sessionId: evidence.sessionId, vmId: evidence.vmId, epoch: evidence.epoch });
  requireVm(evidence.version === 1 && evidence.sequence === 1 && evidence.phase === 'initialized');
  for (const key of names.slice(5).filter((key) => key !== 'phase'))
    requireVm(typeof evidence[key] === 'string' && HEX64.test(evidence[key]));
  return Object.fromEntries(names.map((key) => [key, evidence[key]]));
}

function mac(key, evidence) {
  return createHmac('sha256', key).update(JSON.stringify(evidence)).digest('hex');
}

/**
 * Encode the fixed synthetic guest message; never use this as a guest bootstrap.
 * @param {Buffer} key Test-only 32-byte credential, never argv/journal material.
 * @param {object} evidence Fixed initialized evidence.
 * @returns {Buffer} One bounded frame.
 * @since v0.17.0
 */
export function encodeVmFrame(key, evidence) {
  requireVm(Buffer.isBuffer(key) && key.length === 32);
  const value = canonical(evidence);
  const payload = Buffer.from(JSON.stringify({ evidence: value, mac: mac(key, value) }));
  requireVm(payload.length <= 4096);
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length);
  return Buffer.concat([header, payload]);
}

/**
 * Consume one challenge-bound message. HMAC establishes possession of a supplied
 * key, not OS identity, image contents or integrity of guest-reported observations.
 * @param {Buffer} key Copied credential from the synthetic fixture context.
 * @param {object} expected Complete evidence pinned by that context.
 * @returns {{accept: function(Buffer): void, close: function(): void}}
 * @since v0.17.0
 */
export function createVmVerifier(key, expected) {
  requireVm(Buffer.isBuffer(key) && key.length === 32);
  const ownedKey = Buffer.from(key);
  const pinned = canonical(expected);
  let closed = false;
  return Object.freeze({
    accept(frame) {
      requireVm(!closed && Buffer.isBuffer(frame) && frame.length >= 4 && frame.length <= 4100);
      const size = frame.readUInt32LE(0);
      requireVm(size > 0 && size <= 4096 && frame.length === size + 4);
      const payload = frame.subarray(4).toString('utf8');
      let decoded;
      try {
        decoded = JSON.parse(payload);
      } catch {
        throw new Error('vm-fixture-invalid');
      }
      exactKeys(decoded, ['evidence', 'mac']);
      const evidence = canonical(decoded.evidence);
      requireVm(typeof decoded.mac === 'string' && HEX64.test(decoded.mac));
      requireVm(payload === JSON.stringify({ evidence, mac: decoded.mac }));
      requireVm(
        timingSafeEqual(
          Buffer.from(decoded.mac, 'hex'),
          Buffer.from(mac(ownedKey, evidence), 'hex'),
        ),
      );
      requireVm(JSON.stringify(evidence) === JSON.stringify(pinned));
      closed = true;
      ownedKey.fill(0);
    },
    close() {
      closed = true;
      ownedKey.fill(0);
    },
  });
}
