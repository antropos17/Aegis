'use strict';

const LIMITS = Object.freeze({ inputBytes: 262144, outputBytes: 524288, nodes: 20000 });
const CADENCE = 1_000_000;
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
const id = (v) => typeof v === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(v);
const fail = () => {
  throw new Error('bracketed-resource-input-invalid');
};
const readReasons = [
  null,
  ...'cancelled duration-limit clock-regressed clock-unavailable api-unavailable invalid-reading'.split(
    ' ',
  ),
];
const stopReasons = [
  null,
  ...'cancelled duration-limit clock-regressed clock-unavailable sample-limit output-limit scheduler-stalled scheduler-unavailable'.split(
    ' ',
  ),
];

// Copy descriptors before reading values: no getters, toJSON, inherited fields or aliases.
function copyInput(input) {
  let nodes = 0;
  const seen = new Set();
  function visit(v, depth) {
    if (++nodes > LIMITS.nodes || depth > 12) fail();
    if (v === null || typeof v === 'boolean' || integer(v)) return v;
    if (typeof v === 'string' && v.length <= 128) return v;
    if (typeof v !== 'object' || seen.has(v)) fail();
    seen.add(v);
    const array = Array.isArray(v);
    if (
      Object.getPrototypeOf(v) !== (array ? Array.prototype : Object.prototype) &&
      !(Object.getPrototypeOf(v) === null && !array)
    )
      fail();
    const descriptors = Object.getOwnPropertyDescriptors(v);
    const keys = Reflect.ownKeys(descriptors);
    if (array && (v.length > 512 || keys.length !== v.length + 1)) fail();
    const out = array ? [] : {};
    for (const key of keys) {
      if (array && key === 'length') continue;
      const d = descriptors[key];
      if (
        typeof key !== 'string' ||
        key.length > 64 ||
        key === '__proto__' ||
        !d.enumerable ||
        !Object.hasOwn(d, 'value') ||
        (array && !/^(0|[1-9][0-9]*)$/.test(key))
      )
        fail();
      Object.defineProperty(out, key, { value: visit(d.value, depth + 1), enumerable: true });
    }
    if (array && out.length !== v.length) fail();
    return out;
  }
  try {
    const result = visit(input, 0);
    if (Buffer.byteLength(JSON.stringify(result)) > LIMITS.inputBytes) fail();
    return result;
  } catch {
    fail();
  }
}
function closed(v, keys) {
  if (typeof keys === 'string') keys = keys.split(' ');
  if (
    !v ||
    Array.isArray(v) ||
    typeof v !== 'object' ||
    Object.keys(v).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(v, k))
  )
    fail();
}
function exact(v, expected) {
  closed(v, Object.keys(expected));
  if (Object.keys(expected).some((k) => v[k] !== expected[k])) fail();
}
function bounded(v, min, max) {
  if (!integer(v) || v < min || v > max) fail();
}
function nullable(v) {
  if (v !== null && !integer(v)) fail();
}
function rawInput(r) {
  closed(
    r,
    'version runId readingMode scope cadenceUs plannedDurationUs plannedPoints limits sources units memoryDefinition memoryCaveat clock identity population samples missed unattempted stopReason complete pendingTimer cleanupReason inFlightReading',
  );
  if (
    r.version !== 'self-resource-samples/1' ||
    !id(r.runId) ||
    !['own-process', 'injected'].includes(r.readingMode) ||
    r.scope !== 'calling-node-process' ||
    r.cadenceUs !== CADENCE ||
    r.memoryDefinition !== 'node-process-rss' ||
    r.memoryCaveat !== 'shared-pages-may-double-count'
  )
    fail();
  bounded(r.plannedDurationUs, CADENCE, 60 * CADENCE);
  if (r.plannedDurationUs % CADENCE || r.plannedPoints !== r.plannedDurationUs / CADENCE) fail();
  exact(r.sources, {
    clock: 'process.hrtime.bigint',
    cpu: 'process.cpuUsage',
    rss: 'process.memoryUsage.rss',
  });
  exact(r.units, { clock: 'us', cpu: 'us', rss: 'bytes' });
  exact(r.identity, { osBirthTime: null, reason: 'not-observed' });
  exact(r.population, { complete: null, reason: 'not-collected' });
  closed(r.limits, ['maxSamples', 'maxOutputBytes', 'maxDurationUs']);
  bounded(r.limits.maxSamples, 1, 60);
  bounded(r.limits.maxOutputBytes, 2048, 131072);
  if (
    r.limits.maxDurationUs !== 60 * CADENCE ||
    Buffer.byteLength(JSON.stringify(r)) > r.limits.maxOutputBytes
  )
    fail();
  closed(r.clock, ['epoch', 'quantization', 'lastObservedUs', 'reason']);
  if (
    r.clock.epoch !== 'collector-start' ||
    r.clock.quantization !== 'floor-nanoseconds-to-microseconds' ||
    ![null, 'not-observed', 'clock-unavailable', 'clock-regressed'].includes(r.clock.reason)
  )
    fail();
  nullable(r.clock.lastObservedUs);
  if (
    !Array.isArray(r.samples) ||
    r.samples.length > r.limits.maxSamples ||
    !Array.isArray(r.missed) ||
    r.missed.length > r.plannedPoints ||
    !stopReasons.includes(r.stopReason) ||
    typeof r.complete !== 'boolean' ||
    ![true, false, null].includes(r.pendingTimer) ||
    ![null, 'timer-cancel-unavailable', 'timer-state-unavailable'].includes(r.cleanupReason) ||
    r.inFlightReading !== false
  )
    fail();
  const points = new Map();
  function point(time, kind) {
    if (!integer(time) || time % CADENCE || time >= r.plannedDurationUs || points.has(time)) fail();
    points.set(time, kind);
  }
  let previous = -1;
  for (const s of r.samples) {
    closed(s, ['scheduledUs', 'actualUs', 'latenessUs', 'cpu', 'rss']);
    point(s.scheduledUs, 'observed');
    if (
      s.scheduledUs <= previous ||
      !integer(s.actualUs) ||
      s.actualUs < s.scheduledUs ||
      s.actualUs - s.scheduledUs >= CADENCE ||
      s.actualUs >= r.plannedDurationUs ||
      s.latenessUs !== s.actualUs - s.scheduledUs
    )
      fail();
    previous = s.scheduledUs;
    for (const [kind, fields] of [
      ['cpu', ['userUs', 'systemUs']],
      ['rss', ['residentBytes']],
    ]) {
      const read = s[kind];
      closed(read, ['beforeUs', 'afterUs', ...fields, 'reason']);
      for (const key of ['beforeUs', 'afterUs', ...fields]) nullable(read[key]);
      if (!readReasons.includes(read.reason)) fail();
    }
  }
  previous = -1;
  for (const m of r.missed) {
    closed(m, ['scheduledUs', 'reason']);
    exact(m, { scheduledUs: m.scheduledUs, reason: 'scheduler-late' });
    point(m.scheduledUs, 'missed');
    if (m.scheduledUs <= previous) fail();
    previous = m.scheduledUs;
  }
  if (r.unattempted !== null) {
    const u = r.unattempted;
    closed(u, ['firstScheduledUs', 'count', 'reason']);
    bounded(u.count, 1, r.plannedPoints);
    if (
      u.reason === null ||
      u.reason !== r.stopReason ||
      u.firstScheduledUs + u.count * CADENCE !== r.plannedDurationUs
    )
      fail();
    for (let i = 0; i < u.count; i++) point(u.firstScheduledUs + i * CADENCE, 'unattempted');
  }
  if (
    points.size !== r.plannedPoints ||
    r.complete !==
      (r.stopReason === null &&
        !r.missed.length &&
        r.unattempted === null &&
        r.samples.every((s) => s.cpu.reason === null && s.rss.reason === null))
  )
    fail();
  return points;
}
function planInput(p, r) {
  closed(p, 'version runId clock durationUs maxAcquisitionUs maxCpuUncertaintyUs phases');
  if (
    p.version !== 'bracketed-resource-plan/1' ||
    p.runId !== r.runId ||
    p.clock !== 'collector-start' ||
    p.durationUs !== r.plannedDurationUs
  )
    fail();
  bounded(p.maxAcquisitionUs, 1, p.durationUs);
  bounded(p.maxCpuUncertaintyUs, 1, 2 * p.durationUs);
  if (!Array.isArray(p.phases) || !p.phases.length || p.phases.length > 16) fail();
  let end = 0;
  const ids = new Set();
  for (const phase of p.phases) {
    closed(phase, ['id', 'kind', 'steady', 'startUs', 'endUs']);
    if (
      !id(phase.id) ||
      ids.has(phase.id) ||
      !['warmup', 'idle', 'workload', 'burst', 'drain'].includes(phase.kind) ||
      typeof phase.steady !== 'boolean' ||
      (phase.kind === 'warmup' && phase.steady) ||
      !integer(phase.startUs) ||
      !integer(phase.endUs) ||
      phase.startUs < end ||
      phase.endUs <= phase.startUs ||
      phase.endUs > p.durationUs
    )
      fail();
    ids.add(phase.id);
    end = phase.endUs;
  }
}
function bracket(read, plan, earliestUs) {
  if (read.beforeUs === null || read.afterUs === null)
    return { lowerUs: null, upperExclusiveUs: null, widthUs: null, reason: 'bracket-unavailable' };
  if (read.afterUs < read.beforeUs)
    return { lowerUs: null, upperExclusiveUs: null, widthUs: null, reason: 'bracket-regressed' };
  if (read.afterUs === Number.MAX_SAFE_INTEGER)
    return { lowerUs: null, upperExclusiveUs: null, widthUs: null, reason: 'numeric-overflow' };
  const widthUs = read.afterUs - read.beforeUs + 1;
  return {
    lowerUs: read.beforeUs,
    upperExclusiveUs: read.afterUs + 1,
    widthUs,
    reason:
      read.beforeUs < earliestUs
        ? 'acquisition-order'
        : widthUs > plan.maxAcquisitionUs
          ? 'acquisition-too-wide'
          : null,
  };
}
function phaseFor(p, lower, upper) {
  return p.phases.find((x) => lower >= x.startUs && upper <= x.endUs);
}
function counter(a, b, key) {
  if (a[key] === null || b[key] === null) return { deltaUs: null, reason: 'counter-unavailable' };
  if (b[key] < a[key]) return { deltaUs: null, reason: 'counter-regressed' };
  if (a.reason || b.reason) return { deltaUs: null, reason: 'acquisition-unavailable' };
  return { deltaUs: b[key] - a[key], reason: null };
}

