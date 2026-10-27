'use strict';

// Provider-free qualification of an explicitly supplied Windows unpacked candidate.
// Usage: node scripts/qualification/packaged-claude-hook.cjs <exe> <git-bash> <new-output>
// The output parent must already exist. Only an owned disposable profile is modified.
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const http = require('node:http');
const { extractFile } = require('@electron/asar');
const { boundedChild } = require('./claude-hook-app.cjs');
const { profileCommand } = require('../../src/main/claude-hook-app-profile');
const { createClaudeHookApp } = require('../../src/main/claude-hook-app');
const { createWindowsHookIO } = require('../../src/main/claude-hook-windows-io');
const { startClaudeGuardReceiver } = require('../../src/main/claude-guard-receiver');

const root = path.resolve(__dirname, '../..');
const [exeArg, bashArg, outputArg] = process.argv.slice(2);
const output = outputArg && path.isAbsolute(outputArg) ? path.resolve(outputArg) : null;
const receipt = {
  schemaVersion: 1,
  scope: 'windows-unpacked-asar-hook-transport-and-packaged-native-assets',
  providerAttempted: false,
  actualNativeDialog: false,
  actualInstalledApplication: false,
  scriptedConfirmation: true,
  launchAllowed: false,
  cases: [],
};
let stage = 'preflight';
let outputCreated = false;

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Compare the profile sources in an actual archive against the selected checkout.
 * @param {string} archive Candidate app.asar. @param {string} sourceRoot Checkout root.
 * @returns {Promise<void>} Resolves only when every selected source matches.
 * @since v0.21.0 */
async function assertArchivedProfileSourcesMatch(archive, sourceRoot) {
  const sourceFiles = (await fs.readdir(path.join(sourceRoot, 'src/main')))
    .filter((name) => /^claude-hook.*\.js$/.test(name))
    .concat(
      'action-policy.js',
      'action-policy-hook.js',
      'command-hook-input.js',
      'claude-guard-report.js',
      'claude-guard-receiver.js',
      'cli.js',
      'main.js',
    );
  for (const name of sourceFiles) {
    const source = path.join('src', 'main', name);
    assert.deepEqual(
      extractFile(archive, source),
      await fs.readFile(path.join(sourceRoot, source)),
    );
  }
}

async function regular(file) {
  const stat = await fs.lstat(file);
  assert(stat.isFile() && !stat.isSymbolicLink());
  return stat;
}

