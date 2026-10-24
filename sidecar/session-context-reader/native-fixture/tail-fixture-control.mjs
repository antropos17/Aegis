import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

/** Execute the isolated large-file metadata/EOF fixture on an owned file.
 * Its result is separate from production apphost grammar qualification.
 * @param {string} root Build/evidence task root.
 * @param {string} selected Newly created inert large file.
 * @param {object} env Qualified fixed runtime environment.
 * @returns {Promise<object>} Fixed control result after original-child closure.
 * @since v0.20.1
 */
export async function runTailMetadataFixture(root, selected, env) {
  const folder = path.join(root, 'fixture-build');
  const child = spawn(path.join(folder, 'TailFixture.exe'), [], {
    cwd: folder,
    env,
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const output = [];
  let outputBytes = 0,
    stderrBytes = 0,
    streamCloses = 0,
    overflow = false;
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    stream.once('close', () => streamCloses++);
    stream.on('error', () => {});
  }
  child.stdout.on('data', (bytes) => {
    outputBytes += bytes.length;
    if (outputBytes > 4096) {
      overflow = true;
      child.kill('SIGKILL');
    } else output.push(bytes);
  });
  child.stderr.on('data', (bytes) => {
    stderrBytes += bytes.length;
    if (stderrBytes > 65536) {
      overflow = true;
      child.kill('SIGKILL');
    }
  });
  const ended = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code));
  });
  const payload = Buffer.from(JSON.stringify({ path: selected }));
  const frame = Buffer.alloc(payload.length + 4);
  frame.writeUInt32LE(payload.length);
  payload.copy(frame, 4);
  child.stdin.end(frame, () => {
    frame.fill(0);
    payload.fill(0);
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    assert.equal(await ended, 0);
    assert.equal(overflow, false);
    assert.equal(stderrBytes, 0);
    assert.equal(streamCloses, 3);
    const received = Buffer.concat(output);
    try {
      assert.equal(received.readUInt32LE(0), received.length - 4);
      const result = JSON.parse(received.subarray(4));
      assert.equal(result.largeFileWriteMutationRefused, true);
      assert.equal(result.largeFileChangeMutationRefused, true);
      assert.equal(result.repeatedTailEofRefused, true);
      assert.equal(result.returnedBytes, 512 * 1024);
      const handle = fs.openSync(selected, 'r+');
      fs.closeSync(handle);
      return { ...result, originalChildExit: 'confirmed', streams: 'confirmed', unlocked: true };
    } finally {
      received.fill(0);
    }
  } finally {
    clearTimeout(timer);
    frame.fill(0);
    payload.fill(0);
    for (const bytes of output) bytes.fill(0);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}
