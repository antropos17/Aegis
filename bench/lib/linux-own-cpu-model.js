'use strict';
const { unsigned } = require('./linux-own-cpu-proc');
const MODEL = Object.freeze({
  version: 'aggregate-floor-enclosure/1',
  tickEndpointAllowance: 2,
  apiEndpointAllowanceUs: 2,
  progressRule: 'reference-delta-lower-us-strictly-greater-than-four-and-api-delta-positive',
  upperBoundary: 'exclusive',
  kernelReference: 'linux-v6.14',
  kernelModelQualified: false,
});
const fail = () => {
  throw Error('linux-own-cpu-model-invalid');
};
function exact(v, keys) {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(v, key))
  )
    fail();
}
const safe = (v) => Number.isSafeInteger(v) && v >= 0;
const sum = (v) => BigInt(v.userTicks) + BigInt(v.systemTicks);
const rational = (numerator, denominator) => ({
  numerator: numerator.toString(),
  denominator: denominator.toString(),
});
/** Compare retained CPU readings under declared floor bounds, using strict exact rational overlap.
 * @param {object} input Closed clockTicksPerSecond and normalized two windows.
 * @returns {object} Conditional bounds/state, no calibration or acceptance claim.
 * @since unreleased
 */
function evaluateCpuReference(input) {
  exact(input, ['clockTicksPerSecond', 'windows']);
  if (
    !unsigned(input.clockTicksPerSecond) ||
    BigInt(input.clockTicksPerSecond) < 1n ||
    1000000000n % BigInt(input.clockTicksPerSecond) !== 0n ||
    !Array.isArray(input.windows) ||
    input.windows.length > 2
  )
    fail();
  const result = {
    version: 'linux-own-cpu-comparison/1',
    state: 'incomplete',
    reason: 'missing-reference',
    endpoints: [],
    delta: null,
    model: MODEL,
    sourceAuthenticated: false,
    measurementAccepted: false,
    calibrationAccepted: false,
    w8Accepted: false,
  };
  let incomplete = input.windows.length !== 2;
  const hz = BigInt(input.clockTicksPerSecond);
  let identity = null,
    lastTime = null,
    previousUser = null,
    previousSystem = null,
    previousProcUser = null,
    previousProcSystem = null;
  for (const [i, w] of input.windows.entries()) {
    if (!w || w.index !== i || !w.api) fail();
    incomplete ||= w.reason !== null || !w.before || !w.after || w.api.reason !== null;
    for (const v of [w.before, w.after]) {
      if (!v) continue;
      if (
        ![v.userTicks, v.systemTicks, v.startTicks].every(unsigned) ||
        !/^[0-9]{1,32}$/.test(v.beforeNs) ||
        !/^[0-9]{1,32}$/.test(v.afterNs)
      )
        fail();
      identity ??= v.startTicks;
      if (v.startTicks !== identity || v.startTicks === '0')
        return { ...result, state: 'refused', reason: 'identity-changed' };
      const user = BigInt(v.userTicks),
        system = BigInt(v.systemTicks);
      if (previousProcUser !== null && (user < previousProcUser || system < previousProcSystem))
        return { ...result, state: 'refused', reason: 'counter-regressed' };
      previousProcUser = user;
      previousProcSystem = system;
    }
    const times = [
      w.before?.beforeNs,
      w.before?.afterNs,
      w.api.beforeNs,
      w.api.afterNs,
      w.after?.beforeNs,
      w.after?.afterNs,
    ];
    const retainedTimes = times.filter((v) => v !== null && v !== undefined);
    if (retainedTimes.some((v) => typeof v !== 'string' || !/^[0-9]{1,32}$/.test(v))) fail();
    for (const time of retainedTimes.map(BigInt)) {
      if (lastTime !== null && time < lastTime)
        return { ...result, state: 'refused', reason: 'clock-regressed' };
      lastTime = time;
    }
    for (const key of ['userUs', 'systemUs']) {
      const value = w.api[key];
      if (value === null || value === undefined) continue;
      if (!safe(value)) fail();
      const previous = key === 'userUs' ? previousUser : previousSystem;
      if (previous !== null && value < previous)
        return { ...result, state: 'refused', reason: 'counter-regressed' };
      if (key === 'userUs') previousUser = value;
      else previousSystem = value;
    }
    if (
      !w.before ||
      !w.after ||
      retainedTimes.length !== times.length ||
      !safe(w.api.userUs) ||
      !safe(w.api.systemUs)
    ) {
      incomplete = true;
      continue;
    }
    const api = BigInt(w.api.userUs) + BigInt(w.api.systemUs),
      lower = sum(w.before) * 1000000n,
      upper = (sum(w.after) + 2n) * 1000000n;
    const consistent = (api + 2n) * hz > lower && api * hz < upper;
    result.endpoints.push({
      index: i,
      apiLowerUs: api.toString(),
      apiUpperExclusiveUs: (api + 2n).toString(),
      referenceLowerUs: rational(lower, hz),
      referenceUpperExclusiveUs: rational(upper, hz),
      consistent,
    });
  }
  if (result.endpoints.some((e) => !e.consistent))
    return { ...result, state: 'refused', reason: 'unit-or-enclosure-disagreement' };
  if (incomplete) return result;
  const a = input.windows[0],
    b = input.windows[1];
  const difference = sum(b.before) - sum(a.after) - 2n;
  const lower = (difference > 0n ? difference : 0n) * 1000000n,
    upper = (sum(b.after) + 2n - sum(a.before)) * 1000000n;
  const apiDelta =
    BigInt(b.api.userUs) + BigInt(b.api.systemUs) - BigInt(a.api.userUs) - BigInt(a.api.systemUs);
  const apiLower = apiDelta > 2n ? apiDelta - 2n : 0n,
    apiUpper = apiDelta + 2n;
  const overlap = apiUpper * hz > lower && apiLower * hz < upper;
  result.delta = {
    apiDeltaUs: apiDelta.toString(),
    apiLowerUs: apiLower.toString(),
    apiUpperExclusiveUs: apiUpper.toString(),
    referenceLowerUs: rational(lower, hz),
    referenceUpperExclusiveUs: rational(upper, hz),
    consistent: overlap,
    sufficientResolution: lower > 4n * hz && apiDelta > 0n,
  };
  if (!overlap) {
    result.state = 'refused';
    result.reason = 'unit-or-enclosure-disagreement';
  } else if (!result.delta.sufficientResolution) {
    result.state = 'insufficient-resolution';
    result.reason = 'insufficient-resolution';
  } else {
    result.state = 'consistent-under-declared-model';
    result.reason = null;
  }
  return result;
}
module.exports = { evaluateCpuReference, MODEL };
