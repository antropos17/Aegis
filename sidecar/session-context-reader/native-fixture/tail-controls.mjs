import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readBuiltTaskRoot } from './tail-build-paths.mjs';
import { runTailMetadataFixture } from './tail-fixture-control.mjs';

const [selectedRoot, selectedFixtureRoot] = process.argv.slice(2);
if (
  process.platform !== 'win32' ||
  !selectedRoot ||
  !selectedFixtureRoot ||
  process.argv.length !== 4
)
  throw Error('invalid-tail-control-input');
const here = path.dirname(fileURLToPath(import.meta.url));
const checkout = path.resolve(here, '../../..');
const require = createRequire(import.meta.url);
const readerProof = readBuiltTaskRoot(selectedRoot, checkout, 'reader');
const fixtureProof = readBuiltTaskRoot(selectedFixtureRoot, checkout, 'fixture');
const root = readerProof.root;
const fixtureRoot = fixtureProof.root;
const assets = JSON.parse(fs.readFileSync(path.join(root, 'assets.json'), 'utf8'));
if (path.resolve(assets.hostRoot) !== path.join(root, 'build'))
  throw Error('tail-control-assets-root');
assert.equal(
  path.resolve(assets.runtimeRoot).toLowerCase(),
  path.resolve(readerProof.runtimeRoot).toLowerCase(),
);
assert.equal(
  path.resolve(assets.runtimeRoot).toLowerCase(),
  path.resolve(fixtureProof.runtimeRoot).toLowerCase(),
);
const { qualifyAssets } = require('../../../src/main/session-context-windows-assets');
const { createPipe } = require('../../../src/main/claude-hook-windows-io-wire');
const profile = qualifyAssets(assets);
const digest = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readerBuild = readerProof.receipt;
const fixtureBuild = fixtureProof.receipt;
for (const [receipt, folder] of [
  [readerBuild, path.join(root, 'build')],
  [fixtureBuild, path.join(fixtureRoot, 'fixture-build')],
]) {
  assert.equal(receipt.result, 'PASS');
  assert.equal(receipt.sourceUnchanged, true);
  assert.equal(receipt.outputs.length, 4);
  const assembly = receipt.kind === 'reader' ? 'SessionContextReader' : 'TailFixture';
  const expected = ['exe', 'dll', 'deps.json', 'runtimeconfig.json'].map(
    (extension) => `${assembly}.${extension}`,
  );
  assert.deepEqual(receipt.outputs.map((pin) => pin.name).sort(), expected.sort());
  for (const pin of receipt.outputs) {
    const file = path.join(folder, pin.name);
    const stat = fs.lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
    assert.equal(digest(file), pin.sha256);
  }
  for (const pin of receipt.sources)
    assert.equal(digest(path.join(checkout, pin.name)), pin.sha256);
}
const directory = path.join(root, 'owned-native-tail');
fs.mkdirSync(directory);
const selected = path.join(directory, 'selected.bin');
const maxBytes = 512 * 1024;
const large = Buffer.alloc(maxBytes + 73);
for (let i = 0; i < large.length; i++) large[i] = (i * 31) % 251;
const rows = [];
const children = [];
const limits = { requestMs: 3000, sessionMs: 30000, cleanupMs: 3000 };
let activeCase = 'setup';
const write = (bytes) => fs.writeFileSync(selected, bytes);
const stamp = (row) =>
  JSON.stringify(
    ['kind', 'symlink', 'reparse', 'volumeId', 'fileId', 'size', 'mtimeNs', 'ctimeNs'].map(
      (key) => row[key],
    ),
  );

