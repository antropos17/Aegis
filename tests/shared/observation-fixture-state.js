import { expect } from 'vitest';

const states = new Set([
  'connecting',
  'awaiting-client',
  'observed',
  'coverage-lost',
  'unavailable',
  'stopped',
]);
const reasons = new Set([
  'observer-stopped',
  'updates-expired',
  'observation-expired',
  'invalid-endpoint',
  'connection-closed',
  'invalid-update',
  'owner-closed',
  'observation-unavailable',
]);
const stages = new Set(['launched', 'endpoint-published', 'initialized', 'owner-ended']);
const signals = new Set(['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGABRT', 'SIGHUP']);

/** Capture public lifecycle timing without reading endpoint, streams or wire frames.
 * @param {import('node:child_process').ChildProcess} child Owned fixture child.
 * @returns {{mark: Function, snapshot: Function}} Sanitized diagnostics.
 * @since 0.18.0
 */
export function observationFixtureDiagnostics(child) {
  const started = performance.now();
  let stage = 'launched';
  let stageStarted = started;
  let closed = false;
  child.once('close', () => {
    closed = true;
  });
  return {
    mark(next) {
      stage = stages.has(next) ? next : 'unknown';
      stageStarted = performance.now();
    },
    snapshot(observer) {
      const publicState = observer.snapshot();
      return {
        state: states.has(publicState.state) ? publicState.state : 'unknown',
        reason:
          publicState.reason === null
            ? null
            : reasons.has(publicState.reason)
              ? publicState.reason
              : 'unknown',
        stage,
        elapsedMs: Math.round(performance.now() - started),
        stageElapsedMs: Math.round(performance.now() - stageStarted),
        ownerExitCode: Number.isSafeInteger(child.exitCode) ? child.exitCode : null,
        ownerSignal: signals.has(child.signalCode) ? child.signalCode : null,
        ownerClosed: closed,
      };
    },
  };
}

/** Keep the same state assertion while including sanitized failure evidence.
 * @param {object} observer Read-only observer.
 * @param {string} state Expected public state.
 * @param {ReturnType<typeof observationFixtureDiagnostics>} diagnostics Fixture evidence.
 * @returns {void}
 * @since 0.18.0
 */
export function expectObservationState(observer, state, diagnostics) {
  const evidence = diagnostics.snapshot(observer);
  expect(evidence, `Observation lifecycle: ${JSON.stringify(evidence)}`).toMatchObject({ state });
}
