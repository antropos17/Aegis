'use strict';
const { randomUUID } = require('node:crypto');
const CODES = Object.freeze(['consumed', 'dispatch', 'completed', 'failed']);
const LIMIT = 256;
/** Capture advisory owner events without changing gateway results. Async delivery is bounded.
 * @param {Function|undefined} callback Trusted owner observer, never RPC input.
 * @returns {object} Emit, status and bounded finalization. @since v0.17.0 */
function createGatewayEvidence(callback) {
  let sequence = 0,
    lost = 0,
    sealed = false;
  const pending = new Set();
  const enabled = typeof callback === 'function';
  const loss = () => {
    lost = Math.min(65535, lost + 1);
  };
  const status = () =>
    Object.freeze({ enabled, emitted: sequence, lost, pending: pending.size, sealed });
  const emit = (code, operationId) => {
    if (!enabled) return;
    if (
      sealed ||
      sequence >= LIMIT ||
      !CODES.includes(code) ||
      typeof operationId !== 'string' ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(operationId)
    ) {
      loss();
      return;
    }
    const event = Object.freeze({ schemaVersion: 1, seq: sequence++, operationId, code });
    try {
      const returned = callback(event);
      if (returned != null && typeof returned.then === 'function') {
        const ticket = { accounted: false };
        pending.add(ticket);
        Promise.resolve(returned).then(
          () => pending.delete(ticket),
          () => {
            pending.delete(ticket);
            if (!ticket.accounted) {
              ticket.accounted = true;
              loss();
            }
          },
        );
      }
    } catch {
      loss();
    }
  };
  const finish = async () => {
    sealed = true;
    const deadline = Date.now() + 250;
    while (pending.size && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    for (const ticket of pending)
      if (!ticket.accounted) {
        ticket.accounted = true;
        loss();
      }
    return status();
  };
  return { emit, status, finish, operationId: () => randomUUID() };
}
module.exports = { createGatewayEvidence };
