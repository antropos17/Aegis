'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { uniformCRLFCheckout } = require('./packaged-guard-terminal.cjs');

test('accepts only a uniform LF-to-CRLF conversion of the exact Git blob', () => {
  const blob = Buffer.from('one\ntwo\n');
  assert.equal(uniformCRLFCheckout(blob, Buffer.from('one\r\ntwo\r\n')), true);
  assert.equal(uniformCRLFCheckout(blob, Buffer.from('one\r\ntwo\n')), false);
  assert.equal(uniformCRLFCheckout(blob, Buffer.from('one\r\nchanged\r\n')), false);
  assert.equal(
    uniformCRLFCheckout(Buffer.from('one\r\ntwo\n'), Buffer.from('one\r\ntwo\r\n')),
    false,
  );
});
