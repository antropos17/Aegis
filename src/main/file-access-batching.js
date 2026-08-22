// @ts-check
/**
 * @file file-access-batching.js
 * @module main/file-access-batching
 * @description The DISPLAY-lane batching policy for the `file-access` IPC channel:
 *   the merge key and the bounds main.js hands to {@link module:main/ipc-batcher}.
 *   Pure — no I/O, no Electron, no timers, no module state — so main.js can load it
 *   on the fast path to a visible window, ahead of `loadDeferredModules`.
 * @since v0.13.0
 */
'use strict';

/**
 * Largest number of `file-access` entries one 150 ms flush window may hold. A window
 * that accumulates a thousand display frames is already pathological: the renderer
 * cannot paint them, and the durable lane — the activityLog ring and the audit-logger
 * JSONL with its hash chain — owns completeness independently of this number.
 *
 * An eviction here is a frame the UI never saw. It is not a sensor `lossCount` and it
 * is not an audit drop; see the ipc-batcher module header for that boundary.
 * @type {number}
 * @since v0.13.0
 */
const FILE_ACCESS_CAPACITY = 1000;

/**
 * Flush window for the `file-access` channel, unchanged since v0.5.0.
 * @type {number}
 */
const FILE_ACCESS_INTERVAL_MS = 150;

/**
 * Field separator for {@link fileAccessCoalesceKey}, written as an escape so the source
 * file stays plain text. NUL cannot occur in any of the three segments — `instanceId` is
 * `<pid>:<epochMs>` / `0:<name>` / `<pid>:u` (process-identity.js), `file` is an OS path,
 * `action` is a five-value closed set (shared/types/events.ts `FileAction`) — so the join
 * is unambiguous. A printable delimiter would not be: a Windows path carries both `:`
 * and `\`, and either could otherwise let two different field splits build one key.
 * @type {string}
 */
const KEY_SEP = '\u0000';

/**
 * True when `v` is a usable key segment: a string with at least one character. A type
 * predicate so the three segment checks below narrow the fields they guard, rather than
 * leaving the template literal to stringify an `unknown`.
 * @param {unknown} v
 * @returns {v is string}
 */
function isSegment(v) {
  return typeof v === 'string' && v.length > 0;
}

/**
 * Merge key for a file event on the `file-access` display lane, or `null` when the
 * event must never merge.
 *
 * THREE REFUSALS, and each one is a separate claim:
 *
 * 1. **A sensitive event never merges.** Checked first and independently of everything
 *    below. Today `sensitive` is false whenever `selfAccess` is true by construction
 *    (`sensitive: reason !== null && !selfAccess`, file-watcher.js), so this guard is
 *    unreachable through the self-churn branch — it is here so the refusal does not
 *    depend on that coupling surviving a future edit.
 * 2. **Anything that is not the agent's own benign self-churn never merges.** The only
 *    self-churn marker a file event carries is `selfAccess`, set at all three emission
 *    sites (file-watcher.js `handleWatcherEvent`, `scanFileHandles`, `_scanRmHolders`)
 *    and meaning exactly "this agent touched its OWN config directory". Note the bound
 *    that comes with it: `selfAccess` is true only where the path ALSO matched a
 *    sensitive rule and the owning agent's own exemption cleared it, so an ordinary
 *    non-sensitive file event is not self-churn and is never merged. That is the marker
 *    the event shape actually has; no proxy is invented for the wider case.
 * 3. **An event with no process-instance key never merges.** `instanceId` is `null` for
 *    an unattributed event and for an owner that was never stamped (process-identity.js
 *    `readInstanceId`). Merging on a missing key would pool two different instances'
 *    frames under one entry — the same collapse `dedupFileEvent` refuses for the same
 *    reason (scan-loop.js, F-E03).
 *
 * WHERE THIS ACTUALLY FIRES. `scanLoop.dedupFileEvent` sits AHEAD of the batcher on
 * every push path and suppresses a repeat of the same `instanceId|file` for 30 s, so in
 * steady state the same pair cannot reach one 150 ms window twice and this key merges
 * nothing. It earns its place under burst, where `eventDedupMap` passes 1000 entries and
 * is cleared wholesale, and repeats start arriving: coalescing is the burst-mode
 * backstop, {@link FILE_ACCESS_CAPACITY} is the primary bound.
 *
 * Pure and total: no throw for any input, which matters because ipc-batcher resolves
 * this on the push path before any counter moves.
 * @param {unknown} value - A file event as built by file-watcher.js, or anything else.
 * @returns {string|null} A stable key for benign self-churn, else `null`.
 * @since v0.13.0
 */
function fileAccessCoalesceKey(value) {
  if (value === null || typeof value !== 'object') return null;
  const ev = /** @type {Record<string, unknown>} */ (value);
  if (ev.sensitive === true) return null;
  if (ev.selfAccess !== true) return null;
  if (!isSegment(ev.instanceId)) return null;
  if (!isSegment(ev.file)) return null;
  if (!isSegment(ev.action)) return null;
  return `${ev.instanceId}${KEY_SEP}${ev.file}${KEY_SEP}${ev.action}`;
}

/**
 * The exact options main.js passes to `createBatcher('file-access', …)`.
 *
 * Frozen and exported as ONE object rather than three loose constants so a test can
 * exercise the production configuration itself instead of re-assembling something that
 * merely looks like it — a re-assembled config proves the values, never the wiring.
 * @type {Readonly<{intervalMs: number, capacity: number,
 *   coalesceKey: (value: unknown) => string | null}>}
 * @since v0.13.0
 */
const FILE_ACCESS_BATCHER_OPTIONS = Object.freeze({
  intervalMs: FILE_ACCESS_INTERVAL_MS,
  capacity: FILE_ACCESS_CAPACITY,
  coalesceKey: fileAccessCoalesceKey,
});

module.exports = {
  FILE_ACCESS_CAPACITY,
  FILE_ACCESS_INTERVAL_MS,
  FILE_ACCESS_BATCHER_OPTIONS,
  KEY_SEP,
  fileAccessCoalesceKey,
};
