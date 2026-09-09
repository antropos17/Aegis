/**
 * @file Offline ETW diagnostic contract. No process, pipe, ETW or product wiring.
 * @since v0.14.2
 */
'use strict';

const { TextDecoder } = require('node:util');
const PROTOCOL = 'etw-file/1';
const PROFILE = 'home-26200-diagnostic-v1';
const MAX_FRAME_BYTES = 256 * 1024;
const MAX_DEPTH = 16;
const SCHEMAS = Object.freeze(['10:0', '12:1', '13:1', '14:1', '15:1']);
const ERROR_CODES = Object.freeze([
  'launch-failed',
  'protocol-failed',
  'session-failed',
  'lease-expired',
  'stop-unverified',
  'stream-ended',
  'consumer-failed',
]);
const REASONS = Object.freeze([
  'mapping-uncertain',
  'identity-uncertain',
  'population-unavailable',
  'schema-gap',
]);
const fail = (code = 'invalid-message') => {
  throw new Error(`etw-file:${code}`);
};
const oneOf =
  (...values) =>
  (v) =>
    values.includes(v);
const uint32 = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const uint64 = (v) =>
  typeof v === 'string' && /^(0|[1-9]\d{0,19})$/.test(v) && BigInt(v) <= 0xffffffffffffffffn;
const positive64 = (v) => uint64(v) && v !== '0';
const nullable = (test) => (v) => v === null || test(v);
const text = (max) => (v) =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.isWellFormed() &&
  !/\p{Cc}/u.test(v) &&
  Buffer.byteLength(v) <= max;
const id = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
const array = (test, max) => (v) => Array.isArray(v) && v.length <= max && v.every(test);
const unique = (test, max) => (v) => array(test, max)(v) && new Set(v).size === v.length;
const shape = (fields) => (v) =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === Object.keys(fields).length &&
  Object.entries(fields).every(([key, test]) => Object.hasOwn(v, key) && test(v[key]));
const clock = shape({ qpc: uint64, unixMs: uint64, uncertaintyQpc: uint64 });
const interval = shape({ fromQpc: uint64, toQpc: uint64 });
const intervalOrdered = (v) => interval(v) && BigInt(v.fromQpc) <= BigInt(v.toQpc);
const counts = shape({
  eventsLost: nullable(uint64),
  realTimeBuffersLost: nullable(uint64),
  logBuffersLost: nullable(uint64),
  queryStatus: uint32,
  asOfQpc: uint64,
});
const totals = shape({
  delivered: uint64,
  filtered: uint64,
  dropped: uint64,
  decoderErrors: uint64,
  mapEpoch: uint64,
  mapResets: uint64,
  mapConflicts: uint64,
});
const queues = shape({
  records: uint32,
  bytes: uint32,
  highWaterRecords: uint32,
  highWaterBytes: uint32,
});
const telemetryShape = shape({
  operational: oneOf(true, false),
  reasons: unique(oneOf(...REASONS), REASONS.length),
  counters: counts,
  totals,
  queues,
  coverage: oneOf(PROFILE),
});
const telemetry = (v) =>
  telemetryShape(v) &&
  v.queues.records <= 4096 &&
  v.queues.bytes <= 4 * 1024 * 1024 &&
  v.queues.highWaterRecords <= 4096 &&
  v.queues.highWaterBytes <= 4 * 1024 * 1024 &&
  v.queues.records <= v.queues.highWaterRecords &&
  v.queues.bytes <= v.queues.highWaterBytes &&
  BigInt(v.totals.filtered) <= BigInt(v.totals.delivered);
const observationShape = shape({
  eventSeq: positive64,
  provider: oneOf('edd08927-9cc4-4e65-b970-c2560fb5c289'),
  eventId: uint32,
  version: uint32,
  qpc: uint64,
  headerPid: uint32,
  headerTid: uint32,
  issuingTid: nullable(uint32),
  payloadTid: nullable(uint32),
  path: nullable(text(32 * 1024)),
  pathEvidence: oneOf(
    'observed-name',
    'candidate-object',
    'candidate-key',
    'conflict',
    'unresolved',
  ),
  issuerStatus: oneOf('candidate', 'unresolved'),
  generationStatus: oneOf('candidate', 'unresolved'),
  generationWitness: nullable(positive64),
  generationSource: nullable(oneOf('createTime100ns', 'sequence')),
  generationInterval: nullable(intervalOrdered),
  agent: oneOf(null),
  instanceId: oneOf(null),
});
const observation = (v) =>
  observationShape(v) &&
  SCHEMAS.includes(`${v.eventId}:${v.version}`) &&
  (v.path === null) === ['conflict', 'unresolved'].includes(v.pathEvidence) &&
  (v.pathEvidence !== 'observed-name' || [10, 12].includes(v.eventId)) &&
  (v.generationStatus === 'unresolved'
    ? v.generationWitness === null && v.generationSource === null && v.generationInterval === null
    : v.generationWitness !== null && v.generationSource !== null && v.generationInterval !== null);
const messageData = {
  hello: shape({
    build: text(128),
    profile: oneOf(PROFILE),
    schemas: unique(oneOf(...SCHEMAS), 5),
  }),
  start: shape({ requestId: id, profile: oneOf(PROFILE), buffersMiB: oneOf(16) }),
  ready: shape({
    requestId: id,
    frequency: positive64,
    clock,
    buffers: shape({ count: uint32, sizeKiB: uint32 }),
    telemetry,
  }),
  observations: shape({ records: array(observation, 128) }),
  health: telemetry,
  heartbeat: telemetry,
  stop: shape({ requestId: id }),
  ping: shape({}),
  stopped: shape({
    requestId: id,
    drained: oneOf(true, false),
    stopped: oneOf(true, false),
    finalEventSeq: uint64,
    telemetry,
  }),
  error: shape({ requestId: nullable(id), code: oneOf(...ERROR_CODES) }),
};

