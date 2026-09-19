/** TEST ONLY: observe the production terminal broker without supplying any answer. */
import fs from 'node:fs';
import client from '../src/main/action-observation-client.js';
import schema from '../src/main/action-observation-schema.js';
const probes = new WeakMap();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, ms) {
  const deadline = performance.now() + ms;
  while (performance.now() < deadline) {
    if (predicate()) return true;
    await pause(25);
  }
  return predicate();
}
function frame(value, attempts, settled) {
  const s = value?.snapshot;
  return !!(
    value &&
    Object.keys(value).length === 4 &&
    typeof value.lastObservedAt === 'string' &&
    Number.isFinite(Date.parse(value.lastObservedAt)) &&
    schema.validObservation(s) &&
    s.route === 'mcp-review' &&
    s.selection === 'single-action' &&
    s.selectedActionCount === 1 &&
    s.actionAttempts === attempts &&
    s.ownerInvocations === attempts &&
    s.ownerSettled === settled &&
    s.ownerFailures === 0 &&
    s.selectionRejected === 0 &&
    s.cancellationRequests === 0
  );
}
const live = (value) =>
  value?.state === 'observed' && value.reason === null && value.snapshot.state === 'observed';

/** Validate pending review, settled result or disconnect, and independent observer cleanup.
 * @param {object} e Redacted observation evidence. @param {string} name Fixed review case.
 * @returns {boolean} Whether every required checkpoint agrees. @since v0.15.1 */
export function reviewObservationPassed(e, name) {
  if (
    !e ||
    !['approved-ask', 'declined-ask', 'policy-deny', 'disconnect-during-review'].includes(name) ||
    e.failure !== null ||
    e.providerIdentity !== 'unverified' ||
    e.endpointRemoved !== true ||
    e.stickyLoss !== true ||
    !frame(e.before, 0, 0) ||
    !live(e.before)
  )
    return false;
  const cancelled = name === 'disconnect-during-review';
  if (name === 'policy-deny') {
    if (e.pending !== null || e.pendingEffect !== null) return false;
  } else if (!frame(e.pending, 1, 0) || !live(e.pending) || e.pendingEffect !== false) return false;
  if (cancelled ? e.after !== null : !frame(e.after, 1, 1) || !live(e.after)) return false;
  if (
    !e.lost ||
    e.lost.state !== 'coverage-lost' ||
    !['connection-closed', 'owner-closed'].includes(e.lost.reason) ||
    !['observed', 'coverage-lost'].includes(e.lost.snapshot?.state) ||
    !(frame(e.lost, 1, 1) || (cancelled && frame(e.lost, 1, 0)))
  )
    return false;
  let prior = e.before;
  for (const value of [e.pending, e.after, e.lost].filter(Boolean)) {
    if (
      value.snapshot.connectionId !== prior.snapshot.connectionId ||
      JSON.stringify(value.snapshot.client) !== JSON.stringify(prior.snapshot.client) ||
      value.snapshot.sequence < prior.snapshot.sequence ||
      (value !== e.lost && value.snapshot.sequence === prior.snapshot.sequence)
    )
      return false;
    prior = value;
  }
  return true;
}

/** Keep private endpoint and sentinel outside receipts; terminal answers remain external.
 * @param {object} scenario Public sink. @param {string} file Observation descriptor.
 * @param {string} sentinel Owned effect marker. @returns {object} Preview checkpoint and finalizer.
 * @since v0.15.1 */
export function createReviewObservation(scenario, file, sentinel) {
  const e = (scenario.reviewObservation = {
    before: null,
    pending: null,
    after: null,
    lost: null,
    pendingEffect: null,
    endpointRemoved: false,
    stickyLoss: false,
    failure: null,
    providerIdentity: 'unverified',
  });
  let observer,
    closed = false;
  const checkpoint = async (key, attempts, settled) => {
    if (closed || e.failure) return false;
    try {
      observer ||= client.observeActionRoute(file);
      const ready = await until(() => {
        if (closed) return true;
        const value = observer.snapshot();
        if (['unavailable', 'coverage-lost', 'stopped'].includes(value.state))
          throw Error('closed');
        return live(value) && frame(value, attempts, settled);
      }, 2500);
      if (!ready || closed) throw Error('checkpoint');
      e[key] = observer.snapshot();
      if (key === 'pending') e.pendingEffect = fs.existsSync(sentinel);
      return true;
    } catch {
      e.failure = 'checkpoint-failed';
      return false;
    }
  };
  probes.set(scenario, checkpoint);
  return {
    pending: () => checkpoint('pending', 1, 0),
    async finish() {
      if (closed) return;
      closed = true;
      probes.delete(scenario);
      try {
        if (observer) {
          await until(
            () =>
              ['coverage-lost', 'unavailable', 'stopped'].includes(observer.snapshot().state) &&
              !fs.existsSync(file),
            4000,
          );
          e.lost = observer.snapshot();
          await pause(100);
          e.stickyLoss =
            e.lost.state === 'coverage-lost' &&
            JSON.stringify(e.lost) === JSON.stringify(observer.snapshot());
        }
        e.endpointRemoved = !fs.existsSync(file);
      } finally {
        observer?.close();
      }
    },
  };
}

/** Gate only synthetic model replies, never the operator's input or production executor.
 * @param {object} scenario Current review case. @returns {Promise<boolean>} Snapshot captured.
 * @since v0.15.1 */
export async function prepareReviewObservationReply(scenario) {
  const checkpoint = probes.get(scenario);
  if (!checkpoint) return false;
  return scenario.requests === 1
    ? checkpoint('before', 0, 0)
    : scenario.requests === 2 && scenario.name !== 'disconnect-during-review'
      ? checkpoint('after', 1, 1)
      : false;
}
