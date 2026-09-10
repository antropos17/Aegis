/**
 * @file Bounded ETW diagnostic framing and session-bound validation.
 * @since v0.14.2
 */
'use strict';

const { TextDecoder } = require('node:util');
const {
  PROTOCOL,
  PROFILE,
  MAX_FRAME_BYTES,
  MAX_DEPTH,
  SCHEMAS,
  ERROR_CODES,
  id,
  validEnvelope,
} = require('./etw-file-schema');
const fail = (code = 'invalid-message') => {
  throw new Error(`etw-file:${code}`);
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
  if (!validEnvelope(message)) fail();
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
