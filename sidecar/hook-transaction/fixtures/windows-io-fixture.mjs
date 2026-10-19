import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const { createWindowsHookIO } = require('../../../src/main/claude-hook-windows-io');
const { qualifyAssets, MAX_FRAME } = require('../../../src/main/claude-hook-windows-io-wire');
const { createOwnedHookWriter } = require('../../../src/main/claude-hook-writer');
const { CONTRACT } = require('../../../src/main/claude-hook-plan');
const [rootArgument, assetsArgument] = process.argv.slice(2);
if (process.argv.length !== 4 || !path.isAbsolute(rootArgument) || fs.existsSync(rootArgument))
  throw Error('fixture-selection-invalid');
const root = path.win32.normalize(rootArgument);
if (!/^[A-Z]:\\/.test(root) || !/^windows-io-fixture-[a-z0-9-]+$/.test(path.basename(root)))
  throw Error('fixture-selection-invalid');
fs.mkdirSync(root);
const assets = JSON.parse(fs.readFileSync(assetsArgument, 'utf8'));
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const original = Buffer.from(
  ' {\r\n "fixture":"never a profile", "unicode":"é😀", "hooks":{"PreToolUse":[]}\r\n}\r\n',
);
const selection = {
  command: 'AEGIS_INERT_FIXTURE_NEVER_EXECUTE',
  contract: CONTRACT,
  timeoutSeconds: 5,
};
const results = [],
  sessions = [];
let sequence = 0;
const binaryHashes = () =>
  assets.hostFiles.map(({ name }) => ({
    name,
    sha256: sha(fs.readFileSync(path.join(assets.hostRoot, name))),
  }));
const beforeBinaries = binaryHashes();

async function session() {
  const directory = path.join(root, `case-${++sequence}`);
  fs.mkdirSync(directory);
  const targetPath = path.join(directory, 'settings-fixture.json');
  fs.writeFileSync(targetPath, original, { flag: 'wx' });
  const backupRoot = path.join(directory, 'private-backups');
  const io = await createWindowsHookIO({
    ownedFixture: true,
    targetPath,
    backupRoot,
    assets,
    requestMs: 3000,
    sessionMs: 60000,
    cleanupMs: 2000,
  });
  const state = {
    io,
    targetPath,
    backupRoot,
    writer: createOwnedHookWriter({ configPath: targetPath, io }),
  };
  sessions.push(state);
  return state;
}
async function close(state) {
  const result = await state.io.close();
  assert.deepEqual(result, { admission: 'closed', exit: 'confirmed', streams: 'confirmed' });
}
async function install(state) {
  const preview = await state.writer.prepareInstall(selection);
  assert.equal(preview.code, 'REVIEW_REQUIRED');
  assert.deepEqual(fs.readFileSync(state.targetPath), original);
  assert.equal((await state.writer.apply(preview.ticket, false)).code, 'INVALID_APPROVAL');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await state.writer.apply(preview.ticket, true)).code, 'INSTALLED');
  assert.ok(fs.readFileSync(state.targetPath, 'utf8').includes(selection.command));
  const records = fs.readdirSync(state.backupRoot).filter((name) => name.endsWith('.rec'));
  assert.equal(records.length, 1);
  assert.equal(fs.readFileSync(path.join(state.backupRoot, records[0])).includes(original), false);
  return preview;
}
async function scenario(name, action) {
  try {
    await action();
    results.push({ name, status: 'pass' });
  } catch {
    results.push({ name, status: 'fail' });
  }
}

