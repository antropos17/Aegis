/**
 * @file Pure, offline ETW session health. No live sensor is registered here.
 * A reducer input is a validated collector message, never a FileEvent.
 * @since v0.14.2
 */
'use strict';

const health = require('../sensor-health');
const { validateMessage, ERROR_CODES, PROFILE, PROTOCOL } = require('./etw-file-protocol');
const NATIVE = ['eventsLost', 'realTimeBuffersLost', 'logBuffersLost'];
const TOTALS = [
  'delivered',
  'filtered',
  'dropped',
  'ingressDropped',
  'outputDropped',
  'decoderErrors',
  'mapEpoch',
  'mapResets',
  'mapConflicts',
];
const LOSS_TOTALS = [
  'dropped',
  'ingressDropped',
  'outputDropped',
  'decoderErrors',
  'mapResets',
  'mapConflicts',
];
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const error = (code) => {
  throw new Error(`etw-file:${code}`);
};
function time(now) {
  if (!Number.isSafeInteger(now) || now < 0) error('invalid-time');
}
function detail(reasons) {
  return reasons.join(',');
}

/** Begin an isolated model for a caller-selected new session ID.
 * Caller must retain ended summaries and never reuse an ID for another session.
 * @param {string} launchId - Transport attempt identity.
 * @param {string} sessionId - Intended ETW session identity.
 * @returns {Object} Immutable-by-convention reducer model, with a STARTING leaf.
 * @since v0.14.2
 */
function createSession(launchId, sessionId) {
  validateMessage({
    t: 'stop',
    proto: PROTOCOL,
    launchId,
    sessionId,
    seq: '1',
    data: { requestId: 'validate' },
  });
  return {
    launchId,
    sessionId,
    phase: 'starting',
    helloSeen: false,
    requestId: null,
    lastSeq: '0',
    lastEventSeq: '0',
    lastQueryQpc: null,
    lastReceivedAt: null,
    record: health.createSensorHealth('etw-file'),
    maxima: Object.fromEntries([...NATIVE, ...TOTALS].map((key) => [key, '0'])),
    sticky: [],
    reasons: [],
    latest: null,
    lossSaturated: false,
    coverage: PROFILE,
  };
}

/** Latch a local transport/session failure. Later callbacks cannot revive it.
 * @param {Object} state - Existing reducer model.
 * @param {number} now - Injected receipt time in epoch milliseconds.
 * @param {string} code - Closed static failure code; never peer exception text.
 * @returns {Object} Failed model retaining counters and previous success.
 * @since v0.14.2
 */
function failSession(state, now, code) {
  time(now);
  if (!ERROR_CODES.includes(code)) error('invalid-error-code');
  if (state.phase === 'failed') return state;
  // Repeated EOF after a verified stop is harmless; other failures remain visible.
  if (state.phase === 'stopped' && code === 'stream-ended') return state;
  return {
    ...state,
    phase: 'failed',
    lastReceivedAt: now,
    reasons: [...new Set([...state.reasons, code])],
    record: health.markFailed(state.record, now, { error: code, detail: code }),
  };
}

function withTelemetry(state, sample, now) {
  const sticky = new Set(state.sticky);
  const maxima = { ...state.maxima };
  const current = sample.counters;
  if (state.lastQueryQpc !== null && BigInt(current.asOfQpc) < BigInt(state.lastQueryQpc)) {
    sticky.add('counter-time-regressed');
  }
  const known = current.queryStatus === 0 && NATIVE.every((key) => current[key] !== null);
  if (!known) sticky.add('unmeasured-interval');
  for (const key of [...NATIVE, ...TOTALS]) {
    const raw = NATIVE.includes(key)
      ? current.queryStatus === 0
        ? current[key]
        : null
      : sample.totals[key];
    if (raw === null) continue;
    const value = BigInt(raw),
      previous = BigInt(maxima[key]);
    if (value < previous) sticky.add('counter-regressed');
    if (value > previous) maxima[key] = raw;
    if ((NATIVE.includes(key) || LOSS_TOTALS.includes(key)) && value > 0n) sticky.add(key);
  }
  const loss = BigInt(maxima.eventsLost);
  // Only EventsLost contributes. All other losses have independent sticky flags.
  const count = Number(loss > MAX_SAFE ? MAX_SAFE : loss);
  let record = { ...state.record };
  if (count > record.lossCount) record = health.addLoss(record, count - record.lossCount, now);
  const reasons = [...new Set(['experimental-correlation', ...sticky, ...sample.reasons])];
  if (sample.operational) {
    record = health.markHealthy(record, now);
    record = health.markDegraded(record, now, { detail: detail(reasons) });
  } else {
    record = health.markFailed(record, now, { error: 'session-failed', detail: detail(reasons) });
  }
  return {
    ...state,
    record,
    maxima,
    sticky: [...sticky],
    reasons,
    latest: structuredClone(sample),
    lossSaturated: loss > MAX_SAFE,
    lastQueryQpc:
      state.lastQueryQpc !== null && BigInt(state.lastQueryQpc) > BigInt(current.asOfQpc)
        ? state.lastQueryQpc
        : current.asOfQpc,
    phase: sample.operational ? state.phase : 'failed',
  };
}

