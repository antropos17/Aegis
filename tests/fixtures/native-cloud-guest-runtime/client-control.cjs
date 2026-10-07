'use strict';
// Test-only loader substitution. Real Node/core/pipe/PID/token; synthetic fixed task load.
const fs = require('node:fs');
const vm = require('node:vm');
const net = require('node:net');
const source = fs.readFileSync(process.argv[2], 'utf8');
const mode = process.argv[3];
process.stdout.write('fixture-started\n'); // Test orchestration only; never readiness authority.
const realConnect = net.connect.bind(net);
const observedNet = { connect(endpoint) {
  const socket = realConnect(endpoint);
  const write = socket.write.bind(socket);
  socket.write = bytes => {
    if (mode === 'oversize') bytes = Buffer.alloc(4101, 65);
    if (mode === 'extra') bytes = Buffer.concat([bytes, Buffer.from('extra')]);
    return write(bytes);
  };
  return socket;
} };
vm.runInNewContext(source, {
  Buffer, setImmediate, setTimeout, clearTimeout, process,
  require(name) {
    if (name === 'node:net') return observedNet;
    if (name.startsWith('node:')) return require(name);
    if (name !== 'C:\\ProgramData\\AegisCloudLab\\trusted\\cloud-guest-task.cjs') throw Error('unexpected-task');
    process.stdout.write('fixed-task-loaded\n');
    setImmediate(() => process.exit(0));
  }
}, { filename: 'trusted-runtime-control.cjs' });
