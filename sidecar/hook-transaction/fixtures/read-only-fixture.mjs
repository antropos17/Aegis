import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import console from 'node:console';
import { setTimeout, clearTimeout } from 'node:timers';

const require = createRequire(import.meta.url);
const { createWindowsHookReadIO } = require('../../../src/main/claude-hook-windows-io');
const { qualifyAssets } = require('../../../src/main/claude-hook-windows-io-wire');
const [rootArgument, assetsDirectory] = process.argv.slice(2);
if (
  process.platform !== 'win32' ||
  process.argv.length !== 4 ||
  !path.isAbsolute(rootArgument) ||
  !path.isAbsolute(assetsDirectory) ||
  fs.existsSync(rootArgument)
)
  throw Error('fixture-selection-invalid');
const root = path.win32.normalize(rootArgument).replace(/^[a-z]:/, (drive) => drive.toUpperCase());
if (!/^[A-Z]:\\/.test(root) || !/^hook-read-fixture-[a-z0-9-]+$/.test(path.basename(root)))
  throw Error('fixture-selection-invalid');
fs.mkdirSync(root); // Caller supplies a fresh owned target and existing parent.
const manifest = JSON.parse(fs.readFileSync(path.join(assetsDirectory, 'assets.json'), 'utf8'));
const { schemaVersion, ...pins } = manifest;
if (schemaVersion !== 1) throw Error('fixture-assets-invalid');
const assets = { ...pins, hostRoot: path.win32.normalize(path.join(assetsDirectory, 'host')) };
const original = Buffer.from('{"fixture":"owned-only"}\n');
const target = path.join(root, 'settings.json');
fs.writeFileSync(target, original, { flag: 'wx' });
const io = await createWindowsHookReadIO({
  ownedProfile: true,
  targetPath: target,
  assets,
  requestMs: 3000,
  sessionMs: 60000,
  cleanupMs: 2000,
});
try {
  assert.deepEqual(Object.keys(io).sort(), ['close', 'readTarget', 'status']);
  const first = await io.readTarget();
  assert.deepEqual(first.bytes, original);
  assert.match(first.identity, /^[a-f0-9]{16}:[a-f0-9]{32}$/);
  assert.deepEqual(fs.readdirSync(root), ['settings.json']);
  const edited = Buffer.from('{"fixture":"same-identity-edit"}\n');
  fs.writeFileSync(target, edited);
  const second = await io.readTarget();
  assert.equal(second.identity, first.identity);
  assert.deepEqual(second.bytes, edited);
  // The caller must compare bytes too; a retained witness does not prevent edits.
  fs.renameSync(target, path.join(root, 'retained-original.json'));
  fs.writeFileSync(target, edited, { flag: 'wx' });
  await assert.rejects(io.readTarget(), /private-windows-io-failed/);
  assert.deepEqual(fs.readFileSync(target), edited);
  first.bytes.fill(0);
  second.bytes.fill(0);
} finally {
  assert.deepEqual(await io.close(), {
    admission: 'closed',
    exit: 'confirmed',
    streams: 'confirmed',
  });
}

function frame(value) {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

async function rejectMutation(operation) {
  const qualified = qualifyAssets(assets);
  return await new Promise((resolve, reject) => {
    const child = spawn(qualified.executable, qualified.args, {
      cwd: qualified.cwd,
      env: qualified.env,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const output = [],
      errors = [];
    let outputSize = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(Error('fixture-timeout'));
    }, 5000);
    child.stdout.on('data', (chunk) => {
      outputSize += chunk.length;
      if (outputSize > 1024) child.kill();
      else output.push(chunk);
    });
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.stdin.on('error', () => {});
    child.on('error', () => {
      clearTimeout(timer);
      reject(Error('fixture-spawn-failed'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output: Buffer.concat(output), errorBytes: Buffer.concat(errors).length });
    });
    child.stdin.end(
      Buffer.concat([frame({ id: 1, op: 'open-read', target }), frame({ id: 2, ...operation })]),
    );
  });
}

const currentReader = await createWindowsHookReadIO({
  ownedProfile: true,
  targetPath: target,
  assets,
  requestMs: 3000,
  sessionMs: 60000,
  cleanupMs: 2000,
});
const current = await currentReader.readTarget();
await currentReader.close();
const backupRoot = path.join(root, 'must-not-create');
const mutations = [
  {
    op: 'retain',
    bytes: current.bytes.toString('base64'),
    manifest: Buffer.from('{}').toString('base64'),
  },
  { op: 'backup', reference: 1 },
  {
    op: 'commit',
    identity: current.identity,
    before: current.bytes.toString('base64'),
    after: Buffer.from('{"fixture":"forbidden-write"}').toString('base64'),
  },
  { op: 'open', target, backupRoot },
];
for (const operation of mutations) {
  const result = await rejectMutation(operation);
  assert.equal(result.code, 2);
  assert.equal(result.errorBytes, 0);
  const firstLength = result.output.readUInt32LE(0);
  const first = JSON.parse(result.output.subarray(4, 4 + firstLength));
  const next = 4 + firstLength;
  const secondLength = result.output.readUInt32LE(next);
  const second = JSON.parse(result.output.subarray(next + 4, next + 4 + secondLength));
  assert.deepEqual(first, { id: 1, ok: true, protocol: 1 });
  assert.deepEqual(second, { id: 2, ok: false });
  result.output.fill(0);
}
current.bytes.fill(0);
assert.equal(fs.existsSync(backupRoot), false);
assert.equal(fs.readFileSync(target, 'utf8'), '{"fixture":"same-identity-edit"}\n');
assert.deepEqual(fs.readdirSync(root).sort(), ['retained-original.json', 'settings.json']);
console.log('PASS: owned native read, identity replacement refusal and mutation rejection');
