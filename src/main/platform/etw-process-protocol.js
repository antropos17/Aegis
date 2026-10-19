'use strict';

const { pins, provider } = require('../../../sidecar/etw-process/schema-pins.json');
const PROTOCOL = 'aegis-etw-process-diagnostic';
const CAPACITY = 1024;
const frameKeys = [
  'protocol',
  'version',
  'provider',
  'generation',
  'sequence',
  'type',
  'observation',
  'receipt',
];
const observationKeys = [
  'eventId',
  'eventVersion',
  'schema',
  'kind',
  'subjectPid',
  'headerPid',
  'qpc',
  'creationTime100ns',
  'creationTimeSource',
  'providerProcessSequenceNumber',
  'sequenceSource',
  'processStartKey',
];
const receiptKeys = [
  'callbacks',
  'admitted',
  'unknown',
  'dropped',
  'providerFailures',
  'nativeStopStatus',
  'consumerCompleted',
  'consumerSucceeded',
  'loss',
];
const count = (n) => Number.isSafeInteger(n) && n >= 0;
const uint = (n) => count(n) && n <= 0xffffffff;
const shape = (value, keys) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const decimal = (value, max, zero = false) =>
  typeof value === 'string' &&
  /^(0|[1-9][0-9]{0,19})$/.test(value) &&
  (zero || value !== '0') &&
  BigInt(value) <= max;
const u64 = (value) => decimal(value, 18446744073709551615n);
const qpc = (value) => decimal(value, 9223372036854775807n, true);

function observation(value) {
  if (!shape(value, observationKeys)) return false;
  const pin = pins.find((p) => p.id === value.eventId && p.version === value.eventVersion);
  return (
    pin !== undefined &&
    value.schema === pin.fingerprint &&
    value.kind === (pin.id === 1 ? 'start' : pin.id === 2 ? 'stop' : 'rundown') &&
    uint(value.subjectPid) &&
    value.subjectPid > 0 &&
    uint(value.headerPid) &&
    qpc(value.qpc) &&
    (value.creationTime100ns === null
      ? value.creationTimeSource === null
      : u64(value.creationTime100ns) &&
        value.creationTimeSource === 'payload-CreateTime-FILETIME') &&
    (value.providerProcessSequenceNumber === null
      ? value.sequenceSource === null
      : u64(value.providerProcessSequenceNumber) &&
        value.sequenceSource === 'payload-ProcessSequenceNumber') &&
    value.processStartKey === null
  );
}

/** Create a bounded, diagnostic-only process wire collector. It never supplies a population snapshot.
 * @param {string} generation Caller-selected nonzero GUID in lowercase N format.
 * @returns {{accept: (frame: object) => boolean, result: () => object}} Independent collector.
 * @since v0.19.2
 */
function createCollector(generation) {
  if (!/^[a-f0-9]{32}$/.test(generation) || /^0+$/.test(generation))
    throw new Error('invalid-generation');
  let state = 'initial',
    sequence = 0,
    invalid = 0,
    duplicates = 0,
    outOfOrder = 0;
  let lastQpc = null,
    receipt = null;
  const events = [],
    seen = new Set();
  const reject = () => {
    invalid++;
    return false;
  };
  const accept = (frame) => {
    if (
      !shape(frame, frameKeys) ||
      frame.protocol !== PROTOCOL ||
      frame.version !== 1 ||
      frame.provider !== provider ||
      frame.generation !== generation ||
      frame.sequence !== sequence + 1 ||
      state === 'closed'
    )
      return reject();
    if (frame.type === 'begin') {
      if (state !== 'initial' || frame.observation !== null || frame.receipt !== null)
        return reject();
      state = 'running';
    } else if (frame.type === 'event') {
      if (
        !['running', 'stopping'].includes(state) ||
        frame.receipt !== null ||
        events.length >= CAPACITY ||
        !observation(frame.observation)
      )
        return reject();
      const event = { ...frame.observation };
      const stamp = [
        event.eventId,
        event.subjectPid,
        event.qpc,
        event.creationTime100ns,
        event.providerProcessSequenceNumber,
      ].join(':');
      if (seen.has(stamp)) duplicates++;
      seen.add(stamp);
      const currentQpc = BigInt(event.qpc);
      if (lastQpc !== null && currentQpc < lastQpc) outOfOrder++;
      lastQpc = currentQpc;
      events.push(event);
    } else if (frame.type === 'stopping') {
      if (state !== 'running' || frame.observation !== null || frame.receipt !== null)
        return reject();
      state = 'stopping';
    } else if (frame.type === 'stop') {
      const r = frame.receipt;
      if (
        state !== 'stopping' ||
        frame.observation !== null ||
        !shape(r, receiptKeys) ||
        !['callbacks', 'admitted', 'unknown', 'dropped', 'providerFailures'].every((key) =>
          count(r[key]),
        ) ||
        r.admitted !== events.length ||
        r.callbacks !== r.admitted + r.unknown + r.dropped ||
        (r.nativeStopStatus !== null && !uint(r.nativeStopStatus)) ||
        typeof r.consumerCompleted !== 'boolean' ||
        typeof r.consumerSucceeded !== 'boolean' ||
        !shape(r.loss, ['nativeEventsLost', 'nativeBuffersLost']) ||
        !Object.values(r.loss).every((n) => n === null || uint(n))
      )
        return reject();
      receipt = { ...r, loss: { ...r.loss } };
      state = 'closed';
    } else return reject();
    sequence = frame.sequence;
    return true;
  };
  const result = () => ({
    protocol: PROTOCOL,
    version: 1,
    generation,
    state,
    sequence,
    invalid,
    duplicates,
    outOfOrder,
    events: events.map((event) => ({ ...event })),
    receipt: receipt === null ? null : { ...receipt, loss: { ...receipt.loss } },
    transportDrained:
      state === 'closed' &&
      invalid === 0 &&
      receipt.nativeStopStatus === 0 &&
      receipt.consumerCompleted &&
      receipt.consumerSucceeded &&
      receipt.providerFailures === 0,
    diagnosticComplete:
      state === 'closed' &&
      invalid === 0 &&
      duplicates === 0 &&
      outOfOrder === 0 &&
      receipt.nativeStopStatus === 0 &&
      receipt.consumerCompleted &&
      receipt.consumerSucceeded &&
      receipt.providerFailures === 0 &&
      receipt.unknown === 0 &&
      receipt.dropped === 0 &&
      receipt.loss.nativeEventsLost === 0 &&
      receipt.loss.nativeBuffersLost === 0,
    launchAllowed: false,
  });
  return { accept, result };
}

module.exports = { PROTOCOL, CAPACITY, createCollector };
