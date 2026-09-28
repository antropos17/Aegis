/**
 * Private, one-request wire contract for the inactive Protected Session helper.
 * Correlation IDs carry no caller authority. v1 can never report permission to launch.
 * @module main/protected-session-protocol
 */
'use strict';

const { TextDecoder } = require('node:util');
const PROTOCOL_VERSION = 1;
const MAX_FRAME_BYTES = 2048;
const PROTOCOL_NAME = 'aegis-protected-session';
const REQUEST_KEYS = ['operation', 'requestId', 'sessionId'];
const ID = /^[a-f0-9]{32}$/;

function invalid() {
  throw Error('protected-session-protocol-invalid');
}

function requestMessage(request) {
  if (
    !request ||
    Object.getPrototypeOf(request) !== Object.prototype ||
    Reflect.ownKeys(request).length !== REQUEST_KEYS.length ||
    !REQUEST_KEYS.every((key) => Object.hasOwn(request, key)) ||
    !['probe', 'prepare'].includes(request.operation) ||
    typeof request.requestId !== 'string' ||
    !ID.test(request.requestId) ||
    typeof request.sessionId !== 'string' ||
    !ID.test(request.sessionId)
  )
    invalid();
  return {
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    operation: request.operation,
    requestId: request.requestId,
    sessionId: request.sessionId,
  };
}

function encodeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  if (payload.length === 0 || payload.length > MAX_FRAME_BYTES) invalid();
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length);
  return Buffer.concat([header, payload]);
}

/**
 * Encode a canonical request. No PID, SID, path, command or approval is accepted.
 * @param {{operation: 'probe' | 'prepare', requestId: string, sessionId: string}} request Correlation metadata.
 * @returns {Buffer} One little-endian length-prefixed UTF-8 frame.
 * @since v0.17.0
 */
function encodeProtectedSessionRequest(request) {
  return encodeMessage(requestMessage(request));
}

/**
 * Accept only a complete, correlated, canonical refusal from the inactive helper.
 * Schema validation does not authenticate the helper or a caller.
 * @param {Buffer} frame Exactly one response frame, after transport EOF.
 * @param {{operation: 'probe' | 'prepare', requestId: string, sessionId: string}} request Trusted outstanding request metadata.
 * @returns {Readonly<object>} Fixed unavailable result. Never authorizes execution.
 * @since v0.17.0
 */
function decodeProtectedSessionResponse(frame, request) {
  const expected = {
    ...requestMessage(request),
    state: 'unavailable',
    reason: 'containment-unavailable',
    launchAllowed: false,
  };
  if (!Buffer.isBuffer(frame) || frame.length < 5 || frame.length > MAX_FRAME_BYTES + 4) invalid();
  const length = frame.readUInt32LE(0);
  if (length === 0 || length > MAX_FRAME_BYTES || frame.length !== length + 4) invalid();
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      frame.subarray(4),
    );
    JSON.parse(text);
  } catch {
    invalid();
  }
  // Exact canonical bytes reject duplicate/unknown keys and cross-session replies.
  if (!frame.equals(encodeMessage(expected))) invalid();
  return Object.freeze(expected);
}

module.exports = {
  PROTOCOL_VERSION,
  MAX_FRAME_BYTES,
  encodeProtectedSessionRequest,
  decodeProtectedSessionResponse,
};
