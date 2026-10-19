// @ts-check
'use strict';

const fs = require('node:fs');
const { privateAdmissionSafe } = require('./policy-cedar-process');
const { evaluateRequest } = require('./cedar-worker-thread');
const MAXIMUM = 8 * 1024 * 1024 + 65536 + 1024;

/** Read a single bounded private frame, never argv, env, paths or a launch descriptor.
 * @param {number} length Exact byte count.
 * @returns {Buffer} Copied input bytes.
 * @since v0.19.2 */
function exact(length) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const read = fs.readSync(0, buffer, offset, length - offset, null);
    if (!read) throw Error();
    offset += read;
  }
  return buffer;
}

if (require.main === module) {
  if (!privateAdmissionSafe()) {
    process.exitCode = 1;
  } else {
    /** @type {import('./cedar-worker-thread').Metadata} */
    let result = { decision: 'deny', reason: 'cedar-evaluation-failed', policyIds: [] };
    try {
      const length = exact(4).readUInt32LE(0);
      if (!length || length > MAXIMUM) throw Error();
      const message = JSON.parse(exact(length).toString('utf8'));
      if (
        fs.readSync(0, Buffer.alloc(1), 0, 1, null) !== 0 ||
        Object.keys(message).length !== 3 ||
        message.schemaVersion !== 1 ||
        message.op !== 'evaluate' ||
        !Object.hasOwn(message, 'request')
      )
        throw Error();
      result = evaluateRequest(message.request);
    } catch (_) {}
    const body = Buffer.from(JSON.stringify(result));
    const frame = Buffer.alloc(body.length + 4);
    frame.writeUInt32LE(body.length);
    body.copy(frame, 4);
    // No console/diagnostics, even on malformed input or runtime initialization failure.
    fs.writeSync(1, frame);
  }
}
