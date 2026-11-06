'use strict';
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { createOwnerConsole } = require('../../src/main/action-owner-console');

const target = process.argv[2];
const child = new EventEmitter();
child.stdout = new PassThrough();
child.stdin = new Writable({
  write(frame, _encoding, callback) {
    const message = frame.subarray(4).toString('ascii');
    const parts = message.split(' ');
    if (parts.length !== 3 || parts[0] !== 'R') return callback(new Error('unexpected request'));
    fs.writeFileSync(target, parts[2]);
    const body = Buffer.from(`D ${parts[1]}`, 'ascii');
    const response = Buffer.alloc(4 + body.length);
    response.writeUInt32LE(body.length);
    body.copy(response, 4);
    setImmediate(() => child.stdout.write(response));
    callback();
  },
});
child.kill = () => child.emit('exit', 0, null);
const hello = Buffer.from([3, 0, 0, 0, 72, 32, 49]);
(async () => {
  const creating = createOwnerConsole({ child, randomBytes: () => Buffer.from('0123456789abcdef0123456789abcdef', 'hex') });
  child.stdout.write(hello);
  const adapter = await creating;
  const result = await adapter.confirmInTerminal({ target: 'C:\\fixture\\file-α.txt', controls: '\u001b\n' }, { kind: 'delete-file' });
  if (result !== false) throw new Error('expected denial');
  process.exit(0);
})().catch(() => process.exit(1));
