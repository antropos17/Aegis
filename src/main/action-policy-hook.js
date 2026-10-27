'use strict';

const { runCommandHookInput } = require('./command-hook-input');

const LIMITS = Object.freeze({ inputBytes: 64 * 1024, deadlineMs: 1500 });
const REASONS = Object.freeze({
  allow: 'AEGIS policy allows this tool request.',
  ask: 'AEGIS policy requires confirmation of this tool request.',
  deny: 'AEGIS policy does not allow this tool request.',
});
const PROJECT_REASONS = Object.freeze({
  'project-review-ordinary': [
    'ask',
    'AEGIS project review requests provider confirmation for this supported command.',
  ],
  'project-deny-sensitive': [
    'deny',
    'AEGIS project review denies this declared sensitive filename.',
  ],
  'project-deny-destructive': [
    'deny',
    'AEGIS project review denies this declared destructive command.',
  ],
  'project-deny-unsupported': [
    'deny',
    'AEGIS project review does not support this command or input.',
  ],
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
  const runtime = testDeps?.runtime || process;
  // Electron's Windows bootstrap replaces process.stdin with an EOF stream.
  // Match Node's inherited-pipe stdin wrapper so destroy cancels a pending read.
  let input;
  try {
    input =
      testDeps?.input ||
      (runtime.platform === 'win32' && runtime.versions.electron
        ? (testDeps?.createSocket || ((options) => new (require('node:net').Socket)(options)))({
            fd: 0,
            readable: true,
            writable: false,
          })
        : runtime.stdin);
  } catch {
    try {
      return Promise.resolve(respond());
    } catch {
      return Promise.resolve(2);
    }
  }
  const evaluate =
    testDeps?.evaluate ||
    ((policyPath, raw) => require('./action-policy').evaluateActionPolicy(policyPath, raw));
  return runCommandHookInput({
    input,
    args,
    flag: '--action-policy-hook',
    limits: LIMITS,
    evaluate,
    normalize(result) {
      if (!result || !Object.hasOwn(REASONS, result.decision)) return undefined;
      const reason = Object.hasOwn(PROJECT_REASONS, result.reason)
        ? PROJECT_REASONS[result.reason]
        : null;
      return {
        decision: result.decision,
        code: 0,
        message: reason && reason[0] === result.decision ? reason[1] : undefined,
      };
    },
    respond,
  });
  function respond({ decision = 'deny', code = 2, message } = {}) {
    write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: decision,
          permissionDecisionReason: message || REASONS[decision],
        },
      }),
    );
    return code;
  }
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
