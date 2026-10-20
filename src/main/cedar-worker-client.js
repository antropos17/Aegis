// @ts-check
'use strict';

const { Worker } = require('node:worker_threads');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { debuglog } = require('node:util');
const { snapshotRequest, metadataReply } = require('./cedar-worker-thread');
/** @typedef {import('./cedar-worker-thread').Metadata} Metadata */
/** @typedef {{timeoutMs?: number, signal?: AbortSignal}} EvaluationOptions */
/** @typedef {{stop: (reason: string) => void}} Lifetime */

/** Create a dormant, one-at-a-time disposable Cedar worker owner.
 * Deadlines cover startup, runtime load, compilation, evaluation and confirmed exit.
 * A thread shares process memory; resourceLimits do not bound WASM/external memory.
 * @param {{WorkerClass?: typeof Worker}} [deps] Constructor seam for lifecycle tests.
 * @returns {{evaluate: (policy: unknown, action: unknown, options?: EvaluationOptions) => Promise<Metadata>, close: () => void}}
 * @since v0.19.2 */
function createCedarWorkerClient({ WorkerClass = Worker } = {}) {
  /** @type {Lifetime|null} */
  let active = null;
  let closed = false;
  /** @param {string} reason @returns {Metadata} */
  const deny = (reason) => ({ decision: 'deny', reason, policyIds: [] });

  /** @param {unknown} policy @param {unknown} action @param {EvaluationOptions} [options] */
  function evaluate(policy, action, options = {}) {
    // Admission precedes all inspection/copying of private inputs and options.
    if (closed) return Promise.resolve(deny('cedar-worker-closed'));
    if (active) return Promise.resolve(deny('cedar-worker-busy'));
    // Worker construction logs its private options in the parent. Node caches
    // NODE_DEBUG at startup, so deleting process.env.NODE_DEBUG cannot disable it.
    if (debuglog('worker').enabled) return Promise.resolve(deny('cedar-unavailable'));
    /** @type {Lifetime} */
    const lifetime = { stop: () => {} };
    active = lifetime;
    const started = performance.now();
    let timeoutMs;
    let signal;
    try {
      timeoutMs = options.timeoutMs ?? 5000;
      signal = options.signal;
      if (
        !Number.isInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > 30000 ||
        (signal !== undefined && !(signal instanceof AbortSignal))
      )
        throw Error();
    } catch (_) {
      active = null;
      return Promise.resolve(deny('request-invalid'));
    }
    if (signal?.aborted) {
      active = null;
      return Promise.resolve(deny('cedar-worker-cancelled'));
    }
    const snapshot = snapshotRequest(policy, action);
    if (!snapshot.ok) {
      active = null;
      return Promise.resolve(deny(snapshot.reason));
    }
    const deadline = started + timeoutMs;
    if (performance.now() >= deadline) {
      active = null;
      return Promise.resolve(deny('cedar-worker-timeout'));
    }
    return new Promise((resolve) => {
      /** @type {Worker|undefined} */
      let worker;
      /** @type {Metadata|null} */
      let candidate = null;
      let settled = false;
      let invalid = false;
      let terminating = false;
      let exited = false;
      /** @type {ReturnType<typeof setTimeout>|undefined} */
      let timer;
      const cancelled = () => fail('cedar-worker-cancelled');
      /** @param {Metadata} result */
      const settle = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancelled);
        resolve(result);
      };
      const terminate = () => {
        if (!worker || terminating || exited) return;
        terminating = true;
        try {
          // Fulfillment is not used as an admission shortcut: only exit releases it.
          Promise.resolve(worker.terminate()).catch(() => fail('cedar-worker-cleanup-failed'));
        } catch (_) {
          fail('cedar-worker-cleanup-failed');
        }
      };
      /** @param {string} reason */
      const fail = (reason) => {
        invalid = true;
        candidate = null;
        settle(deny(reason));
        terminate();
      };
      lifetime.stop = fail;
      timer = setTimeout(
        () => fail('cedar-worker-timeout'),
        Math.max(1, deadline - performance.now()),
      );
      signal?.addEventListener('abort', cancelled, { once: true });
      if (signal?.aborted || closed) {
        fail('cedar-worker-cancelled');
        active = null; // No worker has been created.
        return;
      }
      try {
        worker = new WorkerClass(path.join(__dirname, 'cedar-worker-thread.js'), {
          workerData: snapshot.request,
          env: {},
          execArgv: [],
          argv: [],
          stdout: true,
          stderr: true,
          resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
        });
        worker.on('error', () => fail('cedar-worker-failed'));
        worker.on('messageerror', () => fail('cedar-worker-protocol'));
        worker.on('message', (message) => {
          if (invalid || exited) return;
          if (performance.now() >= deadline) return fail('cedar-worker-timeout');
          const reply = metadataReply(message, Object.keys(snapshot.request.policy.policies));
          if (candidate || !reply) return fail('cedar-worker-protocol');
          candidate = reply;
        });
        worker.once('exit', (code) => {
          exited = true;
          if (active === lifetime) active = null;
          if (invalid) return;
          if (performance.now() >= deadline) return fail('cedar-worker-timeout');
          if (code !== 0) return fail('cedar-worker-failed');
          settle(candidate || deny('cedar-worker-failed'));
        });
        // Drain without retaining or forwarding private runtime output.
        worker.stdout?.resume();
        worker.stderr?.resume();
      } catch (_) {
        fail('cedar-worker-failed');
        // Constructor failure created no worker. A later setup failure must retain admission.
        if (!worker && active === lifetime) active = null;
      }
    });
  }

  return {
    evaluate,
    close() {
      closed = true;
      active?.stop('cedar-worker-cancelled');
    },
  };
}

module.exports = { createCedarWorkerClient };
