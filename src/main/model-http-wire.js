'use strict';
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { createTlsAgent } = require('./mcp-gateway-tls');
const { LIMITS, validateModelResponseHeaders } = require('./model-contract');

/** Exchange one fixed loopback text request with host-only credential injection.
 * @param {object} endpoint Privately pinned parsed route. @param {string} body Owned serialized request.
 * @param {AbortSignal} signal Owner/capability lifetime.
 * @returns {Promise<object>} Private finite response; caller clears body. @since v0.17.0 */
function exchangeModel(endpoint, body, signal) {
  return new Promise((resolve, reject) => {
    let request,
      response,
      timer,
      settled = false,
      size = 0;
    const chunks = [];
    let agent;
    const finish = (failed, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      request?.destroy();
      response?.destroy();
      agent?.destroy();
      for (const chunk of chunks) chunk.fill(0);
      if (failed) reject(Error('model-upstream-unavailable'));
      else resolve(value);
    };
    const abort = () => finish(true);
    try {
      const secure = endpoint.protocol === 'https:';
      if (
        (secure && endpoint.address !== '127.0.0.1') ||
        Buffer.byteLength(body) > LIMITS.bytes ||
        signal.aborted
      )
        throw Error('model-route-invalid');
      agent = secure
        ? createTlsAgent(endpoint)
        : new http.Agent({ keepAlive: false, proxyEnv: {} });
      if (!secure)
        agent.createConnection = () =>
          net.createConnection({ host: '127.0.0.1', port: endpoint.port });
      request = (secure ? https : http).request(
        {
          hostname: secure ? endpoint.hostname : '127.0.0.1',
          port: endpoint.port,
          path: endpoint.path,
          method: 'POST',
          agent,
          maxHeaderSize: LIMITS.headers,
          headers: {
            ...(secure ? { Host: endpoint.hostHeader } : {}),
            Authorization: `Bearer ${endpoint.token}`,
            Origin: endpoint.origin,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (incoming) => {
          response = incoming;
          incoming.on('error', abort);
          incoming.on('aborted', abort);
          try {
            validateModelResponseHeaders({
              status: incoming.statusCode,
              headers: incoming.headers,
              rawHeaders: incoming.rawHeaders,
            });
          } catch {
            abort();
            return;
          }
          incoming.on('data', (chunk) => {
            if (settled) return;
            if ((size += chunk.length) > LIMITS.bytes) {
              abort();
              return;
            }
            chunks.push(Buffer.from(chunk));
          });
          incoming.on('end', () =>
            finish(false, {
              status: incoming.statusCode,
              headers: incoming.headers,
              rawHeaders: incoming.rawHeaders,
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      request.on('error', abort);
      request.on('information', abort);
      request.on('upgrade', (_reply, socket) => {
        socket.on('error', () => {});
        socket.destroy();
        abort();
      });
      timer = setTimeout(abort, LIMITS.timeoutMs);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      else request.end(body);
    } catch {
      abort();
    }
  });
}
module.exports = { exchangeModel };
