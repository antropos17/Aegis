'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(`${__dirname}/claude-test-witness.cjs`, 'utf8');
let cases = 0;
for (const mode of ['valid', 'old-bytes', 'wrong-sum', 'wrong-type', 'wrong-scope']) {
  const expected = mode === 'valid';
  let refused = false, loads = 0;
  try {
    vm.runInNewContext(source, { process: { env: { AEGIS_CLOUD_GUEST_TASK: '1', AEGIS_CLOUD_GUEST_TEST_WITNESS: mode === 'wrong-scope' ? '0' : '1' } }, require(name) {
      if (name === 'node:assert/strict') return assert;
      if (name === 'node:fs') return { readFileSync(path, encoding) {
        assert.equal(path, 'C:/AegisLab/work/claude/sum.cjs'); assert.equal(encoding, 'utf8');
        return mode === 'old-bytes' ? 'module.exports = (a, b) => a - b;\n' : 'module.exports = (a, b) => a + b;\n';
      } };
      assert.equal(name, 'C:/AegisLab/work/claude/sum.cjs'); loads++;
      return mode === 'wrong-type' ? 5 : mode === 'wrong-sum' ? (a, b) => a - b : (a, b) => a + b;
    } }, { timeout: 250 });
  } catch { refused = true; }
  assert.equal(!refused, expected);
  if (mode === 'old-bytes' || mode === 'wrong-scope') assert.equal(loads, 0);
  cases++;
}
const runtime = fs.readFileSync(`${__dirname}/claude-test-witness-runtime.cjs`, 'utf8');
const { EventEmitter } = require('node:events');
for (const mode of ['valid-ack', 'wrong-ack', 'early-ack', 'wrong-scope']) {
  const socket = new EventEmitter(); socket.write = () => {}; socket.destroy = () => {};
  socket.removeListener = EventEmitter.prototype.removeListener;
  const immediate = []; let timeout, loads = 0, refused = false;
  try {
    vm.runInNewContext(runtime, { Buffer, process: { env: { AEGIS_CLOUD_GUEST_TASK: '1',
      AEGIS_CLOUD_GUEST_TEST_WITNESS: mode === 'wrong-scope' ? '0' : '1',
      AEGIS_RUNTIME_SESSION: 'a'.repeat(32), AEGIS_RUNTIME_REQUEST: 'b'.repeat(32), AEGIS_RUNTIME_PIPE: `aegis-cloud-runtime-${'c'.repeat(32)}` },
      exit() { throw Error('fixed-runtime-refused'); } },
      setImmediate(fn) { immediate.push(fn); }, setTimeout(fn) { timeout = fn; return 1; }, clearTimeout() {},
      require(name) {
        if (name === 'node:assert/strict') return assert;
        if (name === 'node:net') return { connect() { return socket; } };
        assert.equal(name, 'C:\\ProgramData\\AegisCloudLab\\trusted\\claude-test-witness.cjs'); loads++; return {};
      } }, { timeout: 250 });
    assert.equal(loads, 0);
    if (mode === 'early-ack') { socket.emit('data', Buffer.from('R')); assert.equal(loads, 0); timeout(); }
    else { socket.emit('data', Buffer.from('d'.repeat(32))); immediate.forEach(fn => fn()); assert.equal(loads, 0); socket.emit('data', Buffer.from(mode === 'valid-ack' ? 'R' : 'X')); }
  } catch { refused = true; }
  assert.equal(!refused, mode === 'valid-ack'); assert.equal(loads, mode === 'valid-ack' ? 1 : 0); cases++;
}
console.log(JSON.stringify({ passed: true, pureCases: cases, actualGuestOrProcessObserved: false, scope: 'fixed-witness-source-and-release-models', launchAllowed: false }));
