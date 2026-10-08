'use strict';

const { digestSessionBytes, LIMITS } = require('./session-authority');
const receipt = (state) => Object.freeze({ schemaVersion: 1, state, launchAllowed: false });

/** Dispatch one bound attempt through fixed trusted owner callbacks.
 * This is reusable broker logic, with no native containment or production launch.
 * The callback must honor its AbortSignal; abort after dispatch cannot undo effects.
 * Callback contents/errors are never included in receipts and unknown outcomes never retry.
 * @param {{authority: object, ledger: object, dispatchers: object}} options Private owner dependencies.
 * @returns {{dispatch: function}} Bound one-attempt dispatch interface. @since v0.17.0 */
function createSessionOperationBroker({ authority, ledger, dispatchers }) {
  const callbacks = new Map(Object.entries(dispatchers));
  if (!callbacks.size || [...callbacks.values()].some((callback) => typeof callback !== 'function'))
    throw Error('session-dispatcher-invalid');
  return Object.freeze({
    async dispatch(capability, request, { signal } = {}) {
      let binding, raw, snapshot, operationSignal, abort;
      let dispatched = false;
      try {
        if (signal?.aborted) {
          authority.cancel(capability);
          return receipt('refused');
        }
        if (
          !request ||
          Object.getPrototypeOf(request) !== Object.prototype ||
          Reflect.ownKeys(request).length !== 4 ||
          !['operationId', 'operation', 'request', 'snapshot'].every(
            (key) =>
              Object.hasOwn(request, key) &&
              'value' in Object.getOwnPropertyDescriptor(request, key),
          ) ||
          !Buffer.isBuffer(request.request) ||
          !Buffer.isBuffer(request.snapshot) ||
          request.request.length > LIMITS.bytes ||
          request.snapshot.length > LIMITS.bytes ||
          !callbacks.has(request.operation)
        ) {
          authority.cancel(capability);
          return receipt('refused');
        }
        raw = Buffer.from(request.request);
        snapshot = Buffer.from(request.snapshot);
        binding = authority.reserve(capability, {
          operationId: request.operationId,
          operation: request.operation,
          requestDigest: digestSessionBytes(raw),
          snapshotDigest: digestSessionBytes(snapshot),
        });
        operationSignal = authority.signal(capability);
        abort = () => authority.cancel(capability);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        const consumption = await ledger.consume(binding);
        if (!authority.reserved(capability)) {
          await ledger.settle(binding, 'not-dispatched');
          return receipt('refused');
        }
        await ledger.recheckConsumption(consumption, binding);
        if (!authority.reserved(capability)) {
          await ledger.settle(binding, 'not-dispatched');
          return receipt('refused');
        }
        let stop;
        const cancelled = new Promise((resolve) => {
          stop = () => resolve('outcome-unknown');
          operationSignal.addEventListener('abort', stop, { once: true });
        });
        dispatched = true;
        let state;
        try {
          const work = Promise.resolve(
            callbacks.get(binding.operation)({
              request: raw,
              snapshot,
              signal: operationSignal,
            }),
          ).then(
            (value) => (value?.status === 'completed' ? 'completed' : 'outcome-unknown'),
            () => 'outcome-unknown',
          );
          state = await Promise.race([work, cancelled]);
          if (operationSignal.aborted) state = 'outcome-unknown';
        } catch {
          state = 'outcome-unknown';
        } finally {
          operationSignal.removeEventListener('abort', stop);
        }
        const terminal = await ledger.settle(binding, state, { signal: operationSignal });
        return receipt(terminal.state);
      } catch {
        return receipt(dispatched ? 'outcome-unknown' : 'refused');
      } finally {
        signal?.removeEventListener('abort', abort);
        if (binding) authority.finish(capability);
        raw?.fill(0);
        snapshot?.fill(0);
      }
    },
  });
}

module.exports = { createSessionOperationBroker };
