/**
 * @file export-csv-row.js
 * @module main/export-csv-row
 * @description Allowlisted provenance extraction and CSV-safe row serialization
 *   for activity and network observations.
 * @since v0.25.0
 */

'use strict';

const { EVIDENCE_CODES } = require('./attribution');
const { VERDICT_REASONS } = require('./network-monitor');
const { endpointLabel } = require('../shared/observation-display');

/**
 * Complete 12-column CSV header preserving the initial 5 columns followed by
 * observation provenance and network verdict fields.
 * @type {string}
 * @since v0.25.0
 */
const CSV_HEADER =
  'Timestamp,Agent Name,Action Type,Target,Sensitive,PID,Instance ID,Source,' +
  'Attribution,Attribution Evidence,Network Verdict,Network Verdict Reason';

// Recorded file-observation source labels only; never derive one from an action
// or accept arbitrary text (which could carry contents or credentials).
const FILE_OBSERVATION_SOURCES = new Set(['chokidar-write', 'rm-hold', 'handle-scan', 'watcher']);
const ATTRIBUTION_STATUSES = new Set(['confirmed', 'inferred', 'unattributed']);
const NETWORK_VERDICTS = new Set(['allowlisted', 'unknown', 'flagged']);
const NETWORK_VERDICT_REASONS = new Set(Object.values(VERDICT_REASONS));
const MAX_INSTANCE_ID_LENGTH = 256;
const MAX_DATE_TIME_MS = 8640000000000000;

/**
 * Escape a normalized cell value for safe CSV embedding.
 * @param {string|number} val - Normalized cell scalar (`null`/`undefined` coerce to `''`).
 * @returns {string} CSV-escaped cell.
 * @since v0.1.0
 */