await scenario('real-writer-install-removal-exact-original-bytes', async () => {
  const state = await session();
  await install(state);
  const removal = await state.writer.prepareRemoval();
  assert.equal(removal.code, 'REVIEW_REQUIRED');
  assert.equal(removal.review.mode, 'exact-rollback');
  assert.equal((await state.writer.apply({}, true)).code, 'INVALID_APPROVAL');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await state.writer.apply(removal.ticket, true)).code, 'REMOVED');
  assert.deepEqual(fs.readFileSync(state.targetPath), original);
  assert.equal(fs.readdirSync(state.backupRoot).filter((name) => name.endsWith('.rec')).length, 2);
  await close(state);
});
await scenario('unrelated-concurrent-edit-targeted-removal', async () => {
  const state = await session();
  await install(state);
  const current = fs
    .readFileSync(state.targetPath, 'utf8')
    .replace('never a profile', 'concurrent unrelated edit');
  fs.writeFileSync(state.targetPath, current);
  const removal = await state.writer.prepareRemoval();
  assert.equal(removal.code, 'REVIEW_REQUIRED');
  assert.equal(removal.review.mode, 'targeted-removal');
  assert.equal((await state.writer.apply(removal.ticket, true)).code, 'REMOVED');
  assert.equal(fs.readFileSync(state.targetPath, 'utf8').includes(selection.command), false);
  assert.equal(
    fs.readFileSync(state.targetPath, 'utf8').includes('concurrent unrelated edit'),
    true,
  );
  await close(state);
});
await scenario('fresh-reads-and-stale-content-refusal', async () => {
  const state = await session();
  const first = await state.io.readTarget();
  const changed = Buffer.from('{"fixture":"changed-before-commit"}');
  fs.writeFileSync(state.targetPath, changed);
  assert.deepEqual((await state.io.readTarget()).bytes, changed);
  assert.equal(
    await state.io.compareAndWrite({
      identity: first.identity,
      beforeBytes: first.bytes,
      afterBytes: Buffer.from('{}'),
    }),
    'stale',
  );
  assert.deepEqual(fs.readFileSync(state.targetPath), changed);
  await close(state);
});
await scenario('writer-stale-review-content-refusal', async () => {
  const state = await session();
  const preview = await state.writer.prepareInstall(selection);
  const changed = Buffer.from('{"fixture":"changed-after-review"}');
  fs.writeFileSync(state.targetPath, changed);
  assert.equal((await state.writer.apply(preview.ticket, true)).code, 'TARGET_CHANGED');
  assert.deepEqual(fs.readFileSync(state.targetPath), changed);
  await close(state);
});
await scenario('equal-content-replaced-identity-through-review', async () => {
  const state = await session();
  const first = await state.io.readTarget();
  const preview = await state.writer.prepareInstall(selection);
  fs.renameSync(state.targetPath, state.targetPath + '.original');
  fs.writeFileSync(state.targetPath, original, { flag: 'wx' });
  const replacement = await state.io.readTarget();
  assert.notEqual(replacement.identity, first.identity);
  assert.equal((await state.writer.apply(preview.ticket, true)).code, 'TARGET_IDENTITY_CHANGED');
  assert.equal(
    await state.io.compareAndWrite({
      identity: first.identity,
      beforeBytes: first.bytes,
      afterBytes: Buffer.from('{}'),
    }),
    'stale',
  );
  assert.equal(
    await state.io.compareAndWrite({
      identity: replacement.identity,
      beforeBytes: replacement.bytes,
      afterBytes: Buffer.from('{}'),
    }),
    'stale',
  );
  assert.deepEqual(fs.readFileSync(state.targetPath), original);
  await close(state);
});
await scenario('original-witness-survives-install-commit-and-removal-review', async () => {
  const state = await session();
  await install(state);
  const installed = fs.readFileSync(state.targetPath);
  fs.renameSync(state.targetPath, state.targetPath + '.installed');
  fs.writeFileSync(state.targetPath, installed, { flag: 'wx' });
  assert.equal((await state.writer.prepareRemoval()).code, 'TARGET_IDENTITY_CHANGED');
  assert.deepEqual(fs.readFileSync(state.targetPath), installed);
  await close(state);
});
await scenario('tampered-backup-refused-before-target-write', async () => {
  const state = await session();
  await install(state);
  const before = fs.readFileSync(state.targetPath);
  const record = fs.readdirSync(state.backupRoot).find((name) => name.endsWith('.rec'));
  const recordPath = path.join(state.backupRoot, record);
  const cipher = fs.readFileSync(recordPath);
  cipher[0] ^= 1;
  fs.writeFileSync(recordPath, cipher);
  assert.equal((await state.writer.prepareRemoval()).code, 'BACKUP_FAILED');
  assert.deepEqual(fs.readFileSync(state.targetPath), before);
  assert.equal(state.io.status().admission, 'closed');
  await close(state);
});
await scenario('opaque-foreign-and-unissued-references', async () => {
  const first = await session(),
    second = await session();
  const ref = await first.io.retainPrivate({ bytes: original, manifest: 'fixture-manifest' });
  assert.deepEqual(Object.keys(ref), []);
  await assert.rejects(second.io.readPrivate(ref), { message: 'private-windows-io-failed' });
  await assert.rejects(first.io.readPrivate({}), { message: 'private-windows-io-failed' });
  assert.deepEqual(await first.io.readPrivate(ref), {
    bytes: original,
    manifest: 'fixture-manifest',
  });
  await close(first);
  await close(second);
});
await scenario('closed-session-has-no-reference-import-or-storage-adoption', async () => {
  const state = await session();
  const ref = await state.io.retainPrivate({
    bytes: original,
    manifest: 'private fixture ownership',
  });
  const inventory = fs
    .readdirSync(state.backupRoot)
    .map((name) => ({ name, sha256: sha(fs.readFileSync(path.join(state.backupRoot, name))) }));
  await close(state);
  await assert.rejects(state.io.readPrivate(ref), { message: 'private-windows-io-failed' });
  await assert.rejects(
    createWindowsHookIO({
      ownedFixture: true,
      targetPath: state.targetPath,
      backupRoot: state.backupRoot,
      assets,
      requestMs: 3000,
      sessionMs: 10000,
      cleanupMs: 2000,
    }),
    { message: 'private-windows-io-failed' },
  );
  assert.deepEqual(
    fs
      .readdirSync(state.backupRoot)
      .map((name) => ({ name, sha256: sha(fs.readFileSync(path.join(state.backupRoot, name))) })),
    inventory,
  );
  assert.deepEqual(fs.readFileSync(state.targetPath), original);
});
await scenario('eight-record-quota-and-terminal-retention', async () => {
  const state = await session();
  for (let index = 0; index < 8; index++)
    await state.io.retainPrivate({ bytes: original, manifest: 'fixture' });
  await assert.rejects(state.io.retainPrivate({ bytes: original, manifest: 'fixture' }), {
    message: 'private-windows-io-failed',
  });
  assert.equal(fs.readdirSync(state.backupRoot).filter((name) => name.endsWith('.rec')).length, 8);
  await assert.rejects(state.io.readTarget(), { message: 'private-windows-io-failed' });
  assert.deepEqual(fs.readFileSync(state.targetPath), original);
  await close(state);
});

