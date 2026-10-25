'use strict';
const c = require('./linux-cpu-replay-common');
const N = Object.keys(c.FILES);
const acquisition = (r) => ({
  complete: r.complete,
  readingMode: r.readingMode,
  observedPoints: r.samples.length,
  missedPoints: r.missed.length,
  unattemptedPoints: r.unattempted?.count ?? 0,
  stopReason: r.stopReason,
  pendingTimer: r.pendingTimer,
  cleanupReason: r.cleanupReason,
  inFlightReading: r.inFlightReading,
});
/** Reconcile every surviving declaration without allowing a missing peer to hide contradictions. @param {object} b Exact byte records. @returns {object} Sanitized recorded summary. @since unreleased */
function reconcile(b) {
  const [p, q, r, w, f] = N.map((n) => b[n]?.value ?? null);
  const present = [p, q, r, w, f].filter(Boolean);
  const runId = present[0]?.runId ?? null;
  c.assert(present.every((x) => x.runId === runId));
  const sameness = (values) => {
    const v = values.filter((x) => x !== undefined);
    if (v.length) c.assert(v.every((x) => c.equal(x, v[0])));
  };
  sameness([p?.collectionMode, q?.collectionMode, w?.collectionMode, f?.collectionMode]);
  sameness([p?.platform, f?.platform]);
  sameness([p?.clockTicksPerSecond, w?.clockTicksPerSecond, f?.clockTicksPerSecond]);
  for (const [key, part, values] of [
    ['planSha256', b[N[0]], [q?.planSha256, w?.planSha256, f?.planSha256]],
    ['rawSha256', b[N[2]], [w?.rawSha256, f?.rawSha256]],
    ['windowsSha256', b[N[3]], [f?.windowsSha256]],
  ]) {
    const known = values.filter((x) => x !== undefined);
    sameness(known);
    if (part) c.assert(known.every((x) => x === null || x === part.sha256));
    // Null is meaningful: persistence can fail, but cannot attest a retained full file.
    if (f)
      for (const rec of f.files.filter((x) => x.file === part?.file))
        c.assert(rec.sha256 === f[key]);
  }
  if (w && f) {
    c.assert(c.equal(w.workload, f.workload) && c.equal(w.comparison, f.comparison));
  }
  if (p && f && f.sources.state !== 'unavailable')
    c.assert((f.sources.state === 'unchanged') === c.equal(p.sources, f.sources.after));
  if (f) {
    f.files.forEach((rec) => {
      const part = b[rec.file];
      if (part) c.assert(rec.sha256 === part.sha256 && rec.byteLength === part.byteLength);
    });
    for (const [file, key] of [
      [N[0], 'planSha256'],
      [N[2], 'rawSha256'],
      [N[3], 'windowsSha256'],
    ]) {
      const rec = f.files.find((x) => x.file === file);
      if (rec) c.assert(rec.sha256 === f[key]);
      if (f[key] !== null) c.assert(!!rec);
    }
    c.assert(f.files.some((x) => x.file === N[0]) && f.files.some((x) => x.file === N[1]));
    if (r) c.assert(c.equal(f.acquisition, acquisition(r)));
  }
  if (r && w) {
    c.assert(w.windows.length <= r.samples.length);
    w.windows.forEach((row, i) => {
      const cpu = r.samples[i].cpu;
      // Ordinal CPU values share identity, not the sampler-relative/absolute clock origins.
      c.assert(cpu.userUs === row.api.userUs && cpu.systemUs === row.api.systemUs);
    });
    if (r.complete) c.assert(w.windows.length === 2);
  }
  if (w) {
    if (w.collectionMode === 'linux-own-defaults')
      for (const row of w.windows)
        for (const ref of [row.before, row.after]) if (ref) c.assert(ref.closed === true);
    const work = w.workload;
    if (work.state !== 'not-started') {
      const first = w.windows[0];
      c.assert(first && first.reason === null);
      if (work.beforeNs !== null) c.assert(BigInt(work.beforeNs) >= BigInt(first.after.afterNs));
      if (work.afterNs !== null && w.windows[1]?.before)
        c.assert(BigInt(work.afterNs) <= BigInt(w.windows[1].before.beforeNs));
    }
  }
  if (f) {
    const fullRaw =
      f.acquisition?.complete === true &&
      f.acquisition.observedPoints === 2 &&
      f.acquisition.pendingTimer === false &&
      f.acquisition.cleanupReason === null &&
      f.acquisition.inFlightReading === false;
    const complete =
      fullRaw &&
      f.workload.state === 'completed' &&
      f.workload.completedIterations === c.WORK.iterations &&
      f.comparison.state === 'consistent-under-declared-model';
    if (f.state !== 'persistence-failed') {
      const expected =
        f.sources.state !== 'unchanged'
          ? 'unavailable'
          : f.comparison.state === 'refused'
            ? 'refused'
            : complete
              ? 'consistent-under-declared-model'
              : 'incomplete';
      c.assert(f.state === expected);
      if (expected === 'unavailable') c.assert(f.reason === 'source-unavailable-or-changed');
      if (expected === 'refused') c.assert(f.reason === f.comparison.reason);
    } else c.assert(f.reason === 'persistence-unavailable');
  }
  return {
    runId,
    collectionMode:
      p?.collectionMode ?? w?.collectionMode ?? f?.collectionMode ?? q?.collectionMode ?? null,
    comparisonState: w?.comparison.state ?? f?.comparison.state ?? null,
    workState: w?.workload.state ?? f?.workload.state ?? null,
    sourceState: f?.sources.state ?? null,
    finalState: f?.state ?? null,
    finalPublication: 'unknown',
    predecessorClosure: 'reported-only',
    rssAssessment: 'not-qualified',
  };
}
module.exports = { reconcile, acquisition };