function csvEscape(val) {
  const raw = val == null ? '' : String(val);
  // Spreadsheet applications may interpret quoted cells as formulas too.
  const str =
    typeof val === 'string' && (/^[\s]*[=+@-]/.test(raw) || /^[\t\r\n]/.test(raw))
      ? "'" + raw
      : raw;
  if (/[",\r\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Format an activity-log timestamp as ISO 8601 UTC, or `''` when absent/invalid.
 * @param {*} value - Recorded epoch ms or date string.
 * @returns {string} ISO timestamp or `''`.
 */
function formatActivityTimestamp(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && Math.abs(value) <= MAX_DATE_TIME_MS
      ? new Date(value).toISOString()
      : '';
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && Math.abs(parsed) <= MAX_DATE_TIME_MS
      ? new Date(parsed).toISOString()
      : '';
  }
  return '';
}

/**
 * Format a retained network observation time strictly from a valid safe integer.
 * Legacy/invalid rows have no recorded time and stay blank.
 * @param {*} value - Recorded epoch ms.
 * @returns {string} ISO timestamp or `''`.
 */
function formatNetworkTimestamp(value) {
  return Number.isSafeInteger(value) && Math.abs(value) <= MAX_DATE_TIME_MS
    ? new Date(value).toISOString()
    : '';
}

/**
 * Read a valid non-negative integer PID (`0` included), or `''` when absent/invalid.
 * @param {Object|null|undefined} row - Observation record.
 * @returns {string} Decimal PID or `''`.
 */
function readPidText(row) {
  return Number.isInteger(row?.pid) && row.pid >= 0 ? String(row.pid) : '';
}

/**
 * Preserve a bounded recorded `instanceId` verbatim, or `null`.
 * Never reconstructs an identity from `pid`.
 * @param {Object|null|undefined} row - Observation record.
 * @returns {string|null} Verbatim instance key or `null`.
 * @since v0.25.0
 */
function readBoundedInstanceId(row) {
  return typeof row?.instanceId === 'string' &&
    row.instanceId.length > 0 &&
    row.instanceId.length <= MAX_INSTANCE_ID_LENGTH
    ? row.instanceId
    : null;
}

/**
 * Read an allowlisted recorded file-observation source label, or `null`.
 * @param {Object|null|undefined} row - Activity-log event.
 * @returns {string|null} Allowlisted source label or `null`.
 * @since v0.25.0
 */
function readFileObservationSource(row) {
  return typeof row?.source === 'string' && FILE_OBSERVATION_SOURCES.has(row.source)
    ? row.source
    : null;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Read an allowlisted attribution status from a plain `attribution` object.
 * @param {Object|null|undefined} row - Observation record.
 * @returns {string|null} `'confirmed'|'inferred'|'unattributed'` or `null`.
 * @since v0.25.0
 */
function readAttributionStatus(row) {
  const attr = row?.attribution;
  if (!isPlainObject(attr) || !Object.hasOwn(attr, 'status')) return null;
  return typeof attr.status === 'string' && ATTRIBUTION_STATUSES.has(attr.status)
    ? attr.status
    : null;
}

/**
 * Read allowlisted attribution evidence codes from `row.attribution.evidence`.
 * @param {Object|null|undefined} row - Observation record.
 * @returns {string[]} Allowlisted evidence codes in recorded order.
 * @since v0.25.0
 */
function readAttributionEvidence(row) {
  const attr = row?.attribution;
  if (!isPlainObject(attr) || !Object.hasOwn(attr, 'evidence') || !Array.isArray(attr.evidence)) {
    return [];
  }
  return attr.evidence.filter((code) => typeof code === 'string' && EVIDENCE_CODES.includes(code));
}

function isValidPort(port) {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

/**
 * Format the target column for a network row while preserving local-socket
 * details and guarding non-string/invalid fields against coercion leaks.
 * @param {Object|null|undefined} conn - Network connection record.
 * @returns {string} Formatted network target cell.
 */
function formatNetworkTarget(conn) {
  const remotePort = isValidPort(conn?.remotePort) ? conn.remotePort : null;
  const remoteLabel = endpointLabel({
    domain: typeof conn?.domain === 'string' ? conn.domain : '',
    remoteIp: typeof conn?.remoteIp === 'string' ? conn.remoteIp : '',
    ip: typeof conn?.ip === 'string' ? conn.ip : '',
    remotePort,
  });
  const localIp = typeof conn?.localIp === 'string' ? conn.localIp.trim() : '';
  const localPort = isValidPort(conn?.localPort) ? conn.localPort : null;
  if (!localIp && localPort === null) return remoteLabel;
  const localEndpoint =
    endpointLabel({ remoteIp: localIp, remotePort: localPort }) ||
    (localPort !== null ? 'port ' + localPort : '');
  const pidText = readPidText(conn);
  const state = typeof conn?.state === 'string' ? conn.state.trim() : '';
  return [
    remoteLabel,
    localEndpoint ? 'Local ' + localEndpoint : '',
    pidText ? 'PID ' + pidText : '',
    state,
  ]
    .filter(Boolean)
    .join(' · ');
}

function readNetworkVerdictFields(conn) {
  const verdict =
    typeof conn?.verdict === 'string' && NETWORK_VERDICTS.has(conn.verdict) ? conn.verdict : '';
  const verdictReason =
    verdict &&
    typeof conn?.verdictReason === 'string' &&
    NETWORK_VERDICT_REASONS.has(conn.verdictReason)
      ? conn.verdictReason
      : '';
  return { verdict, verdictReason };
}

/**
 * Serialize one file/activity observation into a 12-column CSV row.
 * @param {Object|null|undefined} event - Activity-log event.
 * @param {string} agentLabel - Human-facing actor/context label.
 * @returns {string} Escaped CSV row without trailing newline.
 * @since v0.25.0
 */
function formatActivityCsvRow(event, agentLabel) {
  const ts = formatActivityTimestamp(event?.timestamp);
  const agent = typeof agentLabel === 'string' ? agentLabel : '';
  const action =
    typeof event?.action === 'string' && event.action.length > 0 ? event.action : 'accessed';
  const target = typeof event?.file === 'string' ? event.file : '';
  const sensitive = event?.sensitive ? 'yes' : 'no';
  const pid = readPidText(event);
  const instanceId = readBoundedInstanceId(event) ?? '';
  const source = readFileObservationSource(event) ?? '';
  const attribution = readAttributionStatus(event) ?? '';
  const evidence = readAttributionEvidence(event).join(';');
  return [
    ts,
    agent,
    action,
    target,
    sensitive,
    pid,
    instanceId,
    source,
    attribution,
    evidence,
    '',
    '',
  ]
    .map(csvEscape)
    .join(',');
}

/**
 * Serialize one network connection observation into a 12-column CSV row.
 * @param {Object|null|undefined} conn - Network connection observation.
 * @param {string} agentLabel - Human-facing actor/context label.
 * @returns {string} Escaped CSV row without trailing newline.
 * @since v0.25.0
 */
function formatNetworkCsvRow(conn, agentLabel) {
  const ts = formatNetworkTimestamp(conn?.timestamp);
  const agent = typeof agentLabel === 'string' ? agentLabel : '';
  const target = formatNetworkTarget(conn);
  const sensitive = conn?.flagged ? 'yes' : 'no';
  const pid = readPidText(conn);
  const instanceId = readBoundedInstanceId(conn) ?? '';
  const attribution = readAttributionStatus(conn) ?? '';
  const evidence = readAttributionEvidence(conn).join(';');
  const { verdict, verdictReason } = readNetworkVerdictFields(conn);
  return [
    ts,
    agent,
    'network',
    target,
    sensitive,
    pid,
    instanceId,
    '',
    attribution,
    evidence,
    verdict,
    verdictReason,
  ]
    .map(csvEscape)
    .join(',');
}

module.exports = {
  CSV_HEADER,
  csvEscape,
  readBoundedInstanceId,
  readFileObservationSource,
  readAttributionStatus,
  readAttributionEvidence,
  formatActivityCsvRow,
  formatNetworkCsvRow,
};
