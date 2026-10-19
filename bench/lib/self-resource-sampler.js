'use strict';

const CADENCE_US = 1_000_000;
const LIMITS = Object.freeze({ durationMs: 60_000, samples: 60, outputBytes: 131_072 });
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const invalid = () => {
  throw new Error('self-resource-input-invalid');
};

function closed(value, keys) {
  const copy = Object.create(null);
  try {
    if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
    for (const key of Reflect.ownKeys(value)) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!keys.includes(key) || !Object.hasOwn(d, 'value')) invalid();
      copy[key] = d.value;
    }
  } catch {
    invalid();
  }
  return copy;
}

/**
 * Capture bounded raw observations of the calling Node process, without IO.
 * Injected synchronous readers/timers are test instrumentation, not source authority.
 * @param {object} options Closed runId, durationMs, maxSamples, maxOutputBytes, signal options.
 * @param {object} [deps] Synchronous nowNs/cpuUsage/rss and setTimer/clearTimer test seams.
 * @returns {Promise<object>} Closed numeric observations with separate acquisition brackets.
 * @since 0.19.2
 */
async function sampleSelfResources(options, deps = {}) {
  options = closed(options, ['runId', 'durationMs', 'maxSamples', 'maxOutputBytes', 'signal']);
  deps = closed(deps, ['nowNs', 'cpuUsage', 'rss', 'setTimer', 'clearTimer']);
  const {
    runId,
    durationMs = 4000,
    maxSamples = 60,
    maxOutputBytes = LIMITS.outputBytes,
    signal,
  } = options;
  if (
    typeof runId !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(runId) ||
    !integer(durationMs) ||
    durationMs < 1000 ||
    durationMs > LIMITS.durationMs ||
    durationMs % 1000 ||
    !integer(maxSamples) ||
    maxSamples < 1 ||
    maxSamples > LIMITS.samples ||
    !integer(maxOutputBytes) ||
    maxOutputBytes < 2048 ||
    maxOutputBytes > LIMITS.outputBytes ||
    (signal !== undefined && !(signal instanceof AbortSignal))
  )
    invalid();
  for (const value of Object.values(deps))
    if (value !== null && typeof value !== 'function') invalid();
  const d = {
    nowNs: () => process.hrtime.bigint(),
    cpuUsage: () => process.cpuUsage(),
    rss: () => process.memoryUsage.rss(),
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    ...deps,
  };
  const count = durationMs / 1000;
  const r = {
    version: 'self-resource-samples/1',
    runId,
    readingMode: Object.keys(deps).length ? 'injected' : 'own-process',
    scope: 'calling-node-process',
    cadenceUs: CADENCE_US,
    plannedDurationUs: durationMs * 1000,
    plannedPoints: count,
    limits: { maxSamples, maxOutputBytes, maxDurationUs: LIMITS.durationMs * 1000 },
    sources: {
      clock: 'process.hrtime.bigint',
      cpu: 'process.cpuUsage',
      rss: 'process.memoryUsage.rss',
    },
    units: { clock: 'us', cpu: 'us', rss: 'bytes' },
    memoryDefinition: 'node-process-rss',
    memoryCaveat: 'shared-pages-may-double-count',
    clock: {
      epoch: 'collector-start',
      quantization: 'floor-nanoseconds-to-microseconds',
      lastObservedUs: null,
      reason: null,
    },
    identity: { osBirthTime: null, reason: 'not-observed' },
    population: { complete: null, reason: 'not-collected' },
    samples: [],
    missed: [],
    unattempted: null,
    stopReason: null,
    complete: false,
    pendingTimer: false,
    cleanupReason: null,
    inFlightReading: false,
  };
  let origin,
    lastNs,
    clockReason = null,
    index = 0,
    waits = 0;
  function now() {
    if (clockReason) return null;
    try {
      const n = d.nowNs();
      if (typeof n !== 'bigint' || n < 0n) throw new Error();
      if (lastNs !== undefined && n < lastNs) {
        clockReason = 'clock-regressed';
        return null;
      }
      origin ??= n;
      lastNs = n;
      const us = Number((n - origin) / 1000n);
      if (!integer(us)) throw new Error();
      r.clock.lastObservedUs = us;
      return us;
    } catch {
      clockReason = 'clock-unavailable';
      return null;
    }
  }
  function read(kind) {
    const beforeUs = now();
    let reason = signal?.aborted ? 'cancelled' : beforeUs === null ? clockReason : null,
      value = null;
    if (!reason && beforeUs >= r.plannedDurationUs) reason = 'duration-limit';
    if (!reason) {
      try {
        value = d[kind]();
      } catch {
        reason = 'api-unavailable';
      }
    }
    const afterUs = now();
    reason ??= afterUs === null ? clockReason : null;
    if (kind === 'cpuUsage') {
      let user = null,
        system = null;
      try {
        user = value?.user;
        system = value?.system;
      } catch {
        reason ??= 'invalid-reading';
      }
      const valid = integer(user) && integer(system);
      return {
        beforeUs,
        afterUs,
        userUs: valid ? user : null,
        systemUs: valid ? system : null,
        reason: reason || (valid ? null : 'invalid-reading'),
      };
    }
    const valid = integer(value);
    return {
      beforeUs,
      afterUs,
      residentBytes: valid ? value : null,
      reason: reason || (valid ? null : 'invalid-reading'),
    };
  }
  function fits() {
    return Buffer.byteLength(JSON.stringify(r)) + 512 <= maxOutputBytes;
  }
  async function wait(ms) {
    if (++waits > LIMITS.samples * 4) return 'scheduler-stalled';
    if (typeof d.setTimer !== 'function' || typeof d.clearTimer !== 'function')
      return 'scheduler-unavailable';
    return new Promise((resolve) => {
      let handle,
        done = false;
      const cancel = () => finish('cancelled');
      function clear() {
        try {
          d.clearTimer(handle);
          r.pendingTimer = false;
        } catch {
          r.cleanupReason = 'timer-cancel-unavailable';
        }
      }
      function finish(reason) {
        if (done) return;
        done = true;
        signal?.removeEventListener('abort', cancel);
        if (reason && handle !== undefined) clear();
        if (!reason) r.pendingTimer = false;
        resolve(reason);
      }
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) {
        finish('cancelled');
        return;
      }
      try {
        r.pendingTimer = true;
        handle = d.setTimer(() => finish(null), ms);
        if (done && r.pendingTimer) clear();
      } catch {
        r.pendingTimer = null;
        r.cleanupReason = 'timer-state-unavailable';
        finish('scheduler-unavailable');
      }
    });
  }
  if (!signal?.aborted) now();
  while (index < count) {
    if (signal?.aborted) {
      r.stopReason = 'cancelled';
      break;
    }
    if (clockReason) {
      r.stopReason = clockReason;
      break;
    }
    if (r.samples.length >= maxSamples) {
      r.stopReason = 'sample-limit';
      break;
    }
    const actualUs = now();
    if (actualUs === null) {
      r.stopReason = clockReason;
      break;
    }
    if (actualUs >= r.plannedDurationUs) {
      r.stopReason = 'duration-limit';
      break;
    }
    const due = Math.floor(actualUs / CADENCE_US);
    while (index < due) {
      r.missed.push({ scheduledUs: index * CADENCE_US, reason: 'scheduler-late' });
      if (!fits()) {
        r.missed.pop();
        r.stopReason = 'output-limit';
        break;
      }
      index++;
    }
    if (r.stopReason) break;
    const scheduledUs = index * CADENCE_US;
    if (actualUs < scheduledUs) {
      r.stopReason = await wait((scheduledUs - actualUs) / 1000);
      if (r.stopReason) break;
      continue;
    }
    const row = {
      scheduledUs,
      actualUs,
      latenessUs: actualUs - scheduledUs,
      cpu: read('cpuUsage'),
      rss: read('rss'),
    };
    r.samples.push(row);
    if (!fits()) {
      r.samples.pop();
      r.stopReason = 'output-limit';
      break;
    }
    index++;
    if (signal?.aborted) {
      r.stopReason = 'cancelled';
      break;
    }
    if (clockReason) {
      r.stopReason = clockReason;
      break;
    }
    if (lastNs - origin >= BigInt(r.plannedDurationUs) * 1000n) {
      r.stopReason = 'duration-limit';
      break;
    }
  }
  if (index < count)
    r.unattempted = {
      firstScheduledUs: index * CADENCE_US,
      count: count - index,
      reason: r.stopReason,
    };
  r.clock.reason = clockReason || (origin === undefined ? 'not-observed' : null);
  r.complete =
    r.stopReason === null &&
    !r.missed.length &&
    r.samples.every((s) => s.cpu.reason === null && s.rss.reason === null);
  if (Buffer.byteLength(JSON.stringify(r)) > maxOutputBytes)
    throw new Error('self-resource-output-too-large');
  return r;
}

module.exports = { sampleSelfResources, LIMITS };
