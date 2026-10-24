'use strict';
const c = require('./resource-replay-common');
const schema = require('./resource-replay-raw');
const STOP = [
  null,
  'cancelled',
  'duration-limit',
  'clock-regressed',
  'clock-unavailable',
  'sample-limit',
  'output-limit',
  'scheduler-stalled',
  'scheduler-unavailable',
  'reading-incomplete',
  'acquisition-unavailable',
];
/** Validate every present fixed child artifact, retaining unavailable predecessors as missing. @param {object} bundle Parsed exact-byte parts. @param {object} parent Parent declarations. @returns {object} Child evidence. @since unreleased */
function validateChild(bundle, parent) {
  const p = bundle['capture/session-plan.json'],
    n = bundle['capture/session-pending.json'],
    r = bundle['capture/raw-samples.json'],
    d = bundle['capture/bracketed-intervals.json'],
    f = bundle['capture/session-final.json'];
  if (p) {
    const v = p.value;
    c.base(
      v,
      'self-resource-session-plan/1',
      'version runId scope activity plan sampler sources limits',
      'calling-node-process',
    );
    if (v.activity !== 'owned-node-waiting-no-workload') c.fail();
    c.plan(v.plan, v.runId);
    c.fixed(v.sampler, {
      durationMs: v.plan.durationUs / 1000,
      maxSamples: v.plan.durationUs / 1000000,
      maxOutputBytes: 131072,
    });
    c.fixed(v.limits, { totalBytes: 1048576, files: c.CHILD_CAPS });
    c.inventory(v.sources);
    if (
      parent.plan &&
      !c.equal(parent.plan.child, {
        entry: 'bench/self-resource-run.cjs',
        output: 'capture',
        durationMs: v.sampler.durationMs,
        maxAcquisitionUs: v.plan.maxAcquisitionUs,
        maxCpuUncertaintyUs: v.plan.maxCpuUncertaintyUs,
      })
    )
      c.fail();
  }
  if (n) {
    const v = n.value;
    c.base(
      v,
      'self-resource-session-pending/1',
      'version runId state scope planSha256 roster',
      'calling-node-process',
    );
    if (v.state !== 'pending' || !c.equal(v.roster, Object.keys(c.CHILD_CAPS))) c.fail();
    c.link(v.planSha256, p);
  }
  if (r) {
    schema.raw(r.value);
    if (
      (p &&
        (r.value.plannedDurationUs !== p.value.plan.durationUs ||
          r.value.runId !== p.value.runId)) ||
      (parent.plan && r.value.plannedDurationUs !== parent.plan.child.durationMs * 1000)
    )
      c.fail();
  }
  if (d) {
    schema.derived(d.value);
    if ((r && !c.equal(d.value.raw, r.value)) || (p && !c.equal(d.value.plan, p.value.plan)))
      c.fail();
    c.link(d.value.provenance.sourceSha256, p);
    if (
      parent.plan &&
      (d.value.plan.durationUs !== parent.plan.child.durationMs * 1000 ||
        d.value.plan.maxAcquisitionUs !== parent.plan.child.maxAcquisitionUs ||
        d.value.plan.maxCpuUncertaintyUs !== parent.plan.child.maxCpuUncertaintyUs)
    )
      c.fail();
  }
  if (f) {
    const v = f.value;
    c.base(
      v,
      'self-resource-session-final/1',
      'version runId scope state priorArtifactState finalPublication planSha256 rawSha256 acquisition derivation cleanup sources files',
      'calling-node-process',
    );
    if (v.finalPublication !== 'not-self-attested') c.fail();
    c.link(v.planSha256, p);
    c.files(v.files, Object.keys(c.CHILD_CAPS).slice(0, 4), bundle, 'capture/');
    if (
      v.files.length < 2 ||
      v.priorArtifactState !== (v.files.length === 4 ? 'complete' : 'partial')
    )
      c.fail();
    c.exact(v.acquisition, 'state complete reason readingMode');
    if (
      !['complete', 'incomplete', 'cancelled', 'failed'].includes(v.acquisition.state) ||
      ![null, true, false].includes(v.acquisition.complete) ||
      !STOP.includes(v.acquisition.reason) ||
      !['own-process', 'injected'].includes(v.acquisition.readingMode)
    )
      c.fail();
    if (
      (v.acquisition.state === 'complete') !== (v.acquisition.complete === true) ||
      (v.acquisition.state === 'failed'
        ? v.acquisition.complete !== null || v.acquisition.reason !== 'acquisition-unavailable'
        : v.acquisition.complete === null) ||
      (v.acquisition.state === 'cancelled') !== (v.acquisition.reason === 'cancelled')
    )
      c.fail();
    if (
      (v.acquisition.state === 'complete' && v.acquisition.reason !== null) ||
      (v.acquisition.state === 'incomplete' && v.acquisition.reason === null)
    )
      c.fail();
    c.exact(v.cleanup, 'pendingTimer reason inFlightReading');
    if (
      ![null, true, false].includes(v.cleanup.pendingTimer) ||
      ![null, 'timer-cancel-unavailable', 'timer-state-unavailable'].includes(v.cleanup.reason) ||
      ![null, false].includes(v.cleanup.inFlightReading)
    )
      c.fail();
    c.exact(v.derivation, 'state reason');
    const states = {
      written: [null, 4],
      refused: ['derivation-unavailable', 3],
      'not-written': ['persistence-unavailable', 3],
      'not-started': [null, 2],
    };
    if (
      typeof v.derivation.state !== 'string' ||
      !Object.hasOwn(states, v.derivation.state) ||
      v.derivation.reason !== states[v.derivation.state][0] ||
      v.files.length !== states[v.derivation.state][1]
    )
      c.fail();
    if (v.files.length >= 3) {
      c.link(v.rawSha256, r);
      if (v.rawSha256 !== v.files[2].sha256) c.fail();
    } else if (v.rawSha256 !== null) c.fail();
    if ((r || d) && v.rawSha256 !== null) {
      const raw = r?.value ?? d.value.raw;
      if (
        !c.equal(v.acquisition, {
          state:
            raw.stopReason === 'cancelled' ? 'cancelled' : raw.complete ? 'complete' : 'incomplete',
          complete: raw.complete,
          reason: raw.stopReason ?? (raw.complete ? null : 'reading-incomplete'),
          readingMode: raw.readingMode,
        }) ||
        !c.equal(v.cleanup, {
          pendingTimer: raw.pendingTimer,
          reason: raw.cleanupReason,
          inFlightReading: raw.inFlightReading,
        })
      )
        c.fail();
    }
    c.sources(v.sources, p?.value.sources);
    const persistence =
      v.derivation.state === 'not-written' ||
      (v.derivation.state === 'not-started' && v.acquisition.state !== 'failed');
    const cleaned =
      v.cleanup.pendingTimer === false &&
      v.cleanup.reason === null &&
      v.cleanup.inFlightReading === false;
    const expected = persistence
      ? 'persistence-failed'
      : v.sources.state !== 'unchanged'
        ? 'source-refused'
        : v.acquisition.state === 'complete' && v.derivation.state === 'written' && cleaned
          ? 'complete-candidate'
          : 'incomplete';
    if (v.state !== expected) c.fail();
  }
  const observed = parent.final?.supervision;
  if (observed?.exit.observed && observed.exit.code === 0 && observed.exit.signal === null) {
    if (f && f.value.state !== 'complete-candidate') c.fail();
    for (const raw of [r?.value, d?.value.raw])
      if (
        raw &&
        (raw.complete !== true ||
          raw.pendingTimer !== false ||
          raw.cleanupReason !== null ||
          raw.inFlightReading !== false)
      )
        c.fail();
  }
  const alignment =
    !parent.plan || !p
      ? 'unknown'
      : parent.plan.sources.files
            .slice(-5)
            .every((file, i) => c.equal(file, p.value.sources.files[i]))
        ? 'match'
        : 'different';
  return {
    plan: p?.value ?? null,
    raw: r?.value ?? null,
    derived: d?.value ?? null,
    final: f?.value ?? null,
    sourceAlignment: alignment,
  };
}
module.exports = { validateChild };
