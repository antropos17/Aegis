'use strict';
const { randomBytes } = require('node:crypto');
const { captureGatewayRoute } = require('./mcp-gateway-route');
const { createSessionOperationBroker } = require('./session-operation-broker');
const { digestSessionBytes } = require('./session-authority');
const { LIMITS, parseModelRequest, parseModelResponse } = require('./model-contract');
const { exchangeModel } = require('./model-http-wire');
const { createKnownSecretGuard } = require('./mcp-gateway-secrets');
const refused = () => Object.freeze({ schemaVersion: 1, state: 'refused', launchAllowed: false });

/** Create a private owner model broker; this factory is never an IPC or launch boundary.
 * @param {{authority: object, ledger: object, endpointPath: string, model: string}} options Trusted owner scope.
 * @returns {Promise<object>} Private prepare, request and close interface. @since v0.17.0 */
async function createBoundedModelBroker({ authority, ledger, endpointPath, model }) {
  if (typeof model !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(model))
    throw Error('model-owner-invalid');
  const lifetime = new AbortController();
  const entries = new WeakMap();
  const retained = new Set();
  const expiresAt = Date.now() + LIMITS.lifetimeMs;
  let active,
    slot = 0,
    requestedOutputTokens = 0,
    route,
    guard,
    timer,
    closed = false;
  const discard = (entry) => {
    entry.owned.fill(0);
    entry.snapshot.fill(0);
    entry.text = '';
    entry.state = 'spent';
    retained.delete(entry);
  };
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    lifetime.abort();
    route?.close();
    guard?.close();
    for (const entry of retained) if (entry.state !== 'running') discard(entry);
  };
  let credentialTag;
  try {
    route = await captureGatewayRoute({ endpointPath }, lifetime.signal);
    const endpoint = await route.recheck();
    if (endpoint.protocol === 'https:' && endpoint.address !== '127.0.0.1') throw Error('invalid');
    guard = createKnownSecretGuard([endpoint.token]);
    guard.assertSafe({ model });
    const key = randomBytes(32);
    try {
      credentialTag = route.credentialTag(key);
    } finally {
      key.fill(0);
    }
    timer = setTimeout(close, Math.max(0, expiresAt - Date.now()));
    timer.unref?.();
  } catch {
    close();
    throw Error('model-owner-unavailable');
  }
  const session = createSessionOperationBroker({
    authority,
    ledger,
    dispatchers: {
      'model.request': async ({ request, signal }) => {
        const entry = active;
        const combined = AbortSignal.any([signal, lifetime.signal]);
        const input = parseModelRequest(request);
        guard.assertSafe(input);
        const selected = await route.recheck();
        if (combined.aborted || Date.now() >= expiresAt) throw Error('model-owner-unavailable');
        const response = await exchangeModel(
          selected,
          JSON.stringify({
            model,
            messages: input.messages,
            max_output_tokens: input.maxOutputTokens,
          }),
          combined,
        );
        try {
          const output = parseModelResponse(response, model);
          guard.assertSafe({ output });
          await route.recheck();
          if (combined.aborted) throw Error('model-owner-unavailable');
          entry.text = output;
          return { status: 'completed' };
        } finally {
          response.body.fill(0);
        }
      },
    },
  });
  return Object.freeze({
    prepare(operationId, bytes) {
      let owned;
      try {
        if (
          closed ||
          Date.now() >= expiresAt ||
          ++slot > LIMITS.attempts ||
          typeof operationId !== 'string' ||
          !/^[a-f0-9]{32}$/.test(operationId) ||
          !Buffer.isBuffer(bytes) ||
          bytes.length > LIMITS.bytes
        )
          throw Error('invalid');
        owned = Buffer.from(bytes);
        const input = parseModelRequest(owned);
        guard.assertSafe(input);
        if (
          Buffer.byteLength(
            JSON.stringify({
              model,
              messages: input.messages,
              max_output_tokens: input.maxOutputTokens,
            }),
          ) > LIMITS.bytes
        )
          throw Error('invalid');
        if (input.maxOutputTokens > LIMITS.ownerOutputTokens - requestedOutputTokens)
          throw Error('invalid');
        const reservedOutputTokens = requestedOutputTokens + input.maxOutputTokens;
        const snapshot = Buffer.from(
          JSON.stringify({
            model,
            route: route.identity,
            credentialTag,
            limits: LIMITS,
            slot,
            requestedOutputTokens: reservedOutputTokens,
          }),
        );
        const prepared = Object.freeze({
          binding: Object.freeze({
            operationId,
            operation: 'model.request',
            requestDigest: digestSessionBytes(owned),
            snapshotDigest: digestSessionBytes(snapshot),
            expiresAt,
          }),
        });
        const entry = { operationId, owned, snapshot, text: '', state: 'prepared' };
        requestedOutputTokens = reservedOutputTokens;
        entries.set(prepared, entry);
        retained.add(entry);
        return prepared;
      } catch {
        owned?.fill(0);
        throw Error('model-request-unavailable');
      }
    },
    async request(capability, prepared, { signal } = {}) {
      const entry = entries.get(prepared);
      if (closed || Date.now() >= expiresAt || !entry || entry.state !== 'prepared' || active) {
        if (active?.capability !== capability) authority.cancel(capability);
        if (entry?.state === 'prepared') discard(entry);
        return refused();
      }
      entry.state = 'running';
      entry.capability = capability;
      active = entry;
      let entered = false;
      try {
        const signals = signal ? [signal, lifetime.signal] : [lifetime.signal];
        const combined = AbortSignal.any(signals);
        entered = true;
        const result = await session.dispatch(
          capability,
          {
            operationId: entry.operationId,
            operation: 'model.request',
            request: entry.owned,
            snapshot: entry.snapshot,
          },
          { signal: combined },
        );
        return Object.freeze({
          ...result,
          ...(result.state === 'completed' ? { text: entry.text } : {}),
        });
      } catch {
        authority.cancel(capability);
        return Object.freeze({
          schemaVersion: 1,
          state: entered ? 'outcome-unknown' : 'refused',
          launchAllowed: false,
        });
      } finally {
        active = null;
        discard(entry);
        entries.delete(prepared);
      }
    },
    close,
  });
}
module.exports = { createBoundedModelBroker };
