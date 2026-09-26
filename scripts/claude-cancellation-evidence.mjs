import schema from '../src/main/action-observation-schema.js';

/** Validate a checkpoint without inferring termination from its counters.
 * @param {object} value Public observer frame. @param {boolean} catalog Catalog route.
 * @param {number} attempts Expected invocations. @param {number} settled Expected settlements.
 * @param {number} cancelled Expected notifications. @param {string} [route] Expected route.
 * @returns {boolean} Complete matching frame.
 * @since v0.15.1 */
export function frame(value, catalog, attempts, settled, cancelled, route = 'mcp-stdio') {
  const s = value?.snapshot;
  return (
    !!value &&
    Object.keys(value).length === 4 &&
    typeof value.lastObservedAt === 'string' &&
    Number.isFinite(Date.parse(value.lastObservedAt)) &&
    schema.validObservation(s) &&
    s.route === route &&
    s.selection === (catalog ? 'catalog' : 'single-action') &&
    s.selectedActionCount === (catalog ? 2 : 1) &&
    s.actionAttempts === attempts &&
    s.ownerInvocations === attempts &&
    s.ownerSettled === settled &&
    s.cancellationRequests === cancelled &&
    s.selectionRejected === 0 &&
    s.ownerFailures === 0
  );
}

/** Require delivery, real execution, held-child termination and post-cancel live state separately.
 * @param {object} e Redacted fixture evidence. @returns {boolean} Complete cancellation proof.
 * @since v0.15.1 */
export function cancellationPassed(e) {
  const match = (...args) => frame(...args, e?.review ? 'mcp-review' : 'mcp-stdio');
  if (
    !e ||
    e.failure !== null ||
    typeof e.catalog !== 'boolean' ||
    e.providerIdentity !== 'unverified' ||
    e.interruptSent !== true ||
    e.interruptAcknowledged !== true ||
    e.progressObserved !== true ||
    e.progressStopped !== true ||
    e.endpointRemoved !== true ||
    e.stickyLoss !== true ||
    e.unusedBytes !== 0 ||
    e.timedOut ||
    e.cancelled ||
    e.exceeded ||
    !e.toolDiscovered ||
    e.requests < 1 ||
    e.requests > 3
  )
    return false;
  const terminal = e.providerResult;
  if (
    !terminal ||
    !(
      (e.exitCode === 1 &&
        terminal.subtype === 'error_during_execution' &&
        terminal.isError === true) ||
      (e.exitCode === 0 && terminal.subtype === 'success' && terminal.isError === false)
    )
  )
    return false;
  const w = e.witness;
  if (
    !w ||
    Object.keys(w).length !== 6 ||
    w.launches !== 1 ||
    !['exited', 'closed', 'cancelled', 'interrupted', 'terminationConfirmed'].every(
      (k) => w[k] === true,
    )
  )
    return false;
  if (
    !match(e.before, e.catalog, 0, 0, 0) ||
    !match(e.pending, e.catalog, 1, 0, 0) ||
    !match(e.after, e.catalog, 1, 1, 1) ||
    !match(e.lost, e.catalog, 1, 1, 1)
  )
    return false;
  if (
    ![e.before, e.pending, e.after].every(
      (v) => v.state === 'observed' && v.reason === null && v.snapshot.state === 'observed',
    ) ||
    e.lost.state !== 'coverage-lost' ||
    !['connection-closed', 'owner-closed'].includes(e.lost.reason)
  )
    return false;
  let prior = e.before;
  for (const next of [e.pending, e.after, e.lost]) {
    if (
      next.snapshot.connectionId !== prior.snapshot.connectionId ||
      JSON.stringify(next.snapshot.client) !== JSON.stringify(prior.snapshot.client) ||
      next.snapshot.sequence < prior.snapshot.sequence ||
      (next !== e.lost && next.snapshot.sequence === prior.snapshot.sequence)
    )
      return false;
    prior = next;
  }
  return true;
}
