import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { createGuestChannel } from '../../scripts/qualification/guest-channel-wire.mjs';

const key = Buffer.alloc(32, 7);
const context = {
  sessionId: '1'.repeat(32),
  vmId: '11111111-2222-4333-8444-555555555555',
  epoch: '2'.repeat(32),
  challenge: '3'.repeat(64),
};
function independentFrame(operation, data = 'result', overrides = {}) {
  const message = {
    protocol: 'aegis-guest-channel',
    version: 1,
    ...context,
    direction: 'guest-to-host',
    sequence: 1,
    operation,
    dataBase64: Buffer.from(data).toString('base64'),
    ...overrides,
  };
  const mac = createHmac('sha256', key).update(JSON.stringify(message)).digest('hex');
  const payload = Buffer.from(JSON.stringify({ ...message, mac }));
  const frame = Buffer.alloc(4 + payload.length);
  frame.writeUInt32LE(payload.length);
  payload.copy(frame, 4);
  return frame;
}
describe('guest channel phase authority', () => {
  it('refuses a correctly authenticated result before the host has released work', () => {
    const host = createGuestChannel({ key, context, role: 'host' });
    expect(() => host.accept(independentFrame('result'))).toThrow();
  });
  it('round-trips release, untrusted result and stopped without claiming resource closure', () => {
    const host = createGuestChannel({ key, context, role: 'host' });
    const guest = createGuestChannel({ key, context, role: 'guest' });
    expect(guest.accept(host.send('release')).operation).toBe('release');
    const data = Buffer.from('arbitrary untrusted result, never a host command');
    expect(host.accept(guest.send('result', data)).data).toEqual(data);
    expect(host.snapshot().state).toBe('result-received');
    expect(host.accept(guest.send('stopped')).operation).toBe('stopped');
    expect(host.snapshot()).toMatchObject({
      state: 'closed',
      sent: 1,
      received: 2,
      stopMessageAccepted: true,
      executionClosureConfirmed: false,
      launchAllowed: false,
      nativeContainmentQualified: false,
    });
    expect(() => host.send('release')).toThrow();
  });
  it('cancels before release without accepting any task result', () => {
    const host = createGuestChannel({ key, context, role: 'host' });
    const guest = createGuestChannel({ key, context, role: 'guest' });
    expect(guest.accept(host.send('cancel')).operation).toBe('cancel');
    expect(host.accept(guest.send('stopped')).operation).toBe('stopped');
    expect(host.snapshot().executionClosureConfirmed).toBe(false);
  });
  it('accepts an authenticated cancel during work but refuses a later result', () => {
    const host = createGuestChannel({ key, context, role: 'host' });
    const guest = createGuestChannel({ key, context, role: 'guest' });
    guest.accept(host.send('release'));
    guest.accept(host.send('cancel'));
    expect(() => guest.send('result', Buffer.from('late'))).toThrow();
    expect(guest.snapshot().state).toBe('unavailable');
  });
  it('rejects an incoming result after cancellation even with the current key and sequence', () => {
    const host = createGuestChannel({ key, context, role: 'host' });
    host.send('release');
    host.send('cancel');
    expect(() => host.accept(independentFrame('result'))).toThrow();
  });
  it('consumes a result once and refuses its replay', () => {
    const host = createGuestChannel({ key, context, role: 'host' });
    host.send('release');
    const frame = independentFrame('result');
    host.accept(frame);
    expect(() => host.accept(frame)).toThrow();
  });
  it('invalidates the channel after failure, including a later otherwise valid frame', () => {
    const host = createGuestChannel({ key, context, role: 'host' });
    host.send('release');
    expect(() => host.accept(independentFrame('result', 'result', { sequence: 2 }))).toThrow();
    expect(() => host.accept(independentFrame('result'))).toThrow();
    expect(host.snapshot().received).toBe(0);
  });
  it.each([
    { sessionId: '4'.repeat(32) },
    { vmId: '22222222-3333-4444-8555-666666666666' },
    { epoch: '4'.repeat(32) },
    { challenge: '4'.repeat(64) },
    { direction: 'host-to-guest' },
    { sequence: 0 },
    { sequence: 2 },
    { sequence: 1.5 },
    { sequence: 5 },
    { version: 2 },
    { operation: 'run-command' },
    { operation: 'release' },
    { protocol: 'other' },
    { dataBase64: 'AA==\n' },
    { dataBase64: '' },
    { dataBase64: Buffer.alloc(2049).toString('base64') },
  ])('refuses signed foreign/reordered/unsupported message %j', (change) => {
    const host = createGuestChannel({ key, context, role: 'host' });
    host.send('release');
    expect(() => host.accept(independentFrame('result', 'result', change))).toThrow();
  });
  it.each([
    'bad-mac',
    'duplicate',
    'whitespace',
    'extra-key',
    'truncated',
    'length',
    'utf8',
    'oversized',
  ])('rejects %s framing', (kind) => {
    const host = createGuestChannel({ key, context, role: 'host' });
    host.send('release');
    let frame = independentFrame('result');
    let text = frame.subarray(4).toString();
    if (kind === 'bad-mac')
      text = text.replace(/"mac":"(.)/, (_, first) => '"mac":"' + (first === '0' ? '1' : '0'));
    if (kind === 'duplicate') text = text.replace('{', '{"version":1,');
    if (kind === 'whitespace') text = ' ' + text;
    if (kind === 'extra-key') text = text.replace('{', '{"launchAllowed":true,');
    if (['bad-mac', 'duplicate', 'whitespace', 'extra-key'].includes(kind)) {
      const payload = Buffer.from(text);
      frame = Buffer.alloc(payload.length + 4);
      frame.writeUInt32LE(payload.length);
      payload.copy(frame, 4);
    }
    if (kind === 'truncated') frame = frame.subarray(0, frame.length - 1);
    if (kind === 'length') frame.writeUInt32LE(0);
    if (kind === 'utf8') frame[4] = 255;
    if (kind === 'oversized') frame = Buffer.alloc(4101);
    expect(() => host.accept(frame)).toThrow();
  });
  it.each(['release', 'result', 'stopped'])(
    'does not allow a guest to send %s before its required phase',
    (operation) => {
      const guest = createGuestChannel({ key, context, role: 'guest' });
      expect(() => guest.send(operation, Buffer.from('R'))).toThrow();
    },
  );
  it('copies the key and context, so later caller changes cannot change the admitted channel', () => {
    const supplied = Buffer.from(key),
      mutable = { ...context };
    const host = createGuestChannel({ key: supplied, context: mutable, role: 'host' });
    supplied.fill(0);
    mutable.epoch = '9'.repeat(32);
    host.send('release');
    expect(host.accept(independentFrame('result')).operation).toBe('result');
    expect(key).toEqual(Buffer.alloc(32, 7));
    host.close();
  });
  it.each([
    { key: Buffer.alloc(31) },
    { role: 'renderer' },
    { context: { ...context, challenge: '3'.repeat(64) + '\n' } },
    { context: { ...context, vmId: '00000000-0000-0000-0000-000000000000' } },
    { context: { ...context, path: 'untrusted authority' } },
  ])('rejects an invalid channel capability %j', (change) => {
    expect(() => createGuestChannel({ key, context, role: 'host', ...change })).toThrow();
  });
});
