'use strict';
const { randomUUID } = require('crypto');
const { EVIDENCE_CODES } = require('./attribution');
const { projectToolContext, unavailableToolContext } = require('./tool-context-record');
const { projectNativeObservation, unavailableNativeObservation } = require('./native-observation');
const { projectBoundReadObject } = require('../shared/bound-read-object');

const SENSORS = Object.freeze(['file-watch', 'file-handle', 'process', 'network', 'other']);
const TYPES = new Set(['file-access', 'config-access', 'agent-enter', 'network-connection']);
const MAX_RECORD_BYTES = 65536;

function text(value, max = 1024) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > max) throw new Error('invalid-record');
  return value;
}
function attribution(value) {
  if (value == null) return null;
  if (
    !['confirmed', 'inferred', 'unattributed'].includes(value.status) ||
    !Array.isArray(value.evidence) ||
    value.evidence.length > 16 ||
    value.evidence.some((code) => !EVIDENCE_CODES.includes(code))
  )
    throw new Error('invalid-record');
  return { status: value.status, evidence: value.evidence.map((item) => text(item, 128)) };
}

/** Snapshot the closed audit projection before retaining or serializing an event.
 * @param {Object} input Existing audit details with a fixed sensor and observation time.
 * @returns {Object} Detached bounded event; unknown fields are never copied.
 * @since 0.19.2
 */
function projectRecord(input) {
  if (
    !input ||
    !TYPES.has(input.type) ||
    !SENSORS.includes(input.sensor) ||
    !Number.isSafeInteger(input.timestamp) ||
    input.timestamp < 0 ||
    input.timestamp > 8640000000000000
  )
    throw new Error('invalid-record');
  const d = input.details;
  if (!d || (d.pid != null && (!Number.isSafeInteger(d.pid) || d.pid < 0)))
    throw new Error('invalid-record');
  const details = {
    agent: text(d.agent) ?? '',
    pid: d.pid ?? null,
    instanceId: text(d.instanceId),
    action: text(d.action, 128) ?? '',
    path: text(d.path, 32768) ?? '',
    severity: text(d.severity, 32) ?? 'normal',
    attribution: attribution(d.attribution),
  };
  if (d.toolContext !== undefined) details.toolContext = projectToolContext(d.toolContext);
  const extra = {};
  if (input.type === 'network-connection') {
    for (const key of ['domain', 'remoteIp', 'localIp', 'state', 'verdict', 'verdictReason']) {
      if (d.extra?.[key] != null) extra[key] = text(d.extra[key]);
    }
    for (const key of ['remotePort', 'localPort']) {
      const value = d.extra?.[key];
      if (value != null) {
        if (!Number.isInteger(value) || value < 0 || value > 65535)
          throw new Error('invalid-record');
        extra[key] = value;
      }
    }
    if (typeof d.extra?.flagged === 'boolean') extra.flagged = d.extra.flagged;
  } else if (input.type === 'agent-enter') {
    if (Number.isSafeInteger(d.extra?.startTime)) extra.startTime = d.extra.startTime;
  } else {
    if (d.eventId !== undefined) {
      if (
        typeof d.eventId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          d.eventId,
        )
      )
        throw new Error('invalid-record');
      extra.eventId = d.eventId;
    }
    if (d.boundObject !== undefined) {
      const object = projectBoundReadObject(d.boundObject);
      if (!object || details.path !== '') throw new Error('invalid-record');
      extra.boundObject = object;
    }
    if (d.createTime100ns != null) extra.createTime100ns = text(d.createTime100ns, 32);
    if (Number.isSafeInteger(d.repeatCount) && d.repeatCount > 0) extra.repeatCount = d.repeatCount;
  }
  const native = Object.getOwnPropertyDescriptor(d, 'nativeObservation');
  if (native) {
    const capsule = Object.hasOwn(native, 'value')
      ? projectNativeObservation(native.value)
      : unavailableNativeObservation();
    if (capsule !== undefined) extra.nativeObservation = capsule;
  }
  details.extra = extra;
  const record = {
    deliveryId: randomUUID(),
    sensor: input.sensor,
    type: input.type,
    timestamp: input.timestamp,
    details,
    replayed: false,
  };
  if (
    Buffer.byteLength(JSON.stringify(record)) > MAX_RECORD_BYTES &&
    extra.nativeObservation !== undefined
  ) {
    extra.nativeObservation = unavailableNativeObservation('native-observation-over-budget');
    if (Buffer.byteLength(JSON.stringify(record)) > MAX_RECORD_BYTES)
      delete extra.nativeObservation;
  }
  if (
    Buffer.byteLength(JSON.stringify(record)) > MAX_RECORD_BYTES &&
    details.toolContext !== undefined
  ) {
    details.toolContext = unavailableToolContext(details.toolContext);
    if (Buffer.byteLength(JSON.stringify(record)) > MAX_RECORD_BYTES) delete details.toolContext;
  }
  if (Buffer.byteLength(JSON.stringify(record)) > MAX_RECORD_BYTES)
    throw new Error('record-oversize');
  return record;
}

/** Validate and re-project persisted content; no generic extra object crosses replay.
 * @param {Object} value Persisted record.
 * @returns {Object} Historical record preserving its delivery identity.
 * @since 0.19.2
 */
function replayRecord(value) {
  if (!/^[a-f0-9-]{36}$/.test(value.deliveryId)) throw new Error('invalid-record');
  const record = projectRecord(value);
  // File and native metadata are reintroduced through the same closed input fields.
  for (const key of [
    'createTime100ns',
    'repeatCount',
    'nativeObservation',
    'boundObject',
    'eventId',
  ]) {
    if (value.details?.extra?.[key] !== undefined) {
      const projected = projectRecord({
        ...value,
        details: { ...value.details, [key]: value.details.extra[key] },
      });
      Object.assign(record.details.extra, projected.details.extra);
    }
  }
  record.deliveryId = value.deliveryId;
  record.replayed = true;
  return record;
}
module.exports = { SENSORS, MAX_RECORD_BYTES, projectRecord, replayRecord };
