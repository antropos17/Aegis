/** @file Sensor/1 session ordering, active capabilities and fresh identity. @since 0.19.2-beta */
'use strict';
const { convertSensorIdentity } = require('./sensor-identity');
const { isPromise } = require('node:util').types;
const CAPABILITY = {
  exec: 'exec',
  exit: 'exit',
  fork: 'fork',
  open: 'fileOpen',
  connect: 'tcpConnect',
};
function invalid() {
  throw new Error('session-invalid');
}

/** Admit only frames belonging to the selected child and contiguous sequence.
 * sink receives {generation, platform, mode, event, identity}; it must return
 * exactly true synchronously after admission. No audit type/attribution is inferred.
 * @param {object} options Pinned owner context, admission and status callbacks.
 * @returns {object} Frame admission, mode/capability and readiness views.
 * @since 0.19.2-beta
 */
function createSession({
  platform,
  pid,
  generation,
  linuxContext,
  sink,
  onHello,
  onHealth,
  onLoss,
  reply,
  active,
}) {
  let hello = null;
  let mode = null;
  let caps = null;
  let modeReason = null;
  let next = 1n;
  function identity(observation) {
    return convertSensorIdentity(observation, {
      platform,
      ...(platform === 'linux' ? { linuxContext } : {}),
    });
  }
  function accept(message) {
    if (!hello) {
      if (message.t !== 'hello' || message.pid !== pid || message.platform !== platform) invalid();
      hello = message;
      mode = message.mode;
      caps = message.caps;
      onHello();
      return;
    }
    if (message.t === 'hello') invalid();
    if (message.t === 'mode') {
      if (!hello.modes.includes(message.mode) || BigInt(message.seq) !== next) invalid();
      mode = message.mode;
      caps = message.caps;
      modeReason = message.reason;
      onHello();
    } else if (message.t === 'evs') {
      if (BigInt(message.from) !== next) invalid();
      // Preflight the complete batch before admitting any observation.
      const rows = message.events.map((event) => {
        if (!caps[CAPABILITY[event.kind]]) invalid();
        return { generation, platform, mode, event, identity: identity(event) };
      });
      next = BigInt(message.to) + 1n;
      for (let index = 0; index < rows.length; index++) {
        if (!active()) return;
        let accepted = false;
        try {
          const result = sink(rows[index]);
          // Observe ordinary async rejection, but never call it admission.
          if (isPromise(result)) {
            try {
              Promise.prototype.then.call(result, undefined, () => {});
            } catch {
              /* Exotic promise owns rejection. */
            }
          }
          accepted = result === true;
        } catch {
          /* Sink exception text is never a diagnostic. */
        }
        if (!accepted && active()) {
          onLoss(BigInt(rows.length - index), 'sink-rejected');
          throw new Error('sink-rejected');
        }
      }
    } else if (message.t === 'loss') {
      if (BigInt(message.from) !== next) invalid();
      next = BigInt(message.to) + 1n;
      onLoss(BigInt(message.count), 'loss-observed');
    } else if (message.t === 'health') {
      if ((message.state === 'HEALTHY') !== (message.detail === 'ready')) invalid();
      onHealth(message);
    } else {
      if (message.t === 'snap') for (const row of message.procs) identity(row);
      if (!reply(message)) invalid();
    }
  }
  return {
    accept,
    hasHello: () => hello !== null,
    getMode: () => mode,
    getModeReason: () => modeReason,
    getCapabilities: () => (caps ? { ...caps } : null),
  };
}
module.exports = { createSession };
