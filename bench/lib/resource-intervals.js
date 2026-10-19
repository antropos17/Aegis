'use strict';

const { resourceInput } = require('./resource-input');
const active = (life, time) => life.startUs <= time && (life.endUs === null || time < life.endUs);
const result = (value, reason = null, deltaCpuUs = null) => ({ value, reason, deltaCpuUs });
const sum = (values) => {
  const total = values.reduce((total, value) => total + BigInt(value), 0n);
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null;
};
function percentage(delta, duration) {
  const value = 100 * (delta / duration);
  return Number.isFinite(value) && value <= Number.MAX_SAFE_INTEGER
    ? result(value, null, delta)
    : result(null, 'numeric-overflow');
}
function phaseInterval(phases, a, b) {
  return phases.find((p) => Math.min(a, b) >= p.startUs && Math.max(a, b) <= p.endUs);
}
function orderReason(input, a, b) {
  return !a
    ? null
    : b.actualUs <= a.actualUs
      ? 'nonmonotonic-time'
      : b.scheduledUs <= a.scheduledUs
        ? 'nonmonotonic-schedule'
        : b.scheduledUs - a.scheduledUs !== input.cadenceUs
          ? 'missing-sample'
          : null;
}
function memberCpu(life, a, b, reason) {
  if (reason) return result(null, reason);
  if (!active(life, a.actualUs) || !active(life, b.actualUs)) return result(null, 'lifetime-churn');
  const left = a.members.find((m) => m.lifetime === life.id),
    right = b.members.find((m) => m.lifetime === life.id);
  if (!left || !right) return result(null, 'missing-member');
  if ([left.userUs, left.kernelUs, right.userUs, right.kernelUs].some((v) => v === null))
    return result(null, 'missing-cpu');
  if (right.userUs < left.userUs || right.kernelUs < left.kernelUs)
    return result(null, 'counter-regression');
  const delta = sum([right.userUs - left.userUs, right.kernelUs - left.kernelUs]);
  return delta === null
    ? result(null, 'numeric-overflow')
    : percentage(delta, b.actualUs - a.actualUs);
}
function interval(input, a, b) {
  const phase = phaseInterval(input.phases, a.actualUs, b.actualUs);
  const reason =
    orderReason(input, a, b) ||
    (!phase ? 'phase-boundary' : !phase.steady ? 'nonsteady-phase' : null);
  const members = input.lifetimes
    .filter(
      (l) =>
        (l.startUs <= Math.max(a.actualUs, b.actualUs) &&
          (l.endUs === null || l.endUs > Math.min(a.actualUs, b.actualUs))) ||
        a.members.some((m) => m.lifetime === l.id) ||
        b.members.some((m) => m.lifetime === l.id),
    )
    .map((l) => ({ lifetime: l.id, cohort: l.cohort, ...memberCpu(l, a, b, reason) }));
  const cohorts = input.cohorts.map((cohort) => {
    const rows = members.filter((m) => m.cohort === cohort);
    const why =
      reason ||
      (!a.populationKnown || !b.populationKnown
        ? 'population-unknown'
        : !rows.length
          ? 'empty-population'
          : rows.find((m) => m.reason)?.reason);
    if (why) return { cohort, ...result(null, why) };
    const delta = sum(rows.map((m) => m.deltaCpuUs));
    return {
      cohort,
      ...(delta === null
        ? result(null, 'numeric-overflow')
        : percentage(delta, b.actualUs - a.actualUs)),
    };
  });
  return {
    fromSample: a.id,
    toSample: b.id,
    fromUs: a.actualUs,
    toUs: b.actualUs,
    phaseId: phase?.id ?? null,
    reason,
    members,
    cohorts,
  };
}
function memorySample(input, sample, previous) {
  const phase = input.phases.find((p) => sample.actualUs >= p.startUs && sample.actualUs < p.endUs);
  const reason =
    orderReason(input, previous, sample) ||
    (!phase ? 'outside-phase' : !phase.steady ? 'nonsteady-phase' : null);
  const cohorts = input.cohorts.map((cohort) => {
    const members = input.lifetimes
      .filter(
        (l) =>
          l.cohort === cohort &&
          (active(l, sample.actualUs) || sample.members.some((m) => m.lifetime === l.id)),
      )
      .map((l) => {
        const row = sample.members.find((m) => m.lifetime === l.id);
        const why = !active(l, sample.actualUs)
          ? 'lifetime-churn'
          : !row
            ? 'missing-member'
            : row.residentBytes === null
              ? 'missing-memory'
              : null;
        return { lifetime: l.id, value: why ? null : row.residentBytes, reason: why };
      });
    const why =
      reason ||
      (!sample.populationKnown
        ? 'population-unknown'
        : !members.length
          ? 'empty-population'
          : members.find((m) => m.reason)?.reason);
    const value = why ? null : sum(members.map((m) => m.value));
    return { cohort, value, reason: why || (value === null ? 'numeric-overflow' : null), members };
  });
  return {
    sampleId: sample.id,
    actualUs: sample.actualUs,
    phaseId: phase?.id ?? null,
    reason,
    cohorts,
  };
}
function estimate(input, phase, cohort, metric, observations) {
  const valid = observations.filter((x) => x.value !== null),
    excluded = observations.filter((x) => x.value === null);
  const sorted = valid.map((x) => x.value).sort((a, b) => a - b);
  let reason = !phase.steady
    ? 'nonsteady-phase'
    : excluded.length
      ? 'incomplete-population'
      : !valid.length
        ? 'empty-population'
        : null;
  let p50 = null,
    p95 = null;
  if (!reason) {
    const n = sorted.length,
      mid = Math.floor(n / 2),
      left = sorted[mid - 1],
      right = sorted[mid];
    p50 = n % 2 ? right : left / 2 + right / 2;
    if (
      n % 2 === 0 &&
      Number.isInteger(left) &&
      Number.isInteger(right) &&
      (BigInt(left) + BigInt(right)) % 2n === 1n &&
      Number.isInteger(p50)
    )
      reason = 'numeric-overflow';
    p95 = sorted[Math.ceil((95 * n) / 100) - 1];
  }
  return {
    runId: input.runId,
    phaseId: phase.id,
    cohort,
    metric,
    unit: metric === 'resident-bytes' ? 'bytes' : 'percent-one-core',
    valid,
    excluded,
    validCount: valid.length,
    excludedCount: excluded.length,
    p50: reason ? null : p50,
    p95: reason ? null : p95,
    reason,
  };
}

