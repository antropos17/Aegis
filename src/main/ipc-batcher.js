// @ts-check
/**
 * @file ipc-batcher.js
 * @module main/ipc-batcher
 * @description Batches high-frequency IPC events to prevent renderer freezes.
 *   Collects events over a configurable interval then sends a single IPC message.
 * @since v0.5.0
 */
'use strict';

/**
 * @typedef {Object} BatcherOptions
 * @property {number} [intervalMs] - Flush interval in milliseconds (default 150)
 * @property {'append' | 'latest'} [mode] - Batching strategy (default 'append')
 */

/**
 * @typedef {Object} Batcher
 * @property {(value: unknown) => void} push - Add event to buffer
 * @property {(producer: () => unknown) => void} pushLazy - Queue a producer, resolved once at flush ('latest' only)
 * @property {() => void} flush - Send buffered data immediately
 * @property {() => void} destroy - Flush and prevent further pushes
 */

/**
 * Create a batched IPC sender.
 *
 * - **append** mode: accumulates events in an array, flushes as flat array.
 * - **latest** mode: keeps only the most recent value, flushes that.
 *
 * @param {string} channel - IPC channel name (e.g. 'file-access').
 * @param {(channel: string, data: unknown) => void} sendFn - Function that sends data to renderer.
 * @param {BatcherOptions} [options]
 * @returns {Batcher}
 * @since v0.5.0
 */
function createBatcher(channel, sendFn, options = {}) {
  const intervalMs = options.intervalMs || 150;
  const mode = options.mode || 'append';

  /** @type {unknown} */
  let buffer = mode === 'append' ? [] : undefined;
  /**
   * A pending {@link pushLazy} producer, or null. Held in its own slot rather than in
   * `buffer` so a payload that happens to be a function is still a payload.
   * @type {(() => unknown) | null}
   */
  let producer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let destroyed = false;

  /** Schedule a flush if one isn't already pending. */
  function scheduleFlush() {
    if (timer === null && !destroyed) {
      timer = setTimeout(flush, intervalMs);
    }
  }

  /**
   * Add an event to the batch buffer.
   * @param {unknown} value - Event object (append) or full replacement value (latest).
   */
  function push(value) {
    if (destroyed) return;
    if (mode === 'append') {
      /** @type {unknown[]} */ (buffer).push(value);
    } else {
      buffer = value;
      producer = null;
    }
    scheduleFlush();
  }

  /**
   * Queue a PRODUCER of the next 'latest' payload instead of the payload itself.
   *
   * Same batching semantics as {@link push} — last one wins, one send per interval —
   * but the payload is built ONCE, when the batch actually flushes. In 'latest' mode
   * every value but the last is discarded anyway, so N eager pushes inside one window
   * compute N payloads to throw N-1 of them away; a producer computes exactly one.
   *
   * NOT a cache. Nothing is retained across flushes: each producer is dropped the
   * moment it is resolved, and the next window starts empty. There is no revision key
   * that could tell a stale payload from a fresh one, so none is kept.
   *
   * The producer runs on the flush timer, and a throw from it escapes there — a
   * producer must therefore be total. `push` and `pushLazy` overwrite each other:
   * whichever came last is what flushes.
   * @param {() => unknown} fn - Builds the payload. Called at most once per flush.
   * @returns {void}
   * @throws {Error} when the batcher is in 'append' mode, where "last one wins" — the
   *   property that makes deferral free — does not hold.
   * @since v0.12.0
   */
  function pushLazy(fn) {
    if (mode !== 'latest') {
      throw new Error("ipc-batcher: pushLazy requires mode 'latest'");
    }
    if (typeof fn !== 'function') {
      throw new Error('ipc-batcher: pushLazy requires a producer function');
    }
    if (destroyed) return;
    producer = fn;
    buffer = undefined;
    scheduleFlush();
  }

  /**
   * Immediately send all buffered data and reset the buffer.
   * Skips the IPC call if the buffer is empty.
   */
  function flush() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (mode === 'append') {
      const buf = /** @type {unknown[]} */ (buffer);
      if (buf.length === 0) return;
      buffer = [];
      sendFn(channel, buf);
    } else {
      // A pending producer is resolved HERE, once, and dropped before the send so a
      // throwing producer cannot be retried against a window it already consumed.
      if (producer !== null) {
        const build = producer;
        producer = null;
        sendFn(channel, build());
        return;
      }
      if (buffer === undefined) return;
      const snapshot = buffer;
      buffer = undefined;
      sendFn(channel, snapshot);
    }
  }

  /**
   * Flush remaining events and prevent further pushes.
   */
  function destroy() {
    if (destroyed) return;
    flush();
    destroyed = true;
  }

  return { push, pushLazy, flush, destroy };
}

module.exports = { createBatcher };
