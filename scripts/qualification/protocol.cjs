'use strict';
const crypto = require('node:crypto');
const CASES = Object.freeze([
  'tcp4', 'tcp6', 'udp4', 'udp6', 'dns4', 'dns6',
  'lookup4', 'lookup6', 'held-tcp4', 'held-tcp6',
]);
const LIMIT = Object.freeze({ receipt: 8192, input: 2048, message: 512, total: 16384, packets: 32 });

/** Validate the closed loopback endpoint shape; addresses are never input. @since draft1 */
function endpoints(value) {
  const keys = (object, expected) => object && typeof object === 'object' && !Array.isArray(object)
    && Object.keys(object).sort().join(',') === expected.slice().sort().join(',');
  if (!keys(value, ['schemaVersion', 'nonce', 'ports']) || value.schemaVersion !== 1
    || typeof value.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(value.nonce)
    || !keys(value.ports, ['tcp4', 'tcp6', 'udp4', 'udp6'])
    || Object.values(value.ports).some((port) => !Number.isInteger(port) || port < 1 || port > 65535))
    throw new Error('invalid-endpoints');
  return Object.freeze({ schemaVersion: 1, nonce: value.nonce, ports: Object.freeze({ ...value.ports }) });
}

/** Build a fixed dummy token. @since draft1 */
function token(nonce, index, phase = 0) {
  const value = Buffer.alloc(32);
  value.write('AGNW');
  Buffer.from(nonce, 'hex').copy(value, 4);
  value[20] = index;
  value[21] = phase;
  return value;
}

/** Validate one complete dummy token. @since draft1 */
function validToken(value, nonce, allowed) {
  return value.length === 32 && value.subarray(0, 4).toString() === 'AGNW'
    && value.subarray(4, 20).equals(Buffer.from(nonce, 'hex'))
    && allowed.includes(value[20]) && value[21] <= 1
    && value.subarray(22).every((byte) => byte === 0);
}

/** Answer only the fixed nonce-bearing calibration question; never forward DNS. @since draft1 */
function dnsAnswer(query, nonce, family) {
  if (query.length < 12 || query.length > LIMIT.message || query.readUInt16BE(2) !== 0x0100
    || query.readUInt16BE(4) !== 1 || query.readUInt16BE(6) !== 0 || query.readUInt16BE(8) !== 0)
    return null;
  const labels = [`n${nonce}`, 'aegis-control', 'invalid'];
  let cursor = 12;
  for (const label of labels) {
    if (query[cursor++] !== label.length || query.subarray(cursor, cursor + label.length).toString() !== label)
      return null;
    cursor += label.length;
  }
  if (query[cursor++] !== 0 || cursor + 4 > query.length) return null;
  const type = family === 4 ? 1 : 28;
  if (query.readUInt16BE(cursor) !== type || query.readUInt16BE(cursor + 2) !== 1) return null;
  cursor += 4;
  const additional = query.readUInt16BE(10);
  if (additional === 0 && query.length !== cursor) return null;
  if (additional === 1 && (query.length !== cursor + 11 || query[cursor] !== 0
    || query.readUInt16BE(cursor + 1) !== 41 || query.readUInt16BE(cursor + 9) !== 0)) return null;
  if (additional > 1) return null;
  const address = family === 4 ? Buffer.from([127, 0, 0, 1]) : Buffer.from('00000000000000000000000000000001', 'hex');
  const answer = Buffer.alloc(cursor + 12 + address.length);
  query.copy(answer, 0, 0, cursor);
  answer.writeUInt16BE(0x8180, 2);
  answer.writeUInt16BE(1, 6);
  answer.writeUInt16BE(0, 10);
  answer.writeUInt16BE(0xc00c, cursor);
  answer.writeUInt16BE(type, cursor + 2);
  answer.writeUInt16BE(1, cursor + 4);
  answer.writeUInt16BE(address.length, cursor + 10);
  address.copy(answer, cursor + 12);
  return answer;
}

/** Emit only bounded structured evidence. @since draft1 */
function json(value) {
  const output = JSON.stringify(value);
  if (Buffer.byteLength(output) > LIMIT.receipt) throw new Error('receipt-limit');
  return output;
}
const digest = (nonce) => crypto.createHash('sha256').update(Buffer.from(nonce, 'hex')).digest('hex');
module.exports = { CASES, LIMIT, endpoints, token, validToken, dnsAnswer, json, digest };
