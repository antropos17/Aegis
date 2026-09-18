'use strict';

const LIMITS = Object.freeze({ inputBytes: 64 * 1024, deadlineMs: 1500 });
const REASONS = Object.freeze({
  allow: 'AEGIS policy allows this tool request.',
  ask: 'AEGIS policy requires confirmation of this tool request.',
  deny: 'AEGIS policy does not allow this tool request.',
});
let testDeps = null;

/**
 * Read one bounded command-hook request and emit only a provider decision.
 * The internal deadline cannot protect against provider hook launch failures,
 * process termination or event-loop stalls; those remain unsupported bypasses.
 * @param {string[]} args CLI flag and explicitly selected policy path.
 * @param {(text: string) => void} write Provider JSON output sink.
 * @returns {Promise<number>} 0 for a valid decision; 2 for adapter failure.
 * @since v0.15.1
 */
function handleActionPolicyHook(args, write) {
  const input = testDeps?.input || process.stdin;
  const evaluate =
    testDeps?.evaluate ||
    ((policyPath, raw) => require('./action-policy').evaluateActionPolicy(policyPath, raw));
  const started = performance.now();
  return new Promise((resolve) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    let ended = false;
    let timer;
    const finish = (decision = 'deny', code = 2) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chunks.length = 0;
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      // Keep the error handler until close: destroy may have a queued error.
      // Release a pipe whose producer never sends EOF.
      if (!ended) input.destroy();
      try {
        write(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: decision,
              permissionDecisionReason: REASONS[decision],
            },
          }),
        );
      } catch (_) {
        code = 2;
      }
      resolve(code);
    };
    function onError() {
      finish();
    }
    function onClose() {
      if (!ended) finish();
      input.removeListener('error', onError);
      input.removeListener('close', onClose);
    }
    function onData(chunk) {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > LIMITS.inputBytes || performance.now() - started >= LIMITS.deadlineMs)
        return finish();
      chunks.push(buffer);
    }
    function onEnd() {
      ended = true;
      if (settled) return;
      const raw = Buffer.concat(chunks, bytes);
      chunks.length = 0;
      Promise.resolve()
        .then(() => {
          if (settled || performance.now() - started >= LIMITS.deadlineMs) return null;
          return evaluate(args[1], raw);
        })
        .then((result) => {
          if (settled) return;
          if (
            performance.now() - started >= LIMITS.deadlineMs ||
            !result ||
            !Object.hasOwn(REASONS, result.decision)
          )
            return finish();
          finish(result.decision, 0);
        })
        .catch(() => finish());
    }
    timer = setTimeout(() => finish(), LIMITS.deadlineMs);
    input.on('error', onError);
    input.on('close', onClose);
    if (
      args.length !== 2 ||
      args[0] !== '--action-policy-hook' ||
      typeof args[1] !== 'string' ||
      !args[1].length
    )
      return finish();
    input.on('end', onEnd);
    input.on('data', onData);
  });
}

/**
 * Inject streams/evaluation for deterministic boundary tests.
 * @param {object} deps Test-only input and evaluator.
 * @returns {void}
 * @since v0.15.1
 */
function _setDepsForTest(deps) {
  testDeps = deps;
}

/**
 * Restore production dependencies after a boundary test.
 * @returns {void}
 * @since v0.15.1
 */
function _resetForTest() {
  testDeps = null;
}

module.exports = { handleActionPolicyHook, LIMITS, _setDepsForTest, _resetForTest };