for (const mode of ['stream', 'child_process', 'net', 'worker', 'node-options'])
  await scenario(`cached-debug-${mode}-refusal-before-private-spawn`, async () => {
    const directory = path.join(root, `case-${++sequence}`);
    fs.mkdirSync(directory);
    const canary = `AEGIS_INERT_PIPE_CANARY_${mode.toUpperCase()}`;
    fs.writeFileSync(path.join(directory, 'settings-fixture.json'), JSON.stringify({ canary }), {
      flag: 'wx',
    });
    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          path.join(import.meta.dirname, 'private-mode-fixture.mjs'),
          directory,
          assetsArgument,
          mode,
        ],
        {
          windowsHide: true,
          shell: false,
          env: {
            ...process.env,
            NODE_DEBUG: mode === 'node-options' ? '' : mode,
            NODE_OPTIONS: mode === 'node-options' ? '--no-warnings' : '',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let output = '',
        diagnostics = '',
        overflow = false;
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(Error('fixture-timeout'));
      }, 5000);
      for (const [stream, key] of [
        [child.stdout, 'out'],
        [child.stderr, 'err'],
      ])
        stream.on('data', (bytes) => {
          if (output.length + diagnostics.length + bytes.length > 256 * 1024) {
            overflow = true;
            child.kill('SIGKILL');
            return;
          }
          if (key === 'out') output += bytes.toString();
          else diagnostics += bytes.toString();
        });
      child.on('error', () => {
        clearTimeout(timer);
        reject(Error('fixture-spawn-failed'));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, output, diagnostics, overflow });
      });
    });
    assert.equal(result.code, 0);
    assert.equal(result.overflow, false);
    const body = JSON.parse(result.output.trim());
    assert.equal(body.refused, true);
    assert.equal(body.untouched, true);
    assert.equal(result.diagnostics.includes(canary), false);
    assert.equal(result.diagnostics.includes(Buffer.from(canary).toString('base64')), false);
  });

