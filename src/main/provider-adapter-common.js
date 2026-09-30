'use strict';
const path = require('node:path');
const { createActionPolicySession } = require('./action-policy-session');
const { parseActionJson, decodeActionRequest } = require('./action-policy');
const LIMITS = Object.freeze({ events: 128, actions: 64, bytes: 262144, inputBytes: 16384 });
const id = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const failure = (profile, reason) =>
  Object.freeze({
    provider: profile.provider,
    adapterVersion: profile.version,
    decision: 'deny',
    reason,
    approvalSupported: profile.provider === 'claude',
    launchAllowed: false,
    wire: Object.freeze({
      hookSpecificOutput: Object.freeze({
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'AEGIS adapter refused this request.',
      }),
    }),
  });
/** Create a finite trusted-owner adapter over the existing policy/observation session.
 * @param {object} profile Fixed provider/version mapping.
 * @param {{policyPath:string,sessionId:string,cwd:string}} owner Private admitted context.
 * @returns {object} Local decision/observation interface, never native execution authority. @since v0.17.0 */
function createProviderAdapter(profile, owner) {
  if (
    !profile ||
    !['claude', 'codex'].includes(profile.provider) ||
    profile.version !== `${profile.provider}-hook-subset-v1`
  )
    throw Error('provider-profile-invalid');
  if (
    !owner ||
    !id(owner.sessionId) ||
    typeof owner.cwd !== 'string' ||
    !path.isAbsolute(owner.cwd) ||
    typeof owner.policyPath !== 'string' ||
    !path.isAbsolute(owner.policyPath)
  )
    throw Error('provider-owner-invalid');
  const context = Object.freeze({ ...owner });
  const session = createActionPolicySession({ policyPath: owner.policyPath });
  const identities = new Map();
  let closed = false,
    events = 0,
    bytes = 0,
    actions = 0,
    limitExceeded = false;
  const close = () => {
    closed = true;
    identities.clear();
    return session.close();
  };
  const decode = (raw, before) => {
    if (closed) throw Error('closed');
    if (
      ++events > LIMITS.events ||
      !Buffer.isBuffer(raw) ||
      raw.length > LIMITS.inputBytes ||
      (bytes += raw.length) > LIMITS.bytes
    ) {
      limitExceeded = true;
      throw Error('invalid');
    }
    const value = parseActionJson(raw);
    const keys = ['hook_event_name', 'session_id', 'tool_use_id', 'tool_name', 'cwd', 'tool_input'];
    if (profile.provider === 'codex') keys.push('turn_id', 'model');
    if (!before) keys.push('tool_response');
    if (
      !value ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).length !== keys.length ||
      !keys.every((key) => Object.hasOwn(value, key)) ||
      value.cwd !== context.cwd ||
      value.session_id !== context.sessionId ||
      !id(value.tool_use_id) ||
      (profile.provider === 'codex' && (!id(value.turn_id) || !id(value.model)))
    )
      throw Error('invalid');
    const phases = before
      ? ['PreToolUse']
      : profile.provider === 'codex'
        ? ['PostToolUse']
        : ['PostToolUse', 'PostToolUseFailure'];
    decodeActionRequest(raw, phases);
    return value;
  };
  const canonical = (value) =>
    Buffer.from(
      JSON.stringify({
        hook_event_name: value.hook_event_name,
        session_id: value.session_id,
        tool_use_id: value.tool_use_id,
        tool_name: value.tool_name,
        cwd: value.cwd,
        tool_input: value.tool_input,
      }),
    );
  return Object.freeze({
    async before(raw) {
      let owned;
      try {
        const value = decode(raw, true);
        if (++actions > LIMITS.actions) {
          limitExceeded = true;
          throw Error('invalid');
        }
        const identity =
          profile.provider === 'codex' ? JSON.stringify([value.turn_id, value.model]) : 'claude';
        if (identities.has(value.tool_use_id)) throw Error('duplicate');
        identities.set(value.tool_use_id, identity);
        owned = canonical(value);
        const result = await session.before(owned);
        if (closed) return failure(profile, 'adapter-closed');
        const unsupported = profile.provider === 'codex' && result.decision === 'ask';
        const permissionDecision = unsupported ? 'deny' : result.decision;
        return Object.freeze({
          provider: profile.provider,
          adapterVersion: profile.version,
          decision: result.decision,
          reason: unsupported ? 'approval-unsupported' : result.reason,
          approvalSupported: profile.provider === 'claude',
          launchAllowed: false,
          wire: Object.freeze({
            hookSpecificOutput: Object.freeze({
              hookEventName: 'PreToolUse',
              permissionDecision,
              permissionDecisionReason: unsupported
                ? 'AEGIS adapter cannot request approval on this hook.'
                : 'AEGIS selected policy decision.',
            }),
          }),
        });
      } catch {
        close();
        return failure(profile, limitExceeded ? 'adapter-limit' : 'adapter-invalid');
      } finally {
        owned?.fill(0);
      }
    },
    after(raw) {
      let owned;
      try {
        const value = decode(raw, false);
        const identity =
          profile.provider === 'codex' ? JSON.stringify([value.turn_id, value.model]) : 'claude';
        if (identities.get(value.tool_use_id) !== identity) throw Error('identity');
        owned = canonical(value);
        const result = session.after(owned);
        if (result.status !== 'linked') close();
        return Object.freeze({
          status: result.status,
          outcome: result.outcome || null,
          launchAllowed: false,
        });
      } catch {
        close();
        return Object.freeze({ status: 'rejected', outcome: null, launchAllowed: false });
      } finally {
        owned?.fill(0);
      }
    },
    snapshot: () =>
      Object.freeze({
        provider: profile.provider,
        adapterVersion: profile.version,
        closed,
        limitExceeded,
        events,
        bytes,
        actions,
        observation: session.snapshot(),
        nativeQualification: 'not-run',
        launchAllowed: false,
      }),
    close,
  });
}
module.exports = { createProviderAdapter, LIMITS };
