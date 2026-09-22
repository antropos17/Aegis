'use strict';
const { exchange, singleHeader, parseHttpReply } = require('./mcp-gateway-http-wire');

/** Own one explicit loopback HTTP session; cleanup acknowledgement does not prove tool termination.
 * @param {object} endpoint Validated private endpoint. @param {Function} onFailure Revoke admission.
 * @returns {object} Finite request/notification and bounded session cleanup. @since v0.15.1 */
function createHttpGatewayPeer(endpoint, onFailure) {
  let closed = false,
    started = false,
    sessionId,
    serial = 0,
    total = 0,
    pending,
    resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const onBytes = (bytes) => {
    total += bytes;
    if (total > 1048576) throw Error('http-total-limit');
  };
  async function cleanup(activeId) {
    let cancelled = true;
    if (activeId !== undefined) {
      try {
        const response = await exchange(endpoint, {
          sessionId,
          timeoutMs: 400,
          onBytes,
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'notifications/cancelled',
            params: { requestId: activeId },
          }),
        });
        try {
          cancelled = response.status === 202 && response.body.length === 0;
        } finally {
          response.body.fill(0);
        }
      } catch {
        cancelled = false;
      }
    }
    if (sessionId === undefined) return false;
    try {
      const response = await exchange(endpoint, {
        method: 'DELETE',
        sessionId,
        timeoutMs: 400,
        onBytes,
      });
      try {
        return cancelled && [200, 204, 404].includes(response.status) && response.body.length === 0;
      } finally {
        response.body.fill(0);
      }
    } catch {
      return false;
    }
  }
  const close = () => {
    if (closed) return;
    closed = true;
    const activeId = pending?.id;
    pending?.controller.abort();
    // Do not renew/replay after an error, including an expired session (HTTP 404).
    cleanup(activeId).then(resolveDone, () => resolveDone(false));
  };
  const fail = () => {
    if (!closed) {
      close();
      onFailure();
    }
  };
  async function send(method, params, notification) {
    if (closed || pending || serial >= 64) throw Error('http-upstream-unavailable');
    const initialize = method === 'initialize';
    if (initialize ? started : !sessionId) throw Error('http-session-unavailable');
    if (initialize) started = true;
    const id = notification ? undefined : ++serial;
    const controller = new AbortController();
    // MCP initialization is not cancellable; loss there may leave an unknown server session.
    const work = { id: initialize ? undefined : id, controller };
    pending = work;
    try {
      const response = await exchange(endpoint, {
        sessionId,
        signal: controller.signal,
        onBytes,
        body: JSON.stringify({
          jsonrpc: '2.0',
          ...(notification ? {} : { id }),
          method,
          ...(params === undefined ? {} : { params }),
        }),
      });
      try {
        if (closed) throw Error('http-closed');
        const returnedSession = singleHeader(response, 'mcp-session-id');
        if (initialize) {
          if (typeof returnedSession !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(returnedSession))
            throw Error('http-session-invalid');
          sessionId = returnedSession;
        } else if (returnedSession !== undefined && returnedSession !== sessionId)
          throw Error('http-session-changed');
        if (notification) {
          if (response.status !== 202 || response.body.length)
            throw Error('http-notification-rejected');
          return;
        }
        return parseHttpReply(response, id);
      } finally {
        response.body.fill(0);
      }
    } catch {
      fail();
      throw Error('http-upstream-unavailable');
    } finally {
      if (pending === work) pending = undefined;
    }
  }
  return {
    done,
    close,
    request: (method, params) => send(method, params, false),
    notify: (method) => send(method, undefined, true),
  };
}
module.exports = { createHttpGatewayPeer };
