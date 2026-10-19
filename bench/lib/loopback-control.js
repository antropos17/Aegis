// @ts-check
'use strict';
const http = require('node:http');
const { openLoopbackReceiver, LIMITS } = require('./loopback-receiver');

/**
 * Send one fixed inert canary to a newly owned IPv4 loopback receiver and retain separate outcomes.
 * Sender finish acknowledges handoff to the OS; receiver verification independently checks bytes/hash/count.
 * @param {import('./loopback-receiver').Options} options Closed receiver options; no endpoint or payload input.
 * @returns {Promise<object>} Closed numeric/hash/ID receipt, without body, headers or error messages.
 * @since 0.19.2
 */
async function runLoopbackControl(options) {
  const receiver = await openLoopbackReceiver(options);
  const sender = {
    attempted: false,
    writeFinished: /** @type {boolean|null} */ (null),
    sentBytes: /** @type {number|null} */ (null),
    responseCompleted: /** @type {boolean|null} */ (null),
    statusCode: /** @type {number|null} */ (null),
    socketClosed: /** @type {boolean|null} */ (null),
    reason: /** @type {string|null} */ ('not-attempted'),
  };
  if (receiver.port !== null && receiver.remainingMs() > 0) {
    const payload = Buffer.from(
      `AEGIS_PUBLIC_INERT_LOOPBACK_V1\n${receiver.runId}\n${receiver.nonce}\n`,
      'ascii',
    );
    await new Promise((resolve) => {
      /** @type {import('node:http').ClientRequest|undefined} */
      let request;
      /** @type {import('node:net').Socket|undefined} */
      let socket;
      let settled = false,
        published = false;
      /** @type {NodeJS.Timeout|undefined} */
      let cleanupTimer;
      const timer = setTimeout(() => end('timeout'), Math.ceil(receiver.remainingMs()));
      const cancel = () => end('cancelled');
      const publish = () => {
        if (published) return;
        published = true;
        clearTimeout(cleanupTimer);
        sender.socketClosed = socket ? socket.closed : request === undefined;
        resolve(undefined);
      };
      /** @param {string|null} reason */
      function end(reason) {
        if (settled) return;
        settled = true;
        sender.reason = reason;
        clearTimeout(timer);
        receiver.signal?.removeEventListener('abort', cancel);
        request?.destroy();
        socket?.destroy();
        if (socket?.closed || !request) publish();
        else {
          cleanupTimer = setTimeout(publish, LIMITS.cleanupMs);
          socket?.once('close', publish);
        }
      }
      receiver.signal?.addEventListener('abort', cancel, { once: true });
      receiver.done.then((r) => {
        if (!settled) end(r.reason || 'receiver-ended');
      });
      if (receiver.signal?.aborted) {
        end('cancelled');
        return;
      }
      if (receiver.remainingMs() <= 0) {
        end('timeout');
        return;
      }
      sender.attempted = true;
      try {
        request = http.request(
          {
            host: '127.0.0.1',
            port: receiver.port,
            path: '/',
            method: 'POST',
            agent: false,
            maxHeaderSize: 2048,
            headers: {
              'Content-Length': payload.length,
              Connection: 'close',
              'Content-Type': 'application/octet-stream',
            },
          },
          (response) => {
            if (settled) {
              response.destroy();
              return;
            }
            sender.statusCode = response.statusCode ?? null;
            let responseBytes = 0;
            response.on('error', () => end('response-unavailable'));
            response.on('data', (chunk) => {
              responseBytes += chunk.length;
              if (responseBytes > 0) end('response-invalid');
            });
            response.on('end', () => {
              if (settled) return;
              sender.responseCompleted = response.complete;
              end(
                response.complete && response.statusCode === 204 && responseBytes === 0
                  ? null
                  : 'response-invalid',
              );
            });
            response.on('close', () => {
              if (!settled && !response.complete) end('response-unavailable');
            });
          },
        );
        request.once('socket', (value) => {
          socket = value;
          if (settled) socket.destroy();
        });
        request.once('finish', () => {
          if (!settled) {
            sender.writeFinished = true;
            sender.sentBytes = payload.length;
            // Half-close only this owned writer so the receiver can finish its HTTP parser.
            socket?.end();
          }
        });
        request.on('error', () => end('request-unavailable'));
        if (receiver.remainingMs() <= 0) end('timeout');
        else request.end(payload);
      } catch {
        end('request-unavailable');
      }
    });
  }
  const outcome = await receiver.finish();
  const result = {
    version: 'loopback-control/1',
    runId: receiver.runId,
    nonce: receiver.nonce,
    scope: 'controlled-node-loopback',
    sender,
    receiver: outcome,
    confirmed:
      sender.reason === null &&
      sender.socketClosed === true &&
      outcome.exact === true &&
      outcome.cleanup.confirmed,
    limits: LIMITS,
  };
  if (Buffer.byteLength(JSON.stringify(result)) > LIMITS.outputBytes)
    throw Error('loopback-output-too-large');
  return structuredClone(result);
}

module.exports = { runLoopbackControl };
