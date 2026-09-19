/** TEST ONLY: observe three catalog reviews without supplying terminal answers. */
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
    s.selection === 'catalog' &&
    s.selectedActionCount === 2 &&
    s.actionAttempts === attempts &&
    s.ownerInvocations === attempts &&
    s.ownerSettled === settled &&
    s.ownerFailures === 0 &&
    s.selectionRejected === 0 &&
    s.cancellationRequests === 0
  );
}
const live = (value) =>
  value?.state === 'observed' && value.reason === null && value.snapshot?.state === 'observed';
const fields = [
  'before',
  'pending',
  'after',
  'lost',
  'pendingEffects',
  'endpointRemoved',
  'stickyLoss',
  'failure',
  'providerIdentity',
];

/** Validate catalog pending/settled ordering and disconnect after the third invocation.
 * @param {object} e Redacted evidence. @returns {boolean} Every checkpoint agrees.
 * @since v0.15.1 */
export function catalogReviewObservationPassed(e) {
  if (
    !e ||
    Object.keys(e).length !== fields.length ||
    !fields.every((key) => Object.hasOwn(e, key)) ||
    e.failure !== null ||
    e.providerIdentity !== 'unverified' ||
    e.endpointRemoved !== true ||
    e.stickyLoss !== true ||
    !frame(e.before, 0, 0) ||
    !live(e.before) ||
    !Array.isArray(e.pending) ||
    e.pending.length !== 3 ||
    !Array.isArray(e.after) ||
    e.after.length !== 2 ||
    !Array.isArray(e.pendingEffects) ||
    e.pendingEffects.length !== 3
  )
    return false;
  for (let i = 0; i < 3; i++) {
    const effect = e.pendingEffects[i];
    if (
      !frame(e.pending[i], i + 1, i) ||
      !live(e.pending[i]) ||
      !effect ||
      Object.keys(effect).length !== 2 ||
      effect.firstBytes !== (i === 0 ? 0 : 1) ||
      effect.secondBytes !== 0
    )
      return false;
    if (i < 2 && (!frame(e.after[i], i + 1, i + 1) || !live(e.after[i]))) return false;
  }
  if (
    !e.lost ||
    e.lost.state !== 'coverage-lost' ||
    !['connection-closed', 'owner-closed'].includes(e.lost.reason) ||
    !['observed', 'coverage-lost'].includes(e.lost.snapshot?.state) ||
    !(frame(e.lost, 3, 2) || frame(e.lost, 3, 3))
  )
    return false;
  let prior = e.before;
  for (const value of [e.pending[0], e.after[0], e.pending[1], e.after[1], e.pending[2], e.lost]) {
    if (
      value.snapshot.connectionId !== prior.snapshot.connectionId ||
      JSON.stringify(value.snapshot.client) !== JSON.stringify(prior.snapshot.client) ||
      value.snapshot.sequence < prior.snapshot.sequence ||
      (value.snapshot.sequence === prior.snapshot.sequence &&
        (value !== e.lost || JSON.stringify(value.snapshot) !== JSON.stringify(prior.snapshot)))
    )
      return false;
    prior = value;
  }
  return true;
}

/** Keep descriptors and effect paths private; checkpoints never approve or invoke actions.
 * @param {object} scenario Public sink. @param {string} file Observation descriptor.
 * @param {string[]} sentinels Two owned markers. @returns {object} Pending hook and finalizer.
 * @since v0.15.1 */
export function createCatalogReviewObservation(scenario, file, sentinels) {
  const e = (scenario.catalogReviewObservation = {
    before: null,
    pending: [],
    after: [],
    lost: null,
    pendingEffects: [],
    endpointRemoved: false,
    stickyLoss: false,
    failure: null,
    providerIdentity: 'unverified',
  });
  let observer,
    closed = false;
  const checkpoint = async (kind, index, attempts, settled) => {
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
      const value = observer.snapshot();
      if (kind === 'before') e.before = value;
      else {
        if (e[kind].length !== index) throw Error('order');
        e[kind].push(value);
      }
      if (kind === 'pending') {
        const size = (p) => (fs.existsSync(p) ? fs.statSync(p).size : 0);
        e.pendingEffects.push({ firstBytes: size(sentinels[0]), secondBytes: size(sentinels[1]) });
      }
      return true;
    } catch {
      e.failure = 'checkpoint-failed';
      return false;
    }
  };
  probes.set(scenario, checkpoint);
  return {
    pending: (index) => checkpoint('pending', index, index + 1, index),
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

/** Capture counters before each synthetic next-action reply; no reply after pending disconnect.
 * @param {object} scenario Current catalog scenario. @returns {Promise<boolean>} Checkpoint captured.
 * @since v0.15.1 */
export async function prepareCatalogReviewObservationReply(scenario) {
  const checkpoint = probes.get(scenario);
  if (!checkpoint) return false;
  const n = scenario.requests;
  return n === 1
    ? checkpoint('before', 0, 0, 0)
    : n === 2 || n === 3
      ? checkpoint('after', n - 2, n - 1, n - 1)
      : false;
}