for (const [name, change] of [
  [
    'host-hash',
    (value) => {
      value.hostFiles[0].sha256 = '0'.repeat(64);
    },
  ],
  [
    'executable-hash',
    (value) => {
      value.executableSha256 = '0'.repeat(64);
    },
  ],
  [
    'runtime-hash',
    (value) => {
      value.runtimeFiles[0].sha256 = '0'.repeat(64);
    },
  ],
  [
    'runtime-version',
    (value) => {
      value.runtimeVersion = '10.0.9';
    },
  ],
])
  await scenario(`pinned-asset-${name}-refusal`, async () => {
    const directory = path.join(root, `case-${++sequence}`);
    fs.mkdirSync(directory);
    const targetPath = path.join(directory, 'settings-fixture.json');
    fs.writeFileSync(targetPath, original, { flag: 'wx' });
    const backupRoot = path.join(directory, 'private-backups');
    const altered = structuredClone(assets);
    change(altered);
    await assert.rejects(
      createWindowsHookIO({
        ownedFixture: true,
        targetPath,
        backupRoot,
        assets: altered,
        requestMs: 3000,
        sessionMs: 10000,
        cleanupMs: 2000,
      }),
      { message: 'private-windows-io-failed' },
    );
    assert.equal(fs.existsSync(backupRoot), false);
    assert.deepEqual(fs.readFileSync(targetPath), original);
  });

await scenario('unlisted-host-load-folder-file-refused', async () => {
  const directory = path.join(root, `case-${++sequence}`);
  fs.mkdirSync(directory);
  const loadRoot = path.join(directory, 'load');
  fs.mkdirSync(loadRoot);
  for (const { name } of assets.hostFiles)
    fs.copyFileSync(
      path.join(assets.hostRoot, name),
      path.join(loadRoot, name),
      fs.constants.COPYFILE_EXCL,
    );
  fs.writeFileSync(path.join(loadRoot, 'unlisted.inert'), 'never executable', { flag: 'wx' });
  assert.throws(() => qualifyAssets({ ...assets, hostRoot: loadRoot }), {
    message: 'private-windows-io-failed',
  });
});

await scenario('actual-host-session-deadline-is-terminal-and-preserves-target', async () => {
  const directory = path.join(root, `case-${++sequence}`);
  fs.mkdirSync(directory);
  const targetPath = path.join(directory, 'settings-fixture.json');
  fs.writeFileSync(targetPath, original, { flag: 'wx' });
  const backupRoot = path.join(directory, 'private-backups');
  const io = await createWindowsHookIO({
    ownedFixture: true,
    targetPath,
    backupRoot,
    assets,
    requestMs: 1000,
    sessionMs: 1000,
    cleanupMs: 2000,
  });
  assert.deepEqual((await io.readTarget()).bytes, original);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(io.status().admission, 'closed');
  await assert.rejects(io.readTarget(), { message: 'private-windows-io-failed' });
  assert.deepEqual(await io.close(), {
    admission: 'closed',
    exit: 'confirmed',
    streams: 'confirmed',
  });
  assert.deepEqual(fs.readFileSync(targetPath), original);
  assert.equal(fs.readdirSync(backupRoot).filter((name) => name.endsWith('.rec')).length, 0);
});