async function unlinkedDirectory(directory) {
  let cursor = path.resolve(directory);
  for (;;) {
    const stat = await fs.lstat(cursor);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Output ancestor must be a directory');
    const parent = path.dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

async function assetHashes(directory, relative = '') {
  const rows = [];
  for (const entry of (
    await fs.readdir(path.join(directory, relative), { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path.join(relative, entry.name);
    assert(!entry.isSymbolicLink(), 'Packaged assets must not contain links');
    if (entry.isDirectory()) rows.push(...(await assetHashes(directory, name)));
    else {
      assert(entry.isFile(), 'Packaged asset must be a regular file');
      rows.push([name.replaceAll('\\', '/'), await digest(path.join(directory, name))]);
    }
  }
  return rows;
}

async function child(executable, args, options) {
  const started = performance.now();
  const result = await boundedChild(executable, args, options);
  const evidence = {
    exitCode: result.code,
    terminated: result.terminated,
    cleanupConfirmed: result.cleanupConfirmed,
    elapsedMs: Math.round(performance.now() - started),
    stdoutBytes: result.stdoutBytes,
    stderrBytes: result.stderrBytes,
  };
  if (!result.cleanupConfirmed) {
    receipt.ownedChildCleanupUnconfirmed = { ...evidence, pid: result.ownedPid };
    result.stdout.fill(0);
    throw Error('Owned child cleanup unconfirmed');
  }
  return { result, evidence };
}

function post(receiver, route, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: receiver.port,
        method: 'POST',
        path: `/${route}/${receiver.sessionId}`,
        agent: false,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ code: res.statusCode, body: Buffer.concat(chunks).toString() }),
        );
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

async function run() {
  assert.equal(process.platform, 'win32');
  assert.equal(process.argv.length, 5);
  assert(exeArg && path.isAbsolute(exeArg) && bashArg && path.isAbsolute(bashArg) && output);
  const exe = path.resolve(exeArg);
  const bash = path.resolve(bashArg);
  const asar = path.join(path.dirname(exe), 'resources', 'app.asar');
  assert.equal(path.basename(exe).toLowerCase(), 'aegis - ai monitoring & threat detection.exe');
  assert.equal(path.basename(bash).toLowerCase(), 'bash.exe');
  const shellDirectory = path.basename(path.dirname(bash)).toLowerCase();
  assert(['bin'].includes(shellDirectory), 'Select Git for Windows bin/bash.exe');
  const gitRoot = path.dirname(path.dirname(bash));
  await Promise.all([
    regular(exe),
    regular(asar),
    regular(bash),
    regular(path.join(gitRoot, 'cmd', 'git.exe')),
  ]);
  await unlinkedDirectory(path.dirname(output));
  await fs.mkdir(output); // Never adopt an existing directory or profile.
  outputCreated = true;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  delete env.BASH_ENV;
  delete env.ENV;
  const hashes = async () => ({
    exe: await digest(exe),
    asar: await digest(asar),
    bash: await digest(bash),
  });
  receipt.artifacts = await hashes();

  stage = 'archive-command-generator';
  await assertArchivedProfileSourcesMatch(asar, root);
  receipt.archiveProfileSourcesMatch = true;

  stage = 'shell-preflight';
  const shell = await child(bash, ['--noprofile', '--norc', '-c', "printf 'AEGIS_SHELL_OK\\n'"], {
    cwd: output,
    env,
    deadlineMs: 5000,
    input: '',
  });
  try {
    assert.equal(shell.result.code, 0);
    assert.equal(shell.result.terminated, false);
    assert.equal(shell.result.stdout.toString('utf8'), 'AEGIS_SHELL_OK\n');
  } finally {
    shell.result.stdout.fill(0);
  }
  receipt.shellPreflight = shell.evidence;

  const allowed = {
    command: "printf 'allowed' > allowed.txt",
    description: 'Allowed fixture',
    timeout: 1000,
  };
  const denied = {
    command: "printf 'denied' > denied.txt",
    description: 'Denied fixture',
    timeout: 1000,
  };
  const policy = path.join(output, 'policy.json');
  await fs.writeFile(
    policy,
    JSON.stringify({
      schemaVersion: 1,
      cwd: output,
      defaultDecision: 'deny',
      rules: [{ tool: 'Bash', input: allowed, decision: 'allow' }],
    }),
    { flag: 'wx' },
  );
  const command = profileCommand(exe, asar, policy);
  const assetRoot = path.join(path.dirname(exe), 'resources', 'hook-review');
  const assets = await assetHashes(assetRoot);
  assert(assets.length > 0);
  receipt.packagedAssetHashes = assets;
  const directory = path.join(output, 'claude-hook-profile');
  const settings = path.join(directory, 'settings.json');
  const initial = '{"private":"DISPOSABLE_PROFILE_CANARY","hooks":{"PreToolUse":[]}}\n';
  await fs.mkdir(directory);
  await fs.writeFile(settings, initial, { flag: 'wx' });
  let approve = true;
  let dialogs = 0;
  const sessions = [];
  const window = { isDestroyed: () => false };
  const app = createClaudeHookApp({
    userData: output,
    assetsRoot: assetRoot,
    executable: exe,
    appPath: asar,
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
        assert(review.detail.includes(settings));
        dialogs++;
        return { response: approve ? 1 : 0 };
      },
    },
  });
  const policyHash = await digest(policy);
  try {
    stage = 'packaged-assets-source-profile-install';
    assert.equal((await app.handle('status', () => true)).available, true);
    assert.equal(sessions.length, 0);
    assert.equal((await app.handle('install', () => true)).code, 'INSTALLED');
    const hooks = JSON.parse(await fs.readFile(settings, 'utf8')).hooks;
    const selected = hooks.PreToolUse[0].hooks[0].command;
    assert.equal(selected, command);
    receipt.scriptedSourceProfileInstall = true;
    const settingsHash = await digest(settings);
    const request = (input) =>
      JSON.stringify({
        session_id: 'owned-fixture',
        tool_use_id: 'owned-test',
        hook_event_name: 'PreToolUse',
        cwd: output,
        tool_name: 'Bash',
        tool_input: input,
      });
    const cases = [
      { name: 'allow-eof', input: request(allowed), expected: 'allow', code: 0 },
      { name: 'deny-eof', input: request(denied), expected: 'deny', code: 0 },
      { name: 'invalid-request-eof', input: '{}', expected: 'deny', code: 0 },
      {
        name: 'held-open-deadline',
        input: request(allowed),
        expected: 'deny',
        code: 2,
        held: true,
      },
    ];
    for (const item of cases) {
      stage = item.name;
      const value = await child(bash, ['--noprofile', '--norc', '-c', selected], {
        cwd: output,
        env,
        deadlineMs: 6000,
        input: item.input,
        endInput: !item.held,
      });
      const evidence = { name: item.name, ...value.evidence, expectedDecision: item.expected };
      receipt.cases.push(evidence);
      try {
        assert.equal(value.result.terminated, false);
        assert.equal(value.result.code, item.code);
        const parsed = JSON.parse(value.result.stdout.toString('utf8'));
        assert.deepEqual(Object.keys(parsed), ['hookSpecificOutput']);
        assert.deepEqual(parsed.hookSpecificOutput, {
          hookEventName: 'PreToolUse',
          permissionDecision: item.expected,
          permissionDecisionReason:
            item.expected === 'allow'
              ? 'AEGIS policy allows this tool request.'
              : 'AEGIS policy does not allow this tool request.',
        });
        evidence.matched = true;
      } finally {
        value.result.stdout.fill(0);
      }
    }
    stage = 'packaged-after-observation';
    const observer = await startClaudeGuardReceiver({
      selection: { executable: exe, settings, cwd: output },
      approve: async () => true,
      verify: async () => true,
    });
    try {
      const claim = await post(observer, 'claim', { code: '123456', nonce: 'c'.repeat(32) });
      assert.equal(claim.code, 200);
      const token = JSON.parse(claim.body).token;
      assert.equal((await post(observer, 'start', {}, token)).code, 204);
      const reportEnv = {
        ...env,
        AEGIS_CLAUDE_GUARD_PORT: String(observer.port),
        AEGIS_CLAUDE_GUARD_SESSION: observer.sessionId,
        AEGIS_CLAUDE_GUARD_CAPABILITY: token,
      };
      const before = JSON.parse(request(allowed));
      for (const [event, outcome] of [
        ['PostToolUse', 'reported-completed'],
        ['PostToolUseFailure', 'reported-failed'],
      ]) {
        before.tool_use_id = `fixture-${event}`;
        const pre = await child(bash, ['--noprofile', '--norc', '-c', selected], {
          cwd: output,
          env: reportEnv,
          deadlineMs: 6000,
          input: JSON.stringify(before),
        });
        try {
          assert.equal(pre.result.code, 0);
          assert.equal(
            JSON.parse(pre.result.stdout.toString()).hookSpecificOutput.permissionDecision,
            'allow',
          );
        } finally {
          pre.result.stdout.fill(0);
        }
        const after = await child(
          bash,
          ['--noprofile', '--norc', '-c', hooks[event][0].hooks[0].command],
          {
            cwd: output,
            env: reportEnv,
            deadlineMs: 6000,
            input: JSON.stringify({
              ...before,
              hook_event_name: event,
              tool_response: 'PRIVATE_OUTPUT',
              error: 'PRIVATE_ERROR',
            }),
          },
        );
        try {
          assert.equal(after.result.code, 0);
          assert.equal(after.result.stdoutBytes, 0);
          assert.equal(after.result.stderrBytes, 0);
        } finally {
          after.result.stdout.fill(0);
        }
        assert.equal(observer.snapshot().entries.at(-1).outcome, outcome);
      }
      const state = observer.snapshot();
      assert.equal(state.sender, 'unverified');
      assert.equal(state.effect, 'unknown');
      assert(!JSON.stringify(state).includes('PRIVATE'));
      assert(!JSON.stringify(state).includes(token));
      receipt.packagedAfterObservation = true;
    } finally {
      await observer.close();
    }
    stage = 'packaged-assets-source-profile-removal';
    approve = false;
    assert.equal((await app.handle('remove', () => true)).code, 'CANCELLED');
    assert.equal(await digest(settings), settingsHash);
    approve = true;
    assert.equal((await app.handle('remove', () => true)).code, 'REMOVED');
    assert.equal(await fs.readFile(settings, 'utf8'), initial);
    assert.equal(dialogs, 3);
    let backups = 0;
    const backupRoot = path.join(directory, 'backups');
    for (const folder of await fs.readdir(backupRoot)) {
      for (const name of await fs.readdir(path.join(backupRoot, folder))) {
        if (!name.endsWith('.rec')) continue;
        const bytes = await fs.readFile(path.join(backupRoot, folder, name));
        assert(!bytes.includes(Buffer.from('DISPOSABLE_PROFILE_CANARY')));
        assert(!bytes.includes(Buffer.from(policy)));
        backups++;
      }
    }
    assert(backups > 0);
    receipt.retainedBackupsWithoutPlaintextCanaries = backups;
    receipt.scriptedSourceProfileRemoval = true;
  } finally {
    await app.close();
    receipt.nativeSessions = sessions.map((io) => io.status());
  }
  assert.equal(sessions.length, 1);
  assert.deepEqual(receipt.nativeSessions[0], {
    admission: 'closed',
    exit: 'confirmed',
    streams: 'confirmed',
  });
  stage = 'integrity';
  assert.deepEqual(await hashes(), receipt.artifacts);
  assert.deepEqual(await assetHashes(assetRoot), assets);
  assert.equal(await digest(policy), policyHash);
  for (const name of ['allowed.txt', 'denied.txt'])
    await assert.rejects(fs.access(path.join(output, name)), { code: 'ENOENT' });
  receipt.candidateAndPolicyUnchanged = true;
  receipt.toolMarkersAbsent = true;
  receipt.complete = true;
  await fs.writeFile(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {
    flag: 'wx',
  });
  console.log('PASS: packaged hook and assets; source profile used scripted confirmation.');
}

module.exports = { assertArchivedProfileSourcesMatch };
if (require.main === module)
  run().catch(async (error) => {
    receipt.complete = false;
    receipt.failureStage = stage;
    receipt.failure = String(error.message).slice(0, 300);
    if (outputCreated)
      await fs
        .writeFile(path.join(output, 'failure.json'), JSON.stringify(receipt, null, 2) + '\n', {
          flag: 'wx',
        })
        .catch(() => {});
    console.error('Packaged hook qualification failed at ' + stage + '; private files retained.');
    process.exitCode = 1;
    if (receipt.ownedChildCleanupUnconfirmed) process.exit(1);
  });
