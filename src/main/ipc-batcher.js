/**
 * @file ipc-batcher.js
 * @module main/ipc-batcher
 * @description Batches high-frequency IPC events to prevent renderer freezes.
 *   Collects events over a configurable interval then sends a single IPC message.
 * @since v0.5.0
 */
'use strict';

/**
 * Create a batched IPC sender.
 *
 * - **append** mode: accumulates events in an array, flushes as flat array.
 * - **latest** mode: keeps only the most recent value, flushes that.
 *
 * @param {string} channel - IPC channel name (e.g. 'file-access').
 * @param {function(string, *): void} sendFn - Function that sends data to renderer.
 * @param {Object} [options]
 * @param {number} [options.intervalMs=150] - Flush interval in milliseconds.
 * @param {'append'|'latest'} [options.mode='append'] - Batching strategy.
 * @returns {{ push: function(*): void, flush: function(): void, destroy: function(): void }}
 * @since v0.5.0
 */
function createBatcher(channel, sendFn, options = {}) {
  const intervalMs = options.intervalMs || 150;
  const mode = options.mode || 'append';

  let buffer = mode === 'append' ? [] : undefined;
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
   * @param {*} value - Event object (append) or full replacement value (latest).
   */
  function push(value) {
    if (destroyed) return;
    if (mode === 'append') {
      buffer.push(value);
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
      if (buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      sendFn(channel, batch);
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
