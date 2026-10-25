'use strict';

const { createHash } = require('node:crypto');
const { LIMITS, parseRecords } = require('./auditd-records');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const FRAMING_TYPES = new Set(['SYSCALL', 'CWD', 'PATH', 'PROCTITLE', 'EOE']);

/**
 * Stage raw auditd compound-event framing for offline inspection.
 * Payloads (including quoted/hex PATH, CWD and PROCTITLE values) remain opaque:
 * neither open success nor a PATH record establishes a completed file read.
 * EOE and PROCTITLE are explicit terminal markers in the upstream stream model:
 * https://github.com/linux-audit/audit-userspace/blob/master/docs/auditd.conf.5
 * Other completion rules, timeouts, capture receipts and loss are unimplemented.
 * @param {Buffer} bytes Raw records from one source, without rotation concatenation.
 * @returns {object} Deterministic staging metadata, always ineligible for scoring.
 * @since v0.20.1
 */
function importRaw(bytes) {
  const records = parseRecords(bytes);
  const grouped = new Map();
  // Reserve the outer envelope/counters and budget every event/record before insertion.
  let outputBytes = 2048;
  let unsupportedRecordTypes = 0;
  const reserve = (value) => {
    outputBytes += Buffer.byteLength(JSON.stringify(value)) + 1;
    if (outputBytes > LIMITS.outputBytes) throw new Error('auditd-output-byte-limit');
  };
  for (const record of records) {
    // JSON framing prevents absent/present node or delimiters in node from colliding.
    const key = JSON.stringify([record.node, record.seconds, record.milliseconds, record.serial]);
    let event = grouped.get(key);
    if (!event) {
      if (grouped.size >= LIMITS.events) throw new Error('auditd-event-limit');
      event = {
        nodeSha256: record.node === null ? null : digest(record.node),
        seconds: record.seconds,
        milliseconds: record.milliseconds,
        serial: record.serial,
        terminal: null,
        records: [],
      };
      reserve(event);
      grouped.set(key, event);
    }
    // A raw audit.log usually omits EOE. PROCTITLE may be followed by EOE in
    // exported streams; accept that single extra marker without reopening data.
    if (event.terminal && !(event.terminal === 'PROCTITLE' && record.type === 'EOE'))
      throw new Error('auditd-record-after-terminal');
    if (event.records.length >= LIMITS.recordsPerEvent)
      throw new Error('auditd-event-record-limit');
    const payloadSha256 = digest(record.payload);
    if (
      event.records.some(
        (item) => item.type === record.type && item.payloadSha256 === payloadSha256,
      )
    )
      throw new Error('auditd-duplicate-record');
    const projected = { line: record.line, type: record.type, payloadSha256 };
    reserve(projected);
    event.records.push(projected);
    if (!FRAMING_TYPES.has(record.type)) unsupportedRecordTypes++;
    if (record.type === 'EOE' || record.type === 'PROCTITLE') event.terminal = record.type;
  }
  const events = [...grouped.values()];
  const terminated = events.filter((event) => event.terminal !== null).length;
  return {
    schema: 'aegis-auditd-framing-staging',
    schemaVersion: 1,
    oracle: 'auditd',
    acquisition: 'offline-raw-framing',
    input: { sha256: digest(bytes), bytes: bytes.length },
    accounting: {
      records: records.length,
      events: events.length,
      explicitlyTerminated: terminated,
      withoutTerminal: events.length - terminated,
      unsupportedRecordTypes,
    },
    captureQualified: false,
    fieldsNormalized: false,
    catalogueConfirmed: false,
    sensorScored: false,
    admittedToScoring: false,
    loss: null,
    completeness: null,
    events,
  };
}

module.exports = { importRaw };
