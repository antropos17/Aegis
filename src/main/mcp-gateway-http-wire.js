'use strict';
const http = require('node:http');
const https = require('node:https');
const { createTlsAgent } = require('./mcp-gateway-tls');
const net = require('node:net');
const { TextDecoder } = require('node:util');
const { parseActionJson } = require('./action-policy');
const LIMITS = Object.freeze({ bodyBytes: 16384, headerBytes: 8192 });

/** Make one finite request to the already validated fixed HTTP or HTTPS endpoint.
 * @param {object} endpoint Private fixed port/path/token.
 * @param {object} options Method, body, session, deadline, signal and byte-accounting callback.
 * @returns {Promise<object>} Bounded response; caller must clear its private body. @since v0.15.1 */
function exchange(
  endpoint,
  { method = 'POST', body = '', sessionId, timeoutMs = 3000, signal, onBytes },
) {
  return new Promise((resolve, reject) => {
    let request,
      response,
      timer,
      settled = false,
      size = 0,
      informational = 0;
    const chunks = [];
    // Dedicated agent and literal connection: no DNS, global agent, proxy env or pool reuse.
    const secure = endpoint.protocol === 'https:';
    const agent = secure
      ? createTlsAgent(endpoint)
      : new http.Agent({ keepAlive: false, proxyEnv: {} });
    if (!secure)
      agent.createConnection = () =>
        net.createConnection({ host: '127.0.0.1', port: endpoint.port });
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      request?.destroy();
      response?.destroy();
      agent.destroy();
      for (const chunk of chunks) chunk.fill(0);
      if (error) reject(Error('http-upstream-unavailable'));
      else resolve(value);
    };
    const abort = () => finish(true);
    try {
      if (Buffer.byteLength(body) > LIMITS.bodyBytes) throw Error('limit');
      request = (secure ? https : http).request(
        {
          hostname: secure ? endpoint.hostname : '127.0.0.1',
          port: endpoint.port,
          path: endpoint.path,
          method,
          agent,
          maxHeaderSize: LIMITS.headerBytes,
          headers: {
            ...(secure ? { Host: endpoint.hostHeader } : {}),
            Authorization: `Bearer ${endpoint.token}`,
            Origin: endpoint.origin,
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'MCP-Protocol-Version': '2025-11-25',
            ...(sessionId === undefined ? {} : { 'MCP-Session-Id': sessionId }),
          },
        },
        (incoming) => {
          response = incoming;
          incoming.on('error', abort);
          incoming.on('aborted', abort);
          incoming.on('data', (chunk) => {
            if (settled) return;
            size += chunk.length;
            try {
              onBytes?.(chunk.length);
              if (size > LIMITS.bodyBytes) throw Error('limit');
            } catch {
              abort();
              return;
            }
            chunks.push(Buffer.from(chunk));
          });
          incoming.on('end', () => {
            if (!settled)
              finish(false, {
                status: incoming.statusCode,
                headers: incoming.headers,
                rawHeaders: incoming.rawHeaders,
                body: Buffer.concat(chunks),
              });
          });
        },
      );
      request.on('error', abort);
      request.on('information', () => {
        if (++informational > 4) abort();
      });
      request.on('upgrade', (_response, socket) => {
        socket.on('error', () => {});
        socket.destroy();
        abort();
      });
      timer = setTimeout(abort, timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      else request.end(body);
    } catch {
      abort();
    }
  });
}

/** Reject duplicate security-relevant headers instead of trusting Node's joined value.
 * @param {object} response HTTP response metadata. @param {string} name Lowercase header name.
 * @returns {string|undefined} One header value. @since v0.15.1 */
function singleHeader(response, name) {
  let count = 0;
  for (let i = 0; i < response.rawHeaders.length; i += 2)
    if (response.rawHeaders[i].toLowerCase() === name) count++;
  if (count > 1) throw Error('http-header-invalid');
  return response.headers[name];
}

function sseJson(body) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.pop() !== '') throw Error('http-sse-incomplete');
  if (lines.length > 128) throw Error('http-sse-limit');
  let data = [],
    event = '',
    reply;
  for (const line of lines) {
    if (!line) {
      const content = data.join('\n');
      if (content) {
        if (reply !== undefined || (event && event !== 'message')) throw Error('http-sse-invalid');
        reply = parseActionJson(Buffer.from(content));
      }
      data = [];
      event = '';
      continue;
    }
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
    else if (field === 'id' && value.length <= 128 && !value.includes('\0')) {
      /* No resumption. */
    } else if (field === 'retry' && /^\d{1,5}$/.test(value)) {
      /* No automatic retry. */
    } else throw Error('http-sse-invalid');
  }
  if (data.length || event || reply === undefined) throw Error('http-sse-incomplete');
  return reply;
}

/** Decode one correlated reply from finite JSON or SSE; reverse traffic is never forwarded.
 * @param {object} response Bounded HTTP response. @param {number} id Expected upstream ID.
 * @returns {unknown} Private JSON-RPC result. @since v0.15.1 */
function parseHttpReply(response, id) {
  const type = singleHeader(response, 'content-type');
  if (
    response.status !== 200 ||
    singleHeader(response, 'content-encoding') !== undefined ||
    typeof type !== 'string'
  )
    throw Error('http-response-invalid');
  let message;
  if (/^application\/json(?:;\s*charset=utf-8)?$/i.test(type))
    message = parseActionJson(response.body);
  else if (/^text\/event-stream(?:;\s*charset=utf-8)?$/i.test(type))
    message = sseJson(response.body);
  else throw Error('http-content-type');
  if (
    !message ||
    typeof message !== 'object' ||
    Array.isArray(message) ||
    message.jsonrpc !== '2.0' ||
    message.id !== id ||
    Object.keys(message).length !== 3 ||
    !Object.hasOwn(message, 'result')
  )
    throw Error('http-rpc-invalid');
  return message.result;
}
module.exports = { exchange, singleHeader, parseHttpReply, LIMITS };
