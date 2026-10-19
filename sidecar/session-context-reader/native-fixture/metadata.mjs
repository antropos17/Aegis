import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const report = 'X:/tmp/aegis-ten-hour-20261019/reports/05-windows-context-reader';
const mutant = process.argv[2] === 'mutant';
const selected = path.win32.normalize(`${report}/owned-controls/metadata.jsonl`);
fs.writeFileSync(selected, Buffer.from('inert fixture'));
const folder = `${report}/${mutant ? 'mutant-build' : 'metadata-build'}`;
const child = spawn(`${folder}/MetadataFixture.exe`, [], {
  cwd: folder,
  env: {
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.SystemRoot,
    DOTNET_ROOT: 'C:\\Program Files\\dotnet',
    DOTNET_EnableDiagnostics: '0',
    COMPlus_EnableDiagnostics: '0',
    DOTNET_ROLL_FORWARD: 'Disable',
  },
  windowsHide: true,
  shell: false,
  stdio: ['pipe', 'pipe', 'pipe'],
});
const body = Buffer.from(JSON.stringify({ path: selected }));
const frame = Buffer.alloc(body.length + 4);
frame.writeUInt32LE(body.length);
body.copy(frame, 4);
const output = [];
let stderrBytes = 0,
  closed = 0;
for (const stream of [child.stdin, child.stdout, child.stderr])
  stream.once('close', () => closed++);
child.stdout.on('data', (chunk) => {
  assert.ok(output.reduce((sum, part) => sum + part.length, 0) + chunk.length < 1024);
  output.push(chunk);
});
child.stderr.on('data', (chunk) => {
  stderrBytes += chunk.length;
});
child.stdin.end(frame, () => {
  frame.fill(0);
  body.fill(0);
});
const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
try {
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(code, 0);
  assert.equal(stderrBytes, 0);
  assert.equal(closed, 3);
  const received = Buffer.concat(output);
  assert.equal(received.readUInt32LE(0), received.length - 4);
  const result = JSON.parse(received.subarray(4));
  assert.equal(result.writeMutationRefused, true);
  assert.equal(result.changeOnlyMutationRefused, true);
  assert.equal(result.repeatedEofRefused, true);
  console.log(
    JSON.stringify({
      metadataMutationControls: 2,
      eofControls: 1,
      result: 'PASS',
      originalChildExit: 'confirmed',
      streams: 'confirmed',
    }),
  );
} finally {
  clearTimeout(timer);
  fs.unlinkSync(selected);
}
