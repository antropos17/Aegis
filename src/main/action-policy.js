'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { TextDecoder } = require('node:util');
const LIMITS = Object.freeze({ bytes: 65536, depth: 8, nodes: 2048, rules: 32 });
const PROJECT_PROFILE = 'aegis-windows-project-review-v1';
const ordinaryCommands = new Set([
  'pwd',
  'ls',
  'git status',
  'git status --short',
  'git diff --stat',
]);
const scriptCommands = new Set(['npm test', 'npm run lint']);
const reservedDeviceStem = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const sensitiveName = /^(?:\.env(?:\.[a-z0-9_.-]*)?|id_(?:rsa|ed25519)|credentials(?:\.json)?)$/i;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const deny = (reason) => ({ decision: 'deny', reason });
const validString = (v) => typeof v === 'string' && !/[\ud800-\udfff]/u.test(v);
const identifier = (v) =>
  validString(v) &&
  v.length > 0 &&
  Buffer.byteLength(v) <= 256 &&
  // eslint-disable-next-line no-control-regex -- IDs are metadata, never arbitrary text.
  !/[\x00-\x1f\x7f-\x9f]/u.test(v);
const keys = (value, expected) =>
  object(value) &&
  Object.keys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key));

// This literal subset grants no automatic permission and resolves no executable or file.
function evaluateProjectProfile(input) {
  const unsupported = deny('project-deny-unsupported');
  if (
    Object.keys(input).some((key) => !['command', 'description', 'timeout'].includes(key)) ||
    (Object.hasOwn(input, 'description') && typeof input.description !== 'string') ||
    (Object.hasOwn(input, 'timeout') &&
      (!Number.isSafeInteger(input.timeout) || input.timeout < 1 || input.timeout > 600000))
  )
    return unsupported;
  const command = input.command;
  if (scriptCommands.has(command)) return { decision: 'ask', reason: 'project-review-script' };
  if (ordinaryCommands.has(command)) return { decision: 'ask', reason: 'project-review-ordinary' };
  const patch = /^git apply -- ([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.(?:patch|diff)$/.exec(command);
  if (patch && !reservedDeviceStem.test(patch[1]))
    return { decision: 'ask', reason: 'project-review-edit' };
  const read = /^cat ([A-Za-z0-9_.-]+)$/.exec(command);
  if (read && read[1] !== '.' && read[1] !== '..' && !read[1].startsWith('-')) {
    if (reservedDeviceStem.test(read[1].split('.')[0])) return unsupported;
    return sensitiveName.test(read[1])
      ? deny('project-deny-sensitive')
      : { decision: 'ask', reason: 'project-review-ordinary' };
  }
  if (/^(?:rm(?: [A-Za-z0-9_.-]+)+|git reset --hard|git clean -fd)$/.test(command))
    return deny('project-deny-destructive');
  return unsupported;
}

/**
 * Parse bounded private JSON without retaining its source bytes.
 * @param {Buffer} buffer Explicit input bytes.
 * @returns {unknown} Validated JSON value; private to the calling evaluator.
 * @since v0.15.1
 */
function parse(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > LIMITS.bytes) throw new Error('invalid');
  const value = JSON.parse(
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer),
  );
  let nodes = 0;
  function visit(current, depth) {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) throw new Error('invalid');
    if (typeof current === 'number' && !Number.isFinite(current)) throw new Error('invalid');
    if (typeof current === 'string' && !validString(current)) throw new Error('invalid');
    if (current && typeof current === 'object') {
      for (const [key, child] of Object.entries(current)) {
        if (!validString(key)) throw new Error('invalid');
        visit(child, depth + 1);
      }
    }
  }
  visit(value, 0);
  return value;
}

