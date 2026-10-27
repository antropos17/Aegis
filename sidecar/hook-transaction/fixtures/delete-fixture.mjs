import fs from 'node:fs';
import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const [root, host, dotnet] = process.argv.slice(2);
if (
  process.platform !== 'win32' ||
  process.argv.length !== 5 ||
  !/^X:\\tmp\\w6-delete-wire-fixture-[a-z0-9-]+$/.test(root) ||
  fs.existsSync(root) ||
  !path.isAbsolute(host) ||
  !fs.statSync(host).isFile() ||
  !path.isAbsolute(dotnet) ||
  !fs.statSync(dotnet).isFile()
)
  throw Error('fixture-selection-invalid');
fs.mkdirSync(root);
const result = [];

function frame(value) {
  const body = Buffer.from(JSON.stringify(value));
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(body.length);
  return Buffer.concat([prefix, body]);
}

async function session(file, action) {
  const child = spawn(dotnet, [host], {
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let received = Buffer.alloc(0),
    errorBytes = 0,
    waiter = null;
  child.stdout.on('data', (chunk) => {
    received = Buffer.concat([received, chunk]);
    waiter?.();
  });
  child.stderr.on('data', (chunk) => {
    errorBytes += chunk.length;
  });
  const exited = once(child, 'close');
  const timer = setTimeout(() => child.kill(), 10000);
  async function request(value) {
    child.stdin.write(frame(value));
    while (received.length < 4 || received.length < 4 + received.readUInt32LE(0))
      await Promise.race([
        new Promise((resolve) => {
          waiter = resolve;
        }),
        exited.then(() => {
          throw Error('fixture-host-ended-before-frame');
        }),
      ]);
    const size = received.readUInt32LE(0);
    assert.ok(size <= 1024);
    const response = JSON.parse(received.subarray(4, 4 + size).toString('utf8'));
    received = received.subarray(4 + size);
    waiter = null;
    return response;
  }
  try {
    assert.deepEqual(await request({ id: 1, op: 'open-delete', target: file }), {
      id: 1,
      ok: true,
      protocol: 1,
    });
    const output = await action(request);
    child.stdin.end();
    const [code] = await exited;
    assert.equal(code, 0);
    assert.equal(errorBytes, 0);
    assert.equal(received.length, 0);
    return output;
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
  }
}

const cancelled = path.join(root, 'cancelled.txt');
fs.writeFileSync(cancelled, 'cancelled', { flag: 'wx' });
await session(cancelled, async () => {});
assert.equal(fs.readFileSync(cancelled, 'utf8'), 'cancelled');
const check = fs.openSync(cancelled, 'r+');
fs.closeSync(check);
result.push({ name: 'eof-cancel-preserves-and-releases', status: 'pass' });

const target = path.join(root, 'target.txt');
const replacement = path.join(root, 'replacement.txt');
fs.writeFileSync(target, 'reviewed', { flag: 'wx' });
fs.writeFileSync(replacement, 'replacement', { flag: 'wx' });
await session(target, async (request) => {
  assert.throws(() => fs.renameSync(replacement, target));
  assert.deepEqual(await request({ id: 2, op: 'delete' }), { id: 2, ok: true, outcome: 'deleted' });
});
assert.equal(fs.existsSync(target), false);
assert.equal(fs.readFileSync(replacement, 'utf8'), 'replacement');
result.push({ name: 'replacement-refused-original-deleted', status: 'pass' });

const pending = path.join(root, 'pending.txt');
fs.writeFileSync(pending, 'reader', { flag: 'wx' });
const reader = fs.openSync(pending, 'r');
try {
  await session(pending, async (request) => {
    assert.deepEqual(await request({ id: 2, op: 'delete' }), {
      id: 2,
      ok: true,
      outcome: 'unknown',
    });
  });
} finally {
  fs.closeSync(reader);
}
result.push({ name: 'held-reader-outcome-unknown', status: 'pass' });
console.log(
  JSON.stringify({
    status: 'pass',
    scenarios: result,
    retention: 'owned-fixture-retained-for-review-no-automatic-deletion',
  }),
);
