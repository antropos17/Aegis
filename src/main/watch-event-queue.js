/**
 * @file watch-event-queue.js
 * @description Bounded, acknowledged worker-to-main delivery. At most one batch
 *   is in the MessagePort and one bounded queue is waiting. Drop-newest overflow
 *   is counted; ready/error/loss state does not compete with file events for space.
 */
'use strict';

/** @param {Function} send @param {object} [limits] @returns {object} @since v0.14.0 */
function createQueue(send, { maxEvents = 512, maxBytes = 1024 * 1024, batchSize = 32 } = {}) {
  const pending = [];
  let bytes = 0;
  let dropped = 0;
  let ready = false;
  let error = null;
  let dirty = false;
  let inFlight = 0;
  let seq = 0;
  let scheduled = false;
  let closed = false;

  const pump = () => {
    scheduled = false;
    if (closed || inFlight || (!pending.length && !dirty)) return;
    const batch = pending.splice(0, batchSize);
    for (const event of batch) bytes -= event.bytes;
    dirty = false;
    inFlight = ++seq;
    send({ seq, events: batch.map(({ type, path }) => ({ type, path })), ready, error, dropped });
  };
  const schedule = () => {
    if (closed || scheduled || inFlight) return;
    scheduled = true;
    setImmediate(pump);
  };
  return {
    event(type, path) {
      if (closed) return;
      const size = Buffer.byteLength(path, 'utf8') + 32;
      if (pending.length >= maxEvents || bytes + size > maxBytes) {
        dropped++;
        dirty = true;
      } else {
        pending.push({ type, path, bytes: size });
        bytes += size;
      }
      schedule();
    },
    ready() {
      if (closed || ready) return;
      ready = true;
      dirty = true;
      schedule();
    },
    error() {
      if (closed || error) return;
      // No paths, watched content or arbitrary provider error text crosses here.
      error = 'watch-worker-provider-error';
      dirty = true;
      schedule();
    },
    ack(value) {
      if (!inFlight || value !== inFlight) return;
      inFlight = 0;
      schedule();
    },
    close() {
      closed = true;
      pending.length = 0;
      bytes = 0;
    },
  };
}

module.exports = { createQueue };
