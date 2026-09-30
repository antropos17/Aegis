import { createHmac, timingSafeEqual } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { binding, exactKeys, HEX64, requireVm } from './vm-contract.mjs';

const names = [
  'protocol',
  'version',
  'sessionId',
  'vmId',
  'epoch',
  'challenge',
  'direction',
  'sequence',
  'operation',
  'dataBase64',
];
const controls = { release: 'R', cancel: 'C', stopped: 'S' };
const outgoing = { host: 'host-to-guest', guest: 'guest-to-host' };

function pinContext(context) {
  exactKeys(context, ['sessionId', 'vmId', 'epoch', 'challenge']);
  const pinned = binding({
    sessionId: context.sessionId,
    vmId: context.vmId,
    epoch: context.epoch,
  });
  requireVm(pinned.vmId !== '00000000-0000-0000-0000-000000000000');
  requireVm(typeof context.challenge === 'string' && HEX64.test(context.challenge));
  return Object.freeze({ ...pinned, challenge: context.challenge });
}

function message(value) {
  exactKeys(value, names);
  const context = pinContext({
    sessionId: value.sessionId,
    vmId: value.vmId,
    epoch: value.epoch,
    challenge: value.challenge,
  });
  requireVm(value.protocol === 'aegis-guest-channel' && value.version === 1);
  requireVm(Object.values(outgoing).includes(value.direction));
  requireVm(Number.isInteger(value.sequence) && value.sequence >= 1 && value.sequence <= 4);
  requireVm(['release', 'cancel', 'result', 'stopped'].includes(value.operation));
  requireVm(typeof value.dataBase64 === 'string' && value.dataBase64.length <= 2732);
  const data = Buffer.from(value.dataBase64, 'base64');
  requireVm(data.length > 0 && data.length <= 2048 && data.toString('base64') === value.dataBase64);
  if (value.operation !== 'result')
    requireVm(data.toString('hex') === Buffer.from(controls[value.operation]).toString('hex'));
  return {
    value: Object.fromEntries(
      names.map((name) => [name, name in context ? context[name] : value[name]]),
    ),
    data,
  };
}

function sign(key, value) {
  return createHmac('sha256', key).update(JSON.stringify(value)).digest('hex');
}
function encode(key, value) {
  const payload = Buffer.from(JSON.stringify({ ...value, mac: sign(key, value) }));
  requireVm(payload.length <= 4096);
  const frame = Buffer.alloc(4 + payload.length);
  frame.writeUInt32LE(payload.length);
  payload.copy(frame, 4);
  return frame;
}

/**
 * Stateful qualification channel with direction/sequence/phase authentication.
 * Starts only after separately verified initialization. Supplied key/context are
 * test capabilities, not an OS peer or authorization to operate any VM. Results
 * remain untrusted bytes; a stopped message never confirms process/VM closure.
 * @param {object} options Fresh key, host-pinned context and fixed host/guest role.
 * @returns {Readonly<object>} Bounded send/accept, explicit close and diagnostic snapshot.
 * @since v0.17.0
 */
export function createGuestChannel({ key, context, role }) {
  requireVm(Buffer.isBuffer(key) && key.length === 32 && Object.hasOwn(outgoing, role));
  const pinned = pinContext(context);
  const ownedKey = Buffer.from(key);
  let state = 'ready',
    sent = 0,
    received = 0,
    stoppedMessage = false;
  function finish(next) {
    state = next;
    ownedKey.fill(0);
  }
  function next(operation, sending) {
    requireVm(state !== 'closed' && state !== 'unavailable');
    const hostMessage = (role === 'host') === sending;
    if (hostMessage) {
      if (operation === 'release') {
        requireVm(state === 'ready');
        return 'running';
      }
      requireVm(
        operation === 'cancel' &&
          ['ready', 'running', 'result-received', 'result-sent'].includes(state),
      );
      return 'cancelling';
    }
    if (operation === 'result') {
      requireVm(state === 'running');
      return role === 'host' ? 'result-received' : 'result-sent';
    }
    requireVm(
      operation === 'stopped' && ['cancelling', 'result-received', 'result-sent'].includes(state),
    );
    return 'closed';
  }
  function snapshot() {
    return Object.freeze({
      scope: 'guest-channel-wire-fixture',
      state,
      sent,
      received,
      stopMessageAccepted: stoppedMessage,
      executionClosureConfirmed: false,
      launchAllowed: false,
      nativeContainmentQualified: false,
    });
  }
  return Object.freeze({
    snapshot,
    send(operation, data = Buffer.from(controls[operation] || '')) {
      try {
        requireVm(Buffer.isBuffer(data));
        const parsed = message({
          protocol: 'aegis-guest-channel',
          version: 1,
          ...pinned,
          direction: outgoing[role],
          sequence: sent + 1,
          operation,
          dataBase64: data.toString('base64'),
        });
        const following = next(operation, true);
        const frame = encode(ownedKey, parsed.value);
        sent++;
        if (following === 'closed') finish(following);
        else state = following;
        return frame;
      } catch {
        finish('unavailable');
        throw new Error('guest-channel-invalid');
      }
    },
    accept(frame) {
      try {
        requireVm(Buffer.isBuffer(frame) && frame.length >= 5 && frame.length <= 4100);
        const size = frame.readUInt32LE(0);
        requireVm(size > 0 && size <= 4096 && frame.length === size + 4);
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
          frame.subarray(4),
        );
        const decoded = JSON.parse(text);
        exactKeys(decoded, [...names, 'mac']);
        const { mac, ...unsigned } = decoded;
        const parsed = message(unsigned);
        requireVm(typeof mac === 'string' && HEX64.test(mac));
        requireVm(text === JSON.stringify({ ...parsed.value, mac }));
        requireVm(
          timingSafeEqual(
            Buffer.from(mac, 'hex'),
            Buffer.from(sign(ownedKey, parsed.value), 'hex'),
          ),
        );
        for (const field of Object.keys(pinned)) requireVm(parsed.value[field] === pinned[field]);
        requireVm(
          parsed.value.direction !== outgoing[role] && parsed.value.sequence === received + 1,
        );
        const following = next(parsed.value.operation, false);
        received++;
        if (parsed.value.operation === 'stopped') stoppedMessage = true;
        if (following === 'closed') finish(following);
        else state = following;
        return Object.freeze({ operation: parsed.value.operation, data: parsed.data });
      } catch {
        finish('unavailable');
        throw new Error('guest-channel-invalid');
      }
    },
    close() {
      finish('closed');
    },
  });
}
