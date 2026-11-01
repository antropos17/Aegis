'use strict';

const http = require('node:http');
const { createHmac } = require('node:crypto');
const { decodeActionRequest } = require('./action-policy');

// Stable structural encoding preserves array order and object membership while
// avoiding private identifiers and tool input in the local report transport.
function canonical(value) {
  if (value === null) return ['null'];
  if (typeof value === 'number') return ['number', Object.is(value, -0) ? '-0' : String(value)];
  if (typeof value === 'string' || typeof value === 'boolean') return [typeof value, value];
  if (Array.isArray(value)) return ['array', value.map(canonical)];
  return [
    'object',
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  ];
}

/** Derive an opaque per-launch attempt key without exporting provider data.
 * @param {Buffer} raw Bounded provider input. @param {string[]} phases Accepted events.
 * @param {NodeJS.ProcessEnv} env Explicit child environment.
 * @returns {string|null} Session-keyed correlation or unavailable. @since v0.21.0 */
function correlateClaudeGuardAttempt(raw, phases, env = process.env) {
  const secret = env.AEGIS_CLAUDE_GUARD_CAPABILITY;
  if (!/^[a-f0-9]{64}$/.test(secret || '')) return null;
  try {
    const input = decodeActionRequest(raw, phases);
    const key = Buffer.from(secret, 'hex');
    try {
      return createHmac('sha256', key)
        .update(
          JSON.stringify([
            input.session_id,
            input.tool_use_id,
            input.cwd,
            canonical(input.tool_input),
          ]),
        )
        .digest('hex');
    } finally {
      key.fill(0);
    }
  } catch {
    return null;
  }
}

function sendReport(route, event, env) {
  const portText = env.AEGIS_CLAUDE_GUARD_PORT;
  const session = env.AEGIS_CLAUDE_GUARD_SESSION;
  const token = env.AEGIS_CLAUDE_GUARD_CAPABILITY;
  const port = Number(portText);
  if (
    !/^[1-9][0-9]{0,4}$/.test(portText || '') ||
    port > 65535 ||
    !/^[a-f0-9]{32}$/.test(session || '') ||
    !/^[a-f0-9]{64}$/.test(token || '')
  )
    return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    let request;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request?.destroy();
      resolve();
    };
    const timer = setTimeout(finish, 150);
    try {
      const body = JSON.stringify(event);
      request = http.request(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: `/${route}/${session}`,
          agent: false,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            connection: 'close',
          },
        },
        (response) => {
          response.on('error', finish);
          response.on('end', finish);
          response.resume();
        },
      );
      request.on('error', finish);
      request.end(body);
    } catch {
      finish();
    }
  });
}

/** Send one bounded decision report to an explicitly initiated local session.
 * Reporting never changes the provider decision; possession of a capability is
 * not proof of a Claude process, delivery completeness, or action effect.
 * @param {{decision:string,reason:string,attempt?:string}} event Fixed, redacted decision.
 * @param {NodeJS.ProcessEnv} env The hook process environment.
 * @returns {Promise<void>} Settles after acknowledgment, failure, or deadline.
 * @since v0.21.0 */
function reportClaudeGuardDecision(event, env = process.env) {
  const allowed = {
    generic: ['allow', 'ask', 'deny'],
    'adapter-failure': ['deny'],
    'project-review-ordinary': ['ask'],
    'project-review-script': ['ask'],
    'project-review-edit': ['ask'],
    'project-deny-sensitive': ['deny'],
    'project-deny-destructive': ['deny'],
    'project-deny-unsupported': ['deny'],
  };
  if (
    !event ||
    ![2, 3].includes(Object.keys(event).length) ||
    (Object.hasOwn(event, 'attempt') && !/^[a-f0-9]{64}$/.test(event.attempt || '')) ||
    Object.keys(event).some((key) => !['decision', 'reason', 'attempt'].includes(key)) ||
    !Object.hasOwn(allowed, event.reason) ||
    !allowed[event.reason].includes(event.decision)
  )
    return Promise.resolve();
  return sendReport('decision', event, env);
}

/** Send a fixed after-event or a loss indicator without provider content.
 * @param {{attempt?:string,outcome:string}} event Redacted event.
 * @param {NodeJS.ProcessEnv} env Child environment. @returns {Promise<void>} Bounded report.
 * @since v0.21.0 */
function reportClaudeGuardOutcome(event, env = process.env) {
  if (!event || !['reported-completed', 'reported-failed', 'loss'].includes(event.outcome))
    return Promise.resolve();
  if (event.outcome === 'loss') {
    if (Object.keys(event).length !== 1) return Promise.resolve();
  } else if (Object.keys(event).length !== 2 || !/^[a-f0-9]{64}$/.test(event.attempt || '')) {
    return Promise.resolve();
  }
  return sendReport('outcome', event, env);
}

module.exports = {
  reportClaudeGuardDecision,
  reportClaudeGuardOutcome,
  correlateClaudeGuardAttempt,
};
