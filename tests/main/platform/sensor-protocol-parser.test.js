import { describe, expect, it } from 'vitest';
import protocol from '../../../src/main/platform/sensor-protocol.js';

function frame(value) {
  const payload = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length);
  return Buffer.concat([header, payload]);
}
function decode(value, direction = 'host-to-sensor') {
  const delivered = [];
  const decoder = protocol.createFrameDecoder({ direction, onMessage: (v) => delivered.push(v) });
  return { result: decoder.push(frame(value)), decoder, delivered };
}
function rejects(value, code = 'json-invalid') {
  const { result, decoder, delivered } = decode(value);
  expect(result).toEqual({ decodedCount: 0, errorCode: code, fatal: true });
  expect(delivered).toEqual([]);
  expect(decoder.pendingBytes()).toBe(0);
  expect(decoder.push(frame('{"t":"stop","id":1}')).errorCode).toBe(code);
  expect(decoder.finish().errorCode).toBe(code);
}

describe('strict JSON and UTF-8 at the exported decoder', () => {
  it('accepts ordinary JSON whitespace and valid escaped Unicode', () => {
    const { result, delivered } = decode(
      ' \t\r\n{ "t" : "paths", "id":1, "prefixes":["/fixture/\\uD83E\\uDDEA"] }\n',
    );
    expect(result.fatal).toBe(false);
    expect(delivered).toEqual([{ t: 'paths', id: 1, prefixes: ['/fixture/🧪'] }]);
  });

  it.each([
    '{"t":"stop","t":"snap","id":1}',
    '{"t":"stop","\\u0074":"snap","id":1}',
    '{"t":"paths","id":1,"prefixes":[],"id":2}',
    '{"t":"stop","id":1,}',
    '{"t":"stop","id":1} true',
    '{"t":"paths","id":1,"prefixes":["a",]}',
    '{"t":"paths","id":1,"prefixes":["\\uD800"]}',
    '{"t":"paths","id":1,"prefixes":["\\uDC00"]}',
    '{"t":"paths","id":1,"prefixes":["\\uD800x"]}',
    '{"t":"paths","id":1,"prefixes":["\\x41"]}',
    '{"t":"paths","id":1,"prefixes":["line\nbreak"]}',
    '{"t":"stop","id":1',
    ' ',
    '{',
  ])('rejects malformed/ambiguous JSON %# terminally', (value) => rejects(value));

  it.each(['1.0', '1e0', '1E0', '-0', '-1', '+1', '01', 'NaN', 'Infinity'])(
    'rejects the noncanonical numeric token %s before schema',
    (token) => rejects(`{"t":"stop","id":${token}}`),
  );

  it('detects duplicates inside nested objects including escaped aliases', () => {
    const value =
      '{"t":"watch","id":1,"roots":[{"pid":1,"birth":"0","witness":{"kind":"linux-start-ticks","bootId":"11111111-1111-4111-8111-111111111111","startTicks":"0","\\u0073tartTicks":"0"}}],"descendants":true}';
    rejects(value);
  });

  it.each([
    Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"t":"stop","id":1}')]),
    Buffer.from([0xc0, 0xaf]),
    Buffer.from([0x80]),
    Buffer.from([0xe2, 0x82]),
    Buffer.from([0xed, 0xa0, 0x80]),
    Buffer.from([0xf4, 0x90, 0x80, 0x80]),
  ])('rejects BOM or invalid UTF-8 %# without replacement decoding', (value) =>
    rejects(value, 'utf8-invalid'),
  );

  it('counts root as container one and bounds nesting before schema validation', () => {
    rejects(`{"x":${'['.repeat(15)}0${']'.repeat(15)}}`, 'message-invalid');
    rejects(`{"x":${'['.repeat(16)}0${']'.repeat(16)}}`, 'json-invalid');
    rejects(`{"x":${'{"x":'.repeat(15)}0${'}'.repeat(15)}}`, 'message-invalid');
    rejects(`{"x":${'{"x":'.repeat(16)}0${'}'.repeat(16)}}`, 'json-invalid');
  });

  it.each(['null', '[]', '1', '"text"', 'true', '{"__proto__":{"polluted":true}}'])(
    'rejects a non-message JSON value %# as a schema error',
    (value) => rejects(value, 'message-invalid'),
  );
});
