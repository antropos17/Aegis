'use strict';
const j = require('./resource-replay-json');
const FLAGS = Object.freeze({
  sourceAuthenticated: false,
  measurementAccepted: false,
  calibrationAccepted: false,
  w8Accepted: false,
});
const FILES = Object.freeze({
  'cpu-reference-plan.json': 16384,
  'cpu-reference-pending.json': 4096,
  'raw-samples.json': 16385,
  'cpu-reference-windows.json': 32768,
  'cpu-reference-final.json': 16384,
});
const HISTORICAL = Object.freeze([
  'bench/linux-own-cpu-qualify.cjs',
  'bench/lib/linux-own-cpu-reference.js',
  'bench/lib/linux-own-cpu-proc.js',
  'bench/lib/linux-own-cpu-work.js',
  'bench/lib/linux-own-cpu-model.js',
  'bench/lib/linux-own-cpu-capture.js',
  'bench/lib/linux-own-cpu-storage.js',
  'bench/lib/self-resource-sampler.js',
]);
const MODEL = Object.freeze({
  version: 'aggregate-floor-enclosure/1',
  tickEndpointAllowance: 2,
  apiEndpointAllowanceUs: 2,
  progressRule: 'reference-delta-lower-us-strictly-greater-than-four-and-api-delta-positive',
  upperBoundary: 'exclusive',
  kernelReference: 'linux-v6.14',
  kernelModelQualified: false,
});
const WORK = Object.freeze({
  version: 'lcg32-fixed/1',
  multiplier: 1664525,
  increment: 1013904223,
  seed: 1,
  iterations: 67108864,
  chunk: 65536,
  budgetNs: '2000000000',
});
const REASONS = Object.freeze([
  null,
  'missing-reference',
  'identity-changed',
  'counter-regressed',
  'clock-regressed',
  'clock-unavailable',
  'unit-or-enclosure-disagreement',
  'insufficient-resolution',
  'cancelled',
  'proc-stat-unavailable',
  'api-unavailable',
  'invalid-reading',
  'baseline-unavailable',
  'work-budget',
  'sampler-unavailable',
  'reference-shape-invalid',
  'persistence-unavailable',
  'source-unavailable-or-changed',
  'duration-limit',
  'sample-limit',
  'output-limit',
  'scheduler-stalled',
  'scheduler-unavailable',
  'incomplete-acquisition',
]);
const assert = (v) => {
  if (!v) j.fail();
};
const nullableInt = (v) => v === null || j.integer(v);
const time = (v) => typeof v === 'string' && /^(?:0|[1-9][0-9]{0,31})$/.test(v);
const uint = (v) =>
  typeof v === 'string' && /^(?:0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= 18446744073709551615n;
/** Validate required false acceptance flags. @param {object} v Data. @returns {void} @since unreleased */
function flags(v) {
  for (const [key, value] of Object.entries(FLAGS)) assert(v[key] === value);
}
/** Reject dangerous keys and unsafe numeric data throughout parsed input. @param {unknown} v Data. @returns {void} @since unreleased */
function safeData(v) {
  if (typeof v === 'number') assert(Number.isSafeInteger(v));
  if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      assert(!['__proto__', 'prototype', 'constructor'].includes(k));
      safeData(x);
    }
}
/** Validate fixed historical source declarations, never loaded-code authority. @param {object} v Inventory. @returns {void} @since unreleased */
function sources(v) {
  j.exact(v, 'basis nodeVersion files loadedCodeAuthenticated');
  assert(
    v.basis === 'repository-disk-bytes-at-endpoint' &&
      typeof v.nodeVersion === 'string' &&
      /^v[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/.test(v.nodeVersion) &&
      v.loadedCodeAuthenticated === false &&
      Array.isArray(v.files) &&
      v.files.length === HISTORICAL.length,
  );
  v.files.forEach((x, i) => {
    j.exact(x, 'file sha256 byteLength');
    assert(x.file === HISTORICAL[i] && j.sha(x.sha256) && j.integer(x.byteLength, 1, 65536));
  });
}
/** Validate Linux-only sanitized platform declarations. @param {object} v Data. @returns {void} @since unreleased */
function platform(v) {
  j.exact(v, 'family kernelVersion arch kernelModelQualified');
  assert(v.family === 'linux' && v.kernelModelQualified === false);
  for (const k of ['kernelVersion', 'arch'])
    assert(v[k] === null || (typeof v[k] === 'string' && /^[A-Za-z0-9._+-]{1,128}$/.test(v[k])));
}
module.exports = {
  ...j,
  FLAGS,
  FILES,
  HISTORICAL,
  MODEL,
  WORK,
  REASONS,
  assert,
  nullableInt,
  time,
  uint,
  flags,
  safeData,
  sources,
  platform,
};
