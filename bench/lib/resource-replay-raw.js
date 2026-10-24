'use strict';
const c = require('./resource-replay-common');
const READ = [
  null,
  'cancelled',
  'duration-limit',
  'clock-regressed',
  'clock-unavailable',
  'api-unavailable',
  'invalid-reading',
];
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
];
const nullable = (v) => v === null || c.integer(v);
/** Validate a present fixed-driver raw packet without synthesizing a missing plan. @param {object} r Packet. @returns {void} @since unreleased */
function raw(r) {
  c.exact(
    r,
    'version runId readingMode scope cadenceUs plannedDurationUs plannedPoints limits sources units memoryDefinition memoryCaveat clock identity population samples missed unattempted stopReason complete pendingTimer cleanupReason inFlightReading',
  );
  if (
    r.version !== 'self-resource-samples/1' ||
    !c.id(r.runId) ||
    !['own-process', 'injected'].includes(r.readingMode) ||
    r.scope !== 'calling-node-process' ||
    r.cadenceUs !== 1000000 ||
    !c.integer(r.plannedDurationUs, 1000000, 60000000) ||
    r.plannedDurationUs % 1000000 ||
    r.plannedPoints !== r.plannedDurationUs / 1000000 ||
    r.memoryDefinition !== 'node-process-rss' ||
    r.memoryCaveat !== 'shared-pages-may-double-count'
  )
    c.fail();
  c.fixed(r.limits, {
    maxSamples: r.plannedPoints,
    maxOutputBytes: 131072,
    maxDurationUs: 60000000,
  });
  c.fixed(r.sources, {
    clock: 'process.hrtime.bigint',
    cpu: 'process.cpuUsage',
    rss: 'process.memoryUsage.rss',
  });
  c.fixed(r.units, { clock: 'us', cpu: 'us', rss: 'bytes' });
  c.fixed(r.identity, { osBirthTime: null, reason: 'not-observed' });
  c.fixed(r.population, { complete: null, reason: 'not-collected' });
  c.exact(r.clock, 'epoch quantization lastObservedUs reason');
  if (
    r.clock.epoch !== 'collector-start' ||
    r.clock.quantization !== 'floor-nanoseconds-to-microseconds' ||
    !nullable(r.clock.lastObservedUs) ||
    ![null, 'not-observed', 'clock-unavailable', 'clock-regressed'].includes(r.clock.reason) ||
    !STOP.includes(r.stopReason) ||
    typeof r.complete !== 'boolean' ||
    ![null, true, false].includes(r.pendingTimer) ||
    ![null, 'timer-cancel-unavailable', 'timer-state-unavailable'].includes(r.cleanupReason) ||
    r.inFlightReading !== false
  )
    c.fail();
  if (
    !Array.isArray(r.samples) ||
    !Array.isArray(r.missed) ||
    r.samples.length > r.plannedPoints ||
    r.missed.length > r.plannedPoints
  )
    c.fail();
  const points = new Set();
  const point = (v) => {
    if (!c.integer(v) || v >= r.plannedDurationUs || v % 1000000 || points.has(v)) c.fail();
    points.add(v);
  };
  let previous = -1;
  for (const s of r.samples) {
    c.exact(s, 'scheduledUs actualUs latenessUs cpu rss');
    point(s.scheduledUs);
    if (
      s.scheduledUs <= previous ||
      !c.integer(
        s.actualUs,
        s.scheduledUs,
        Math.min(r.plannedDurationUs - 1, s.scheduledUs + 999999),
      ) ||
      s.latenessUs !== s.actualUs - s.scheduledUs
    )
      c.fail();
    previous = s.scheduledUs;
    for (const [kind, fields] of [
      ['cpu', ['userUs', 'systemUs']],
      ['rss', ['residentBytes']],
    ]) {
      const v = s[kind];
      c.exact(v, ['beforeUs', 'afterUs', ...fields, 'reason']);
      if (
        !READ.includes(v.reason) ||
        ['beforeUs', 'afterUs', ...fields].some((key) => !nullable(v[key])) ||
        (v.reason === null && ['beforeUs', 'afterUs', ...fields].some((key) => v[key] === null))
      )
        c.fail();
    }
  }
  const observedTimes = r.samples
    .flatMap((s) => [s.actualUs, s.cpu.beforeUs, s.cpu.afterUs, s.rss.beforeUs, s.rss.afterUs])
    .filter((v) => v !== null);
  if (
    (r.clock.reason === 'not-observed' &&
      (r.clock.lastObservedUs !== null || observedTimes.length)) ||
    (observedTimes.length &&
      (r.clock.lastObservedUs === null || observedTimes.some((v) => v > r.clock.lastObservedUs)))
  )
    c.fail();
  previous = -1;
  for (const m of r.missed) {
    c.exact(m, 'scheduledUs reason');
    if (m.reason !== 'scheduler-late' || m.scheduledUs <= previous) c.fail();
    point(m.scheduledUs);
    previous = m.scheduledUs;
  }
  if (r.unattempted !== null) {
    const u = r.unattempted;
    c.exact(u, 'firstScheduledUs count reason');
    if (
      !c.integer(u.count, 1, r.plannedPoints) ||
      u.reason === null ||
      u.reason !== r.stopReason ||
      !c.integer(u.firstScheduledUs) ||
      u.firstScheduledUs + u.count * 1000000 !== r.plannedDurationUs
    )
      c.fail();
    for (let i = 0; i < u.count; i++) point(u.firstScheduledUs + i * 1000000);
  }
  if (
    points.size !== r.plannedPoints ||
    r.complete !==
      (r.stopReason === null &&
        !r.missed.length &&
        r.unattempted === null &&
        r.samples.every((s) => s.cpu.reason === null && s.rss.reason === null))
  )
    c.fail();
}
const BRACKET = [
  null,
  'bracket-unavailable',
  'bracket-regressed',
  'numeric-overflow',
  'acquisition-order',
  'acquisition-too-wide',
];
const INTERVAL = [
  ...BRACKET,
  'missing-scheduled-sample',
  'overlapping-acquisitions',
  'cpu-time-uncertainty',
  'phase-boundary',
  'nonsteady-phase',
  'counter-unavailable',
  'counter-regressed',
  'acquisition-unavailable',
];
function window(v) {
  c.exact(v, 'lowerUs upperExclusiveUs widthUs reason');
  if (
    !BRACKET.includes(v.reason) ||
    ['lowerUs', 'upperExclusiveUs', 'widthUs'].some((k) => !nullable(v[k]))
  )
    c.fail();
}
/** Validate the entire stored derived format before any conditional replay. @param {object} v Stored result. @returns {void} @since unreleased */
function derived(v) {
  c.exact(
    v,
    'version raw plan provenance scope readingMode rateMeaning schedule boundaries intervals memory',
  );
  raw(v.raw);
  c.plan(v.plan, v.raw.runId);
  if (v.plan.durationUs !== v.raw.plannedDurationUs) c.fail();
  c.exact(v.provenance, 'sourceSha256');
  if (
    v.version !== 'bracketed-resource-intervals/1' ||
    !c.sha(v.provenance.sourceSha256) ||
    v.scope !== 'calling-node-process' ||
    v.readingMode !== v.raw.readingMode ||
    v.rateMeaning !== 'conditional-on-counter-readings-and-timing-enclosure'
  )
    c.fail();
  if (
    !Array.isArray(v.schedule) ||
    v.schedule.length !== v.raw.plannedPoints ||
    !Array.isArray(v.intervals) ||
    v.intervals.length !== Math.max(0, v.raw.samples.length - 1) ||
    !Array.isArray(v.memory) ||
    v.memory.length !== v.raw.samples.length
  )
    c.fail();
  v.schedule.forEach((s, i) => {
    c.exact(s, 'scheduledUs state');
    if (s.scheduledUs !== i * 1000000 || !['observed', 'missed', 'unattempted'].includes(s.state))
      c.fail();
  });
  c.exact(v.boundaries, 'plannedEndUs firstCpu lastCpu closingScheduledPoint reason');
  if (
    v.boundaries.plannedEndUs !== v.raw.plannedDurationUs ||
    v.boundaries.closingScheduledPoint !== false ||
    v.boundaries.reason !== 'end-exclusive-schedule'
  )
    c.fail();
  for (const key of ['firstCpu', 'lastCpu'])
    if (v.boundaries[key] !== null) window(v.boundaries[key]);
  v.intervals.forEach((r, i) => {
    c.exact(
      r,
      'fromSample toSample phaseId left right elapsedMinUs elapsedMaxUs uncertaintyUs user system deltaCpuUs reason rateBounds',
    );
    if (
      r.fromSample !== i ||
      r.toSample !== i + 1 ||
      ![null, 'owned-idle'].includes(r.phaseId) ||
      !INTERVAL.includes(r.reason) ||
      !nullable(r.elapsedMaxUs) ||
      !nullable(r.uncertaintyUs) ||
      !nullable(r.deltaCpuUs) ||
      (r.elapsedMinUs !== null && !c.integer(r.elapsedMinUs, -Number.MAX_SAFE_INTEGER))
    )
      c.fail();
    window(r.left);
    window(r.right);
    for (const k of ['user', 'system']) {
      c.exact(r[k], 'deltaUs reason');
      if (
        !nullable(r[k].deltaUs) ||
        ![null, 'counter-unavailable', 'counter-regressed', 'acquisition-unavailable'].includes(
          r[k].reason,
        )
      )
        c.fail();
    }
    if (r.rateBounds !== null) {
      c.exact(r.rateBounds, 'unit scale lower upper');
      if (
        r.reason !== null ||
        r.rateBounds.unit !== 'percent-one-core' ||
        r.rateBounds.scale !== 100
      )
        c.fail();
      for (const key of ['lower', 'upper']) {
        const q = r.rateBounds[key];
        c.exact(q, 'numerator denominator');
        if (!c.integer(q.numerator) || !c.integer(q.denominator, 1)) c.fail();
      }
    } else if (r.reason === null) c.fail();
  });
  v.memory.forEach((r, i) => {
    c.exact(r, 'sample phaseId window residentBytes reason');
    window(r.window);
    if (
      r.sample !== i ||
      ![null, 'owned-idle'].includes(r.phaseId) ||
      !nullable(r.residentBytes) ||
      ![
        ...BRACKET,
        'acquisition-unavailable',
        'memory-unavailable',
        'phase-boundary',
        'nonsteady-phase',
      ].includes(r.reason)
    )
      c.fail();
  });
}
module.exports = { raw, derived };
