'use strict';

const path = require('node:path');
const {
  LIMITS: ACTION_LIMITS,
  parseActionJson,
  readActionFile,
  equalActionValue,
} = require('./action-policy');

const LIMITS = Object.freeze({
  inputBytes: ACTION_LIMITS.bytes,
  rules: ACTION_LIMITS.rules,
  deadlineMs: 1500,
});
const DENY = Object.freeze({
  decision: 'deny',
  reason: 'AEGIS policy does not allow this tool request.',
});
let testDeps = null;

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) =>
  object(value) &&
  Object.keys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key));
const validToolInput = (value) =>
  object(value) && typeof value.command === 'string' && value.command.length > 0;

function validPolicy(value) {
  if (
    !keys(value, ['schemaVersion', 'provider', 'hook', 'cwd', 'tool', 'deny']) ||
    value.schemaVersion !== 1 ||
    value.provider !== 'gemini-cli' ||
    value.hook !== 'BeforeTool' ||
    value.tool !== 'run_shell_command' ||
    typeof value.cwd !== 'string' ||
    !path.isAbsolute(value.cwd) ||
    !Array.isArray(value.deny) ||
    value.deny.length < 1 ||
    value.deny.length > LIMITS.rules
  )
    return false;
  for (let i = 0; i < value.deny.length; i++) {
    if (!validToolInput(value.deny[i])) return false;
    if (value.deny.slice(0, i).some((prior) => equalActionValue(prior, value.deny[i])))
      return false;
  }
  return true;
}

/**
 * Evaluate one Gemini BeforeTool shell request against an explicitly selected policy.
 * True means a fixed deny; false means no AEGIS decision. Input stays private.
 * @param {string} policyPath Selected regular policy JSON file.
 * @param {Buffer} raw Bounded provider JSON from stdin.
 * @returns {Promise<boolean>} Whether to emit the fixed deny response.
 * @since v0.16.0
 */
async function evaluateGeminiBeforeTool(policyPath, raw) {
  let request;
  try {
    request = parseActionJson(raw);
  } catch (_) {
    return true;
  }
  if (
    !object(request) ||
    typeof request.hook_event_name !== 'string' ||
    typeof request.tool_name !== 'string'
  )
    return true;
  if (request.hook_event_name !== 'BeforeTool' || request.tool_name !== 'run_shell_command')
    return false;
  if (
    typeof request.cwd !== 'string' ||
    !path.isAbsolute(request.cwd) ||
    !validToolInput(request.tool_input)
  )
    return true;

  let bytes;
  let policy;
  try {
    bytes = await readActionFile(policyPath);
    policy = parseActionJson(bytes);
  } catch (_) {
    return true;
  } finally {
    if (bytes) bytes.fill(0);
  }
  if (!validPolicy(policy) || request.cwd !== policy.cwd) return true;
  return policy.deny.some((entry) => equalActionValue(entry, request.tool_input));
}

/**
 * Read one bounded Gemini hook request and emit only denial or an empty JSON object.
 * Exit 0 keeps a successfully emitted deny parseable by Gemini; an unstartable hook,
 * provider timeout, or process crash is outside this adapter's control.
 * @param {string[]} args CLI flag and explicitly selected policy path.
 * @param {(text: string) => void} write JSON output sink.
 * @returns {Promise<number>} 0 after one JSON response; 2 if output itself failed.
 * @since v0.16.0
 */
function handleGeminiBeforeToolHook(args, write) {
  const input = testDeps?.input || process.stdin;
  const evaluate = testDeps?.evaluate || evaluateGeminiBeforeTool;
  const started = performance.now();
  return new Promise((resolve) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    let ended = false;
    let timer;
    const finish = (denied = true) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chunks.length = 0;
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      // A destroyed stream may already have a queued error; keep its handler until close.
      if (!ended) input.destroy();
      let code = 0;
      try {
        write(JSON.stringify(denied ? DENY : {}));
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
      let raw;
      try {
        raw = Buffer.concat(chunks, bytes);
      } catch (_) {
        return finish();
      }
      chunks.length = 0;
      Promise.resolve()
        .then(() => {
          if (settled || performance.now() - started >= LIMITS.deadlineMs) return null;
          return evaluate(args[1], raw);
        })
        .then((denied) => {
          if (settled) return;
          finish(
            performance.now() - started >= LIMITS.deadlineMs || typeof denied !== 'boolean'
              ? true
              : denied,
          );
        })
        .catch(() => finish())
        .finally(() => raw.fill(0));
    }
    timer = setTimeout(() => finish(), LIMITS.deadlineMs);
    input.on('error', onError);
    input.on('close', onClose);
    if (
      args.length !== 2 ||
      args[0] !== '--gemini-beforetool-hook' ||
      typeof args[1] !== 'string' ||
      !args[1].length
    )
      return finish();
    input.on('end', onEnd);
    input.on('data', onData);
  });
}

/**
 * Inject a stream or evaluator for deterministic boundary tests.
 * @param {object} deps Test-only dependencies.
 * @returns {void}
 * @since v0.16.0
 */
function _setDepsForTest(deps) {
  testDeps = deps;
}

/**
 * Restore production dependencies after a boundary test.
 * @returns {void}
 * @since v0.16.0
 */
function _resetForTest() {
  testDeps = null;
}

module.exports = {
  evaluateGeminiBeforeTool,
  handleGeminiBeforeToolHook,
  LIMITS,
  _setDepsForTest,
  _resetForTest,
};
