'use strict';
const { randomBytes } = require('node:crypto');
const { runLoopbackControl } = require('./loopback-control');
const { validateControl, safeId } = require('./fixture-outcomes');
let control = runLoopbackControl;

/**
 * Run a closed fixed-canary step and preserve sender and receiver observations independently.
 * @param {object} step Validated scenario step.
 * @param {object} ctx Actual run/scenario identity from the actor.
 * @returns {Promise<object>} Actor result and independent fixture outcome.
 * @since unreleased
 */
async function executeLoopbackStep(step, ctx) {
  if (!safeId(ctx.runId) || !safeId(ctx.scenario) || !safeId(step.id))
    throw new Error('loopback-step-input-invalid');
  const nonce = randomBytes(16).toString('hex');
  const fixtureOutcome = {
    runId: ctx.runId,
    scenario: ctx.scenario,
    step: step.id,
    nonce,
    control: null,
    reason: 'control-unavailable',
  };
  try {
    fixtureOutcome.control = validateControl(
      await control({ runId: ctx.runId, nonce, durationMs: step.with.durationMs }),
      ctx.runId,
      nonce,
      step.with.durationMs,
    );
    fixtureOutcome.reason = null;
  } catch {
    /* Preserve a fixed unavailable record; no raw exception or invented facts. */
  }
  const sender = fixtureOutcome.control?.sender;
  const written =
    sender?.writeFinished === true &&
    Number.isSafeInteger(sender.sentBytes) &&
    sender.sentBytes > 0;
  return {
    failed: !written,
    fixtureOutcome,
    result: { nonce },
    observed: written
      ? {
          timestamp: new Date().toISOString(),
          pid: process.pid,
          executable: process.execPath,
          runId: ctx.runId,
          nonce,
          sentBytes: sender.sentBytes,
        }
      : null,
  };
}
/**
 * Replace only the control dependency in focused CommonJS tests.
 * @param {object} deps Injected control function.
 * @returns {void}
 * @since unreleased
 */
function _setDepsForTest(deps) {
  control = deps.runLoopbackControl;
}
/**
 * Restore the real control dependency.
 * @returns {void}
 * @since unreleased
 */
function _resetForTest() {
  control = runLoopbackControl;
}
module.exports = { executeLoopbackStep, _setDepsForTest, _resetForTest };
