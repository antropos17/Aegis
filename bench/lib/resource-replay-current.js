'use strict';
const path = require('node:path');
const io = require('./resource-replay-io');
const ROOT = path.resolve(__dirname, '../..');
const SOURCES = Object.freeze([
  'bench/resource-session-replay.cjs',
  'bench/lib/resource-replay.js',
  'bench/lib/resource-replay-json.js',
  'bench/lib/resource-replay-io.js',
  'bench/lib/resource-replay-common.js',
  'bench/lib/resource-replay-parent.js',
  'bench/lib/resource-replay-child.js',
  'bench/lib/resource-replay-raw.js',
  'bench/lib/resource-replay-current.js',
  'bench/lib/bracketed-resource-intervals.js',
]);
/** Read current fixed implementation disk identities, separately from declarations. @returns {object} Safe inventory. @since unreleased */
function inventory() {
  const budget = { bytes: 0 };
  const files = SOURCES.map((file) => {
    const full = path.join(ROOT, file);
    io.directory(path.dirname(full));
    const bytes = io.read(full, 65536, budget);
    return { file, sha256: io.hash(bytes), byteLength: bytes.length };
  });
  return {
    basis: 'repository-disk-bytes-at-endpoint',
    nodeVersion: process.version,
    files,
    loadedCodeAuthenticated: false,
  };
}
/** Load only the fixed current repository evaluator; never follow recorded source names. @returns {Function|null} Current evaluator if available. @since unreleased */
function evaluator() {
  try {
    const value = require('./bracketed-resource-intervals').evaluateBracketedResources;
    return typeof value === 'function' ? value : null;
  } catch {
    return null;
  }
}
module.exports = { ROOT, SOURCES, inventory, evaluator };
