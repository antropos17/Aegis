'use strict';

const { randomUUID } = require('node:crypto');
const { evaluateActionPolicy, decodeActionRequest, equalActionValue } = require('./action-policy');
const LIMITS = Object.freeze({
  actions: 128,
  attempts: 512,
  bytes: 1048576,
  concurrent: 4,
  decisionMs: 1500,
  ttlMs: 30000,
});
let testDeps = null;

/**
 * Create an in-process decision/observation scope. References are not permission
 * tokens; callers and evaluator are trusted. No execution or transport is owned.
 * @param {{policyPath: string}} options Explicit selected policy.
 * @returns {object} before, after, snapshot and close operations.
 * @since v0.15.1
 */
function createActionPolicySession({ policyPath }) {
  const evaluate = testDeps?.evaluate || evaluateActionPolicy;
  const now = testDeps?.now || (() => performance.now());
  const sourceId = randomUUID();
  const records = new Map();
  const usage = { attempts: 0, bytes: 0, actions: 0, rejected: 0, evaluating: 0 };
  let closed = false;
  let lossDetected = false;
  const metadata = (entry) => ({
    actionRef: entry.actionRef,
    decision: entry.decision,
    state: entry.state,
    ...(entry.outcome ? { outcome: entry.outcome } : {}),
  });
  const snapshot = () => ({
    schemaVersion: 1,
    sourceId,
    closed,
    lossDetected,
    processBinding: 'unbound',
    activityCoverage: 'unknown',
    control: 'provider-hook-fail-open',
    usage: { ...usage },
    actions: [...records.values()].map(metadata),
  });
  const reject = (reason) => {
    lossDetected = true;
    usage.rejected++;
    return { status: 'rejected', reason };
  };
  const end = (entry, state) => {
    clearTimeout(entry.timer);
    entry.payload = null;
    entry.buffer?.fill(0);
    entry.buffer = null;
    entry.state = state;
    if (entry.resolve) {
      entry.decision = 'deny';
      const resolve = entry.resolve;
      entry.resolve = null;
      resolve({ decision: 'deny', reason: state, actionRef: entry.actionRef });
    }
  };
  const expire = (entry) => {
    if (['evaluating', 'pending'].includes(entry.state) && now() >= entry.expiresAt) {
      if (entry.decision !== 'deny' || entry.state === 'evaluating') lossDetected = true;
      end(entry, 'expired');
    }
  };
  const sweep = () => {
    for (const entry of records.values()) expire(entry);
  };
  const close = () => {
    if (!closed) {
      closed = true;
      // Replace private identity keys with public references; keep only metadata.
      const entries = [...records.values()];
      records.clear();
      for (const entry of entries) {
        if (['evaluating', 'pending'].includes(entry.state)) {
          if (entry.decision !== 'deny' || entry.state === 'evaluating') lossDetected = true;
          end(entry, 'closed');
        }
        records.set(entry.actionRef, entry);
      }
    }
    return snapshot();
  };
  function admit(raw, phases) {
    sweep();
    if (closed) return { error: reject('closed') };
    usage.attempts++;
    if (Buffer.isBuffer(raw)) usage.bytes += raw.length;
    if (usage.attempts > LIMITS.attempts || usage.bytes > LIMITS.bytes) {
      close();
      return { error: reject('session-limit') };
    }
    try {
      const input = decodeActionRequest(raw, phases);
      return { input, key: JSON.stringify([input.session_id, input.tool_use_id]) };
    } catch {
      return { error: reject('input-invalid') };
    }
  }
  async function before(raw) {
    const admitted = admit(raw, ['PreToolUse']);
    if (admitted.error) return { decision: 'deny', reason: admitted.error.reason };
    const { input, key } = admitted;
    const existing = records.get(key);
    if (existing) {
      if (['evaluating', 'pending'].includes(existing.state)) end(existing, 'invalidated');
      reject('duplicate-before');
      return { decision: 'deny', reason: 'duplicate-before' };
    }
    if (usage.actions >= LIMITS.actions || usage.evaluating >= LIMITS.concurrent) {
      close();
      reject('session-limit');
      return { decision: 'deny', reason: 'session-limit' };
    }
    // Own the bytes before any asynchronous evaluation; caller mutation cannot
    // make the evaluator inspect a different request from the reserved payload.
    const owned = Buffer.from(raw);
    const started = now();
    const entry = {
      actionRef: `${sourceId}:${++usage.actions}`,
      decision: 'deny',
      state: 'evaluating',
      payload: { cwd: input.cwd, input: input.tool_input },
      expiresAt: started + LIMITS.ttlMs,
      buffer: owned,
      timer: null,
      resolve: null,
    };
    records.set(key, entry);
    usage.evaluating++;
    const result = new Promise((resolve) => {
      entry.resolve = resolve;
    });
    entry.timer = setTimeout(() => {
      lossDetected = true;
      end(entry, 'decision-timeout');
    }, LIMITS.decisionMs);
    entry.timer.unref?.();
    // Unresolved evaluator promises still occupy concurrency; timing out cannot
    // replenish it and accumulate unlimited outstanding filesystem operations.
    Promise.resolve()
      .then(() => {
        if (entry.state !== 'evaluating' || closed) return null;
        return evaluate(policyPath, owned);
      })
      .then((decision) => {
        if (entry.state !== 'evaluating') return;
        if (closed || now() - started >= LIMITS.decisionMs) {
          lossDetected = true;
          end(entry, 'decision-timeout');
          return;
        }
        if (!decision || !['allow', 'ask', 'deny'].includes(decision.decision))
          throw new Error('invalid');
        clearTimeout(entry.timer);
        entry.decision = decision.decision;
        entry.state = 'pending';
        entry.timer = setTimeout(
          () => {
            if (entry.decision !== 'deny') lossDetected = true;
            end(entry, 'expired');
          },
          Math.max(0, entry.expiresAt - now()),
        );
        entry.timer.unref?.();
        const resolve = entry.resolve;
        entry.resolve = null;
        resolve({
          decision: entry.decision,
          reason: `policy-${entry.decision}`,
          actionRef: entry.actionRef,
        });
      })
      .catch(() => {
        if (entry.state === 'evaluating') {
          lossDetected = true;
          end(entry, 'evaluation-failed');
        }
      })
      .finally(() => {
        owned.fill(0);
        entry.buffer = null;
        usage.evaluating--;
      });
    return result;
  }
  function after(raw) {
    const admitted = admit(raw, ['PostToolUse', 'PostToolUseFailure']);
    if (admitted.error) {
      if (admitted.error.reason === 'input-invalid') close();
      return admitted.error;
    }
    const { input, key } = admitted;
    const entry = records.get(key);
    if (!entry) return reject('unknown-action');
    if (entry.state !== 'pending') {
      if (entry.state === 'evaluating') end(entry, 'invalidated');
      return reject('action-unavailable');
    }
    if (
      input.cwd !== entry.payload.cwd ||
      !equalActionValue(input.tool_input, entry.payload.input)
    ) {
      end(entry, 'invalidated');
      return reject('action-mismatch');
    }
    entry.outcome =
      input.hook_event_name === 'PostToolUse' ? 'reported-completed' : 'reported-failed';
    end(entry, 'observed');
    return {
      status: 'linked',
      reason: `reported-after-${entry.decision}`,
      actionRef: entry.actionRef,
      decision: entry.decision,
      outcome: entry.outcome,
    };
  }
  return {
    before,
    after,
    snapshot: () => {
      sweep();
      return snapshot();
    },
    close,
  };
}

/** @param {object} deps Trusted test evaluator/clock. @returns {void} @since v0.15.1 */
function _setDepsForTest(deps) {
  testDeps = deps;
}
/** @returns {void} @since v0.15.1 */
function _resetForTest() {
  testDeps = null;
}
module.exports = { createActionPolicySession, LIMITS, _setDepsForTest, _resetForTest };
