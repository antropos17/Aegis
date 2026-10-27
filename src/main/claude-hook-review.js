// @ts-check
'use strict';

const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { createOwnedHookWriter } = require('./claude-hook-writer');
const { CONTRACT_V2 } = require('./claude-hook-plan');
const {
  MAX_LIFETIME_MS,
  fields,
  status,
  projected,
  readOptions,
} = require('./claude-hook-review-values');

/** @typedef {import('./claude-hook-writer').OwnedIO} OwnedIO */
/** @typedef {import('./claude-hook-writer').Selection} Selection */
/** @typedef {{ok: boolean, code: string, presence: string}} Status */
/** @typedef {Status & {ticket: object, review: object}} Prepared */
/**
 * The concrete private writer's preparation methods return either status or its
 * frozen ticket/review pair; its inferred generic return can widen to Status.
 * @typedef {{
 *   prepareInstall: (selection: Selection) => Promise<Status|Prepared>,
 *   prepareRemoval: () => Promise<Status|Prepared>,
 *   apply: (ticket: object, confirmed: boolean) => Promise<Status>,
 *   reconcile: () => Promise<Status>
 * }} ReviewWriter
 */
/** @typedef {{owner: object, configPath: string, io: OwnedIO, lifetimeMs: number, now?: () => number}} Options */
/** @typedef {{planId: string, expiresAtMs: number, ticket: object, review: object}} Pending */

/**
 * Narrow only the internally constructed real writer's private prepared result.
 * @param {Status|Prepared} result Trusted writer result.
 * @returns {result is Prepared} Both private capability fields are objects.
 */
function isPrepared(result) {
  return (
    'ticket' in result &&
    result.ticket !== null &&
    typeof result.ticket === 'object' &&
    'review' in result &&
    result.review !== null &&
    typeof result.review === 'object'
  );
}

/**
 * Create one dormant PRIVATE owner-review session over one real owned writer.
 * Owner is an exact process-local object capability, not human authentication.
 * Options, selection and IO methods must be plain own data fields. IO and clocks
 * are trusted callbacks; this boundary is not a sandbox for proxies or callbacks.
 * No default target/IO, app caller, IPC, timer, profile discovery or activation.
 * @param {Options} options Explicit owner, owned target/IO and 1..300000ms lifetime.
 * @returns Private owner methods or a fixed sanitized capability failure.
 * @since v0.19.3
 */