// Depth and work are bounded even for a direct caller's cyclic/deep object.
function checkDepth(v, depth = 1, budget = { nodes: 32768 }) {
  if (--budget.nodes < 0 || depth > MAX_DEPTH) fail('structure-limit');
  if (v !== null && typeof v === 'object') {
    for (const key of Object.keys(v)) checkDepth(v[key], depth + 1, budget);
  }
}

/** Validate a closed diagnostic envelope. Errors contain no peer data.
 * @param {Object} message - Proposed JSON message.
 * @param {{launchId?: string, sessionId?: string}} [expected] - Bound peer context.
 * @returns {Object} The validated input; consumers must copy anything retained.
 * @since v0.14.2
 */
function validateMessage(message, expected = {}) {
  checkDepth(message);
  const valid = shape({
    t: (v) => typeof v === 'string' && Object.hasOwn(messageData, v),
    proto: oneOf(PROTOCOL),
    launchId: id,
    sessionId: id,
    seq: positive64,
    data: (v) => Object.hasOwn(messageData, message.t) && messageData[message.t](v),
  });
  if (!valid(message)) fail();
  if (
    (expected.launchId !== undefined && message.launchId !== expected.launchId) ||
    (expected.sessionId !== undefined && message.sessionId !== expected.sessionId)
  )
    fail('session-mismatch');
  if (message.t === 'hello' && message.data.schemas.length !== SCHEMAS.length) fail();
  if (
    message.t === 'ready' &&
    (!message.data.telemetry.operational ||
      message.data.buffers.count === 0 ||
      message.data.buffers.sizeKiB === 0)
  )
    fail();
  if (message.t === 'observations') {
    let previous = 0n;
    for (const record of message.data.records) {
      if (BigInt(record.eventSeq) <= previous) fail('event-order');
      previous = BigInt(record.eventSeq);
    }
  }
  return message;
}

/** Encode one validated bounded frame.
 * @param {Object} message - Diagnostic envelope.
 * @returns {Buffer} Length prefix and UTF-8 payload.
 * @since v0.14.2
 */
function encodeFrame(message) {
  validateMessage(message);
  const payload = Buffer.from(JSON.stringify(message));
  if (payload.length > MAX_FRAME_BYTES) fail('frame-length');
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32LE(payload.length);
  payload.copy(frame, 4);
  return frame;
}

/** Decode incrementally with one bounded payload and synchronous delivery.
 * No returned frame list can grow with a coalesced input chunk. A false callback
 * result means consumer overflow and permanently terminates this decoder.
 * @param {{launchId: string, sessionId: string, onMessage: function(Object): boolean|void}} options - Required binding and sink.
 * @returns {{push: function(Buffer): number, end: function(): void, pendingBytes: function(): number, allocatedBytes: function(): number, isFatal: function(): boolean}}
 * @since v0.14.2
 */
function createFrameDecoder({ launchId, sessionId, onMessage }) {
  if (!id(launchId) || !id(sessionId) || typeof onMessage !== 'function') fail('decoder-options');
  const header = Buffer.alloc(4);
  const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let headerUsed = 0,
    payload = null,
    used = 0,
    fatal = false,
    ended = false,
    busy = false;
  function abort(code) {
    fatal = true;
    payload = null;
    headerUsed = 0;
    used = 0;
    fail(code);
  }
  return {
    push(chunk) {
      if (fatal || ended || busy) abort('decoder-closed');
      if (!Buffer.isBuffer(chunk)) abort('invalid-chunk');
      busy = true;
      let offset = 0,
        delivered = 0;
      try {
        while (offset < chunk.length) {
          if (payload === null) {
            const take = Math.min(4 - headerUsed, chunk.length - offset);
            chunk.copy(header, headerUsed, offset, offset + take);
            offset += take;
            headerUsed += take;
            if (headerUsed < 4) break;
            const length = header.readUInt32LE();
            if (length === 0 || length > MAX_FRAME_BYTES) abort('frame-length');
            payload = Buffer.allocUnsafe(length);
            used = 0;
          }
          const take = Math.min(payload.length - used, chunk.length - offset);
          chunk.copy(payload, used, offset, offset + take);
          offset += take;
          used += take;
          if (used !== payload.length) continue;
          let message;
          try {
            message = JSON.parse(utf8.decode(payload));
          } catch {
            abort('invalid-json');
          }
          try {
            validateMessage(message, { launchId, sessionId });
          } catch {
            abort('invalid-message');
          }
          payload = null;
          headerUsed = 0;
          used = 0;
          try {
            const accepted = onMessage(message);
            if (accepted !== undefined && accepted !== true) abort('consumer-failed');
          } catch {
            abort('consumer-failed');
          }
          if (fatal) abort('decoder-closed');
          delivered++;
        }
        return delivered;
      } finally {
        busy = false;
      }
    },
    end() {
      if (busy) abort('decoder-closed');
      if (fatal) fail('decoder-closed');
      ended = true;
      if (headerUsed || payload) abort('truncated-frame');
    },
    pendingBytes: () => headerUsed + used,
    allocatedBytes: () => 4 + (payload?.length || 0),
    isFatal: () => fatal,
  };
}

module.exports = {
  PROTOCOL,
  PROFILE,
  MAX_FRAME_BYTES,
  MAX_DEPTH,
  SCHEMAS,
  ERROR_CODES,
  validateMessage,
  encodeFrame,
  createFrameDecoder,
};
