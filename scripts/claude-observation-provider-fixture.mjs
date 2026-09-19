/** TEST ONLY: bounded production-observer checkpoints around installed-provider actions. */
import fs from 'node:fs';
import client from '../src/main/action-observation-client.js';
import schema from '../src/main/action-observation-schema.js';
const probes = new WeakMap();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const counters = ['actionAttempts', 'ownerInvocations', 'ownerSettled'];
const zero = ['selectionRejected', 'ownerFailures', 'cancellationRequests'];

async function until(predicate, ms) {
  const deadline = performance.now() + ms;
  while (performance.now() < deadline) {
    if (predicate()) return true;
    await sleep(25);
  }
  return predicate();
}
function captured(value, catalog, attempts) {
  const frame = value?.snapshot;
  return !!(
    value &&
    Object.keys(value).length === 4 &&
    typeof value.lastObservedAt === 'string' &&
    Number.isFinite(Date.parse(value.lastObservedAt)) &&
    schema.validObservation(frame) &&
    frame.route === 'mcp-stdio' &&
    frame.selection === (catalog ? 'catalog' : 'single-action') &&
    frame.selectedActionCount === (catalog ? 2 : 1) &&
    counters.every((key) => frame[key] === attempts) &&
    zero.every((key) => frame[key] === 0)
  );
}

/** Require coherent metadata before/after execution and sticky owner-exit loss.
 * @param {object} evidence Redacted evidence. @param {boolean} catalog Selection kind.
 * @returns {boolean} Whether every required observation agrees. @since v0.15.1 */
export function observationPassed(evidence, catalog) {
  if (
    !evidence ||
    evidence.failure !== null ||
    evidence.providerIdentity !== 'unverified' ||
    evidence.stickyLoss !== true ||
    evidence.endpointRemoved !== true
  )
    return false;
  const { before, after, lost } = evidence;
  if (!captured(before, catalog, 0) || !captured(after, catalog, 1) || !captured(lost, catalog, 1))
    return false;
  if (
    ![before, after].every(
      (value) =>
        value.state === 'observed' && value.reason === null && value.snapshot.state === 'observed',
    )
  )
    return false;
  return (
    lost.state === 'coverage-lost' &&
    ['connection-closed', 'owner-closed'].includes(lost.reason) &&
    ['observed', 'coverage-lost'].includes(lost.snapshot.state) &&
    after.snapshot.sequence > before.snapshot.sequence &&
    lost.snapshot.sequence >= after.snapshot.sequence &&
    [after, lost].every(
      (value) =>
        value.snapshot.connectionId === before.snapshot.connectionId &&
        JSON.stringify(value.snapshot.client) === JSON.stringify(before.snapshot.client),
    )
  );
}

/** Hold private endpoint and observer outside the receipt; no provider settings are changed.
 * @param {object} scenario Public scenario sink. @param {string} file Owned new descriptor.
 * @returns {object} Bounded finalization hook. @since v0.15.1 */
export function createProviderObservation(scenario, file) {
  const evidence = (scenario.liveObservation = {
    before: null,
    after: null,
    lost: null,
    stickyLoss: false,
    endpointRemoved: false,
    providerIdentity: 'unverified',
    failure: null,
  });
  const probe = { file, observer: null, closed: false };
  probes.set(scenario, probe);
  return {
    async finish() {
      if (probe.closed) return;
      probe.closed = true;
      probes.delete(scenario);
      try {
        if (probe.observer) {
          await until(
            () =>
              ['coverage-lost', 'unavailable', 'stopped'].includes(
                probe.observer.snapshot().state,
              ) && !fs.existsSync(file),
            4000,
          );
          evidence.lost = probe.observer.snapshot();
          await sleep(100);
          evidence.stickyLoss =
            evidence.lost.state === 'coverage-lost' &&
            JSON.stringify(probe.observer.snapshot()) === JSON.stringify(evidence.lost);
        }
        evidence.endpointRemoved = !fs.existsSync(file);
      } finally {
        probe.observer?.close();
      }
    },
  };
}

/** Wait for a finite checkpoint before emitting the synthetic API reply.
 * First request precedes all actions; fourth follows status/action/status results.
 * @param {object} scenario Current correlated scenario. @returns {Promise<boolean>} Ready or fixed failure.
 * @since v0.15.1 */
export async function prepareObservationReply(scenario) {
  const probe = probes.get(scenario);
  if (!probe || probe.closed || scenario.liveObservation.failure) return false;
  if (![1, 4].includes(scenario.requests)) return true;
  const key = scenario.requests === 1 ? 'before' : 'after';
  const attempts = key === 'before' ? 0 : 1;
  try {
    probe.observer ||= client.observeActionRoute(probe.file);
    const ready = await until(() => {
      if (probe.closed) return true;
      const value = probe.observer.snapshot();
      if (['unavailable', 'coverage-lost', 'stopped'].includes(value.state)) throw Error('closed');
      return value.state === 'observed' && captured(value, scenario.catalog === true, attempts);
    }, 2500);
    if (!ready || probe.closed) throw Error('checkpoint');
    scenario.liveObservation[key] = probe.observer.snapshot();
    return true;
  } catch {
    scenario.liveObservation.failure = 'checkpoint-failed';
    return false;
  }
}
