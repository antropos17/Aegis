'use strict';

const path = require('node:path');
const { runCommandHookInput } = require('./command-hook-input');
const { parseActionJson, evaluateActionPolicy } = require('./action-policy');
const { scanJson } = require('./claude-hook-json');

const LIMITS = Object.freeze({ inputBytes: 64 * 1024, deadlineMs: 1500 });
const DENY = Object.freeze({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: 'AEGIS policy does not allow this tool request.',
  },
});
const ASK_DENY = Object.freeze({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason:
      'AEGIS policy requires review; this Codex hook cannot request approval.',
  },
});
const FIELDS = Object.freeze([
  'session_id',
  'transcript_path',
  'cwd',
  'hook_event_name',
  'model',
  'permission_mode',
  'turn_id',
  'tool_name',
  'tool_use_id',
  'tool_input',
]);
const MODES = new Set(['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions']);
let testDeps = null;

// These are metadata checks only: no transcript, model or process is accessed.
const boundedString = (value, max) =>
  typeof value === 'string' &&
  value.length > 0 &&
  Buffer.byteLength(value) <= max &&
  // eslint-disable-next-line no-control-regex -- Protocol metadata must not contain control characters.
  !/[\x00-\x1f\x7f-\x9f]/u.test(value);

/** Validate the documented finite Codex PreToolUse Bash envelope without retaining it.
 * @param {Buffer} raw Untrusted hook input. @returns {boolean} Whether the shape is supported.
 * @since v0.21.0 */
function validCodexPreToolInput(raw) {
  let scanned;
  try {
    // Reject duplicate keys before the shared parser/evaluator interprets them.
    scanned = scanJson(raw);
    const value = parseActionJson(raw);
    return (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === FIELDS.length &&
      FIELDS.every((key) => Object.hasOwn(value, key)) &&
      boundedString(value.session_id, 256) &&
      boundedString(value.turn_id, 256) &&
      boundedString(value.tool_use_id, 256) &&
      boundedString(value.model, 256) &&
      (value.transcript_path === null || boundedString(value.transcript_path, 4096)) &&
      boundedString(value.cwd, 4096) &&
      path.isAbsolute(value.cwd) &&
      typeof value.permission_mode === 'string' &&
      MODES.has(value.permission_mode) &&
      value.hook_event_name === 'PreToolUse' &&
      value.tool_name === 'Bash' &&
      value.tool_input !== null &&
      typeof value.tool_input === 'object' &&
      !Array.isArray(value.tool_input) &&
      boundedString(value.tool_input.command, 16384)
    );
  } catch {
    return false;
  } finally {
    scanned?.bytes.fill(0);
  }
}

/** Evaluate a supported Codex hook through the shared exact-input policy.
 * @param {string} policyPath Native-selected policy. @param {Buffer} raw Private request.
 * @returns {Promise<object>} Shared fixed decision; malformed input denies. @since v0.21.0 */
async function evaluateCodexPreTool(policyPath, raw) {
  if (!validCodexPreToolInput(raw)) return { decision: 'deny' };
  return (testDeps?.evaluate || evaluateActionPolicy)(policyPath, raw);
}

/** Run a single bounded Codex Bash hook. Codex host failure behavior is unverified.
 * @param {string[]} args Fixed flag and selected policy path. @param {(text:string)=>void} write Output sink.
 * @returns {Promise<number>} Zero after a response; 2 only if output fails. @since v0.21.0 */
function handleCodexPreToolHook(args, write) {
  const runtime = testDeps?.runtime || process;
  let input;
  const respond = (decision) => {
    write(JSON.stringify(decision === 'allow' ? {} : decision === 'ask' ? ASK_DENY : DENY));
    return 0;
  };
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
  return runCommandHookInput({
    input,
    args,
    flag: '--codex-pretool-hook',
    limits: LIMITS,
    evaluate: evaluateCodexPreTool,
    normalize: (value) =>
      value && ['allow', 'ask', 'deny'].includes(value.decision) ? value.decision : 'deny',
    respond,
  });
}

/** Set deterministic private test seams. @param {object} deps Test dependencies. @returns {void} @since v0.21.0 */
function _setDepsForTest(deps) {
  testDeps = deps;
}
/** Remove deterministic test seams. @returns {void} @since v0.21.0 */
function _resetForTest() {
  testDeps = null;
}

module.exports = {
  validCodexPreToolInput,
  evaluateCodexPreTool,
  handleCodexPreToolHook,
  LIMITS,
  _setDepsForTest,
  _resetForTest,
};
