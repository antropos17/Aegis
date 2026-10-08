'use strict';

// Separate post-Claude verifier in the actual native-held standard-user Node root.
// This does not observe the test process previously requested by Claude.
const assert = require('node:assert/strict');
const fs = require('node:fs');
assert.equal(process.env.AEGIS_CLOUD_GUEST_TASK, '1');
assert.equal(process.env.AEGIS_CLOUD_GUEST_TEST_WITNESS, '1');
const source = 'C:/AegisLab/work/claude/sum.cjs';
assert.equal(fs.readFileSync(source, 'utf8'), 'module.exports = (a, b) => a + b;\n');
const sum = require(source);
assert.equal(typeof sum, 'function');
assert.equal(sum(2, 3), 5);
assert.equal(sum(-2, 3), 1);
assert.equal(sum(0, 0), 0);
// Natural exit0 is observed by the retained native owner. No task result file.
