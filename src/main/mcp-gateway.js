'use strict';
const { createHash } = require('node:crypto');
const { readActionFile, parseActionJson, equalActionValue: equal } = require('./action-policy');
const { captureGatewayRoute } = require('./mcp-gateway-route');
const { isExecutionRuntimeSupported } = require('./execution-runtime');
const { validManifest, matchesSchema, validResult } = require('./mcp-gateway-schema');
const VERSION = '2025-11-25';
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const only = (v, names) => object(v) && Object.keys(v).every((k) => names.includes(k));
const idValid = (id) =>
  (Number.isSafeInteger(id) && id >= 0) ||
  (typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(id));
const result = (id, value) => ({ jsonrpc: '2.0', id, result: value });
const error = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/** Gate an explicitly selected upstream server; grants bind exact tool/arguments for one attempt.
 * @param {object} options Exclusive stdio pair or HTTP endpoint, accepted manifest and failure hook.
 * @returns {object} Finite receive/close and owned child or session cleanup. @since v0.15.1 */
function createMcpGateway({ policyPath, requestPath, endpointPath, manifestPath, onFailure }) {
  let phase = 'new',
    closed = false,
    busy = false,
    route,
    peer,
    manifest,
    digest,
    activeId;
  const ids = new Set(),
    used = new Set();
  const controller = new AbortController();
  const close = (failed = false) => {
    if (closed) return;
    closed = true;
    phase = 'closed';
    controller.abort();
    route?.close();
    peer?.close();
    if (failed) onFailure();
  };
  const step = async (promise) => {
    let timer, abort;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          abort = () => reject(Error('gateway-closed'));
          controller.signal.addEventListener('abort', abort, { once: true });
          timer = setTimeout(() => {
            close(true);
            abort();
          }, 3000);
          if (closed) abort();
        }),
      ]);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', abort);
    }
  };
  const readManifest = async () => {
    const bytes = await readActionFile(manifestPath);
    try {
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (digest && digest !== hash) throw Error('manifest-changed');
      const value = parseActionJson(bytes);
      if (!validManifest(value)) throw Error('manifest-unsupported');
      digest = hash;
      return value;
    } finally {
      bytes.fill(0);
    }
  };
  const recheck = async () => {
    await step(readManifest());
    const selected = await step(route.recheck());
    if (closed) throw Error('server-authorization');
    return selected;
  };
  const checkCatalog = async () => {
    const listed = await step(peer.request('tools/list', {}));
    if (closed || !only(listed, ['tools']) || !equal(listed.tools, manifest.tools))
      throw Error('catalog-changed');
  };
  async function receive(message) {
    if (closed) return null;
    if (
      !only(message, ['jsonrpc', 'id', 'method', 'params']) ||
      message.jsonrpc !== '2.0' ||
      typeof message.method !== 'string'
    ) {
      close(true);
      return null;
    }
    if (!Object.hasOwn(message, 'id')) {
      if (
        message.method === 'notifications/cancelled' &&
        only(message.params, ['requestId', 'reason'])
      ) {
        if (busy && activeId !== undefined && message.params.requestId === activeId) close(true);
      } else if (
        message.method === 'notifications/initialized' &&
        phase === 'awaiting-client' &&
        (message.params === undefined ||
          (object(message.params) && !Object.keys(message.params).length))
      )
        phase = 'ready';
      else close(true);
      return null;
    }
    const id = message.id;
    if (!idValid(id) || ids.has(id) || ids.size >= 64)
      return error(idValid(id) ? id : null, -32600, 'gateway-request-invalid');
    ids.add(id);
    if (busy) return error(id, -32000, 'gateway-busy');
    if (message.method === 'initialize') {
      if (
        phase !== 'new' ||
        !only(message.params, ['protocolVersion', 'capabilities', 'clientInfo']) ||
        message.params.protocolVersion !== VERSION ||
        !object(message.params.capabilities) ||
        !object(message.params.clientInfo)
      )
        return error(id, -32602, 'gateway-initialize-invalid');
      busy = true;
      activeId = id;
      phase = 'initializing';
      try {
        if (!isExecutionRuntimeSupported()) throw Error('runtime');
        manifest = await step(readManifest());
        route = await step(
          captureGatewayRoute({ policyPath, requestPath, endpointPath }, controller.signal),
        );
        const launch = await recheck();
        if (closed) throw Error('closed');
        peer = route.open(launch, () => close(true));
        const initialized = await step(
          peer.request('initialize', {
            protocolVersion: VERSION,
            capabilities: {},
            clientInfo: { name: 'aegis-gateway', version: '1.0.0' },
          }),
        );
        if (
          closed ||
          !object(initialized) ||
          initialized.protocolVersion !== VERSION ||
          !object(initialized.capabilities?.tools)
        )
          throw Error('upstream-initialize');
        await step(Promise.resolve(peer.notify('notifications/initialized')));
        await checkCatalog();
        phase = 'awaiting-client';
        return result(id, {
          protocolVersion: VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'aegis-gateway', version: '1.0.0' },
        });
      } catch {
        close(true);
        return error(id, -32000, 'gateway-unavailable');
      } finally {
        busy = false;
        activeId = undefined;
      }
    }
    if (phase !== 'ready') return error(id, -32000, 'gateway-not-initialized');
    if (
      message.method === 'ping' &&
      (message.params === undefined ||
        (object(message.params) && !Object.keys(message.params).length))
    )
      return result(id, {});
    if (
      message.method === 'tools/list' &&
      (message.params === undefined ||
        (object(message.params) && !Object.keys(message.params).length))
    )
      return result(id, { tools: manifest.tools });
    if (message.method !== 'tools/call') return error(id, -32601, 'gateway-method-unsupported');
    const params = message.params;
    if (!only(params, ['name', 'arguments'])) return error(id, -32602, 'gateway-arguments-invalid');
    const tool = manifest.tools.find((item) => item.name === params.name);
    if (!tool || !matchesSchema(tool.inputSchema, params.arguments))
      return error(id, -32602, 'gateway-arguments-invalid');
    const grant = manifest.grants.findIndex(
      (item) => item.tool === params.name && equal(item.arguments, params.arguments),
    );
    if (grant < 0 || used.has(grant)) return error(id, -32000, 'gateway-grant-unavailable');
    // Consume before asynchronous work, even if upstream fails or the caller cancels.
    used.add(grant);
    busy = true;
    activeId = id;
    try {
      await recheck();
      await checkCatalog();
      await recheck();
      if (closed) throw Error('closed');
      const returned = await step(peer.request('tools/call', params));
      if (closed || !validResult(tool, returned)) throw Error('upstream-result');
      return result(id, returned);
    } catch {
      close(true);
      return error(id, -32000, 'gateway-call-failed');
    } finally {
      busy = false;
      activeId = undefined;
    }
  }
  return { receive, close: () => close(), finish: () => peer?.done || Promise.resolve(true) };
}
module.exports = { createMcpGateway };
