'use strict';

const crypto = require('node:crypto');
const { LIMITS, HEADERS, decode } = require('./procmon-csv');
/**
 * Hash exact input bytes.
 * @param {Buffer} bytes Input bytes.
 * @returns {string} SHA-256 hex.
 * @since v0.11.0
 */
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = (message) => {
  throw new Error(message);
};
const token = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:+/-]{0,127}$/.test(value);
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function keys(object, names) {
  if (
    !object ||
    typeof object !== 'object' ||
    Array.isArray(object) ||
    JSON.stringify(Object.keys(object).sort()) !== JSON.stringify(names.split(' ').sort())
  )
    fail('Malformed receipt fields');
}

function fact(value, isHash = false) {
  keys(value, value?.value === null ? 'value unavailable' : 'value');
  if (
    value.value === null
      ? !token(value.unavailable)
      : !(isHash ? hash(value.value) : token(value.value))
  )
    fail('Malformed version fact');
}

function instant(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    fail('Malformed UTC window');
  return Date.parse(value);
}

// Run only after JSON.parse establishes syntax validity. Decode property names so
// escaped aliases cannot hide duplicate identity, mapping or provenance facts.
function uniqueProperties(text) {
  const stack = [];
  for (const [part] of text.matchAll(/"(?:\\.|[^"\\])*"|[{}[\],:]/g)) {
    const current = stack.at(-1);
    if (part === '{') stack.push({ names: new Set(), key: true });
    else if (part === '[') stack.push(null);
    else if (part === '}' || part === ']') stack.pop();
    else if (part === ',' && current) current.key = true;
    else if (part === ':' && current) current.key = false;
    else if (part.startsWith('"') && current?.key) {
      const name = JSON.parse(part);
      if (current.names.has(name)) fail('Duplicate receipt property');
      current.names.add(name);
    }
  }
}

/**
 * Validate a closed receipt, including an exact CSV digest and fixed date/offset basis.
 * @param {Buffer} bytes Receipt JSON bytes.
 * @param {string} csvSha256 Digest of the CSV input.
 * @returns {object} Validated receipt and same-run binding.
 * @since v0.11.0
 */
function parseReceipt(bytes, csvSha256) {
  const text = decode(bytes, LIMITS.receiptBytes);
  const receipt = JSON.parse(text);
  uniqueProperties(text);
  keys(
    receipt,
    'schemaVersion profile runId scenario arm captureId evidenceLabel csvSha256 timestampBasis window provenance pathMappings loss completeness',
  );
  if (receipt.schemaVersion !== 1) fail('Receipt schema version');
  for (const field of ['runId', 'scenario', 'captureId']) {
    if (!token(receipt[field])) fail('Malformed receipt identity');
  }
  if (!['synthetic', 'unvalidated-export'].includes(receipt.evidenceLabel))
    fail('Unsupported evidence label');
  if (!['A', 'B'].includes(receipt.arm)) fail('Malformed receipt arm');
  keys(receipt.profile, 'id columns timestampFormat');
  if (
    receipt.profile.id !== 'procmon-csv-read-v1' ||
    receipt.profile.timestampFormat !== 'HH:mm:ss.fffffff' ||
    JSON.stringify(receipt.profile.columns) !== JSON.stringify(HEADERS)
  )
    fail('Undeclared CSV profile');
  if (!hash(receipt.csvSha256) || receipt.csvSha256 !== csvSha256) fail('CSV digest mismatch');
  keys(receipt.timestampBasis, 'date utcOffset');
  const { date, utcOffset } = receipt.timestampBasis;
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d\d-\d\d$/.test(date) ||
    !Number.isFinite(Date.parse(`${date}T00:00:00.000Z`)) ||
    new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date ||
    typeof utcOffset !== 'string' ||
    !/^[+-](?:0\d|1[0-3]):[0-5]\d$|^[+-]14:00$/.test(utcOffset) ||
    utcOffset === '-00:00'
  )
    fail('Ambiguous timestamp basis');
  const offset =
    (Number(utcOffset.slice(1, 3)) * 60 + Number(utcOffset.slice(4))) *
    (utcOffset[0] === '-' ? -1 : 1);
  const dayStart = Date.parse(`${date}T00:00:00.000Z`) - offset * 60000;
  keys(receipt.window, 'start end');
  const start = instant(receipt.window.start),
    end = instant(receipt.window.end);
  if (start > end || start < dayStart || end >= dayStart + 86400000)
    fail('Window must fit the declared calendar date');
  keys(
    receipt.provenance,
    'commit machine os agentVersions sensorMode method procmonVersion configSha256',
  );
  if (
    typeof receipt.provenance.commit !== 'string' ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(receipt.provenance.commit)
  )
    fail('Malformed commit');
  for (const name of ['machine', 'os', 'agentVersions', 'sensorMode', 'method']) {
    if (!token(receipt.provenance[name])) fail('Malformed provenance');
  }
  fact(receipt.provenance.procmonVersion);
  fact(receipt.provenance.configSha256, true);
  // No independent loss/completeness measurement is admitted by this staging format.
  if (receipt.loss !== null || receipt.completeness !== null)
    fail('Unmeasured completeness/loss must be null');
  if (
    !Array.isArray(receipt.pathMappings) ||
    receipt.pathMappings.length < 1 ||
    receipt.pathMappings.length > LIMITS.mappings
  )
    fail('Mapping limit');
  const paths = new Set(),
    ids = new Set();
  for (const mapping of receipt.pathMappings) {
    keys(mapping, 'sourcePath fixtureId');
    if (
      typeof mapping.sourcePath !== 'string' ||
      mapping.sourcePath.length > LIMITS.cellChars ||
      !/^(?:[A-Za-z]:\\|\\\\)/.test(mapping.sourcePath) ||
      [...mapping.sourcePath].some((character) => character.charCodeAt(0) < 32) ||
      typeof mapping.fixtureId !== 'string' ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(mapping.fixtureId) ||
      paths.has(mapping.sourcePath) ||
      ids.has(mapping.fixtureId)
    )
      fail('Malformed or duplicate path mapping');
    paths.add(mapping.sourcePath);
    ids.add(mapping.fixtureId);
  }
  const binding = Object.fromEntries(
    ['runId', 'scenario', 'arm', 'captureId', 'evidenceLabel', 'window'].map((name) => [
      name,
      receipt[name],
    ]),
  );
  binding.receiptSha256 = digest(bytes);
  return { receipt, binding, dayStart, start, end };
}

/**
 * Convert the declared 24-hour timestamp to exact UTC 100-nanosecond ticks.
 * @param {string} time Time cell.
 * @param {number} dayStart UTC milliseconds at the declared local midnight.
 * @returns {object} UTC ticks and lossless ISO representation.
 * @since v0.11.0
 */
function timestamp(time, dayStart) {
  const match = /^(\d\d):(\d\d):(\d\d)\.(\d{7})$/.exec(time);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3]) > 59)
    fail('Ambiguous row timestamp');
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  const base = dayStart + seconds * 1000;
  return {
    ticks: BigInt(base) * 10000n + BigInt(match[4]),
    iso: `${new Date(base).toISOString().slice(0, 19)}.${match[4]}Z`,
  };
}

module.exports = { parseReceipt, timestamp, digest };
