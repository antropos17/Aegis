'use strict';
const path = require('node:path');
const { debuglog } = require('node:util');
const { createHash } = require('node:crypto');
const { readActionFile, parseActionJson } = require('./action-policy');
const { captureExecutionBinding, revokeExecutionBinding } = require('./execution-binding');
const { prepareExecution } = require('./execution-policy');
const { createGatewayPeer } = require('./mcp-gateway-peer');
const { createHttpGatewayPeer } = require('./mcp-gateway-http-peer');
const { parseHttpsEndpoint } = require('./mcp-gateway-tls');

/** Validate the explicit HTTP or pinned HTTPS profile without normalizing an untrusted URL.
 * @param {object} value Operator-selected descriptor. @returns {object} Private connection parameters.
 * @since v0.15.1 */
function parseHttpEndpoint(value) {
  if (value?.schemaVersion === 2) return parseHttpsEndpoint(value);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 3 ||
    value.schemaVersion !== 1 ||
    typeof value.url !== 'string' ||
    value.url.length > 512 ||
    typeof value.bearerToken !== 'string' ||
    value.bearerToken.length < 32 ||
    value.bearerToken.length > 256 ||
    /[^A-Za-z0-9_-]/.test(value.bearerToken)
  )
    throw Error('http-endpoint-invalid');
  const match =
    /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})(\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)$/.exec(value.url);
  if (
    !match ||
    match[0] !== value.url ||
    match[2].length > 256 ||
    Number(match[1]) < 1024 ||
    Number(match[1]) > 65535
  )
    throw Error('http-endpoint-invalid');
  return {
    port: Number(match[1]),
    path: match[2],
    origin: `http://127.0.0.1:${match[1]}`,
    token: value.bearerToken,
  };
}

/** Capture exactly one selected upstream route; configuration capture grants no tool attempt.
 * @param {object} options Exclusive stdio policy/request or HTTP descriptor path.
 * @param {AbortSignal} signal Owning connection lifetime.
 * @returns {Promise<object>} Reread, open and revoke operations. @since v0.15.1 */
async function captureGatewayRoute({ policyPath, requestPath, endpointPath }, signal) {
  if (signal.aborted) throw Error('gateway-route-closed');
  let binding,
    closed = false;
  const close = () => {
    closed = true;
    if (binding) revokeExecutionBinding(binding);
    signal.removeEventListener('abort', close);
  };
  signal.addEventListener('abort', close, { once: true });
  try {
    if (endpointPath !== undefined) {
      // Node's cached HTTP diagnostics can print Authorization headers before our error handling.
      if (['http', 'net', 'https', 'tls'].some((name) => debuglog(name).enabled))
        throw Error('http-runtime-unsupported');
      if (
        policyPath !== undefined ||
        requestPath !== undefined ||
        typeof endpointPath !== 'string' ||
        !endpointPath
      )
        throw Error('gateway-route-invalid');
      const selectedPath = path.resolve(endpointPath);
      let digest;
      const recheck = async () => {
        if (closed) throw Error('gateway-route-closed');
        const bytes = await readActionFile(selectedPath);
        try {
          const hash = createHash('sha256').update(bytes).digest('hex');
          if (closed || (digest && hash !== digest)) throw Error('gateway-route-changed');
          const endpoint = parseHttpEndpoint(parseActionJson(bytes));
          // Node removes embedded quotes/escapes while parsing NODE_OPTIONS.
          // Strip them conservatively so diagnostics cannot hide their flag spelling.
          if (
            endpoint.protocol === 'https:' &&
            /--(?:tls[-_]keylog|trace[-_]tls|experimental[-_](?:default[-_])?config[-_]file)/.test(
              [...process.execArgv, process.env.NODE_OPTIONS || ''].join(' ').replace(/["\\]/g, ''),
            )
          )
            throw Error('http-runtime-unsupported');
          digest = hash;
          return endpoint;
        } finally {
          bytes.fill(0);
        }
      };
      const endpoint = await recheck();
      const identity = Object.freeze(
        endpoint.protocol === 'https:'
          ? {
              transport: 'https',
              url: endpoint.origin + endpoint.path,
              connectAddress: endpoint.address,
              certificateSha256: endpoint.certificateSha256,
            }
          : { transport: 'http', url: endpoint.origin + endpoint.path },
      );
      return { close, recheck, open: createHttpGatewayPeer, identity };
    }
    binding = await captureExecutionBinding(policyPath, requestPath, { signal });
    if (closed) {
      revokeExecutionBinding(binding);
      throw Error('gateway-route-closed');
    }
    return {
      close,
      open: createGatewayPeer,
      recheck: async () => {
        const prepared = await prepareExecution(policyPath, requestPath, { binding });
        if (closed || prepared.decision !== 'allow') throw Error('server-authorization');
        return prepared.launch;
      },
    };
  } catch {
    close();
    throw Error('gateway-route-unavailable');
  }
}
module.exports = { captureGatewayRoute, parseHttpEndpoint };
