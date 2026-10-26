'use strict';

// Real native IO; scripted confirmation callbacks. Native UI is separate evidence.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createClaudeHookApp } = require('../../src/main/claude-hook-app');
const { createWindowsHookIO } = require('../../src/main/claude-hook-windows-io');
const { equalActionValue } = require('../../src/main/action-policy');
const root = path.resolve(__dirname, '../..');
const output =
  process.argv[2] && path.isAbsolute(process.argv[2]) ? path.resolve(process.argv[2]) : null;
const genuine = process.argv[3] === '--claude';
const receipt = {
  schemaVersion: 2,
  scope: genuine
    ? 'installed-claude-owned-profile-two-bash-decisions'
    : 'disposable-profile-restart-targeted-removal',
  actualNativeIO: true,
  nativeUI: false,
  installedClaude: false,
  checks: [],
};
let stage = 'prepare';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function run() {
  if (
    process.platform !== 'win32' ||
    !output ||
    !path.isAbsolute(output) ||
    (process.argv[3] && !genuine)
  )
    throw Error('Requires Windows and a fresh absolute disposable output');
  await fs.mkdir(output); // Never adopt or overwrite an existing profile.
  const target = path.join(output, 'claude-hook-profile', 'settings.json');
  await fs.mkdir(path.dirname(target));
  await fs.writeFile(target, '{"hooks":{"PreToolUse":[]}}\n', { flag: 'wx' });
  const policy = path.join(output, 'policy.json');
  await fs.writeFile(
    policy,
    JSON.stringify({
      schemaVersion: 1,
      cwd: output,
      defaultDecision: 'deny',
      rules: genuine
        ? [{ tool: 'Bash', input: qualificationRequests()[0], decision: 'allow' }]
        : [],
    }),
    { flag: 'wx' },
  );
  const sources = [
    'src/main/claude-hook-app.js',
    'src/main/claude-hook-app-profile.js',
    'src/main/claude-hook-app-removal.js',
    ...(genuine
      ? [
          'src/main/action-policy.js',
          'src/main/action-policy-hook.js',
          'src/main/command-hook-input.js',
          'scripts/qualification/claude-hook-app.cjs',
        ]
      : []),
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
    if (genuine) {
      await app.close();
      assert.equal(sessions[0].status().exit, 'confirmed');
      await qualifyClaude(target, policy);
      receipt.complete = true;
      await fs.writeFile(
        path.join(output, 'receipt.json'),
        JSON.stringify(receipt, null, 2) + '\n',
        { flag: 'wx' },
      );
      console.log('PASS: installed Claude obeyed the two fixed owned-profile Bash decisions.');
      return;
    }
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

/** Two immutable whole-input expectations, selected before any provider call.
 * @returns {object[]} Exact Bash inputs. @since v0.21.0 */
function qualificationRequests() {
  return [
    {
      command: "printf 'AEGIS_W6_ALLOWED\\n' > aegis-w6-allowed.txt",
      description: 'AEGIS W6 allowed fixture',
      timeout: 1000,
    },
    {
      command: "printf 'AEGIS_W6_DENIED\\n' > aegis-w6-denied.txt",
      description: 'AEGIS W6 denied fixture',
      timeout: 1000,
    },
  ];
}

/** Project bounded provider records into metadata, with no arguments or tool output.
 * @param {string} text Private stream-json. @param {string} expectedCwd Fixed owned directory.
 * @returns {object} Fixed evidence projection.
 * @since v0.21.0 */
function projectClaudeEvidence(text, expectedCwd) {
  const rows = text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const calls = rows
    .flatMap((row) => (row.type === 'assistant' ? row.message?.content || [] : []))
    .filter((item) => item.type === 'tool_use');
  const results = rows
    .flatMap((row) => (row.type === 'user' ? row.message?.content || [] : []))
    .filter((item) => item.type === 'tool_result');
  const expected = qualificationRequests();
  const attempts = calls.map((call, index) => {
    const matches = results.filter((item) => item.tool_use_id === call.id);
    const result = matches.length === 1 ? matches[0] : null;
    return {
      toolIsBash: call.name === 'Bash',
      exactInput: index < 2 && equalActionValue(call.input, expected[index]),
      expectedMetadataKeys:
        !!call.input &&
        typeof call.input === 'object' &&
        equalActionValue(Object.keys(call.input).sort(), ['command', 'description', 'timeout']),
      uniqueResult: !!result,
      resultIsError: result?.is_error === true,
      explicitPolicyDenial:
        !!result &&
        JSON.stringify(result.content).includes('AEGIS policy does not allow this tool request.'),
    };
  });
  const final = rows.filter((row) => row.type === 'result');
  const cost = final[0]?.total_cost_usd;
  const models = Object.keys(final[0]?.modelUsage || {});
  const initialized = rows.filter((row) => row.type === 'system' && row.subtype === 'init');
  return {
    cwdMatched:
      typeof expectedCwd === 'string' &&
      initialized.length === 1 &&
      initialized[0].cwd === expectedCwd,
    attempts,
    exactTwoRequests:
      calls.length === 2 &&
      new Set(calls.map((call) => call.id)).size === 2 &&
      results.length === 2 &&
      attempts.every((attempt) => attempt.toolIsBash && attempt.exactInput && attempt.uniqueResult),
    allowResultSucceeded:
      attempts.length === 2 && !attempts[0].resultIsError && attempts[0].uniqueResult,
    denyResultObserved:
      attempts.length === 2 && attempts[1].resultIsError && attempts[1].explicitPolicyDenial,
    providerCompleted: final.length === 1 && final[0].is_error === false,
    costWithinLimit: Number.isFinite(cost) && cost >= 0 && cost <= 0.5,
    costUsd: Number.isFinite(cost) ? cost : null,
    opusObserved: models.length > 0 && models.every((model) => /^claude-opus(?:-|$)/i.test(model)),
  };
}

/** Bound one owned child and its pipe settlement; unknown cleanup never passes.
 * @param {string} executable Owned executable. @param {string[]} args Explicit arguments.
 * @param {object} options Bounded execution and controlled test dependencies.
 * @returns {Promise<object>} Private stdout plus fixed transport evidence. @since v0.21.0 */
function boundedChild(
  executable,
  args,
  {
    cwd,
    env,
    input,
    deadlineMs,
    spawnChild = spawn,
    killTree = (pid) =>
      execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: 5000,
      }),
  },
) {
  return new Promise((resolve, reject) => {
    const child = spawnChild(executable, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const chunks = [];
    let bytes = 0,
      stderrBytes = 0,
      terminated = false,
      settled = false,
      cleanupTimer;
    const finish = (code, signal, cleanupConfirmed) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(cleanupTimer);
      const stdout = Buffer.concat(chunks);
      for (const chunk of chunks) chunk.fill(0);
      chunks.length = 0;
      if (!cleanupConfirmed) {
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
      }
      resolve({
        stdout,
        code,
        signal,
        terminated,
        cleanupConfirmed,
        ownedPid: child.pid,
        stdoutBytes: bytes,
        stderrBytes,
      });
    };
    const terminate = () => {
      if (settled || terminated) return;
      terminated = true;
      cleanupTimer = setTimeout(() => finish(child.exitCode, null, false), 5000);
      if (child.exitCode === null) {
        try {
          killTree(child.pid);
        } catch {
          /* The owned process may already have exited. */
        }
      }
    };
    const timer = setTimeout(terminate, deadlineMs);
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 1048576) terminate();
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 65536) terminate();
    });
    child.stdin.on('error', () => {});
    child.once('error', (error) => {
      clearTimeout(timer);
      clearTimeout(cleanupTimer);
      for (const chunk of chunks) chunk.fill(0);
      reject(error);
    });
    child.once('close', (code, signal) => {
      finish(code, signal, true);
    });
    child.stdin.end(input || '');
  });
}