async function host(action, target = selected) {
  const child = spawn(profile.executable, [], {
    cwd: profile.cwd,
    env: profile.env,
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.push(child);
  const pipe = createPipe(child, limits);
  try {
    return await action(pipe);
  } finally {
    const cleanup = await pipe.close();
    assert.equal(cleanup.exit, 'confirmed');
    assert.equal(cleanup.streams, 'confirmed');
    assert.ok(child.exitCode !== null || child.signalCode !== null);
    assert.ok(child.stdin.closed && child.stdout.closed && child.stderr.closed);
    const unlocked = fs.openSync(target, 'r+');
    fs.closeSync(unlocked);
  }
}
async function test(name, action) {
  activeCase = name;
  const details = await action();
  rows.push({ name, result: 'PASS', ...(details ? { details } : {}) });
}
async function open(pipe, op = 'tail', target = selected) {
  return pipe.request({ op, path: target });
}
async function close(pipe) {
  assert.equal((await pipe.request({ op: 'close' })).closed, true);
}
async function readWindow(pipe, bytes, op) {
  const first = await open(pipe, op);
  assert.equal(first.size, bytes.length);
  assert.equal(stamp(await pipe.request({ op: 'stat', scope: 'handle' })), stamp(first));
  let position = op === 'tail' ? Math.max(0, bytes.length - maxBytes) : 0;
  let total = 0;
  while (position < bytes.length) {
    const length = Math.min(64 * 1024, bytes.length - position);
    const value = await pipe.request({ op: 'read', length, position });
    const raw = Buffer.from(value.data, 'base64');
    try {
      assert.ok(raw.length > 0 && raw.length <= length);
      assert.ok(raw.equals(bytes.subarray(position, position + raw.length)));
      total += raw.length;
      position += raw.length;
    } finally {
      raw.fill(0);
    }
  }
  assert.equal(total, Math.min(maxBytes, bytes.length));
  assert.equal((await pipe.request({ op: 'read', length: 1, position })).data, '');
  assert.equal(stamp(await pipe.request({ op: 'stat', scope: 'handle' })), stamp(first));
  assert.equal(stamp(await pipe.request({ op: 'stat', scope: 'path' })), stamp(first));
  return { position, total };
}
async function refused(name, request, before) {
  await test(name, async () => {
    write(large);
    await host(async (pipe) => {
      await open(pipe);
      if (before) await before(pipe);
      await assert.rejects(() => pipe.request(request));
    });
  });
}
try {
  await test('large-fixed-suffix-bytes-and-final-proof', async () => {
    write(large);
    await host(async (pipe) => {
      await readWindow(pipe, large, 'tail');
      await close(pipe);
    });
  });
  await test('legacy-complete-small-file', async () => {
    const small = large.subarray(0, 19);
    write(small);
    await host(async (pipe) => {
      await readWindow(pipe, small, 'open');
      await close(pipe);
    });
  });
  await test('tail-empty-file-eof', async () => {
    const empty = Buffer.alloc(0);
    write(empty);
    await host(async (pipe) => {
      await readWindow(pipe, empty, 'tail');
      await close(pipe);
    });
  });
  await test('legacy-complete-oversize-refused', async () => {
    write(large);
    await host((pipe) => assert.rejects(() => open(pipe, 'open')));
  });
  for (const [name, position] of [
    ['wrong-first', 0],
    ['gap', 74],
    ['negative', -1],
    ['fractional', 73.5],
    ['unsafe', 9007199254740992],
  ])
    await refused(`${name}-offset-refused`, { op: 'read', length: 1, position });
  await refused('rewind-refused', { op: 'read', length: 1, position: 73 }, (pipe) =>
    pipe.request({ op: 'read', length: 1, position: 73 }),
  );
  for (const length of [0, -1, 65537])
    await refused(`length-${length}-refused`, { op: 'read', length, position: 73 });
  await refused(
    'seventeenth-data-read-refused',
    { op: 'read', length: 1, position: 89 },
    async (pipe) => {
      for (let i = 0; i < 16; i++) await pipe.request({ op: 'read', length: 1, position: 73 + i });
    },
  );
  await test('repeated-eof-refused', async () => {
    write(large);
    await host(async (pipe) => {
      await readWindow(pipe, large, 'tail');
      await assert.rejects(() => pipe.request({ op: 'read', length: 1, position: large.length }));
    });
  });
  for (const [name, body] of [
    ['mode-field', { op: 'tail', path: selected, mode: 'tail' }],
    ['unknown-operation', { op: 'openTail', path: selected }],
    ['combined-transport-id', { id: 2, op: 'tail', path: selected }],
  ])
    await test(`${name}-refused`, async () => {
      write(large);
      await host((pipe) => assert.rejects(() => pipe.request(body)));
    });
  await refused('second-open-refused', { op: 'open', path: selected });
  await refused('second-tail-refused', { op: 'tail', path: selected });
  await test('active-writer-refused-without-intervention', async () => {
    write(large);
    const writer = fs.openSync(selected, 'r+');
    try {
      await host((pipe) => assert.rejects(() => open(pipe)));
    } finally {
      fs.closeSync(writer);
    }
  });
  await test('ancestor-rename-held-until-close', async () => {
    const folder = path.join(directory, 'held-parent');
    const renamed = folder + '-renamed';
    fs.mkdirSync(folder);
    const target = path.join(folder, 'selected.bin');
    fs.writeFileSync(target, large);
    fs.renameSync(folder, renamed);
    fs.renameSync(renamed, folder);
    await host(async (pipe) => {
      await open(pipe, 'tail', target);
      assert.throws(() => fs.renameSync(folder, renamed));
      await close(pipe);
    }, target);
    fs.renameSync(folder, renamed);
    fs.renameSync(renamed, folder);
  });
  await test('isolated-large-metadata-and-eof-controls', async () => {
    write(large);
    return runTailMetadataFixture(fixtureRoot, selected, profile.env);
  });
  for (const [receipt, folder] of [
    [readerBuild, path.join(root, 'build')],
    [fixtureBuild, path.join(fixtureRoot, 'fixture-build')],
  ])
    for (const pin of receipt.outputs)
      assert.equal(digest(path.join(folder, pin.name)), pin.sha256);
} catch {
  rows.push({ name: activeCase, result: 'FAIL' });
  process.exitCode = 1;
} finally {
  large.fill(0);
  const receipt = {
    at: new Date().toISOString(),
    result: process.exitCode ? 'FAIL' : 'PASS',
    machine: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      hostname: os.hostname(),
    },
    node: process.version,
    runtime: assets.runtimeVersion,
    sourceBase: readerBuild.sourceBase,
    readerBuildSha256: digest(path.join(root, 'reader-build.json')),
    fixtureBuildSha256: digest(path.join(fixtureRoot, 'fixture-build.json')),
    driverSha256: digest(fileURLToPath(import.meta.url)),
    scope:
      'Actual production apphost grammar/reads plus separately named isolated lease controls; no owner parser or live-profile qualification',
    productionHostChildren: children.length,
    rows,
  };
  fs.writeFileSync(path.join(root, 'native-tail-controls.json'), JSON.stringify(receipt, null, 2), {
    flag: 'wx',
  });
  console.log(
    JSON.stringify({
      result: receipt.result,
      controls: rows.length,
      productionHostChildren: children.length,
      failed: rows.filter((r) => r.result !== 'PASS').map((r) => r.name),
    }),
  );
}
