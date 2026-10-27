/** @file Fixed, bounded terminal outcome evidence for a reviewed MCP gateway. */
'use strict';

const { types } = require('node:util');
const LIMITS = Object.freeze({ events: 256, queued: 64, writeMs: 500, finishMs: 1200 });
const CODES = new Set(['consumed', 'dispatch', 'completed', 'failed']);
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const INTRO =
  '\nAEGIS gateway outcomes: each attempt ID is per-attempt, not a stable operation ID.\n' +
  'No automatic retry. Fresh approval does not prevent duplicate effects. ' +
  'Idempotency and reconciliation are unsupported.\n';
const INCOMPLETE = 'Outcome evidence is incomplete; some attempt outcomes may be missing.\n';
// One listener per stream protects late Writable errors from outstanding writes.
// An unresolved native callback retains that listener even after stream closure.
const guardians = new WeakMap();
function guardLateError(stream) {
  if (
    !stream ||
    typeof stream.on !== 'function' ||
    typeof stream.once !== 'function' ||
    typeof stream.removeListener !== 'function'
  )
    return () => {};
  let guard = guardians.get(stream);
  if (!guard) {
    guard = { pending: 0, overflowed: false };
    guard.onError = () => {};
    guard.remove = () => {
      stream.removeListener('error', guard.onError);
      stream.removeListener('close', guard.onClose);
      guardians.delete(stream);
    };
    guard.onClose = () => {
      if (!guard.pending && !guard.overflowed) guard.remove();
    };
    guardians.set(stream, guard);
    stream.on('error', guard.onError);
    stream.once('close', guard.onClose);
  }
  if (guard.pending < LIMITS.events) guard.pending++;
  else guard.overflowed = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    setImmediate(() => {
      if (guardians.get(stream) !== guard) return;
      guard.pending = Math.max(0, guard.pending - 1);
      if (!guard.pending && !guard.overflowed) guard.remove();
    }).unref?.();
  };
}

/** Capture fixed gateway evidence and serialize its output with terminal prompts.
 * @param {object} options Private terminal output and owner-failure callback.
 * @returns {object} Evidence sink, prompt gate, bounded finish and status.
 * @since 0.21.0-beta
 */
