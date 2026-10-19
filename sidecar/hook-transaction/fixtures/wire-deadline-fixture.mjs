import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Writable, PassThrough } from 'node:stream';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPipe } = require('../../../src/main/claude-hook-windows-io-wire');
const child = new EventEmitter();
child.stdout = new PassThrough();
child.stderr = new PassThrough();
child.stdin = new Writable({
  write(bytes, encoding, done) {
    const request = JSON.parse(bytes.subarray(4).toString());
    done();
    setImmediate(() => {
      // A timer cannot run during this turn; monotonic response admission must refuse it.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 130);
      const body = Buffer.from(JSON.stringify({ id: request.id, ok: true }));
      const prefix = Buffer.alloc(4);
      prefix.writeUInt32LE(body.length);
      child.stdout.write(Buffer.concat([prefix, body]));
    });
  },
});
let kills = 0;
child.kill = () => {
  kills++;
  setImmediate(() => {
    child.stdout.destroy();
    child.stderr.destroy();
    child.emit('exit', null, 'SIGKILL');
    child.emit('close');
  });
  return true;
};
const pipe = createPipe(child, { requestMs: 100, sessionMs: 1000, cleanupMs: 100 });
let refused = false;
try {
  await pipe.request({ op: 'commit' });
} catch (error) {
  refused = error.message === 'private-windows-io-failed';
} finally {
  await pipe.close();
}
assert.equal(refused, true, 'late-response-refused');
assert.equal(kills, 1, 'owned-child-terminated-once');
console.log('synthetic-deadline-pass late-response-refused');
