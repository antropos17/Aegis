/**
 * @file watch-worker-client.js
 * @description EventEmitter watcher proxy. Each root has a dedicated worker and
 *   at most one acknowledged batch in flight. Close invalidates delivery before
 *   terminating the worker, so late callbacks cannot enter a new watch lifetime.
 */
'use strict';

const { EventEmitter } = require('node:events');
const { Worker } = require('node:worker_threads');
const path = require('node:path');

/**
 * @param {string|string[]} paths
 * @param {object} options - Serializable chokidar options plus project ignore descriptors.
 * @param {object} [deps] - Worker constructor seam for lifecycle tests.
 * @returns {EventEmitter & {close: Function}}
 * @since v0.14.0
 */
function watch(paths, options, { WorkerClass = Worker } = {}) {
  const emitter = new EventEmitter();
  const worker = new WorkerClass(path.join(__dirname, 'watch-worker-thread.js'), {
    workerData: { paths, options },
  });
  let closed = false;
  let failed = false;
  let ready = false;
  let dropped = 0;
  let sequence = 0;
  let closing;
  const fail = (reason) => {
    if (closed || failed) return;
    failed = true;
    emitter.emit('error', new Error(reason));
  };
  worker.on('error', () => fail('watch-worker-crashed'));
  worker.on('exit', () => fail('watch-worker-exited'));
  worker.on('message', (batch) => {
    if (closed || batch.seq <= sequence) return;
    sequence = batch.seq;
    try {
      if (batch.dropped > dropped) {
        const delta = batch.dropped - dropped;
        dropped = batch.dropped;
        emitter.emit('loss', delta);
      }
      if (closed) return;
      if (batch.error) fail(batch.error);
      if (closed) return;
      if (batch.ready && !ready) {
        ready = true;
        emitter.emit('ready');
      }
      for (const event of batch.events) {
        if (closed) break;
        emitter.emit(event.type, event.path);
      }
    } finally {
      if (!closed) worker.postMessage({ type: 'ack', seq: batch.seq });
    }
  });
  emitter.close = () => {
    if (!closed) {
      closed = true;
      // Termination failure is returned to an awaiting caller, and handled here
      // as well because Electron's final quit callback cannot await promises.
      closing = worker.terminate();
      closing.catch(() => {});
    }
    return closing;
  };
  return emitter;
}

module.exports = { watch };
