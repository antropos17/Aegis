/**
 * @file token-feed.js
 * @module main/token-feed
 * @description Extensible per-PID token-feed CORE. A thin registry that fans a
 *   list of live processes out to each registered token adapter and concatenates
 *   the measured (`estimated:false`) token deltas they return. The core holds NO
 *   agent-specific knowledge — every detail of where usage lives on disk, how to
 *   tail it, and how to attribute it per-PID belongs to an adapter. Adding a new
 *   self-logging agent is one `require` appended to {@link adapters}.
 *
 *   Each adapter implements the contract:
 *     { id: string,
 *       readUsage(procs: Proc[]) => Promise<UsageDelta[]>,
 *       _resetForTest(): void }
 *
 *   An adapter that throws or finds no source contributes nothing — a single bad
 *   adapter can never crash the feed or starve the others. The companion
 *   accounting sink is `token-tracker.js`, whose `estimated:false` contract these
 *   measured deltas satisfy; wiring this feed into the scan loop is a separate
 *   task and is intentionally NOT done here.
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 */
'use strict';

const logger = require('./logger');
const claudeCode = require('./token-adapters/claude-code');

/**
 * @typedef {import('./token-adapters/claude-code').Proc} Proc
 * @typedef {import('./token-adapters/claude-code').UsageDelta} UsageDelta
 */

/** Default adapter registry. Append a module here to support a new agent. */
const DEFAULT_ADAPTERS = [claudeCode];

/** @type {Array<{ id: string, readUsage: Function, _resetForTest?: Function }>} */
let adapters = DEFAULT_ADAPTERS.slice();

/**
 * Read new measured token deltas for the given live processes across every
 * registered adapter, in registration order.
 * @param {Proc[]} procs - live processes enriched with OS `startTime` (see adapter).
 * @returns {Promise<UsageDelta[]>} flat array of measured deltas (possibly empty).
 * @since v0.10.0-alpha
 */
async function readUsageByPid(procs) {
  const out = [];
  for (const adapter of adapters) {
    let deltas;
    try {
      deltas = await adapter.readUsage(procs);
    } catch (err) {
      // One adapter failing never crashes the feed or starves the others.
      logger.debug('token-feed', 'adapter failed', { adapter: adapter.id, error: err.message });
      continue;
    }
    if (Array.isArray(deltas)) for (const d of deltas) out.push(d);
  }
  return out;
}

/** @internal Swap the adapter registry (tests). @param {Array} arr */
function _setAdaptersForTest(arr) {
  adapters = arr;
}

/** @internal Restore the default registry and reset each adapter (tests). @returns {void} */
function _resetForTest() {
  adapters = DEFAULT_ADAPTERS.slice();
  for (const a of DEFAULT_ADAPTERS) if (typeof a._resetForTest === 'function') a._resetForTest();
}

module.exports = { readUsageByPid, _setAdaptersForTest, _resetForTest };
