'use strict';
const { parseActionJson } = require('./action-policy');
const { singleHeader } = require('./mcp-gateway-http-wire');
const { TextDecoder } = require('node:util');
const LIMITS = Object.freeze({
  bytes: 16384,
  headers: 8192,
  timeoutMs: 3000,
  lifetimeMs: 60000,
  attempts: 16,
  concurrent: 1,
  outputTokens: 256,
});
const exact = (v, fields) =>
  v &&
  Object.getPrototypeOf(v) === Object.prototype &&
  Object.keys(v).length === fields.length &&
  fields.every((key) => Object.hasOwn(v, key));
const text = (v) =>
  typeof v === 'string' && !/[\ud800-\udfff]/u.test(v) && Buffer.byteLength(v) <= LIMITS.bytes;

/** Validate the finite text-only request profile; tools and model selection are not input.
 * @param {Buffer} bytes Owned request bytes. @returns {object} Private parsed text request. @since v0.17.0 */
function parseModelRequest(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > LIMITS.bytes) throw Error('model-request-invalid');
  const value = parseActionJson(bytes);
  if (
    !exact(value, ['messages', 'maxOutputTokens']) ||
    !Array.isArray(value.messages) ||
    !value.messages.length ||
    value.messages.length > 4 ||
    !value.messages.every(
      (message) =>
        exact(message, ['role', 'content']) && message.role === 'user' && text(message.content),
    ) ||
    !Number.isSafeInteger(value.maxOutputTokens) ||
    value.maxOutputTokens < 1 ||
    value.maxOutputTokens > LIMITS.outputTokens
  )
    throw Error('model-request-invalid');
  return value;
}

/** Validate the response profile before admitting any upstream body bytes.
 * @param {object} response Status and raw headers from the bounded transport.
 * @returns {string} Accepted content type. @since v0.19.2 */
function validateModelResponseHeaders(response) {
  const type = singleHeader(response, 'content-type');
  if (
    response.status !== 200 ||
    singleHeader(response, 'content-encoding') !== undefined ||
    !/^(?:application\/json|text\/event-stream)(?:;\s*charset=utf-8)?$/i.test(type || '')
  )
    throw Error('model-response-invalid');
  return type;
}

/** Reconstruct a finite JSON or ordered SSE result, requiring explicit completion.
 * @param {object} response Bounded transport response. @param {string} model Fixed owner model.
 * @returns {string} Private reconstructed text, still requiring secret scanning. @since v0.17.0 */
function parseModelResponse(response, model) {
  const type = validateModelResponseHeaders(response);
  if (!Buffer.isBuffer(response.body) || response.body.length > LIMITS.bytes)
    throw Error('model-response-invalid');
  if (/^application\/json(?:;\s*charset=utf-8)?$/i.test(type || '')) {
    const value = parseActionJson(response.body);
    if (
      !exact(value, ['model', 'output', 'finishReason']) ||
      value.model !== model ||
      value.finishReason !== 'stop' ||
      !text(value.output)
    )
      throw Error('model-response-invalid');
    return value.output;
  }
  if (!/^text\/event-stream(?:;\s*charset=utf-8)?$/i.test(type || ''))
    throw Error('model-response-invalid');
  const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
    .decode(response.body)
    .replaceAll('\r\n', '\n');
  if (!raw.endsWith('\n\n')) throw Error('model-stream-incomplete');
  const frames = raw.slice(0, -2).split('\n\n');
  if (frames.length < 3 || frames.length > 34) throw Error('model-stream-invalid');
  let output = '';
  for (let i = 0; i < frames.length; i++) {
    const lines = frames[i].split('\n');
    if (lines.length !== 2 || !lines[1].startsWith('data: ')) throw Error('model-stream-invalid');
    const value = parseActionJson(Buffer.from(lines[1].slice(6)));
    if (i === 0) {
      if (lines[0] !== 'event: start' || !exact(value, ['model']) || value.model !== model)
        throw Error('model-stream-invalid');
    } else if (i === frames.length - 1) {
      if (
        lines[0] !== 'event: complete' ||
        !exact(value, ['finishReason']) ||
        value.finishReason !== 'stop'
      )
        throw Error('model-stream-invalid');
    } else {
      if (lines[0] !== 'event: delta' || !exact(value, ['text']) || !text(value.text))
        throw Error('model-stream-invalid');
      output += value.text;
      if (!text(output)) throw Error('model-stream-invalid');
    }
  }
  return output;
}
module.exports = { LIMITS, parseModelRequest, parseModelResponse, validateModelResponseHeaders };
