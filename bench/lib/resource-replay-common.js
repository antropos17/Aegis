'use strict';
const { fail, exact, fixed, equal, integer, id, sha } = require('./resource-replay-json');
const CHILD_SOURCES = Object.freeze([
  'bench/self-resource-run.cjs',
  'bench/lib/self-resource-session.js',
  'bench/lib/own-resource-storage.js',
  'bench/lib/self-resource-sampler.js',
  'bench/lib/bracketed-resource-intervals.js',
]);
const PARENT_SOURCES = Object.freeze([
  'bench/self-resource-supervise.cjs',
  'bench/lib/resource-supervisor.js',
  'bench/lib/resource-supervisor-child.js',
  'bench/lib/resource-supervisor-stream.js',
  'bench/lib/resource-supervisor-storage.js',
  ...CHILD_SOURCES,
]);
const CHILD_CAPS = Object.freeze({
  'session-plan.json': 16384,
  'session-pending.json': 4096,
  'raw-samples.json': 131073,
  'bracketed-intervals.json': 524289,
  'session-final.json': 16384,
});
const PARENT_CAPS = Object.freeze({
  'supervision-plan.json': 16384,
  'supervision-pending.json': 4096,
  'supervision-final.json': 32768,
});
const FLAGS = 'sourceAuthenticated measurementAccepted w8Accepted';
/** @param {object} v Declaration. @returns {void} @since unreleased */
function flags(v) {
  if (v.sourceAuthenticated !== false || v.measurementAccepted !== false || v.w8Accepted !== false)
    fail();
}
/** @param {object} v Declaration. @param {string} version Version. @param {string} keys Keys. @param {string} [scope] Scope. @returns {void} @since unreleased */
function base(v, version, keys, scope) {
  exact(v, keys + ' ' + FLAGS);
  if (v.version !== version || !id(v.runId) || (scope && v.scope !== scope)) fail();
  flags(v);
}
/** @param {object} v Historical inventory. @param {boolean} [parent] Parent roster. @returns {void} @since unreleased */
function inventory(v, parent = false) {
  exact(v, 'basis nodeVersion files');
  const roster = parent ? PARENT_SOURCES : CHILD_SOURCES;
  if (
    v.basis !== 'repository-disk-bytes-at-endpoint' ||
    typeof v.nodeVersion !== 'string' ||
    !/^v[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/.test(v.nodeVersion) ||
    !Array.isArray(v.files) ||
    v.files.length !== roster.length
  )
    fail();
  v.files.forEach((file, i) => {
    exact(file, 'file sha256 byteLength');
    if (file.file !== roster[i] || !sha(file.sha256) || !integer(file.byteLength, 1, 65536)) fail();
  });
}
/** @param {object} v Endpoint declaration. @param {object|null} before Prior inventory. @param {boolean} [parent] Roster. @returns {void} @since unreleased */
function sources(v, before, parent = false) {
  exact(v, 'state after');
  if (!['unchanged', 'changed', 'unavailable'].includes(v.state)) fail();
  if (v.state === 'unavailable') {
    if (v.after !== null) fail();
    return;
  }
  inventory(v.after, parent);
  if (before && (v.state === 'unchanged') !== equal(before, v.after)) fail();
}
/** @param {object} v Declared bounds. @returns {void} @since unreleased */
function options(v) {
  if (
    !integer(v.durationMs, 1000, 60000) ||
    v.durationMs % 1000 ||
    !integer(v.maxAcquisitionUs, 1, v.durationMs * 1000) ||
    !integer(v.maxCpuUncertaintyUs, 1, v.durationMs * 2000)
  )
    fail();
}
/** @param {object} p Fixed idle plan. @param {string} runId Binding. @returns {void} @since unreleased */
function plan(p, runId) {
  exact(p, 'version runId clock durationUs maxAcquisitionUs maxCpuUncertaintyUs phases');
  if (
    p.version !== 'bracketed-resource-plan/1' ||
    !id(p.runId) ||
    p.runId !== runId ||
    p.clock !== 'collector-start' ||
    !integer(p.durationUs, 1000000, 60000000) ||
    p.durationUs % 1000000
  )
    fail();
  options({ durationMs: p.durationUs / 1000, ...p });
  if (
    !equal(p.phases, [
      { id: 'owned-idle', kind: 'idle', steady: true, startUs: 0, endUs: p.durationUs },
    ])
  )
    fail();
}
/** @param {string} value Declared hash. @param {object|null} part Retained bytes. @returns {void} @since unreleased */
function link(value, part) {
  if (!sha(value) || (part && value !== part.sha256)) fail();
}
/** @param {object[]} v Closed-file declarations. @param {string[]} roster Prefix order. @param {object} bundle Retained parts. @param {string} prefix Fixed directory. @returns {void} @since unreleased */
function files(v, roster, bundle, prefix) {
  if (!Array.isArray(v) || v.length > roster.length) fail();
  v.forEach((record, i) => {
    exact(record, 'file sha256 byteLength closed');
    if (
      record.file !== roster[i] ||
      record.closed !== true ||
      !sha(record.sha256) ||
      !integer(record.byteLength, 1, (prefix ? CHILD_CAPS : PARENT_CAPS)[record.file])
    )
      fail();
    const part = bundle[prefix + record.file];
    if (part && (part.sha256 !== record.sha256 || part.byteLength !== record.byteLength)) fail();
  });
}
/** @param {object} bundle All present declarations. @returns {string|null} Same-run ID. @since unreleased */
function bind(bundle) {
  let runId = null;
  for (const part of Object.values(bundle)) {
    if (part) {
      const value =
        part.value.version === 'bracketed-resource-intervals/1'
          ? part.value.raw?.runId
          : part.value.runId;
      if (!id(value) || (runId && runId !== value)) fail();
      runId = value;
    }
  }
  return runId;
}
/** Cross-check surviving plan-hash declarations even when their plan file is missing. @param {object} bundle Parsed parts. @returns {void} @since unreleased */
function links(bundle) {
  for (const prefix of ['', 'capture/']) {
    const stem = prefix ? 'session' : 'supervision';
    const pending = bundle[prefix + stem + '-pending.json']?.value;
    const final = bundle[prefix + stem + '-final.json']?.value;
    const derived = prefix ? bundle['capture/bracketed-intervals.json']?.value : null;
    const hashes = [
      pending?.planSha256,
      final?.planSha256,
      derived?.provenance.sourceSha256,
    ].filter((v) => v !== undefined);
    if (hashes.some((v) => !sha(v) || v !== hashes[0])) fail();
    if (final && final.files[0]?.sha256 !== final.planSha256) fail();
  }
}
module.exports = {
  CHILD_SOURCES,
  PARENT_SOURCES,
  CHILD_CAPS,
  PARENT_CAPS,
  FLAGS,
  base,
  flags,
  inventory,
  sources,
  options,
  plan,
  link,
  files,
  bind,
  links,
  fail,
  exact,
  fixed,
  equal,
  integer,
  id,
  sha,
};
