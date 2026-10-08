'use strict';

// Fixed trusted bootstrap: initialize Node core before the parent admits project release.
const net = require('node:net');
const assert = require('node:assert/strict');
assert.equal(typeof Buffer.alloc, 'function');
assert.equal(typeof setImmediate, 'function');
const session = process.env.AEGIS_RUNTIME_SESSION;
const request = process.env.AEGIS_RUNTIME_REQUEST;
const endpoint = process.env.AEGIS_RUNTIME_PIPE;
if (process.env.AEGIS_CLOUD_GUEST_TASK !== '1' || process.env.AEGIS_CLOUD_GUEST_CLAUDE !== '1' ||
    !/^[a-f0-9]{32}$/.test(session || '') || !/^[a-f0-9]{32}$/.test(request || '') ||
    !/^aegis-cloud-runtime-[a-f0-9]{32}$/.test(endpoint || '')) process.exit(121);
const socket = net.connect('\\\\.\\pipe\\' + endpoint);
let challenge = Buffer.alloc(0), ready = false, released = false;
const timer = setTimeout(() => { socket.destroy(); process.exit(122); }, 5000);
function refuse() { socket.destroy(); clearTimeout(timer); process.exit(123); }
socket.on('error', refuse);
socket.on('data', bytes => {
  if (!ready) {
    challenge = Buffer.concat([challenge, bytes]);
    if (challenge.length > 32) return refuse();
    if (challenge.length !== 32) return;
    const generation = challenge.toString('ascii');
    if (!/^[a-f0-9]{32}$/.test(generation)) return refuse();
    // An event-loop turn and loaded core modules are observations of this fixed runtime.
    setImmediate(() => {
      if (ready || released) return refuse();
      const payload = Buffer.from(JSON.stringify({ protocol: 'aegis-supervisor-caller', version: 1,
        operation: 'inspect-owned', requestId: request, sessionId: session, generation, sequence: 1 }), 'utf8');
      const frame = Buffer.alloc(4 + payload.length);
      frame.writeUInt32LE(payload.length, 0); payload.copy(frame, 4);
      ready = true; socket.write(frame); // One Windows pipe message, qualified by native controls.
    });
    return;
  }
  if (released || bytes.length !== 1 || bytes[0] !== 82) return refuse();
  released = true; clearTimeout(timer);
  socket.removeListener('error', refuse);
  socket.destroy();
  // No task path, source, arguments, or callback comes from the wire/environment.
  require('C:\\ProgramData\\AegisCloudLab\\trusted\\claude-task.cjs');
});
socket.on('end', () => { if (!released) refuse(); });
