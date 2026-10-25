'use strict';
const c = require('./linux-cpu-replay-common');
/** Jump the fixed affine work in logarithmic steps without executing the workload. @param {number} count Validated retained iterations. @returns {number} Checksum. @since unreleased */
function checksum(count) {
  let n = BigInt(count),
    a = 1664525n,
    b = 1013904223n,
    value = 1n;
  const mask = 0xffffffffn;
  while (n) {
    if (n & 1n) value = (a * value + b) & mask;
    b = (a * b + b) & mask;
    a = (a * a) & mask;
    n >>= 1n;
  }
  return Number(value);
}
/** Validate actual bounded work and its prefix checksum. @param {object} w Work. @returns {void} @since unreleased */
function work(w) {
  c.exact(w, 'state reason completedIterations checksum beforeNs afterNs');
  c.assert(
    ['not-started', 'partial', 'completed'].includes(w.state) &&
      [null, 'baseline-unavailable', 'clock-unavailable', 'cancelled', 'work-budget'].includes(
        w.reason,
      ) &&
      c.integer(w.completedIterations, 0, c.WORK.iterations) &&
      w.completedIterations % c.WORK.chunk === 0 &&
      c.integer(w.checksum, 0, 0xffffffff) &&
      w.checksum === checksum(w.completedIterations),
  );
  c.assert([w.beforeNs, w.afterNs].every((v) => v === null || c.time(v)));
  if (w.state === 'not-started')
    c.assert(
      w.reason === 'baseline-unavailable' &&
        w.completedIterations === 0 &&
        w.beforeNs === null &&
        w.afterNs === null,
    );
  else if (w.state === 'completed')
    c.assert(
      w.completedIterations === c.WORK.iterations &&
        w.reason === null &&
        w.beforeNs !== null &&
        w.afterNs !== null,
    );
  else {
    c.assert(['clock-unavailable', 'cancelled', 'work-budget'].includes(w.reason));
    if (w.reason === 'clock-unavailable')
      c.assert(w.afterNs === null && (w.beforeNs !== null || w.completedIterations === 0));
    else
      c.assert(
        w.beforeNs !== null && w.afterNs !== null && w.completedIterations < c.WORK.iterations,
      );
  }
  if (w.beforeNs !== null && w.afterNs !== null) c.assert(BigInt(w.afterNs) >= BigInt(w.beforeNs));
}
function reference(r) {
  if (r === null) return;
  c.exact(r, 'userTicks systemTicks startTicks byteLength sha256 beforeNs afterNs closed');
  c.assert(
    [r.userTicks, r.systemTicks, r.startTicks].every(c.uint) &&
      c.integer(r.byteLength, 1, 16384) &&
      c.sha(r.sha256) &&
      c.time(r.beforeNs) &&
      c.time(r.afterNs) &&
      [true, null].includes(r.closed),
  );
}
/** Validate retained proc/API windows with fixed privacy fields. @param {object[]} list Rows. @returns {void} @since unreleased */
function rows(list) {
  c.assert(Array.isArray(list) && list.length <= 2);
  list.forEach((r, i) => {
    c.exact(r, 'index before api after reason');
    c.assert(r.index === i && c.REASONS.includes(r.reason));
    reference(r.before);
    reference(r.after);
    c.exact(r.api, 'beforeNs afterNs userUs systemUs reason');
    c.assert(
      [r.api.beforeNs, r.api.afterNs].every((v) => v === null || c.time(v)) &&
        [r.api.userUs, r.api.systemUs].every(c.nullableInt) &&
        c.REASONS.includes(r.api.reason),
    );
    if (r.api.reason === null)
      c.assert(
        r.api.beforeNs !== null &&
          r.api.afterNs !== null &&
          r.api.userUs !== null &&
          r.api.systemUs !== null,
      );
    if (r.reason === null) c.assert(r.before !== null && r.after !== null && r.api.reason === null);
  });
}
/** Admit entire stored comparison shape; arithmetic is replayed separately. @param {object} v Comparison. @returns {void} @since unreleased */
function comparison(v) {
  if (c.equal(v, { state: 'refused', reason: 'reference-shape-invalid' })) return;
  c.exact(
    v,
    'version state reason endpoints delta model sourceAuthenticated measurementAccepted calibrationAccepted w8Accepted',
  );
  c.flags(v);
  c.fixed(v.model, c.MODEL);
  c.assert(
    v.version === 'linux-own-cpu-comparison/1' &&
      [
        'incomplete',
        'refused',
        'insufficient-resolution',
        'consistent-under-declared-model',
      ].includes(v.state) &&
      c.REASONS.includes(v.reason) &&
      Array.isArray(v.endpoints) &&
      v.endpoints.length <= 2,
  );
  if (v.state === 'consistent-under-declared-model')
    c.assert(
      v.reason === null &&
        v.endpoints.length === 2 &&
        v.delta?.consistent === true &&
        v.delta?.sufficientResolution === true &&
        v.endpoints.every((e) => e.consistent === true),
    );
  else c.assert(v.reason !== null);
  const rational = (q) => {
    c.exact(q, 'numerator denominator');
    c.assert(c.time(q.numerator) && c.time(q.denominator) && BigInt(q.denominator) > 0n);
  };
  v.endpoints.forEach((e) => {
    c.exact(
      e,
      'index apiLowerUs apiUpperExclusiveUs referenceLowerUs referenceUpperExclusiveUs consistent',
    );
    c.assert(
      c.integer(e.index, 0, 1) &&
        c.time(e.apiLowerUs) &&
        c.time(e.apiUpperExclusiveUs) &&
        typeof e.consistent === 'boolean',
    );
    rational(e.referenceLowerUs);
    rational(e.referenceUpperExclusiveUs);
  });
  if (v.delta !== null) {
    const d = v.delta;
    c.exact(
      d,
      'apiDeltaUs apiLowerUs apiUpperExclusiveUs referenceLowerUs referenceUpperExclusiveUs consistent sufficientResolution',
    );
    c.assert(
      [d.apiDeltaUs, d.apiLowerUs, d.apiUpperExclusiveUs].every(c.time) &&
        typeof d.consistent === 'boolean' &&
        typeof d.sufficientResolution === 'boolean',
    );
    rational(d.referenceLowerUs);
    rational(d.referenceUpperExclusiveUs);
  }
}
module.exports = { checksum, work, rows, comparison };