/** Apply one collector envelope without mutating the model or retaining its data.
 * Replayed/out-of-order and foreign messages throw static errors. The transport
 * owner must call failSession on decode/reducer/EOF failure; a valid byte EOF alone
 * does not establish that the collector stopped. This module has no timer or I/O.
 * @param {Object} state - Session model from createSession/reduceSession.
 * @param {Object} message - Collector envelope (client start/stop are rejected).
 * @param {number} now - Injected receipt time; ETW QPC remains separate.
 * @returns {Object} Updated model. Terminal models cannot resume in this lifetime.
 * @since v0.14.2
 */
function reduceSession(state, message, now) {
  time(now);
  validateMessage(message, state);
  if (['start', 'stop', 'ping'].includes(message.t)) error('wrong-direction');
  if (BigInt(message.seq) <= BigInt(state.lastSeq)) error('sequence-replayed');
  if (state.phase === 'failed' || state.phase === 'stopped') error('session-terminal');
  if (message.t === 'hello' && (state.helloSeen || state.lastSeq !== '0'))
    error('unexpected-hello');
  if (message.t !== 'hello' && message.t !== 'error' && !state.helloSeen) error('hello-required');
  if (message.t === 'ready' && state.phase !== 'starting') error('unexpected-ready');
  if (
    ['health', 'heartbeat', 'observations', 'stopped'].includes(message.t) &&
    state.phase !== 'running'
  )
    error('ready-required');
  const sticky = new Set(state.sticky);
  if (BigInt(message.seq) !== BigInt(state.lastSeq) + 1n) sticky.add('transport-gap');
  let next = { ...state, lastSeq: message.seq, lastReceivedAt: now, sticky: [...sticky] };
  switch (message.t) {
    case 'hello':
      return { ...next, helloSeen: true };
    case 'ready':
      next.phase = 'running';
      next.requestId = message.data.requestId;
      return withTelemetry(next, message.data.telemetry, now);
    case 'health':
    case 'heartbeat':
      return withTelemetry(next, message.data, now);
    case 'observations': {
      const records = message.data.records;
      if (records.length && BigInt(records[0].eventSeq) <= BigInt(state.lastEventSeq))
        error('event-replayed');
      next.lastEventSeq = records.at(-1)?.eventSeq || state.lastEventSeq;
      // Evidence never leaves this reducer; event sequence gaps can be filtering.
      next.reasons = [...new Set([...next.reasons, ...sticky])];
      next.record = health.markDegraded(next.record, now, { detail: detail(next.reasons) });
      return next;
    }
    case 'stopped': {
      if (BigInt(message.data.finalEventSeq) < BigInt(state.lastEventSeq))
        error('final-sequence-regressed');
      next = withTelemetry(next, message.data.telemetry, now);
      next.lastEventSeq = message.data.finalEventSeq;
      if (!message.data.stopped || !message.data.drained)
        return failSession(next, now, 'stop-unverified');
      if (next.phase === 'failed') return next;
      return { ...next, phase: 'stopped' };
    }
    case 'error':
      return failSession(next, now, message.data.code);
    default:
      return error('wrong-direction');
  }
}

module.exports = { createSession, reduceSession, failSession };
