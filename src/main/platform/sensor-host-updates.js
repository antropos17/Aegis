/** @file Atomic sensor/1 replacement requests; retains only the latest two sets. @since 0.19.2-beta */
'use strict';
const wire = require('./sensor-protocol');
const { createWatchRoot } = require('./sensor-identity');
const { isPromise } = require('node:util').types;

/** Coordinate exact replacements with acknowledgement and transport pressure.
 * @param {object} deps Trusted owner gates and one-request-at-a-time sender.
 * @returns {object} Update admission, pending view, snapshot and flush methods.
 * @since 0.19.2-beta
 */
function createUpdates({ platform, current, desired, disposed, send, notify, failed }) {
  let watch = [],
    paths = [],
    watchRevision = 0,
    pathsRevision = 0;
  function pending() {
    const item = current();
    return {
      watchPending: item ? item.applied.watch !== watchRevision : true,
      pathsPending: item
        ? item.session.getMode() === 'procfs' || item.applied.paths !== pathsRevision
        : true,
    };
  }
  function replacement(message) {
    // The retained set must fit every future request ID, including its longest
    // decimal spelling. JSON escaping can exceed the frame budget even when
    // all individual UTF-8 path limits and the array count are valid.
    const projected = wire.validateMessage(
      { ...message, id: 4294967295 },
      {
        direction: 'host-to-sensor',
      },
    );
    wire.encodeFrame(projected, { direction: 'host-to-sensor' });
    return projected;
  }
  function pump() {
    const item = current();
    if (!item || item.closing || !item.session.hasHello()) return;
    if (!desired()) {
      if (
        send('stop', {}, (reply) => {
          if (reply.t === 'err') return failed('stop-rejected');
          item.stopAck = true;
          item.transport.end();
        })
      )
        item.closing = true;
      return;
    }
    for (const [type, revision, value] of [
      ['watch', watchRevision, watch],
      ['paths', pathsRevision, paths],
    ]) {
      // The procfs service explicitly rejects paths; keep the desired set
      // pending so a later event-capable mode can receive it.
      if (type === 'paths' && platform === 'linux' && item.session.getMode() === 'procfs') continue;
      if (item.applied[type] === revision) continue;
      const data = type === 'watch' ? { roots: value, descendants: true } : { prefixes: value };
      const requestMode = item.modeToken;
      if (
        send(type, data, (reply) => {
          if (type === 'paths' && item.modeToken !== requestMode) return;
          if (reply.t === 'err') return failed('update-rejected');
          item.applied[type] = revision;
          notify();
        })
      )
        return;
    }
  }
  return {
    pump,
    pending,
    updateWatch(observations) {
      if (disposed()) return false;
      try {
        if (!Array.isArray(observations) || observations.length > 4096) return false;
        const roots = observations.map((row) => createWatchRoot(row, { platform }));
        const message = replacement({ t: 'watch', roots, descendants: true });
        watch = message.roots;
        watchRevision++;
        pump();
        return true;
      } catch {
        return false;
      }
    },
    updatePaths(prefixes) {
      if (disposed()) return false;
      try {
        const message = replacement({ t: 'paths', prefixes });
        paths = message.prefixes;
        pathsRevision++;
        pump();
        return true;
      } catch {
        return false;
      }
    },
    requestSnapshot(onSnapshot) {
      if (
        !desired() ||
        !current()?.session.hasHello() ||
        current().closing ||
        typeof onSnapshot !== 'function'
      )
        return false;
      return send('snap', {}, (message) => {
        if (!desired()) return;
        if (message.t === 'err') return failed('snapshot-rejected');
        try {
          const result = onSnapshot(message.procs);
          if (isPromise(result)) {
            try {
              Promise.prototype.then.call(result, undefined, () => {});
            } catch {
              /* Exotic promise owns rejection. */
            }
            failed('snapshot-consumer-failed');
          }
        } catch {
          failed('snapshot-consumer-failed');
        }
      });
    },
    clear() {
      watch = [];
      paths = [];
    },
  };
}
module.exports = { createUpdates };
