'use strict';

// Real native IO; scripted confirmation callbacks. Native UI is separate evidence.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createClaudeHookApp } = require('../../src/main/claude-hook-app');
const { createWindowsHookIO } = require('../../src/main/claude-hook-windows-io');
const root = path.resolve(__dirname, '../..');
const output = process.argv[2];
if (process.platform !== 'win32' || !output || !path.isAbsolute(output))
  throw Error('Requires Windows and a fresh absolute disposable output');
const receipt = {
  schemaVersion: 2,
  scope: 'disposable-profile-restart-targeted-removal',
  actualNativeIO: true,
  nativeUI: false,
  installedClaude: false,
  checks: [],
};
let stage = 'prepare';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function run() {
  await fs.mkdir(output); // Never adopt or overwrite an existing profile.
  const target = path.join(output, 'claude-hook-profile', 'settings.json');
  await fs.mkdir(path.dirname(target));
  await fs.writeFile(target, '{"hooks":{"PreToolUse":[]}}\n', { flag: 'wx' });
  const policy = path.join(output, 'policy.json');
  await fs.writeFile(
    policy,
    JSON.stringify({ schemaVersion: 1, cwd: output, defaultDecision: 'deny', rules: [] }),
    { flag: 'wx' },
  );
  const sources = [
    'src/main/claude-hook-app.js',
    'src/main/claude-hook-app-profile.js',
    'src/main/claude-hook-app-removal.js',
  ];
  receipt.sourceHashes = Object.fromEntries(
    await Promise.all(
      sources.map(async (file) => [file, hash(await fs.readFile(path.join(root, file)))]),
    ),
  );
  let approve = true,
    dialogs = 0;
  const sessions = [];
  const window = { isDestroyed: () => false };
  const options = {
    userData: output,
    assetsRoot: path.join(root, 'build/hook-review'),
    executable: require('electron'),
    appPath: root,
    getWindow: () => window,
    async makeIO(value) {
      const io = await createWindowsHookIO(value);
      sessions.push(io);
      return io;
    },
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [policy] };
      },
      async showMessageBox(_window, review) {
        assert.equal(review.defaultId, 0);
        assert.equal(review.cancelId, 0);
        assert(review.detail.includes(target));
        assert(!review.detail.includes('DISPOSABLE_PROFILE_CANARY'));
        if (dialogs > 0) assert(review.detail.includes('fresh authorization'));
        dialogs++;
        return { response: approve ? 1 : 0 };
      },
    },
  };
  let app = createClaudeHookApp(options);
  try {
    stage = 'native-availability';
    const available = await app.handle('status', () => true);
    assert.equal(available.available, true);
    assert.equal(sessions.length, 0);
    stage = 'initial-install-setup';
    assert.equal((await app.handle('install', () => true)).code, 'INSTALLED');
    const installed = JSON.parse(await fs.readFile(target, 'utf8')).hooks.PreToolUse[0];
    await app.close();
    assert.equal(sessions[0].status().exit, 'confirmed');
    const peer = '{"matcher":"Read","hooks":[{"type":"command","command":"echo fixture-only"}]}';
    const before = `{\r\n "private":"DISPOSABLE_PROFILE_CANARY", "hooks":{"PreToolUse":[${peer},${JSON.stringify(installed)},${peer}]}, "tail":7\r\n}\n`;
    const after = `{\r\n "private":"DISPOSABLE_PROFILE_CANARY", "hooks":{"PreToolUse":[${peer},${peer}]}, "tail":7\r\n}\n`;
    await fs.writeFile(target, before);
    app = createClaudeHookApp(options);
    stage = 'restart-status-without-native-session';
    const status = await app.handle('status', () => true);
    assert.equal(status.code, 'PROFILE_REVIEW_AVAILABLE');
    assert.equal(status.presence, 'Unknown');
    assert.equal(status.canRemove, false);
    assert.equal(status.canReviewExisting, true);
    assert.equal(sessions.length, 1);
    receipt.checks.push('restart-status-does-not-import-ownership-or-create-native-store');
    stage = 'cancel-fresh-native-backed-review';
    approve = false;
    assert.equal((await app.handle('remove', () => true)).code, 'CANCELLED');
    assert.equal(await fs.readFile(target, 'utf8'), before);
    receipt.checks.push('cancel-fresh-review-preserves-all-current-bytes');
    stage = 'confirm-fresh-native-backed-removal';
    approve = true;
    const removed = await app.handle('remove', () => true);
    assert.equal(removed.code, 'OBSERVED_REMOVED');
    assert.equal(removed.canRemove, false);
    assert.equal(removed.canReviewExisting, false);
    assert.equal(await fs.readFile(target, 'utf8'), after);
    receipt.checks.push('fresh-removal-preserves-exact-unrelated-UTF8-CRLF-bytes');
    stage = 'retained-encrypted-backups';
    const stores = await fs.readdir(path.join(output, 'claude-hook-profile/backups'));
    assert.equal(stores.length, 2);
    let records = 0;
    for (const store of stores) {
      const folder = path.join(output, 'claude-hook-profile/backups', store);
      for (const name of (await fs.readdir(folder)).filter((name) => name.endsWith('.rec'))) {
        records++;
        const value = await fs.readFile(path.join(folder, name));
        assert(!value.includes(Buffer.from('DISPOSABLE_PROFILE_CANARY')));
        assert(!value.includes(Buffer.from(policy)));
      }
    }
    assert.equal(records, 2);
    assert.equal(dialogs, 3);
    receipt.checks.push('fresh-and-original-private-backups-retained-without-plaintext-canaries');
  } finally {
    await app.close();
  }
  stage = 'native-session-release';
  receipt.nativeSessions = sessions.map((io) => io.status());
  assert.equal(sessions.length, 2);
  for (const io of receipt.nativeSessions)
    assert.deepEqual(io, { admission: 'closed', exit: 'confirmed', streams: 'confirmed' });
  receipt.checks.push('both-owned-native-sessions-released');
  receipt.complete = true;
  await fs.writeFile(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {
    flag: 'wx',
  });
  console.log(JSON.stringify(receipt));
}
run().catch(async () => {
  receipt.complete = false;
  receipt.failureStage = stage;
  await fs
    .writeFile(path.join(output, 'failure.json'), JSON.stringify(receipt, null, 2) + '\n', {
      flag: 'wx',
    })
    .catch(() => {});
  console.error(
    'Disposable targeted-removal qualification failed at ' + stage + '; private files retained.',
  );
  process.exitCode = 1;
});