function createGatewayOutcomeReporter({ output, onFailure }) {
  const attempts = new Map();
  const queue = [];
  let nextSeq = 0;
  let incomplete = false;
  let lost = 0;
  let sealed = false;
  let broken = false;
  let paused = false;
  let intro = false;
  let active = null;
  let failureNotified = false;
  let finishPromise = null;
  const status = () =>
    Object.freeze({
      incomplete,
      lost,
      pending: queue.length + (active ? 1 : 0),
      paused,
      sealed,
      broken,
    });
  const lose = () => {
    incomplete = true;
    lost = Math.min(65535, lost + 1);
  };
  const fail = () => {
    if (!broken) {
      broken = true;
      lose();
      lost = Math.min(65535, lost + queue.length);
      queue.length = 0;
    }
    if (!failureNotified) {
      failureNotified = true;
      try {
        onFailure?.();
      } catch {
        /* owner callback is advisory */
      }
    }
  };
  const onError = () => fail();
  output?.on?.('error', onError);
  output?.on?.('close', onError);
  const write = (message) =>
    new Promise((resolve) => {
      let settled = false;
      const releaseGuard = guardLateError(output);
      const done = (error, timedOut = false) => {
        if (settled) {
          if (!timedOut) releaseGuard();
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (!timedOut) releaseGuard();
        if (error) fail();
        resolve();
      };
      const timer = setTimeout(() => done(true, true), LIMITS.writeMs);
      try {
        if (
          !output ||
          output.destroyed ||
          output.writableEnded ||
          typeof output.write !== 'function'
        )
          return done(true);
        output.write(message, (error) => done(error));
      } catch {
        done(true);
      }
    });
  const pump = () => {
    if (active || paused || broken || !queue.length) return;
    const message = queue.shift();
    active = write(message).finally(() => {
      active = null;
      pump();
    });
  };
  const enqueue = (message) => {
    if (broken || queue.length >= LIMITS.queued) {
      fail();
      return;
    }
    if (!intro) {
      intro = true;
      message = INTRO + message;
    }
    queue.push(message);
    pump();
  };
  const line = (id, message) => enqueue(`Attempt ${id}: ${message}\n`);
  const onEvidence = (event) => {
    if (
      sealed ||
      !event ||
      typeof event !== 'object' ||
      types.isProxy(event) ||
      Object.getPrototypeOf(event) !== Object.prototype ||
      Reflect.ownKeys(event).length !== 4 ||
      !['code', 'operationId', 'schemaVersion', 'seq'].every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(event, key);
        return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
      }) ||
      event.schemaVersion !== 1 ||
      event.seq !== nextSeq ||
      nextSeq >= LIMITS.events ||
      typeof event.operationId !== 'string' ||
      !UUID.test(event.operationId) ||
      !CODES.has(event.code)
    ) {
      lose();
      return;
    }
    nextSeq++;
    const id = event.operationId;
    let attempt = attempts.get(id);
    if (!attempt) {
      attempt = {
        consumed: false,
        dispatch: false,
        finished: false,
        reported: false,
        failed: false,
      };
      attempts.set(id, attempt);
    }
    if (
      attempt.finished ||
      (event.code === 'consumed' && (attempt.consumed || attempt.dispatch)) ||
      (event.code === 'dispatch' && attempt.dispatch)
    ) {
      lose();
      return;
    }
    if (event.code === 'consumed') attempt.consumed = true;
    if (event.code === 'dispatch') attempt.dispatch = true;
    if (event.code === 'completed') {
      attempt.finished = true;
      attempt.reported = true;
      if (!attempt.dispatch) {
        lose();
        line(id, 'Outcome unknown; evidence is incomplete.');
      } else line(id, 'Upstream response accepted; effect unverified.');
    }
    if (event.code === 'failed') {
      attempt.finished = true;
      attempt.failed = true;
      if (attempt.dispatch) {
        attempt.reported = true;
        line(id, 'Dispatch attempted; outcome unknown.');
      }
    }
  };
  const pauseBeforePrompt = async () => {
    paused = true;
    if (active) await active;
    return !broken && !sealed;
  };
  const resumeAfterPrompt = () => {
    paused = false;
    pump();
  };
  const finish = (evidenceStatus, cleanupConfirmed) => {
    if (finishPromise) return finishPromise;
    sealed = true;
    finishPromise = (async () => {
      const complete =
        cleanupConfirmed === true &&
        evidenceStatus?.enabled === true &&
        evidenceStatus?.sealed === true &&
        evidenceStatus?.lost === 0 &&
        evidenceStatus?.pending === 0 &&
        evidenceStatus?.emitted === nextSeq &&
        !incomplete &&
        [...attempts.values()].every((attempt) => attempt.finished);
      if (!complete) incomplete = true;
      for (const [id, attempt] of attempts) {
        if (attempt.reported) continue;
        if (attempt.dispatch) line(id, 'Dispatch attempted; outcome unknown.');
        else if (complete && attempt.consumed && attempt.failed)
          line(id, 'Not dispatched by this gateway.');
        else {
          incomplete = true;
          line(id, 'Outcome unknown; evidence is incomplete.');
        }
      }
      if (incomplete) enqueue(INCOMPLETE);
      else if (!attempts.size)
        enqueue('No eligible attempts were recorded; unrecorded activity remains unknown.\n');
      const deadline = performance.now() + LIMITS.finishMs;
      while ((active || queue.length) && !broken && performance.now() < deadline) {
        pump();
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      if (active || queue.length) fail();
      output?.removeListener?.('close', onError);
      setImmediate(() => output?.removeListener?.('error', onError)).unref?.();
      return status();
    })();
    return finishPromise;
  };
  return { onEvidence, pauseBeforePrompt, resumeAfterPrompt, finish, status };
}
module.exports = { createGatewayOutcomeReporter, LIMITS };
