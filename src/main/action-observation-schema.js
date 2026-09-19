'use strict';

const CLIENTS = ['claude-code', 'claude', 'codex', 'cursor', 'vscode'];
const counters = [
  'selectedActionCount',
  'actionAttempts',
  'selectionRejected',
  'ownerInvocations',
  'ownerSettled',
  'ownerFailures',
  'cancellationRequests',
];
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const version = (value) => typeof value === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value);

/** Keep only a fixed client label and numeric release; both remain self-reported.
 * @param {object} info Untrusted initialize clientInfo. @returns {object} Bounded metadata. @since v0.15.1 */
function clientMetadata(info) {
  return {
    name: CLIENTS.includes(info.name) ? info.name : 'other',
    version: version(info.version) ? info.version : null,
  };
}

/** Validate the complete read-only wire snapshot, rejecting added private fields.
 * @param {unknown} value Parsed wire frame. @returns {boolean} Exact public schema. @since v0.15.1 */
function validObservation(value) {
  if (
    !exact(value, [
      'schemaVersion',
      'connectionId',
      'sequence',
      'route',
      'state',
      'client',
      'selection',
      ...counters,
    ])
  )
    return false;
  if (
    value.schemaVersion !== 1 ||
    typeof value.connectionId !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(value.connectionId) ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    value.sequence > 1000
  )
    return false;
  if (
    !['mcp-stdio', 'mcp-review'].includes(value.route) ||
    !['awaiting-client', 'observed', 'coverage-lost'].includes(value.state) ||
    !['single-action', 'catalog'].includes(value.selection)
  )
    return false;
  if (
    value.client !== null &&
    (!exact(value.client, ['name', 'version']) ||
      ![...CLIENTS, 'other'].includes(value.client.name) ||
      (value.client.version !== null && !version(value.client.version)))
  )
    return false;
  if (value.state === 'observed' && (!value.client || value.selectedActionCount < 1)) return false;
  if (
    !counters.every(
      (key) =>
        Number.isInteger(value[key]) &&
        value[key] >= 0 &&
        value[key] <=
          (key === 'selectedActionCount' ? (value.selection === 'catalog' ? 8 : 1) : 16),
    )
  )
    return false;
  return (
    value.ownerSettled <= value.ownerInvocations &&
    value.ownerInvocations + value.selectionRejected <= value.actionAttempts &&
    value.ownerFailures <= value.ownerSettled &&
    value.cancellationRequests <= value.actionAttempts
  );
}

/** Check monotonic counters and immutable connection metadata across heartbeats.
 * @param {object|null} prior Last valid frame. @param {object} next Candidate. @returns {boolean} Valid continuation. @since v0.15.1 */
function follows(prior, next) {
  return (
    (!prior && next.sequence === 1) ||
    (prior &&
      next.connectionId === prior.connectionId &&
      next.sequence === prior.sequence + 1 &&
      next.route === prior.route &&
      next.selection === prior.selection &&
      counters.every((key) => next[key] >= prior[key]) &&
      (prior.client === null || JSON.stringify(prior.client) === JSON.stringify(next.client)) &&
      (prior.state !== 'observed' || next.state !== 'awaiting-client') &&
      prior.state !== 'coverage-lost' &&
      (!prior.selectedActionCount || next.selectedActionCount === prior.selectedActionCount))
  );
}
module.exports = { clientMetadata, validObservation, follows };
