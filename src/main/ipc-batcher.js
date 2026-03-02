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
    }
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

  return { push, flush, destroy };
}

module.exports = { createBatcher };
