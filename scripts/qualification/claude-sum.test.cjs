'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
test('fixed Claude disposable sum', () => {
  assert.equal(require('C:/AegisLab/work/claude/sum.cjs')(2, 3), 5);
  console.log('AEGIS_CLAUDE_NODE_TEST_OK');
});