await scenario('maximum-pipe-payload-and-actual-two-mib-ciphertext-quota', async () => {
  const state = await session();
  const bytes = Buffer.alloc(262144, 65),
    manifest = 'M'.repeat(16384);
  fs.writeFileSync(state.targetPath, bytes);
  const snapshot = await state.io.readTarget();
  assert.deepEqual(snapshot.bytes, bytes);
  const ref = await state.io.retainPrivate({ bytes, manifest });
  assert.deepEqual(await state.io.readPrivate(ref), { bytes, manifest });
  const after = Buffer.alloc(262144, 66);
  assert.equal(
    await state.io.compareAndWrite({
      identity: snapshot.identity,
      beforeBytes: bytes,
      afterBytes: after,
    }),
    'written',
  );
  assert.deepEqual((await state.io.readTarget()).bytes, after);
  for (let index = 0; index < 6; index++) await state.io.retainPrivate({ bytes, manifest });
  await assert.rejects(state.io.retainPrivate({ bytes, manifest }), {
    message: 'private-windows-io-failed',
  });
  const records = fs.readdirSync(state.backupRoot).filter((name) => name.endsWith('.rec'));
  assert.equal(records.length, 7);
  const retained = records.reduce(
    (sum, name) => sum + fs.statSync(path.join(state.backupRoot, name)).size,
    0,
  );
  assert.ok(retained <= 2 * 1024 * 1024);
  assert.deepEqual(fs.readFileSync(state.targetPath), after);
  await close(state);
});

// Raw host protocol cases never receive a target/backup path or open a transaction.
function frame(text) {
  const body = Buffer.from(text);
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  return Buffer.concat([head, body]);
}
async function raw(input) {
  const qualified = qualifyAssets(assets);
  return new Promise((resolve, reject) => {
    const child = spawn(qualified.executable, qualified.args, {
      cwd: qualified.cwd,
      env: qualified.env,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = 0,
      diagnostic = 0;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(Error('fixture-timeout'));
    }, 3000);
    child.stdout.on('data', (bytes) => {
      output += bytes.length;
      if (output > 256) child.kill('SIGKILL');
    });
    child.stderr.on('data', (bytes) => {
      diagnostic += bytes.length;
    });
    child.stdin.on('error', () => {});
    child.on('error', () => {
      clearTimeout(timer);
      reject(Error('fixture-spawn-failed'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output, diagnostic });
    });
    child.stdin.end(input);
  });
}
for (const [name, bytes] of [
  ['malformed-json', frame('{broken')],
  ['duplicate-key', frame('{"id":1,"id":1,"op":"read"}')],
  ['unexpected-field', frame('{"id":1,"op":"read","extra":true}')],
  ['wrong-operation', frame('{"id":1,"op":"execute"}')],
  ['non-monotonic-request', frame('{"id":2,"op":"read"}')],
  ['truncated-prefix', Buffer.from([1, 2])],
  ['truncated-body', Buffer.from([10, 0, 0, 0, 123])],
  [
    'overflow-frame',
    (() => {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(MAX_FRAME + 1);
      return b;
    })(),
  ],
  ['invalid-utf8', Buffer.from([1, 0, 0, 0, 255])],
])
  await scenario(`host-protocol-${name}`, async () => {
    const result = await raw(bytes);
    assert.equal(result.code, 2);
    assert.equal(result.diagnostic, 0);
    assert.ok(result.output <= 64);
  });

for (const state of sessions) await state.io.close();
const afterBinaries = binaryHashes();
assert.deepEqual(afterBinaries, beforeBinaries);
const receipt = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  fixture: 'owned-inert-only',
  commandExecuted: false,
  launchAllowed: false,
  cases: results.length,
  passed: results.filter((row) => row.status === 'pass').length,
  results,
  beforeBinaries,
  afterBinaries,
  artifactsRetained: true,
};
fs.writeFileSync(path.join(root, 'fixture-receipt.json'), JSON.stringify(receipt, null, 2), {
  flag: 'wx',
});
console.log(
  JSON.stringify({
    fixture: 'windows-io',
    cases: receipt.cases,
    passed: receipt.passed,
    commandExecuted: false,
    launchAllowed: false,
    binaryHashesUnchanged: true,
  }),
);
if (receipt.passed !== receipt.cases) process.exitCode = 1;