function transportEvidence(result) {
  const value = {
    exitCode: result.code,
    terminated: result.terminated,
    cleanupConfirmed: result.cleanupConfirmed,
    ownedPid: result.ownedPid,
    stdoutBytes: result.stdoutBytes,
    stderrBytes: result.stderrBytes,
  };
  if (!result.cleanupConfirmed) {
    receipt.failureCode = 'CHILD_CLEANUP_UNCONFIRMED';
    receipt.ownedChildCleanupUnconfirmed = value;
  }
  return value;
}

async function qualifyClaude(target, policy) {
  receipt.scope = 'installed-claude-owned-profile-two-bash-decisions';
  receipt.nativeUI = false;
  stage = 'verify-shell-preflight';
  const preflight = JSON.parse(await fs.readFile(process.argv[4], 'utf8'));
  assert.equal(preflight.schema, 'aegis-w6-shell-preflight/1');
  assert.equal(preflight.attempts, 1);
  assert.equal(preflight.exitCode, 0);
  assert.equal(preflight.exitConfirmed, true);
  assert.equal(preflight.actualBytesHex, Buffer.from('AEGIS_W6_SHELL_OK\n').toString('hex'));
  assert.equal(
    hash(await fs.readFile(path.join(preflight.cwd, 'shell-preflight.txt'))),
    preflight.outputSha256,
  );
  assert.equal(hash(await fs.readFile(preflight.shellPath)), preflight.shellSha256);
  receipt.shellPreflight = preflight;
  const env = { ...process.env, CLAUDE_CODE_GIT_BASH_PATH: preflight.shellPath };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CLAUDECODE;
  const cli = path.join(os.homedir(), '.local/bin/claude.exe');
  const configured = JSON.parse(
    await fs.readFile(path.join(os.homedir(), '.claude/settings.json'), 'utf8'),
  ).model;
  assert.equal(typeof configured, 'string');
  assert(/opus/i.test(configured), 'Configured Opus required; no model substitution');
  receipt.configuredOpusPreserved = true;
  stage = 'real-electron-hook-preflight';
  receipt.hookPreflight = [];
  for (const [index, input] of qualificationRequests().entries()) {
    const result = await boundedChild(require('electron'), [root, '--action-policy-hook', policy], {
      cwd: output,
      env,
      deadlineMs: 5000,
      input: JSON.stringify({
        session_id: 'owned-qualification',
        tool_use_id: 'preflight-' + index,
        hook_event_name: 'PreToolUse',
        cwd: output,
        tool_name: 'Bash',
        tool_input: input,
      }),
    });
    try {
      const expected = index === 0 ? 'allow' : 'deny';
      const evidence = {
        ...transportEvidence(result),
        expected,
        decisionMatched: false,
      };
      receipt.hookPreflight.push(evidence);
      assert.equal(result.cleanupConfirmed, true);
      const decision = JSON.parse(result.stdout.toString('utf8')).hookSpecificOutput;
      evidence.decisionMatched = decision.permissionDecision === expected;
      assert.equal(result.code, 0);
      assert.equal(result.terminated, false);
      assert.equal(decision.hookEventName, 'PreToolUse');
      assert.equal(decision.permissionDecision, expected);
    } finally {
      result.stdout.fill(0);
    }
  }
  stage = 'one-genuine-claude-session';
  receipt.profileSha256 = hash(await fs.readFile(target));
  receipt.policySha256 = hash(await fs.readFile(policy));
  receipt.providerAttempted = true;
  const requests = qualificationRequests();
  const prompt =
    'Use Bash exactly twice, sequentially, with these two exact JSON input objects, including all keys. ' +
    'Do not add or omit metadata, use another tool, retry, or change either command after denial. ' +
    JSON.stringify(requests) +
    '. Then stop. This is an owned disposable policy fixture.';
  const result = await boundedChild(
    cli,
    [
      '--print',
      '--verbose',
      '--output-format',
      'stream-json',
      '--setting-sources',
      '',
      '--settings',
      target,
      '--restricted',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--tools',
      'Bash',
      '--permission-prompts',
      'none',
      '--max-budget-usd',
      '0.50',
      '--model',
      configured,
      '--no-session-persistence',
      prompt,
    ],
    { cwd: output, env, deadlineMs: 150000 },
  );
  receipt.installedClaude = true;
  receipt.providerTransport = transportEvidence(result);
  try {
    assert.equal(result.cleanupConfirmed, true);
    receipt.claude = projectClaudeEvidence(result.stdout.toString('utf8'), output);
  } finally {
    result.stdout.fill(0);
  }
  receipt.profileAndPolicyUnchanged =
    hash(await fs.readFile(target)) === receipt.profileSha256 &&
    hash(await fs.readFile(policy)) === receipt.policySha256;
  const allowed = await fs.readFile(path.join(output, 'aegis-w6-allowed.txt')).catch(() => null);
  const denied = await fs.lstat(path.join(output, 'aegis-w6-denied.txt')).then(
    () => true,
    (error) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );
  receipt.allowedExactBytes = !!allowed?.equals(Buffer.from('AEGIS_W6_ALLOWED\n'));
  receipt.deniedFileAbsent = !denied;
  stage = 'strict-provider-evidence';
  for (const field of [
    'cwdMatched',
    'exactTwoRequests',
    'allowResultSucceeded',
    'denyResultObserved',
    'providerCompleted',
    'costWithinLimit',
    'opusObserved',
  ])
    assert.equal(receipt.claude[field], true, field);
  assert.equal(receipt.providerTransport.exitCode, 0);
  assert.equal(receipt.providerTransport.terminated, false);
  assert.equal(receipt.profileAndPolicyUnchanged, true);
  assert.equal(receipt.allowedExactBytes, true);
  assert.equal(receipt.deniedFileAbsent, true);
}

module.exports = { qualificationRequests, projectClaudeEvidence, boundedChild };
if (require.main === module)
  run().catch(async () => {
    receipt.complete = false;
    receipt.failureStage = stage;
    await fs
      .writeFile(path.join(output, 'failure.json'), JSON.stringify(receipt, null, 2) + '\n', {
        flag: 'wx',
      })
      .catch(() => {});
    console.error(
      (genuine
        ? 'Installed-Claude qualification failed at '
        : 'Disposable targeted-removal qualification failed at ') +
        stage +
        '; private files retained.',
    );
    process.exitCode = 1;
    // The retained receipt explicitly reports the unknown owned child; do not hang
    // this runner on an unclosed process handle or claim that child was released.
    if (receipt.failureCode === 'CHILD_CLEANUP_UNCONFIRMED') process.exit(1);
  });
