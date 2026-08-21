/**
 * @file bench/lib/paths.js
 * @module bench/lib/paths
 * @description Recording-time rewrite of machine-local paths. Live I/O still
 *   uses the real filesystem; this module only decides what is written into
 *   artefacts that may be committed.
 *
 *   Isolated from `manifest.js` on purpose: `report.js` must be loadable by
 *   replay without pulling git probes, registry reads or `collect()`.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.11.0
 */
'use strict';

const path = require('path');

/** @type {string} Repository root — this file is `bench/lib/`, two levels down. */
const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Neutral repo root written into artefacts that may be committed. Same shape as
 * a Windows drive path with three segments, so path-parsing tests still see
 * `X:\…\…\…` without recording the developer's clone location.
 * @type {string}
 */
const RECORDED_REPO_ROOT = 'X:\\dev\\project\\AEGIS';

/**
 * Neutral account name written in place of the OS user segment (`\Users\<name>\`).
 * @type {string}
 */
const RECORDED_USER = 'user';

/**
 * Rewrite a path (or a sentence that embeds one) so committed artefacts do not
 * carry the developer clone location or the OS account name.
 *
 * Live I/O still uses the real path — this is a recording transform. The repo
 * root is replaced as a prefix or as an embedded substring; `\Users\<name>\`
 * (or `/Users/<name>/`) becomes `\Users\user\`. Other strings pass through.
 * @param {string} value
 * @returns {string}
 */
function neutralizePath(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  let out = value;
  if (ROOT && out.includes(ROOT)) {
    out = out.split(ROOT).join(RECORDED_REPO_ROOT);
  }
  const rootFwd = ROOT.replace(/\\/g, '/');
  if (rootFwd !== ROOT && out.includes(rootFwd)) {
    out = out.split(rootFwd).join(RECORDED_REPO_ROOT.replace(/\\/g, '/'));
  }
  return out.replace(/([/\\])Users\1([^/\\]+)(?=\1|$)/gi, `$1Users$1${RECORDED_USER}`);
}

/**
 * Walk a JSON-serializable value and neutralize every string. Used when writing
 * a capture record or a report, so a path that landed in a source sentence is
 * rewritten the same way as a dedicated path field.
 * @param {*} value
 * @returns {*}
 */
function neutralizeRecorded(value) {
  if (typeof value === 'string') return neutralizePath(value);
  if (Array.isArray(value)) return value.map(neutralizeRecorded);
  if (value && typeof value === 'object') {
    /** @type {Object<string, *>} */
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = neutralizeRecorded(child);
    }
    return out;
  }
  return value;
}

module.exports = {
  RECORDED_REPO_ROOT,
  RECORDED_USER,
  ROOT,
  neutralizePath,
  neutralizeRecorded,
};
