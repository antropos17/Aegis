'use strict';

const http = require('node:http');

/** Send one bounded decision report to an explicitly initiated local session.
 * Reporting never changes the provider decision; possession of a capability is
 * not proof of a Claude process, delivery completeness, or action effect.
 * @param {{decision:string,reason:string}} event Fixed, redacted decision.
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
    Object.keys(event).length !== 2 ||
    !Object.hasOwn(allowed, event.reason) ||
    !allowed[event.reason].includes(event.decision)
  )
    return Promise.resolve();
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
          path: `/decision/${session}`,
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

module.exports = { reportClaudeGuardDecision };
