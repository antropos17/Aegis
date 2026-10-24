'use strict';

const { parseCsv, LIMITS } = require('./procmon-csv');
const { parseReceipt, timestamp, digest } = require('./procmon-receipt');

/**
 * Import caller-profiled CSV into offline staging.
 * @param {Buffer} csv CSV bytes.
 * @param {Buffer} receiptBytes Receipt bytes.
 * @returns {object} Staging object.
 * @since v0.11.0
 */
function importCsv(csv, receiptBytes) {
  // Bound/decode CSV before hashing; receipt has a separate byte bound before JSON.parse.
  const rows = parseCsv(csv);
  const csvSha256 = digest(csv);
  const { receipt, binding, dayStart, start, end } = parseReceipt(receiptBytes, csvSha256);
  const mappings = new Map(
    receipt.pathMappings.map(({ sourcePath, fixtureId }) => [sourcePath, fixtureId]),
  );
  const accounting = {
    rows: rows.length,
    accepted: 0,
    unsupported: 0,
    unsuccessful: 0,
    zeroLength: 0,
    outsideWindow: 0,
    unmapped: 0,
    invalidLength: 0,
  };
  const events = [];
  const output = {
    schema: 'aegis-procmon-offline-staging',
    schemaVersion: 1,
    oracle: 'procmon',
    acquisition: 'offline-import',
    captureQualified: false,
    exportProfileQualified: false,
    catalogueConfirmed: false,
    sensorScored: false,
    input: {
      csvSha256,
      csvBytes: csv.length,
      receiptSha256: binding.receiptSha256,
      receiptBytes: receiptBytes.length,
      profile: receipt.profile.id,
    },
    binding,
    timestampBasis: receipt.timestampBasis,
    provenance: receipt.provenance,
    accounting,
    loss: null,
    completeness: null,
    admittedToScoring: false,
    events,
  };
  // Reserve counter growth and a terminal newline; bound events BEFORE accumulation.
  let outputBytes = Buffer.byteLength(JSON.stringify(output)) + 128;
  for (const [index, cells] of rows.entries()) {
    const time = timestamp(cells[0], dayStart);
    if (
      !/^[1-9]\d*$/.test(cells[2]) ||
      !Number.isSafeInteger(Number(cells[2])) ||
      Number(cells[2]) > 0xffffffff
    )
      throw new Error('Unsafe PID');
    if (time.ticks < BigInt(start) * 10000n || time.ticks > BigInt(end) * 10000n) {
      accounting.outsideWindow++;
      continue;
    }
    if (cells[3] !== 'ReadFile') {
      accounting.unsupported++;
      continue;
    }
    if (cells[5] !== 'SUCCESS') {
      accounting.unsuccessful++;
      continue;
    }
    const lengths = [...cells[6].matchAll(/(?:^|, )Length: ((?:\d{1,3}(?:,\d{3})+|\d+))(?=, |$)/g)];
    const labels = [...cells[6].matchAll(/(?:^|, )Length:/g)].length;
    const length =
      lengths.length === 1 && labels === 1 ? Number(lengths[0][1].replaceAll(',', '')) : NaN;
    if (!Number.isSafeInteger(length) || length < 0) {
      accounting.invalidLength++;
      continue;
    }
    if (length === 0) {
      accounting.zeroLength++;
      continue;
    }
    const fixtureId = mappings.get(cells[4]);
    if (!fixtureId) {
      accounting.unmapped++;
      continue;
    }
    const event = {
      row: index + 1,
      timestamp: time.iso,
      operation: 'ReadFile',
      result: 'SUCCESS',
      pid: Number(cells[2]),
      fixtureId,
      path: `fixture:${fixtureId}`,
      length,
      detailSha256: digest(Buffer.from(cells[6])),
      binding,
    };
    outputBytes += Buffer.byteLength(JSON.stringify(event)) + 1;
    if (outputBytes > LIMITS.outputBytes) throw new Error('Output byte limit');
    events.push(event);
    accounting.accepted++;
  }
  if (Buffer.byteLength(JSON.stringify(output)) > LIMITS.outputBytes)
    throw new Error('Output byte limit');
  return Object.freeze(output);
}

module.exports = { importCsv };