// Compare every own key without copying into an object: __proto__ stays data.
function equal(a, b) {
  if (Object.is(a, b)) return true;
  if (
    !a ||
    !b ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const left = Object.keys(a);
  const right = Object.keys(b);
  return (
    left.length === right.length &&
    left.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
  );
}

/** Validate an already private schema-1 action policy without evaluating a request.
 * @param {unknown} policy Parsed private input. @returns {boolean} Valid closed policy. @since v0.21.0 */
function validPolicy(policy) {
  if (object(policy) && policy.schemaVersion === 2)
    return (
      keys(policy, ['schemaVersion', 'cwd', 'profile']) &&
      typeof policy.cwd === 'string' &&
      path.isAbsolute(policy.cwd) &&
      policy.profile === PROJECT_PROFILE
    );
  if (
    !keys(policy, ['schemaVersion', 'cwd', 'defaultDecision', 'rules']) ||
    policy.schemaVersion !== 1 ||
    typeof policy.cwd !== 'string' ||
    !path.isAbsolute(policy.cwd) ||
    !['deny', 'ask'].includes(policy.defaultDecision) ||
    !Array.isArray(policy.rules) ||
    policy.rules.length > LIMITS.rules
  )
    return false;
  for (let i = 0; i < policy.rules.length; i++) {
    const rule = policy.rules[i];
    if (
      !keys(rule, ['tool', 'input', 'decision']) ||
      rule.tool !== 'Bash' ||
      !object(rule.input) ||
      typeof rule.input.command !== 'string' ||
      !rule.input.command ||
      !['allow', 'ask', 'deny'].includes(rule.decision)
    )
      return false;
    if (policy.rules.slice(0, i).some((prior) => equal(prior.input, rule.input))) return false;
  }
  return true;
}

const sameFile = (a, b) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs;

/**
 * Read one explicitly selected bounded regular policy/request file.
 * @param {string} filename Selected path.
 * @returns {Promise<Buffer>} Private bytes; caller must clear after parsing.
 * @since v0.15.1
 */
async function readPolicy(filename) {
  let handle;
  try {
    if (typeof filename !== 'string' || !filename || /^[\\/]{2}/.test(filename))
      throw new Error('invalid');
    const selected = path.resolve(filename);
    const name = path.basename(selected);
    // eslint-disable-next-line no-control-regex -- Reject alternate streams and invalid path characters.
    if (!name || /[:\x00-\x1f]/.test(name)) throw new Error('invalid');
    const parent = await fs.promises.realpath(path.dirname(selected));
    const absolute = path.join(parent, name);
    const checkPath = async () => {
      const stat = await fs.promises.lstat(absolute);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        (await fs.promises.realpath(absolute)) !== absolute ||
        (await fs.promises.realpath(parent)) !== parent
      )
        throw new Error('invalid');
      return stat;
    };
    const before = await checkPath();
    if (before.size > LIMITS.bytes) throw new Error('invalid');
    handle = await fs.promises.open(
      absolute,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0),
    );
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFile(before, opened) || !sameFile(opened, await checkPath()))
      throw new Error('invalid');
    const buffer = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) throw new Error('invalid');
      offset += bytesRead;
    }
    if (!sameFile(opened, await handle.stat()) || !sameFile(opened, await checkPath()))
      throw new Error('invalid');
    return buffer;
  } finally {
    if (handle) await handle.close();
  }
}

/**
 * Decode a bounded private provider request; never publish the returned payload.
 * @param {Buffer} buffer Provider input.
 * @param {string[]} phases Explicit phases accepted by the caller.
 * @returns {object} Validated input with private IDs, cwd and tool arguments.
 * @since v0.15.1
 */
function decodeActionRequest(buffer, phases) {
  const input = parse(buffer);
  if (!object(input) || !phases.includes(input.hook_event_name) || input.tool_name !== 'Bash')
    throw new Error('surface-unsupported');
  if (
    !identifier(input.session_id) ||
    !identifier(input.tool_use_id) ||
    typeof input.cwd !== 'string' ||
    !path.isAbsolute(input.cwd) ||
    !object(input.tool_input) ||
    typeof input.tool_input.command !== 'string' ||
    !input.tool_input.command
  )
    throw new Error('input-invalid');
  return input;
}

/**
 * Compare validated private JSON values with every own key retained.
 * @param {unknown} left First validated JSON value.
 * @param {unknown} right Second validated JSON value.
 * @returns {boolean} Exact structural equality, ignoring object key order.
 * @since v0.15.1
 */
function equalActionValue(left, right) {
  return equal(left, right);
}

/**
 * Evaluate one Claude PreToolUse Bash input against a selected immutable read.
 * Exact input matching is not executable/content/OS identity binding. No command
 * is run here; the hook consumer returns a provider decision. All failures deny.
 * @param {string} policyPath Explicit regular policy JSON file.
 * @param {Buffer} inputBuffer Bounded provider JSON input, used only in memory.
 * @param {string} [expectedSha256] Optional reviewed digest of the same policy bytes.
 * @returns {Promise<{decision: string, reason: string}>} Fixed codes with no raw input or digest.
 * @since v0.15.1
 */
async function evaluateActionPolicy(policyPath, inputBuffer, expectedSha256) {
  if (
    expectedSha256 !== undefined &&
    (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha256))
  )
    return deny('policy-invalid');
  let input;
  try {
    input = decodeActionRequest(inputBuffer, ['PreToolUse']);
  } catch (error) {
    return deny(error.message === 'surface-unsupported' ? 'surface-unsupported' : 'input-invalid');
  }
  let bytes;
  try {
    bytes = await readPolicy(policyPath);
  } catch (_) {
    return deny('policy-unavailable');
  }
  let policy;
  try {
    if (
      expectedSha256 !== undefined &&
      createHash('sha256').update(bytes).digest('hex') !== expectedSha256
    )
      return deny('policy-changed');
    policy = parse(bytes);
    if (!validPolicy(policy)) return deny('policy-invalid');
  } catch (_) {
    return deny('policy-invalid');
  } finally {
    bytes.fill(0);
  }
  if (input.cwd !== policy.cwd) return deny('scope-mismatch');
  if (policy.schemaVersion === 2) return evaluateProjectProfile(input.tool_input);
  const rule = policy.rules.find((candidate) => equal(candidate.input, input.tool_input));
  const decision = rule ? rule.decision : policy.defaultDecision;
  return { decision, reason: `policy-${decision}` };
}

module.exports = {
  evaluateActionPolicy,
  decodeActionRequest,
  equalActionValue,
  LIMITS,
  parseActionJson: parse,
  readActionFile: readPolicy,
  validActionPolicy: validPolicy,
};
