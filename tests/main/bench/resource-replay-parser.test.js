import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { parse } = require('../../../bench/lib/resource-replay-json');
describe('bounded replay JSON parser (CI only)', () => {
  it('accepts UTF-8 data, escaped keys and repeated words in different objects', () => {
    const value = parse(
      Buffer.from('{"name":"café","nested":{"name":"safe"},"numbers":[0,1.0,1e0]}'),
    );
    expect(value.name).toBe('café');
    expect(value.numbers).toEqual([0, 1, 1]);
  });
  it.each([
    '{"x":1,"x":2}',
    '{"x":1,"\\u0078":2}',
    '{"nested":{"x":1,"x":2}}',
    '{"x":1,}',
    '[1,]',
    '1 2',
    '{"x":1e999}',
  ])('refuses duplicate or malformed JSON %# with a fixed error', (value) => {
    expect(() => parse(Buffer.from(value))).toThrow(/^resource-replay-refused$/);
  });
  it('uses fatal decoding for otherwise valid JSON containing invalid UTF-8', () => {
    expect(() =>
      parse(Buffer.concat([Buffer.from('{"name":"'), Buffer.from([0xff]), Buffer.from('"}')])),
    ).toThrow(/^resource-replay-refused$/);
  });
  it.each(['depth', 'string', 'container', 'bytes'])(
    'bounds %s before unbounded accumulation',
    (kind) => {
      const bytes =
        kind === 'depth'
          ? Buffer.from('['.repeat(26) + '0' + ']'.repeat(26))
          : kind === 'string'
            ? Buffer.from(JSON.stringify('x'.repeat(4097)))
            : kind === 'container'
              ? Buffer.from(JSON.stringify(Array(1025).fill(0)))
              : Buffer.alloc(524290, 32);
      expect(() => parse(bytes)).toThrow(/^resource-replay-refused$/);
    },
  );
});
