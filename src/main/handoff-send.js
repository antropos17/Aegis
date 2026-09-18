'use strict';

const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { TextDecoder } = require('node:util');
const { validToken } = require('./handoff-live');
const { createAgentEventReceiver, LIMITS } = require('./agent-event-receiver');

/**
 * Forward one bounded hook input to a fixed loopback endpoint. Unknown fields
 * never cross the socket; no referenced files are read and no retry is attempted.
 * @param {NodeJS.ReadableStream} input Hook stdin.
 * @param {{port: number, token: string}} options Receiver port and ephemeral bearer.
 * @returns {Promise<number>} 0 for an empty 204 receipt, otherwise 1; never a policy verdict.
 * @since v0.15.1
 */
async function sendHandoffEvent(input, { port, token }) {
  if (!validToken(token) || !Number.isInteger(port) || port < 1 || port > 65535) return 1;
  const chunks = [];
  let bytes = 0;
  const timer = setTimeout(() => input.destroy(), 2000);
  let body;
  try {
    for await (const chunk of input) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > LIMITS.lineBytes) return 1;
      chunks.push(buffer);
    }
    const raw = Buffer.concat(chunks, bytes);
    const receiver = createAgentEventReceiver();
    const source = receiver.register('claude-code-offline');
    const result = receiver.receive(source, 1, raw);
    receiver.close(source);
    if (result.status !== 'accepted') return 1;
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    body = JSON.stringify({
      hook_event_name: parsed.hook_event_name,
      session_id: parsed.session_id,
      agent_id: parsed.agent_id,
    });
  } catch (_) {
    return 1;
  } finally {
    clearTimeout(timer);
    chunks.length = 0;
  }
  return new Promise((resolve) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/v1/lifecycle',
      method: 'POST',
      agent: false,
      maxHeaderSize: 4096,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Aegis-Version': '1',
        'X-Aegis-Delivery': randomUUID(),
        Connection: 'close',
      },
    });
    const deadline = setTimeout(() => {
      request.destroy();
      resolve(1);
    }, 2000);
    const finish = (code) => {
      clearTimeout(deadline);
      resolve(code);
    };
    request.on('error', () => finish(1));
    request.on('response', (response) => {
      // Never interpret a peer's body as hook output or follow redirects.
      const ok = response.statusCode === 204;
      response.destroy();
      finish(ok ? 0 : 1);
    });
    request.end(body);
  });
}

module.exports = { sendHandoffEvent };