function createOwnedHookReview(options) {
  let input;
  try {
    input = readOptions(options);
  } catch {
    return status(false, 'INVALID_CAPABILITY');
  }
  const owner = input.owner;
  const lifetimeMs = /** @type {number} */ (input.lifetimeMs);
  const now = /** @type {() => number} */ (input.now || (() => performance.now()));
  const created = createOwnedHookWriter({ configPath: input.configPath, io: input.io });
  if (!('prepareInstall' in created)) return projected(created);
  const writer = /** @type {ReviewWriter} */ (created);
  // No external writer or ticket is ever accepted or returned.
  let released = false;
  let generation = 0;
  let clockInvalid = false;
  let lastTime = -Infinity;
  /** @type {'prepare'|'confirm'|'apply'|'status'|'reconcile'|null} */
  let phase = null;
  /** @type {Pending|null} */
  let pending = null;
  let last = status(true, 'IDLE');
  /** @type {Status|null} */
  let retainedOutcome = null;
  /** @param {Status} result */
  const finish = (result) => {
    if (result.code === 'WRITE_UNCERTAIN' || result.code === 'READBACK_FAILED')
      retainedOutcome ||= result;
    last = retainedOutcome || result;
    return result;
  };
  /** @param {unknown} caller */
  const admission = (caller) =>
    caller !== owner
      ? status(false, 'INVALID_OWNER')
      : released
        ? status(false, 'RELEASED')
        : phase
          ? status(false, 'BUSY')
          : null;
  function time() {
    if (clockInvalid) throw Error();
    try {
      const value = now();
      if (!Number.isFinite(value) || value < 0 || value < lastTime) throw Error();
      lastTime = value;
      return value;
    } catch {
      clockInvalid = true;
      pending = null;
      throw Error();
    }
  }
  /** @param {number} currentGeneration */
  const revoked = (currentGeneration) =>
    released
      ? status(false, 'RELEASED')
      : generation !== currentGeneration
        ? status(false, 'CANCELLED')
        : null;

  /** @param {unknown} caller @param {unknown} selection @param {boolean} removal */
  async function prepare(caller, selection, removal) {
    const refused = admission(caller);
    if (refused) return refused;
    phase = 'prepare';
    const currentGeneration = ++generation;
    pending = null;
    try {
      const v2 =
        !removal && Object.getOwnPropertyDescriptor(selection, 'contract')?.value === CONTRACT_V2;
      const selected = removal
        ? null
        : fields(
            selection,
            v2
              ? ['command', 'afterCommand', 'contract', 'timeoutSeconds']
              : ['command', 'contract', 'timeoutSeconds'],
          );
      if (
        selected &&
        (typeof selected.command !== 'string' ||
          typeof selected.contract !== 'string' ||
          (v2 && typeof selected.afterCommand !== 'string') ||
          typeof selected.timeoutSeconds !== 'number')
      )
        return finish(status(false, 'INVALID_SELECTION'));
      const expiresAtMs = time() + lifetimeMs;
      const stopped = revoked(currentGeneration);
      if (stopped) return stopped;
      const result = removal
        ? await writer.prepareRemoval()
        : await writer.prepareInstall(/** @type {Selection} */ (selected));
      const stoppedAfter = revoked(currentGeneration);
      if (stoppedAfter) return stoppedAfter;
      const currentTime = time();
      const stoppedAtClock = revoked(currentGeneration);
      if (stoppedAtClock) return stoppedAtClock;
      if (currentTime >= expiresAtMs) return finish(status(false, 'EXPIRED'));
      if (!isPrepared(result)) return finish(projected(result));
      const planId = randomUUID();
      pending = { planId, expiresAtMs, ticket: result.ticket, review: result.review };
      finish(projected(result));
      return Object.freeze({ ...last, planId, expiresAtMs, review: result.review });
    } catch {
      return finish(
        revoked(currentGeneration) ||
          status(false, clockInvalid ? 'CLOCK_INVALID' : 'INVALID_SELECTION'),
      );
    } finally {
      phase = null;
    }
  }
  /**
   * Prepare exact private install review. Snapshot selection before asynchronous IO.
   * @param {object} caller Exact constructor owner.
   * @param {Selection} selection Plain own primitive command/contract/timeout fields.
   * @returns Private frozen envelope (planId, expiresAtMs, real frozen review) or status.
   * @since v0.19.3
   */
  const prepareInstall = (caller, selection) => prepare(caller, selection, false);
  /**
   * Prepare removal using the SAME writer's retained ownership.
   * @param {object} caller Exact constructor owner.
   * @returns Private frozen removal envelope or status.
   * @since v0.19.3
   */
  const prepareRemoval = (caller) => prepare(caller, null, true);
  /**
   * Admit once before expiry, then preserve the actual asynchronous writer outcome.
   * Cancel/expiry/release cannot interrupt a dispatched writer.apply operation.
   * @param {object} caller Exact constructor owner.
   * @param {string} planId Latest private opaque ID.
   * @param {boolean} confirmed Only literal true admits apply; no human-auth proof.
   * @returns Fixed sanitized writer/admission status.
   * @since v0.19.3
   */
  async function confirm(caller, planId, confirmed) {
    const refused = admission(caller);
    if (refused) return refused;
    phase = 'confirm';
    const currentGeneration = generation;
    try {
      if (!pending || typeof planId !== 'string' || pending.planId !== planId || confirmed !== true)
        return status(false, 'INVALID_APPROVAL');
      const review = pending;
      const currentTime = time();
      const stopped = revoked(currentGeneration);
      if (stopped) return stopped;
      if (currentTime >= review.expiresAtMs) {
        pending = null;
        return finish(status(false, 'EXPIRED'));
      }
      pending = null;
      phase = 'apply';
      return finish(projected(await writer.apply(review.ticket, true)));
    } catch {
      return finish(status(false, clockInvalid ? 'CLOCK_INVALID' : 'OPERATION_FAILED'));
    } finally {
      phase = null;
    }
  }
  /** Check verified ownership without exposing private identity or content.
   * @param {object} caller Exact constructor owner. @returns {Promise<Status>} Sanitized result. @since v0.21.0 */
  async function reconcile(caller) {
    const refused = admission(caller);
    if (refused) return refused;
    phase = 'reconcile';
    const currentGeneration = generation;
    try {
      const result = await writer.reconcile();
      return revoked(currentGeneration) || projected(result);
    } catch {
      return status(false, 'TARGET_READ_FAILED');
    } finally {
      phase = null;
    }
  }
  /**
   * Revoke pending/preparing admission; an admitted apply is already too late.
   * Completed mutation uncertainty survives cancellation and requires recovery.
   * @param {object} caller Exact constructor owner.
   * @returns Fixed sanitized cancellation status.
   * @since v0.19.3
   */
  function cancel(caller) {
    if (caller !== owner) return status(false, 'INVALID_OWNER');
    if (released) return status(false, 'RELEASED');
    if (phase === 'apply') return status(false, 'APPLY_IN_PROGRESS');
    generation += 1;
    pending = null;
    return finish(retainedOutcome || status(true, 'CANCELLED'));
  }
  /**
   * Permanently close future admission. Does not abort, retry or roll back apply.
   * Closing a completed uncertain mutation preserves its actual failure outcome.
   * @param {object} caller Exact constructor owner.
   * @returns Fixed sanitized release/in-progress status.
   * @since v0.19.3
   */
  function release(caller) {
    if (caller !== owner) return status(false, 'INVALID_OWNER');
    if (released) return status(false, 'RELEASED');
    released = true;
    generation += 1;
    pending = null;
    return phase === 'apply'
      ? status(false, 'APPLY_IN_PROGRESS')
      : finish(retainedOutcome || status(true, 'RELEASED'));
  }
  /**
   * Fixed public projection only. Expiry is logical on calls; no timer runs.
   * Private writer bytes may survive revocation until its next prepare or GC.
   * @returns Only ok, code and presence; never IDs/expiry/private review fields.
   * @since v0.19.3
   */
  function readStatus() {
    if (phase) return status(false, phase === 'apply' ? 'APPLY_IN_PROGRESS' : 'BUSY');
    if (!released && pending) {
      phase = 'status';
      try {
        const review = pending;
        if (time() >= review.expiresAtMs && pending === review) {
          pending = null;
          finish(status(false, 'EXPIRED'));
        }
      } catch {
        finish(status(false, 'CLOCK_INVALID'));
      } finally {
        phase = null;
      }
    }
    return last;
  }
  return Object.freeze({
    ok: true,
    prepareInstall,
    prepareRemoval,
    confirm,
    reconcile,
    cancel,
    release,
    status: readStatus,
  });
}

module.exports = { MAX_LIFETIME_MS, createOwnedHookReview };