/** Evaluate bounded offline resource samples. @param {object} input
 * The versioned contract is bench/RESOURCE_INTERVALS.md. No I/O or runtime imports.
 * @returns {object} @since v0.19.2
 */
function evaluateResourceIntervals(input) {
  input = resourceInput(input);
  const intervals = input.samples
    .slice(1)
    .map((sample, i) => interval(input, input.samples[i], sample));
  const memorySamples = input.samples.map((sample, i) =>
    memorySample(input, sample, input.samples[i - 1]),
  );
  const estimates = [];
  const missingScheduledUs = [];
  const scheduled = new Set(input.samples.map((s) => s.scheduledUs));
  for (let time = input.sampleWindow.startUs; time <= input.sampleWindow.endUs;) {
    if (!scheduled.has(time)) missingScheduledUs.push(time);
    if (input.sampleWindow.endUs - time < input.cadenceUs) break;
    time += input.cadenceUs;
  }
  for (const phase of input.phases)
    for (const cohort of input.cohorts) {
      for (const [metric, rows] of [
        ['cpu-one-core-pct', intervals],
        ['resident-bytes', memorySamples],
      ]) {
        const observations = rows
          .filter((row) => row.phaseId === phase.id)
          .map((row) => {
            const value = row.cohorts.find((c) => c.cohort === cohort);
            return {
              sampleId: row.sampleId ?? `${row.fromSample}..${row.toSample}`,
              value: value.value,
              reason: value.reason,
            };
          });
        for (const time of missingScheduledUs.filter((t) => t >= phase.startUs && t <= phase.endUs))
          observations.push({
            sampleId: `scheduled:${time}`,
            value: null,
            reason: 'missing-sample',
          });
        if (metric === 'resident-bytes')
          for (const row of intervals.filter((row) => row.phaseId === phase.id)) {
            if (row.cohorts.find((c) => c.cohort === cohort).reason === 'lifetime-churn')
              observations.push({
                sampleId: `${row.fromSample}..${row.toSample}`,
                value: null,
                reason: 'lifetime-churn',
              });
          }
        if (observations.length)
          for (const life of input.lifetimes.filter(
            (l) =>
              l.cohort === cohort &&
              l.startUs < phase.endUs &&
              (l.endUs === null || l.endUs > phase.startUs),
          )) {
            const witnessed = rows.some(
              (row) =>
                row.phaseId === phase.id &&
                (metric === 'resident-bytes'
                  ? row.cohorts.find((c) => c.cohort === cohort).members
                  : row.members
                ).some((m) => m.lifetime === life.id && m.value !== null),
            );
            if (!witnessed)
              observations.push({
                sampleId: `lifetime:${life.id}`,
                value: null,
                reason: 'unsampled-lifetime',
              });
          }
        estimates.push(estimate(input, phase, cohort, metric, observations));
      }
    }
  const output = { ...input, missingScheduledUs, intervals, memorySamples, estimates };
  if (Buffer.byteLength(JSON.stringify(output)) > 8 * 1024 ** 2)
    throw new Error('resource-output-too-large');
  return output;
}

module.exports = { evaluateResourceIntervals };
