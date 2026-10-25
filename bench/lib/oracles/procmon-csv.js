'use strict';

const LIMITS = Object.freeze({
  csvBytes: 1048576,
  receiptBytes: 65536,
  rows: 4096,
  cellChars: 4096,
  mappings: 128,
  outputBytes: 2097152,
});
const HEADERS = Object.freeze([
  'Time of Day',
  'Process Name',
  'PID',
  'Operation',
  'Path',
  'Result',
  'Detail',
]);

/**
 * Decode bounded UTF-8 bytes without replacing invalid sequences.
 * @param {Buffer} bytes Input bytes.
 * @param {number} max Maximum bytes.
 * @returns {string} Decoded text.
 * @since v0.11.0
 */
function decode(bytes, max) {
  if (!Buffer.isBuffer(bytes) || bytes.length > max) throw new Error('Input byte limit');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (text.includes('\0')) throw new Error('NUL refused');
  return text;
}

/**
 * Parse the strict seven-column caller-defined CSV profile, with bounded accumulation.
 * @param {Buffer} bytes CSV bytes.
 * @returns {string[][]} Data rows (header excluded).
 * @since v0.11.0
 */
function parseCsv(bytes) {
  const text = decode(bytes, LIMITS.csvBytes);
  const rows = [];
  let row = [],
    cell = '',
    state = 'start';
  const append = (character) => {
    if (cell.length >= LIMITS.cellChars) throw new Error('Cell limit');
    cell += character;
  };
  const endCell = () => {
    if (row.length >= HEADERS.length) throw new Error('Column limit');
    row.push(cell);
    cell = '';
    state = 'start';
  };
  const endRow = () => {
    endCell();
    if (row.length !== HEADERS.length) throw new Error('Missing columns');
    if (rows.length > LIMITS.rows) throw new Error('Row limit');
    rows.push(row);
    row = [];
  };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (state === 'quoted') {
      if (character === '"') state = 'closed';
      else append(character);
    } else if (state === 'closed' && character === '"') {
      append('"');
      state = 'quoted';
    } else if (character === ',') endCell();
    else if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] !== '\n') throw new Error('Bare CR');
      if (character === '\r') index++;
      endRow();
    } else if (character === '"' && state === 'start') state = 'quoted';
    else {
      if (state === 'closed' || character === '"') throw new Error('Malformed CSV quoting');
      append(character);
      state = 'plain';
    }
  }
  if (state === 'quoted') throw new Error('Unclosed CSV quote');
  if (state !== 'start' || row.length || cell.length) endRow();
  if (!rows.length || JSON.stringify(rows[0]) !== JSON.stringify(HEADERS))
    throw new Error('Strict CSV headers required');
  return rows.slice(1);
}

module.exports = { LIMITS, HEADERS, decode, parseCsv };
