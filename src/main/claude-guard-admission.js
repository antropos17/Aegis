'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { scanJson } = require('./claude-hook-json');
const { planObservedRemoval } = require('./claude-hook-app-removal');
const { profileCommand } = require('./claude-hook-app-profile');
const { readActionFile, parseActionJson, validActionPolicy } = require('./action-policy');

function policyFromProfile(bytes, selection) {
  const plan = planObservedRemoval(bytes, selection);
  try {
    if (!plan.ok) throw Error('profile-refused');
  } finally {
    plan.after?.fill(0);
  }
  const source = scanJson(bytes);
  try {
    const entries = source.root.members.get('hooks')?.members.get('PreToolUse');
    // Additional pre-tool entries may also match Bash and alter the provider's input.
    if (entries?.kind !== 'array' || entries.items.length !== 1) throw Error('profile-refused');
    const command = entries.items[0].members.get('hooks')?.items[0]?.members.get('command')?.value;
    if (typeof command !== 'string') throw Error('profile-refused');
    const match = /^"[^"]+" "[^"]+" --action-policy-hook "([^"]+)"$/.exec(command);
    if (!match || profileCommand(selection.executable, selection.appPath, match[1]) !== command)
      throw Error('profile-refused');
    return match[1];
  } finally {
    source.bytes.fill(0);
  }
}

function samePolicyIdentity(first, second) {
  return (
    first.dev === second.dev &&
    first.ino === second.ino &&
    first.size === second.size &&
    first.mtimeNs === second.mtimeNs &&
    first.ctimeNs === second.ctimeNs
  );
}

async function readPolicyBinding(filename, cwd) {
  let bytes;
  try {
    if (typeof filename !== 'string' || /^[\\/]{2}/.test(filename)) throw Error('policy-refused');
    const selected = path.resolve(filename);
    const parent = await fs.realpath(path.dirname(selected));
    const absolute = path.join(parent, path.basename(selected));
    const check = async () => {
      const stat = await fs.lstat(absolute, { bigint: true });
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.ino === 0n ||
        (await fs.realpath(absolute)) !== absolute ||
        (await fs.realpath(parent)) !== parent
      )
        throw Error('policy-refused');
      return stat;
    };
    const before = await check();
    bytes = await readActionFile(filename);
    const after = await check();
    const parsed = parseActionJson(bytes);
    if (!samePolicyIdentity(before, after) || !validActionPolicy(parsed) || parsed.cwd !== cwd)
      throw Error('policy-refused');
    const result = { identity: after, bytes };
    bytes = null;
    return result;
  } finally {
    bytes?.fill(0);
  }
}

async function readTarget(io) {
  const value = await io.readTarget();
  try {
    if (
      !value ||
      typeof value.identity !== 'string' ||
      !value.identity ||
      value.identity.length > 256 ||
      !Buffer.isBuffer(value.bytes) ||
      value.bytes.length > 262144
    )
      throw Error('profile-refused');
    return { identity: value.identity, bytes: Buffer.from(value.bytes) };
  } finally {
    value?.bytes?.fill(0);
  }
}

/** Bind one admitted profile and policy to guarded reads. This is not a file lock:
 * another process can still change them after verification and before spawn.
 * @param {object} options Fixed app paths and trusted private profile reader.
 * @returns {object} Opaque capture, revalidation and zeroing operations. @since v0.21.0 */
function createClaudeGuardAdmission({ io, target, executable, appPath }) {
  const selection = Object.freeze({ target, executable, appPath });
  if (!io || typeof io.readTarget !== 'function') throw Error('admission-unavailable');
  let state = null;
  let busy = false;
  let closed = false;

  function release(binding) {
    if (!state || state.binding !== binding) return;
    state.profile.bytes.fill(0);
    state.policy.bytes.fill(0);
    state = null;
  }
  function close() {
    closed = true;
    if (state) release(state.binding);
  }
  async function capture(cwd) {
    if (closed || busy || state || typeof cwd !== 'string' || !path.isAbsolute(cwd)) return null;
    busy = true;
    let profile, after, policy;
    try {
      profile = await readTarget(io);
      const policyPath = policyFromProfile(profile.bytes, selection);
      policy = await readPolicyBinding(policyPath, cwd);
      after = await readTarget(io);
      if (closed || after.identity !== profile.identity || !after.bytes.equals(profile.bytes))
        return null;
      const binding = Object.freeze({});
      state = { binding, profile, policy, policyPath, cwd };
      profile = null;
      policy = null;
      return binding;
    } catch {
      return null;
    } finally {
      profile?.bytes.fill(0);
      after?.bytes.fill(0);
      policy?.bytes.fill(0);
      busy = false;
    }
  }
  async function verify(binding) {
    if (closed || busy || !state || state.binding !== binding) return false;
    busy = true;
    const expected = state;
    let before, after, policy;
    try {
      before = await readTarget(io);
      if (
        before.identity !== expected.profile.identity ||
        !before.bytes.equals(expected.profile.bytes)
      )
        return false;
      policy = await readPolicyBinding(expected.policyPath, expected.cwd);
      if (
        !samePolicyIdentity(policy.identity, expected.policy.identity) ||
        !policy.bytes.equals(expected.policy.bytes)
      )
        return false;
      after = await readTarget(io);
      return (
        !closed &&
        state === expected &&
        after.identity === expected.profile.identity &&
        after.bytes.equals(expected.profile.bytes)
      );
    } catch {
      return false;
    } finally {
      before?.bytes.fill(0);
      after?.bytes.fill(0);
      policy?.bytes.fill(0);
      busy = false;
    }
  }
  return Object.freeze({ capture, verify, release, close });
}

module.exports = { createClaudeGuardAdmission };
