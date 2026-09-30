'use strict';
const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
/** Copy finite evidence details before audit-logger buffers them by reference.
 * @param {object} audit Actual logger API. @param {object} event Owner gateway event.
 * @returns {void} No raw request, path or upstream fields. @since v0.17.0 */
function logGatewayEvidence(audit, event) {
  if (
    !event ||
    Object.keys(event).length !== 4 ||
    event.schemaVersion !== 1 ||
    !Number.isSafeInteger(event.seq) ||
    event.seq < 0 ||
    event.seq > 255 ||
    !uuid(event.operationId) ||
    !['consumed', 'dispatch', 'completed', 'failed'].includes(event.code)
  )
    throw Error('evidence-event-invalid');
  const extra = Object.freeze({
    schemaVersion: 1,
    seq: event.seq,
    operationId: event.operationId,
    code: event.code,
  });
  audit.log('gateway-evidence', { action: event.code, extra });
}
module.exports = { logGatewayEvidence };
