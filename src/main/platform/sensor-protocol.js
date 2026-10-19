/**
 * @file Pure sensor/1 framing, validation and terminal incremental decoding.
 * Session ordering, active capabilities, host custody and freshness are W1b.
 * @since 0.19.2-beta
 */
'use strict';
const { MAX_FRAME_BYTES, WireError, fail, exact, direction } = require('./sensor-protocol-values');
const { projectMessage } = require('./sensor-protocol-schema');
const { parsePayload } = require('./sensor-protocol-json');
const { snapshotData } = require('./sensor-protocol-data');
const { isProxy, isPromise } = require('node:util').types;

function fixed(error) {
  return error instanceof WireError ? error : new WireError('message-invalid');
}

/**
 * Validate and freshly project a single direction-specific message.
 * @param {object} message
 * @param {{direction: 'host-to-sensor'|'sensor-to-host'}} options
 * @returns {object}
 * @since 0.19.2-beta
 */
function validateMessage(message, options) {
  try {
    const selectedDirection = direction(options);
    return projectMessage(snapshotData(message), selectedDirection);
  } catch (error) {
    throw fixed(error);
  }
}

/**
 * Encode compact approved JSON behind its four-byte little-endian byte length.
 * @param {object} message
 * @param {{direction: 'host-to-sensor'|'sensor-to-host'}} options
 * @returns {Buffer}
 * @since 0.19.2-beta
 */
function encodeFrame(message, options) {
  const projected = validateMessage(message, options);
  const payload = Buffer.from(JSON.stringify(projected), 'utf8');
  if (payload.length < 1 || payload.length > MAX_FRAME_BYTES) fail('frame-length-invalid');
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

/**
 * Retain only one header/body; deliver synchronously without accumulating output.
 * Callback errors and any invalid frame permanently close delivery.
 * @param {{direction: 'host-to-sensor'|'sensor-to-host', onMessage: Function}} options
 * @returns {{push: Function, finish: Function, pendingBytes: Function, isFatal: Function}}
 * @since 0.19.2-beta
 */
function createFrameDecoder(options) {
  let selectedDirection;
  let onMessage;
  try {
    exact(options, ['direction', 'onMessage']);
    selectedDirection = direction({ direction: options.direction });
    onMessage = options.onMessage;
    if (typeof onMessage !== 'function' || isProxy(onMessage)) fail();
  } catch (error) {
    throw fixed(error);
  }
  const header = Buffer.allocUnsafe(4);
  let headerBytes = 0;
  let payload = null;
  let payloadBytes = 0;
  let errorCode = null;
  let active = false;
  let closed = false;
  const status = (decodedCount = 0) => ({ decodedCount, errorCode, fatal: errorCode !== null });
  function fatal(code) {
    if (errorCode === null) errorCode = code;
    headerBytes = 0;
    payload = null;
    payloadBytes = 0;
  }
  function deliver(message) {
    try {
      const result = onMessage(message);
      if (result !== null && (typeof result === 'object' || typeof result === 'function')) {
        // Best effort: intrinsic then must complete species construction before
        // attaching reactions. Exotic constructors/species remain callback-owned.
        const nativePromise = isPromise(result);
        try {
          if (nativePromise) Promise.prototype.then.call(result, undefined, () => {});
        } catch {
          /* Constructor/species prevented handler attachment. */
        }
        if (nativePromise || typeof result.then === 'function') fatal('callback-failed');
      }
    } catch {
      fatal('callback-failed');
    }
  }
  function push(chunk) {
    if (errorCode !== null) return status();
    if (active) {
      fatal('decoder-reentrant');
      return status();
    }
    if (closed) {
      fatal('decoder-closed');
      return status();
    }
    if (isProxy(chunk) || !Buffer.isBuffer(chunk)) {
      fatal('chunk-invalid');
      return status();
    }
    let decodedCount = 0;
    let offset = 0;
    active = true;
    try {
      while (offset < chunk.length && errorCode === null) {
        if (headerBytes < 4) {
          const take = Math.min(4 - headerBytes, chunk.length - offset);
          chunk.copy(header, headerBytes, offset, offset + take);
          headerBytes += take;
          offset += take;
          if (headerBytes < 4) continue;
          const length = header.readUInt32LE(0);
          if (length < 1 || length > MAX_FRAME_BYTES) {
            fatal('frame-length-invalid');
            break;
          }
          payload = Buffer.allocUnsafe(length);
        }
        const take = Math.min(payload.length - payloadBytes, chunk.length - offset);
        chunk.copy(payload, payloadBytes, offset, offset + take);
        payloadBytes += take;
        offset += take;
        if (payloadBytes !== payload.length) continue;
        const message = validateMessage(parsePayload(payload), { direction: selectedDirection });
        headerBytes = 0;
        payload = null;
        payloadBytes = 0;
        deliver(message);
        if (errorCode === null) decodedCount++;
      }
    } catch (error) {
      fatal(fixed(error).code);
    } finally {
      active = false;
    }
    return status(decodedCount);
  }
  function finish() {
    if (errorCode !== null) return status();
    if (active) {
      fatal('decoder-reentrant');
      return status();
    }
    if (headerBytes || payloadBytes) fatal('frame-truncated');
    else closed = true;
    return status();
  }
  return {
    push,
    finish,
    pendingBytes: () => headerBytes + payloadBytes,
    isFatal: () => errorCode !== null,
  };
}

module.exports = { validateMessage, encodeFrame, createFrameDecoder };
