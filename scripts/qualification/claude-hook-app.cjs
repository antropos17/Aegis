'use strict';

// Disposable profile qualification of the real native IO and owner review.
// Dialog callbacks are scripted here; real desktop confirmation is separate evidence.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createClaudeHookApp } = require('../../src/main/claude-hook-app');
const root = path.resolve(__dirname, '../..');
const output = process.argv[2];
if (process.platform !== 'win32' || !output || !path.isAbsolute(output))
  throw Error('Requires Windows and a fresh absolute disposable output');

async function run() {
  await fs.mkdir(output); // Never adopt or overwrite an existing profile.
  const target = path.join(output, 'claude-hook-profile', 'settings.json');
  await fs.mkdir(path.dirname(target));
  const before = Buffer.from(
    '{ "private": "DISPOSABLE_PROFILE_CANARY", "hooks": {"PreToolUse":[]} }\n',
  );
  await fs.writeFile(target, before, { flag: 'wx' });
  const policy = path.join(output, 'policy.json');
  await fs.writeFile(
    policy,
    JSON.stringify({ schemaVersion: 1, cwd: output, defaultDecision: 'deny', rules: [] }),
    { flag: 'wx' },
  );
  let approve = false;
  let dialogs = 0;
  const executable = require('electron');
  const window = { isDestroyed: () => false };
  const app = createClaudeHookApp({
    userData: output,
    assetsRoot: path.join(root, 'build/hook-review'),
    executable,
    appPath: root,
    getWindow: () => window,
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [policy] };
      },
      async showMessageBox(_window, review) {
        assert.equal(review.defaultId, 0);
        assert.equal(review.cancelId, 0);
        assert(review.detail.includes(target));
        assert(!review.detail.includes('DISPOSABLE_PROFILE_CANARY'));
        dialogs++;
        return { response: approve ? 1 : 0 };
      },
    },
  });
  const receipt = {
    schemaVersion: 1,
    scope: 'disposable-profile-real-Windows-IO-scripted-dialogs',
    checks: [],
  };
  try {
    assert.equal((await app.handle('status', () => true)).code, 'READY');
    assert.equal((await app.handle('install', () => true)).code, 'CANCELLED');
    assert.deepEqual(await fs.readFile(target), before);
    receipt.checks.push('cancel-preserves-exact-target');
    approve = true;
    const installed = await app.handle('install', () => true);
    assert.equal(installed.code, 'INSTALLED');
    assert.equal(installed.canRemove, true);
    const profile = JSON.parse(await fs.readFile(target, 'utf8'));
    assert.equal(profile.hooks.PreToolUse.length, 1);
    assert.equal(profile.hooks.PreToolUse[0].matcher, 'Bash');
    receipt.checks.push('confirmed-native-backed-install-readback');
    const hookEnv = { ...process.env };
    delete hookEnv.ELECTRON_RUN_AS_NODE;
    const decision = JSON.parse(
      execFileSync(executable, [root, '--action-policy-hook', policy], {
        env: hookEnv,
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 65536,
        input: JSON.stringify({
          cwd: output,
          tool_name: 'Bash',
          tool_input: { command: 'echo disposable' },
        }),
        encoding: 'utf8',
      }),
    );
    assert.equal(decision.hookSpecificOutput.permissionDecision, 'deny');
    receipt.checks.push('actual-Electron-hook-route-denies-selected-request');
    assert.equal((await app.handle('remove', () => true)).code, 'REMOVED');
    assert.deepEqual(await fs.readFile(target), before);
    receipt.checks.push('confirmed-native-backed-exact-rollback');
    const sessions = await fs.readdir(path.join(output, 'claude-hook-profile/backups'));
    const records = (
      await fs.readdir(path.join(output, 'claude-hook-profile/backups', sessions[0]))
    ).filter((name) => name.endsWith('.rec'));
    assert.equal(records.length, 2);
    for (const name of records) {
      const value = await fs.readFile(
        path.join(output, 'claude-hook-profile/backups', sessions[0], name),
      );
      assert(!value.includes(Buffer.from('DISPOSABLE_PROFILE_CANARY')));
      assert(!value.includes(Buffer.from(policy)));
    }
    receipt.checks.push('two-retained-records-exclude-plaintext-canaries');
    assert.equal(dialogs, 3);
  } finally {
    await app.close();
  }
  receipt.complete = true;
  await fs.writeFile(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {
    flag: 'wx',
  });
  console.log(JSON.stringify(receipt));
}
run().catch(() => {
  console.error('Disposable hook profile qualification failed; private files retained.');
  process.exitCode = 1;
});
