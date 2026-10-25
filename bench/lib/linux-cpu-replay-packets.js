'use strict';
const c = require('./linux-cpu-replay-common');
const legacyRaw = require('./resource-replay-raw').raw;
const { work, comparison, rows, checksum } = require('./linux-cpu-replay-observations');
const keys = 'sourceAuthenticated measurementAccepted calibrationAccepted w8Accepted';
const mode = (v) => ['linux-own-defaults', 'injected-test-seams'].includes(v);
function base(v, version, fields) {
  c.exact(v, fields + ' ' + keys);
  c.flags(v);
  c.assert(v.version === version && c.id(v.runId));
}
/** Validate fixed initial declaration. @param {object} p Plan. @returns {void} @since unreleased */
function plan(p) {
  base(
    p,
    'linux-own-cpu-plan/1',
    'version runId scope collectionMode platform clockTicksPerSecond clock stat getconf sampler model workload rssAssessment sources limits',
  );
  c.assert(
    p.scope === 'calling-node-process-cpu' &&
      mode(p.collectionMode) &&
      p.rssAssessment === 'not-qualified' &&
      p.clock === 'process.hrtime.bigint-arbitrary-domain',
  );
  hz(p.clockTicksPerSecond);
  c.platform(p.platform);
  c.sources(p.sources);
  c.fixed(p.stat, {
    source: '/proc/self/stat',
    fields: [14, 15, 22],
    maxBytes: 16384,
    identity: 'same-self-start-ticks-not-birth-authority',
  });
  c.fixed(p.getconf, {
    source: '/usr/bin/getconf CLK_TCK',
    timeoutMs: 1000,
    maxBytes: 128,
    inheritedEnvironment: false,
  });
  c.fixed(p.sampler, { durationMs: 2000, maxSamples: 2, maxOutputBytes: 16384 });
  c.fixed(p.model, c.MODEL);
  c.fixed(p.workload, c.WORK);
  c.fixed(p.limits, { totalBytes: 131072, files: c.FILES });
}
/** Validate discovered model rate. @param {unknown} h HZ. @returns {void} @since unreleased */
function hz(h) {
  c.assert(
    c.uint(h) && BigInt(h) > 0n && BigInt(h) <= 1000000000n && 1000000000n % BigInt(h) === 0n,
  );
}
/** Validate pending initial receipt. @param {object} p Data. @returns {void} @since unreleased */
function pending(p) {
  base(p, 'linux-own-cpu-pending/1', 'version runId state planSha256 collectionMode');
  c.assert(p.state === 'pending' && c.sha(p.planSha256) && mode(p.collectionMode));
}
/** Validate unchanged sampler shape using its existing validator after explicit fixed cap admission. @param {object} r Raw. @returns {void} @since unreleased */
function raw(r) {
  c.assert(
    r.readingMode === 'injected' && r.plannedDurationUs === 2000000 && r.plannedPoints === 2,
  );
  c.fixed(r.limits, { maxSamples: 2, maxOutputBytes: 16384, maxDurationUs: 60000000 });
  legacyRaw({ ...r, limits: { ...r.limits, maxOutputBytes: 131072 } });
  // The fixed sampler calls now() in this order. Null clock failures retain no new time.
  // Missed slots carry scheduledUs only, not an observed acquisition timestamp.
  let last = null;
  for (const sample of r.samples) {
    for (const time of [
      sample.actualUs,
      sample.cpu.beforeUs,
      sample.cpu.afterUs,
      sample.rss.beforeUs,
      sample.rss.afterUs,
    ]) {
      if (time === null) continue;
      c.assert(last === null || time >= last);
      last = time;
    }
  }
}
/** Validate present normalized window envelope. @param {object} w Data. @returns {void} @since unreleased */
function windows(w) {
  base(
    w,
    'linux-own-cpu-windows/1',
    'version runId planSha256 rawSha256 clockTicksPerSecond clock collectionMode windows workload comparison rssAssessment',
  );
  c.assert(
    c.sha(w.planSha256) &&
      (w.rawSha256 === null || c.sha(w.rawSha256)) &&
      mode(w.collectionMode) &&
      w.clock === 'process.hrtime.bigint-arbitrary-domain' &&
      w.rssAssessment === 'not-qualified',
  );
  hz(w.clockTicksPerSecond);
  rows(w.windows);
  work(w.workload);
  comparison(w.comparison);
}
/** Validate present final candidate, independently from missing peers. @param {object} f Data. @returns {void} @since unreleased */
function final(f) {
  base(
    f,
    'linux-own-cpu-final/1',
    'version runId scope collectionMode state reason finalPublication rssAssessment platform clockTicksPerSecond planSha256 rawSha256 windowsSha256 acquisition comparison workload sources files',
  );
  c.assert(
    f.scope === 'calling-node-process-cpu' &&
      mode(f.collectionMode) &&
      [
        'persistence-failed',
        'unavailable',
        'refused',
        'consistent-under-declared-model',
        'incomplete',
      ].includes(f.state) &&
      c.REASONS.includes(f.reason) &&
      f.finalPublication === 'not-self-attested' &&
      f.rssAssessment === 'not-qualified',
  );
  c.platform(f.platform);
  hz(f.clockTicksPerSecond);
  for (const key of ['planSha256', 'rawSha256', 'windowsSha256'])
    c.assert(f[key] === null || c.sha(f[key]));
  work(f.workload);
  comparison(f.comparison);
  c.exact(f.sources, 'state after');
  c.assert(['unchanged', 'changed', 'unavailable'].includes(f.sources.state));
  if (f.sources.state === 'unavailable') c.assert(f.sources.after === null);
  else c.sources(f.sources.after);
  if (f.acquisition !== null) {
    const a = f.acquisition;
    c.exact(
      a,
      'complete readingMode observedPoints missedPoints unattemptedPoints stopReason pendingTimer cleanupReason inFlightReading',
    );
    c.assert(
      typeof a.complete === 'boolean' &&
        a.readingMode === 'injected' &&
        ['observedPoints', 'missedPoints', 'unattemptedPoints'].every((k) =>
          c.integer(a[k], 0, 2),
        ) &&
        a.observedPoints + a.missedPoints + a.unattemptedPoints === 2 &&
        [true, false, null].includes(a.pendingTimer) &&
        a.inFlightReading === false &&
        c.REASONS.includes(a.stopReason) &&
        [null, 'timer-cancel-unavailable', 'timer-state-unavailable'].includes(a.cleanupReason),
    );
    if (a.complete)
      c.assert(
        a.stopReason === null &&
          a.observedPoints === 2 &&
          a.missedPoints === 0 &&
          a.unattemptedPoints === 0,
      );
  }
  c.assert(Array.isArray(f.files) && f.files.length <= 4);
  let last = -1;
  f.files.forEach((r) => {
    c.exact(r, 'file sha256 byteLength closed');
    const index = Object.keys(c.FILES).indexOf(r.file);
    c.assert(
      index >= 0 &&
        index < 4 &&
        index > last &&
        r.closed === true &&
        c.sha(r.sha256) &&
        c.integer(r.byteLength, 1, c.FILES[r.file]),
    );
    last = index;
  });
  // Writer may retain windows after a raw persistence failure; only success requires all four.
  if (f.state === 'consistent-under-declared-model')
    c.assert(
      f.reason === null &&
        f.files.length === 4 &&
        f.acquisition?.complete === true &&
        f.acquisition.observedPoints === 2 &&
        f.acquisition.pendingTimer === false &&
        f.acquisition.cleanupReason === null &&
        f.workload.state === 'completed' &&
        f.comparison.state === 'consistent-under-declared-model' &&
        f.sources.state === 'unchanged',
    );
  else c.assert(f.reason !== null);
}
module.exports = { plan, pending, raw, windows, final, hz, work, checksum, comparison };
