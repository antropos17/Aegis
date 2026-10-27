'use strict';

// Disposable real-native-host fixture; dialogs are scripted, not owner acceptance.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createClaudeHookApp } = require('../../src/main/claude-hook-app');
const { createWindowsPolicyIO } = require('../../src/main/claude-hook-windows-io');
const root = path.resolve(__dirname, '../..');
const output = process.argv[2];
const assetsRoot = process.argv[3];
const receipt = {
  schemaVersion: 1,
  scope: 'disposable-project-policy-real-native-host',
  nativeUI: false,
  provider: false,
  checks: [],
};
let stage = 'admission';

async function run() {
  if (
    process.platform !== 'win32' ||
    !output ||
    !path.isAbsolute(output) ||
    !assetsRoot ||
    !path.isAbsolute(assetsRoot)
  )
    throw Error('requires Windows and absolute fixture paths');
  await fs.mkdir(output); // Never adopt an existing fixture.
  const userData = path.join(output, 'app-data');
  const scope = path.join(output, 'project');
  await fs.mkdir(userData);
  await fs.mkdir(scope);
  const destination = path.join(userData, 'claude-hook-profile');
  const target = path.join(destination, 'settings.json');
  const normalizedScope = scope.replace(/^[a-z](?=:)/, (letter) => letter.toUpperCase());
  let approve = false;
  const sessions = [];
  const window = { isDestroyed: () => false };
  const app = createClaudeHookApp({
    userData,
    assetsRoot,
    executable: require('electron'),
    appPath: root,
    getWindow: () => window,
    makePolicyIO: async (options) => {
      const io = await createWindowsPolicyIO(options);
      sessions.push(io);
      return io;
    },
    dialog: {
      showOpenDialog: async (_window, options) => {
        assert.deepEqual(options.properties, ['openDirectory']);
        return { canceled: false, filePaths: [scope] };
      },
      showMessageBox: async (_window, review) => {
        assert.equal(review.defaultId, 0);
        assert.equal(review.cancelId, 0);
        if (review.message === 'Install the reviewed Claude hook profile?') {
          assert(review.detail.includes('"schemaVersion": 2'));
          assert(review.detail.includes(JSON.stringify(normalizedScope)));
          assert(review.detail.includes('id_rsa and id_ed25519'));
        }
        return { response: approve ? 1 : 0 };
      },
    },
  });
  try {
    stage = 'availability';
    assert.equal((await app.handle('status', () => true)).available, true);
    stage = 'cancel';
    assert.equal((await app.handle('install-project-policy', () => true)).code, 'CANCELLED');
    assert(!(await fs.readdir(destination)).some((name) => name.startsWith('project-policy-')));
    assert.deepEqual(await fs.readFile(target), Buffer.from('{}\n'));
    receipt.checks.push('native-lease-cancel-no-policy-or-profile-write');
    stage = 'confirmed-create-and-profile';
    approve = true;
    assert.equal((await app.handle('install-project-policy', () => true)).code, 'INSTALLED');
    const names = (await fs.readdir(destination)).filter((name) =>
      /^project-policy-[0-9a-f-]+\.json$/.test(name),
    );
    assert.equal(names.length, 1);
    const policy = path.join(destination, names[0]);
    assert.deepEqual(JSON.parse(await fs.readFile(policy, 'utf8')), {
      schemaVersion: 2,
      cwd: normalizedScope,
      profile: 'aegis-windows-project-review-v1',
    });
    assert((await fs.readFile(target, 'utf8')).includes(policy.replaceAll('\\', '/')));
    receipt.checks.push('create-new-readback-and-profile-adoption');
    stage = 'remove';
    assert.equal((await app.handle('remove', () => true)).code, 'REMOVED');
    assert.deepEqual(await fs.readFile(target), Buffer.from('{}\n'));
    receipt.checks.push('existing-profile-removal-restores-original-bytes');
    receipt.policySha256 = createHash('sha256')
      .update(await fs.readFile(policy))
      .digest('hex');
  } finally {
    await app.close();
  }
  assert.equal(sessions.length, 2);
  for (const session of sessions) assert.equal(session.status().exit, 'confirmed');
  receipt.checks.push('native-creation-processes-released');
  receipt.sourceHashes = Object.fromEntries(
    await Promise.all(
      [
        'scripts/qualification/claude-project-policy.cjs',
        'src/main/claude-hook-app.js',
        'src/main/claude-hook-app-profile.js',
        'src/main/claude-hook-windows-io.js',
        'src/main/claude-hook-windows-io-wire.js',
        'sidecar/hook-config-target/CreateLease.cs',
        'sidecar/hook-config-target/TargetPath.cs',
        'sidecar/hook-config-target/Native.cs',
        'sidecar/hook-transaction/Transaction.cs',
      ].map(async (file) => [
        file,
        createHash('sha256')
          .update(await fs.readFile(path.join(root, file)))
          .digest('hex'),
      ]),
    ),
  );
  receipt.assetDescriptorSha256 = createHash('sha256')
    .update(await fs.readFile(path.join(assetsRoot, 'assets.json')))
    .digest('hex');
  receipt.complete = true;
  await fs.writeFile(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {
    flag: 'wx',
  });
  console.log(JSON.stringify(receipt));
}

run().catch(async () => {
  receipt.complete = false;
  receipt.failureStage = stage;
  if (output && path.isAbsolute(output))
    await fs
      .writeFile(path.join(output, 'failure.json'), JSON.stringify(receipt, null, 2) + '\n', {
        flag: 'wx',
      })
      .catch(() => {});
  console.error(
    'Disposable project-policy qualification failed at ' + stage + '; fixture retained.',
  );
  process.exitCode = 1;
});