/** Derive conditional timing/rate bounds from raw own-Node observations, without IO.
 * @param {object} input Closed raw, plan and provenance; see bench/BRACKETED_RESOURCE_INTERVALS.md.
 * @returns {object} Independent evidence with exact rational CPU bounds and separate RSS windows.
 * @since 0.19.2
 */
function evaluateBracketedResources(input) {
  input = copyInput(input);
  closed(input, ['raw', 'plan', 'provenance']);
  const { raw: r, plan: p, provenance } = input;
  const points = rawInput(r);
  planInput(p, r);
  closed(provenance, ['sourceSha256']);
  if (
    typeof provenance.sourceSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(provenance.sourceSha256)
  )
    fail();
  const windows = r.samples.map((s) => ({
    cpu: bracket(s.cpu, p, s.actualUs),
    rss: bracket(s.rss, p, s.cpu.afterUs ?? s.actualUs),
  }));
  const intervals = r.samples.slice(1).map((b, i) => {
    const a = r.samples[i],
      left = windows[i].cpu,
      right = windows[i + 1].cpu;
    const user = counter(a.cpu, b.cpu, 'userUs'),
      system = counter(a.cpu, b.cpu, 'systemUs');
    const phase =
      left.lowerUs === null || right.upperExclusiveUs === null
        ? null
        : phaseFor(p, left.lowerUs, right.upperExclusiveUs);
    const elapsedMinUs =
      left.upperExclusiveUs === null || right.lowerUs === null
        ? null
        : right.lowerUs - left.upperExclusiveUs;
    const elapsedMaxUs =
      left.lowerUs === null || right.upperExclusiveUs === null
        ? null
        : right.upperExclusiveUs - left.lowerUs;
    const uncertainty = elapsedMinUs === null ? null : BigInt(elapsedMaxUs) - BigInt(elapsedMinUs);
    const uncertaintyUs =
      uncertainty !== null && uncertainty <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(uncertainty)
        : null;
    const delta =
      user.reason || system.reason ? null : BigInt(user.deltaUs) + BigInt(system.deltaUs);
    const deltaCpuUs =
      delta !== null && delta <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(delta) : null;
    const reason =
      (b.scheduledUs - a.scheduledUs !== CADENCE && 'missing-scheduled-sample') ||
      left.reason ||
      right.reason ||
      (uncertaintyUs === null && 'numeric-overflow') ||
      (elapsedMinUs <= 0 && 'overlapping-acquisitions') ||
      (uncertaintyUs > p.maxCpuUncertaintyUs && 'cpu-time-uncertainty') ||
      (!phase && 'phase-boundary') ||
      (!phase.steady && 'nonsteady-phase') ||
      user.reason ||
      system.reason ||
      (deltaCpuUs === null && 'numeric-overflow') ||
      null;
    return {
      fromSample: i,
      toSample: i + 1,
      phaseId: phase?.id ?? null,
      left,
      right,
      elapsedMinUs,
      elapsedMaxUs,
      uncertaintyUs,
      user,
      system,
      deltaCpuUs,
      reason,
      rateBounds: reason
        ? null
        : {
            unit: 'percent-one-core',
            scale: 100,
            lower: { numerator: deltaCpuUs, denominator: elapsedMaxUs },
            upper: { numerator: deltaCpuUs, denominator: elapsedMinUs },
          },
    };
  });
  const memory = r.samples.map((s, i) => {
    const window = windows[i].rss;
    const phase =
      window.lowerUs === null || window.upperExclusiveUs === null
        ? null
        : phaseFor(p, window.lowerUs, window.upperExclusiveUs);
    const reason =
      window.reason ||
      (s.rss.reason && 'acquisition-unavailable') ||
      (s.rss.residentBytes === null && 'memory-unavailable') ||
      (!phase && 'phase-boundary') ||
      (!phase.steady && 'nonsteady-phase') ||
      null;
    return {
      sample: i,
      phaseId: phase?.id ?? null,
      window,
      residentBytes: reason ? null : s.rss.residentBytes,
      reason,
    };
  });
  const result = {
    version: 'bracketed-resource-intervals/1',
    raw: r,
    plan: p,
    provenance,
    scope: 'calling-node-process',
    readingMode: r.readingMode,
    rateMeaning: 'conditional-on-counter-readings-and-timing-enclosure',
    schedule: Array.from({ length: r.plannedPoints }, (_, i) => ({
      scheduledUs: i * CADENCE,
      state: points.get(i * CADENCE),
    })),
    boundaries: {
      plannedEndUs: r.plannedDurationUs,
      firstCpu: windows[0]?.cpu ?? null,
      lastCpu: windows.at(-1)?.cpu ?? null,
      closingScheduledPoint: false,
      reason: 'end-exclusive-schedule',
    },
    intervals,
    memory,
  };
  if (Buffer.byteLength(JSON.stringify(result)) > LIMITS.outputBytes)
    throw new Error('bracketed-resource-output-too-large');
  return result;
}
module.exports = { evaluateBracketedResources, LIMITS };
