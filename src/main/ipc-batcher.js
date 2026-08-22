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
 * @property {number} [capacity] - 'append' only. Largest number of entries the buffer
 *   may hold between two flushes; a push beyond it evicts the oldest entry. Absent =
 *   unbounded, which is exactly the behaviour every caller had before v0.13.0.
 * @property {(value: unknown) => string | null} [coalesceKey] - 'append' only. Merge key
 *   for a pushed value, or null when the value must never merge.
 */

/**
 * @typedef {Object} BatcherStats
 * @property {number} pushed - Accepted `push` calls, lifetime.
 * @property {number} coalesced - Pushes that replaced a same-key entry, lifetime.
 * @property {number} evicted - Entries dropped to honour `capacity`, lifetime.
 * @property {number} evictedSinceFlush - Evictions since the last flush that SENT.
 * @property {number} highWater - Largest buffered length ever observed.
 * @property {number} buffered - Entries the next flush would send, right now.
 */

/**
 * @typedef {Object} Batcher
 * @property {(value: unknown) => void} push - Add event to buffer
 * @property {(producer: () => unknown) => void} pushLazy - Queue a producer, resolved once at flush ('latest' only)
 * @property {() => void} flush - Send buffered data immediately
 * @property {() => void} destroy - Flush and prevent further pushes
 * @property {() => BatcherStats} getStats - Snapshot of this batcher's own accounting
 */

/**
 * Create a batched IPC sender.
 *
 * - **append** mode: accumulates events in an array, flushes as flat array.
 * - **latest** mode: keeps only the most recent value, flushes that.
 *
 * ## What an eviction here is, and what it is not
 *
 * This batcher is the DISPLAY lane. Everything it drops is a frame the renderer never
 * paints, and nothing else: an eviction is not a sensor `lossCount`, and it is not an
 * audit drop. The durable record — the activityLog ring and the audit-logger JSONL with
 * its hash chain and buffer-overflow-drop markers — is a separate lane that accounts for
 * its own loss. A number from {@link BatcherStats} answers "what did the UI not see",
 * never "what was not observed" or "what was not recorded".
 *
 * @param {string} channel - IPC channel name (e.g. 'file-access').
 * @param {(channel: string, data: unknown) => void} sendFn - Function that sends data to renderer.
 * @param {BatcherOptions} [options]
 * @returns {Batcher}
 * @throws {Error} when `capacity` is not a positive integer, when `coalesceKey` is not a
 *   function, or when either is passed in 'latest' mode, where a one-slot buffer can
 *   neither overflow nor merge.
 * @since v0.5.0
 */
function createBatcher(channel, sendFn, options = {}) {
  const intervalMs = options.intervalMs || 150;
  const mode = options.mode || 'append';
  const capacity = options.capacity;
  const coalesceKey = options.coalesceKey;

  if (capacity !== undefined) {
    if (mode !== 'append') {
      throw new Error("ipc-batcher: capacity requires mode 'append'");
    }
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('ipc-batcher: capacity must be a positive integer');
    }
  }
  if (coalesceKey !== undefined) {
    if (mode !== 'append') {
      throw new Error("ipc-batcher: coalesceKey requires mode 'append'");
    }
    if (typeof coalesceKey !== 'function') {
      throw new Error('ipc-batcher: coalesceKey must be a function');
    }
  }

  /** @type {unknown} */
  let buffer = mode === 'append' ? [] : undefined;
  /**
   * Merge keys, parallel to the append buffer — index i holds the key of entry i, or
   * null for an entry that must never merge. Stays null while coalescing is off, so a
   * batcher without `coalesceKey` allocates and walks nothing extra.
   * @type {(string | null)[] | null}
   */
  let keys = coalesceKey ? [] : null;
  /**
   * A pending {@link pushLazy} producer, or null. Held in its own slot rather than in
   * `buffer` so a payload that happens to be a function is still a payload.
   * @type {(() => unknown) | null}
   */
  let producer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let destroyed = false;

  let pushed = 0;
  let coalesced = 0;
  let evicted = 0;
  let evictedSinceFlush = 0;
  let highWater = 0;

  /** Schedule a flush if one isn't already pending. */
  function scheduleFlush() {
    if (timer === null && !destroyed) {
      timer = setTimeout(flush, intervalMs);
    }
  }

  /**
   * How many entries the next flush would send. One flat array in 'append' mode, one
   * value or nothing in 'latest'.
   * @returns {number}
   */
  function bufferedCount() {
    if (mode === 'append') return /** @type {unknown[]} */ (buffer).length;
    return buffer === undefined ? 0 : 1;
  }

  /**
   * Add an event to the batch buffer.
   *
   * In 'append' mode with `coalesceKey`, a value whose key already sits in the buffer
   * REPLACES that entry where it stands — position preserved, last value wins — instead
   * of extending the buffer. A merge adds no entry, so it can never trigger an eviction.
   *
   * With `capacity` set, a push that would exceed it drops the OLDEST buffered entry
   * first and the pushed value always enters. Eviction is oldest-first regardless of what
   * an entry holds: selective retention is the caller's job via `coalesceKey`, and the
   * durable lane owns completeness.
   * @param {unknown} value - Event object (append) or full replacement value (latest).
   */
  function push(value) {
    if (destroyed) return;
    if (mode === 'append') {
      const buf = /** @type {unknown[]} */ (buffer);
      // Resolved before any counter moves: a throwing coalesceKey must leave the
      // batcher exactly as it found it.
      const key = coalesceKey ? coalesceKey(value) : null;
      pushed++;
      // Only a string merges. null, undefined, or anything else means this value must
      // never merge, and two such values both occupy their own slot.
      const at = typeof key === 'string' && keys !== null ? keys.indexOf(key) : -1;
      if (at !== -1) {
        buf[at] = value;
        coalesced++;
      } else {
        if (capacity !== undefined && buf.length >= capacity) {
          buf.shift();
          if (keys !== null) keys.shift();
          evicted++;
          evictedSinceFlush++;
        }
        buf.push(value);
        if (keys !== null) keys.push(typeof key === 'string' ? key : null);
      }
    } else {
      buffer = value;
      producer = null;
      pushed++;
    }
    const now = bufferedCount();
    if (now > highWater) highWater = now;
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
      if (keys !== null) keys = [];
      evictedSinceFlush = 0;
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

  /**
   * Snapshot of this batcher's own accounting, as a fresh object per call.
   *
   * `pushed`, `coalesced` and `evicted` are lifetime totals; `evictedSinceFlush` returns
   * to 0 on every flush that actually sent; `highWater` is a lifetime maximum and never
   * returns to 0. Still readable after {@link destroy}, which leaves the totals standing
   * and `buffered` at 0.
   *
   * Two exclusions, stated rather than implied. A push refused because the batcher was
   * destroyed is not counted anywhere — it never entered. And {@link pushLazy} is outside
   * this accounting entirely: a queued producer moves no counter and a pending one reads
   * `buffered: 0`, because what it will build does not exist yet.
   *
   * In 'latest' mode only the counters that can apply do: `buffered` is 0 or 1, and
   * `coalesced`, `evicted` and `evictedSinceFlush` stay 0 — a one-slot buffer can neither
   * overflow nor merge.
   * @returns {BatcherStats}
   * @since v0.13.0
   */
  function getStats() {
    return {
      pushed,
      coalesced,
      evicted,
      evictedSinceFlush,
      highWater,
      buffered: bufferedCount(),
    };
  }

  return { push, pushLazy, flush, destroy, getStats };
}

module.exports = { createBatcher };
