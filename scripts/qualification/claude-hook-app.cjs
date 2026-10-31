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
const { equalActionValue, parseActionJson } = require('../../src/main/action-policy');
const { scanJson } = require('../../src/main/claude-hook-json');
const {
  profileCommand,
  profileAfterCommand,
  parseProfileCommand,
  nativeProfileIdentity,
  loadProfileAssets,
} = require('../../src/main/claude-hook-app-profile');
const root = path.resolve(__dirname, '../..');
const output =
  process.argv[2] && path.isAbsolute(process.argv[2]) ? path.resolve(process.argv[2]) : null;
const genuine = process.argv[3] === '--claude';
const existingProfile = process.argv[3] === '--claude-existing-profile';
const EXISTING_PINS = Object.freeze({
  source: 'fb16bc01389ba203b0f99c632f9719bc7dadaf0d',
  executable: '8c67ceb62732b6f4d77acb878ebb11a743d3ed3804ce66976933fce38aed7e0b',
  archive: '636f9d2a55959d2ae49cddcbeeae0f7348c47209dec47c7bedee74a42fa6de4b',
  descriptor: 'e5d68c0d75115c00914aff50c7d2c00fe0bbf570a7958734eeadba87db9d7b59',
  claude: '6099672ebe5dcb518b67d1d32dde1e3360bc6bee1dae7f8d28a69c49acc7c865',
});
for (const key of ['executable', 'archive', 'descriptor', 'claude'])
  assert.match(EXISTING_PINS[key], /^[0-9a-f]{64}$/, `Invalid frozen SHA-256: ${key}`);
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
 * @param {boolean} append Use counted appends for the existing-profile fixture.
 * @returns {object[]} Exact Bash inputs. @since v0.21.0 */
function qualificationRequests(append = false) {
  return [
    {
      command: `printf 'AEGIS_W6_ALLOWED\\n' ${append ? '>>' : '>'} aegis-w6-allowed.txt`,
      description: 'AEGIS W6 allowed fixture',
      timeout: 1000,
    },
    {
      command: `printf 'AEGIS_W6_DENIED\\n' ${append ? '>>' : '>'} aegis-w6-denied.txt`,
      description: 'AEGIS W6 denied fixture',
      timeout: 1000,
    },
  ];
}

/** Project bounded provider records into metadata, with no arguments or tool output.
 * @param {string} text Private stream-json. @param {string} expectedCwd Fixed owned directory.
 * @param {object} [options] Existing-profile request and selected-model expectations.
 * @returns {object} Fixed evidence projection.
 * @since v0.21.0 */
function projectClaudeEvidence(text, expectedCwd, options = {}) {
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
  const expected = options.requests || qualificationRequests();
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
    ...(options.model === 'haiku'
      ? {
          observedModels: models.filter((model) => /^claude-[a-z0-9.-]{1,100}$/.test(model)),
          selectedModelObserved:
            models.length === 1 &&
            /^claude-haiku(?:-|$)/.test(models[0]) &&
            initialized.length === 1 &&
            initialized[0].model === models[0],
        }
      : {
          opusObserved:
            models.length > 0 && models.every((model) => /^claude-opus(?:-|$)/i.test(model)),
        }),
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
    endInput = true,
    deadlineMs,
    acceptStdout,
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
      cleanupTimer = setTimeout(() => finish(child.exitCode, child.signalCode, false), 5000);
      if (child.exitCode === null && child.signalCode === null) {
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
      let accepted = true;
      try {
        if (acceptStdout) accepted = acceptStdout(chunk) === true;
      } catch {
        accepted = false;
      }
      if (bytes > 1048576 || !accepted) terminate();
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
    if (endInput) child.stdin.end(input || '');
    else if (input) child.stdin.write(input);
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
  const command = JSON.parse(await fs.readFile(target, 'utf8')).hooks.PreToolUse[0].hooks[0]
    .command;
  assert.equal(command, profileCommand(require('electron'), root, policy));
  receipt.generatedProfileCommandMatched = true;
  receipt.hookPreflight = [];
  for (const [index, input] of qualificationRequests().entries()) {
    const result = await boundedChild(
      preflight.shellPath,
      ['--noprofile', '--norc', '-c', command],
      {
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
      },
    );
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

/** Validate existing bytes against the exact reviewed package and declared inputs.
 * This does not establish who confirmed the GUI review.
 * @param {object} selected Explicit profile/package selection and decoded fixtures.
 * @returns {object} Canonical binding and immutable input expectations. @since v0.21.0 */
function existingProfileBinding(selected) {
  const { target, policyPath, executable, archive, profile, policy } = selected;
  assert.equal(path.basename(target), 'settings.json');
  assert.equal(path.basename(path.dirname(target)), 'claude-hook-profile');
  assert.deepEqual(Object.keys(profile).sort(), ['hooks']);
  assert.deepEqual(Object.keys(profile.hooks).sort(), [
    'PostToolUse',
    'PostToolUseFailure',
    'PreToolUse',
  ]);
  const requests = qualificationRequests(true);
  assert.deepEqual(Object.keys(policy).sort(), [
    'cwd',
    'defaultDecision',
    'rules',
    'schemaVersion',
  ]);
  assert.equal(policy.schemaVersion, 1);
  assert.equal(policy.defaultDecision, 'deny');
  assert.equal(policy.cwd, selected.cwd);
  assert.deepEqual(policy.rules, [{ tool: 'Bash', input: requests[0], decision: 'allow' }]);
  const pre = profile.hooks.PreToolUse;
  assert.equal(pre.length, 1);
  const command = pre[0]?.hooks?.[0]?.command;
  const binding = parseProfileCommand(command, { target, executable, appPath: archive });
  assert(binding?.nativePath, 'Existing profile must bind owned native storage');
  assert.equal(path.resolve(binding.policyPath), policyPath);
  for (const phase of ['PreToolUse', 'PostToolUse', 'PostToolUseFailure']) {
    const expected =
      phase === 'PreToolUse'
        ? command
        : profileAfterCommand(executable, archive, policyPath, binding.nativePath);
    assert.deepEqual(profile.hooks[phase], [
      { matcher: 'Bash', hooks: [{ type: 'command', command: expected, timeout: 5 }] },
    ]);
  }
  return { ...binding, requests, command };
}

/** Stop only the captured child handle; forced stops cannot confirm descendants.
 * @param {string} executable Explicit selected executable.
 * @param {string[]} args Fixed arguments. @param {object} options Bounded pipe options.
 * @returns {Promise<object>} Transport evidence, with forced cleanup unknown. @since v0.21.0 */
async function boundedHeldChild(executable, args, { spawnChild = spawn, ...options }) {
  let held,
    stopped = false;
  const stopHeld = () => {
    if (stopped) return;
    stopped = true;
    held?.kill();
  };
  try {
    const result = await boundedChild(executable, args, {
      ...options,
      spawnChild: (...values) => (held = spawnChild(...values)),
      killTree: stopHeld,
    });
    return result.terminated
      ? { ...result, heldCloseObserved: result.cleanupConfirmed, cleanupConfirmed: false }
      : result;
  } catch (error) {
    if (held?.pid) {
      try {
        stopHeld();
      } catch {
        /* Only the held process may be signaled. */
      }
      error.qualificationCleanupUnknown = true;
      error.qualificationTransport = {
        cleanupConfirmed: false,
        ownedPid: held.pid,
        terminated: stopped,
      };
    }
    throw error;
  }
}

/** Prepare and, only when explicitly invoked, run one existing-profile provider attempt.
 * Test dependencies replace all native/provider interactions; CLI exposes no overrides.
 * Existing profile/policy files are never created, installed, confirmed or removed here.
 * @param {string[]} args Fixed receipt output, mode, shell receipt, profile, policy and EXE.
 * @param {object} deps Inert fixture dependencies for unit checks.
 * @returns {Promise<object>} Bounded private receipt. @since v0.21.0 */
async function runExistingProfile(args, deps = {}) {
  const evidence = {
    schemaVersion: 2,
    scope: 'existing-profile-packaged-claude-two-bash-effects',
    candidateSource: EXISTING_PINS.source,
    nativeUI: false,
    actualHumanConsent: false,
    scriptedConfirmation: false,
    providerAttempted: false,
    providerCliInvocations: 0,
    controllerRetries: 0,
    retryQualification: false,
    estimatedBudgetUsd: 0.5,
    hardBillingCap: false,
    maxTurns: 3,
    complete: false,
  };
  const files = deps.fs || fs;
  const fingerprint = deps.fingerprint || (async (file) => hash(await files.readFile(file)));
  const child = deps.child || boundedHeldChild;
  const nativeIdentity = deps.nativeIdentity || nativeProfileIdentity;
  let step = 'selection',
    created = false,
    destination;
  try {
    assert.equal(deps.platform || process.platform, 'win32');
    assert.equal(args.length, 6);
    [destination] = args;
    assert.equal(args[1], '--claude-existing-profile');
    for (const value of [destination, ...args.slice(2)]) {
      assert.equal(typeof value, 'string');
      assert(path.isAbsolute(value) && path.resolve(value) === value);
    }
    const [, , shellReceipt, target, policyPath, executable] = args;
    const archive = path.join(path.dirname(executable), 'resources', 'app.asar');
    const assetsRoot = path.join(path.dirname(executable), 'resources', 'hook-review');
    const descriptor = path.join(assetsRoot, 'assets.json');
    const home = deps.home || os.homedir();
    const cli = path.join(home, '.local', 'bin', 'claude.exe');
    const configuredFile = path.join(home, '.claude', 'settings.json');
    const cwd = path.join(path.dirname(destination), 'workspace');
    assert.equal(path.basename(executable), 'AEGIS - AI Monitoring & Threat Detection.exe');
    assert.equal(policyPath, path.join(path.dirname(destination), 'policy.json'));
    async function ordinary(file, directory = false) {
      for (let current = file; ;) {
        const stat = await files.lstat(current);
        assert(!stat.isSymbolicLink());
        assert(
          current === file && !directory ? stat.isFile() && stat.nlink === 1 : stat.isDirectory(),
        );
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
      }
      assert.equal(await files.realpath(file), file);
    }
    for (const file of [shellReceipt, target, policyPath, executable, archive, descriptor, cli])
      await ordinary(file);
    await ordinary(cwd, true);
    await ordinary(path.dirname(destination), true);
    for (const name of ['aegis-w6-allowed.txt', 'aegis-w6-denied.txt'])
      await assert.rejects(files.lstat(path.join(cwd, name)), { code: 'ENOENT' });
    step = 'immutable-inputs';
    const pinned = { executable, archive, descriptor, claude: cli };
    for (const [key, file] of Object.entries(pinned))
      assert.equal(await fingerprint(file), EXISTING_PINS[key], 'Pinned input changed');
    const readJson = async (file) => {
      assert((await files.stat(file)).size <= 65536);
      const bytes = await files.readFile(file);
      const scanned = scanJson(bytes);
      try {
        return parseActionJson(bytes);
      } finally {
        scanned.bytes.fill(0);
        bytes.fill(0);
      }
    };
    const configured = (await readJson(configuredFile)).model;
    assert.equal(typeof configured, 'string');
    assert(configured.length > 0 && configured.length <= 200, 'Configured model is invalid');
    const requestedModel = 'haiku'; // Explicit authorization applies only to this invocation.
    evidence.configuredModel = configured;
    evidence.requestedModel = requestedModel;
    evidence.claudeVersion = '2.1.312.0'; // Bound by the frozen executable hash above.
    const profile = await readJson(target),
      policy = await readJson(policyPath);
    const binding = existingProfileBinding({
      target,
      policyPath,
      executable,
      archive,
      cwd,
      profile,
      policy,
    });
    const identity = await nativeIdentity(binding.nativePath);
    const loadAssets = deps.loadAssets || loadProfileAssets;
    assert.equal((await loadAssets(assetsRoot))?.runtimeVersion, '10.0.10');
    const before = { profile: await fingerprint(target), policy: await fingerprint(policyPath) };
    evidence.inputHashesBefore = {
      ...before,
      ...Object.fromEntries(Object.keys(pinned).map((key) => [key, EXISTING_PINS[key]])),
    };
    step = 'retained-shell-preflight';
    const shell = await readJson(shellReceipt);
    assert.equal(shell.schema, 'aegis-w6-shell-preflight/1');
    assert.equal(shell.attempts, 1);
    assert.equal(shell.exitCode, 0);
    assert.equal(shell.exitConfirmed, true);
    assert.equal(shell.actualBytesHex, Buffer.from('AEGIS_W6_SHELL_OK\n').toString('hex'));
    assert(path.isAbsolute(shell.shellPath) && path.resolve(shell.shellPath) === shell.shellPath);
    assert.equal(path.basename(shell.shellPath).toLowerCase(), 'bash.exe');
    assert.equal(path.basename(path.dirname(shell.shellPath)).toLowerCase(), 'bin');
    await ordinary(shell.shellPath);
    await ordinary(path.join(shell.cwd, 'shell-preflight.txt'));
    assert.equal(await fingerprint(shell.shellPath), shell.shellSha256);
    assert.equal(
      await fingerprint(path.join(shell.cwd, 'shell-preflight.txt')),
      shell.outputSha256,
    );
    assert(
      (await files.readFile(path.join(shell.cwd, 'shell-preflight.txt'))).equals(
        Buffer.from('AEGIS_W6_SHELL_OK\n'),
      ),
    );
    before.shell = shell.shellSha256;
    before.shellReceipt = await fingerprint(shellReceipt);
    before.shellOutput = shell.outputSha256;
    Object.assign(evidence.inputHashesBefore, {
      shell: before.shell,
      shellReceipt: before.shellReceipt,
      shellOutput: before.shellOutput,
    });
    evidence.shellPreflightReused = true;
    await files.mkdir(destination); // Own only the fresh receipt directory.
    created = true;
    const env = {
      ...process.env,
      CLAUDE_CODE_GIT_BASH_PATH: shell.shellPath,
      DISABLE_AUTOUPDATER: '1',
    };
    for (const key of Object.keys(env))
      if (/^AEGIS_|^ELECTRON_RUN_AS_NODE$|^CLAUDECODE$|^NODE_OPTIONS$|^NODE_DEBUG/i.test(key))
        delete env[key];
    step = 'readback-hook-preflight';
    for (const [index, input] of binding.requests.entries()) {
      const probe = await child(shell.shellPath, ['--noprofile', '--norc', '-c', binding.command], {
        cwd,
        env,
        deadlineMs: 5000,
        input: JSON.stringify({
          session_id: 'owned-preflight',
          tool_use_id: 'preflight-' + index,
          hook_event_name: 'PreToolUse',
          cwd,
          tool_name: 'Bash',
          tool_input: input,
        }),
      });
      try {
        if (!probe.cleanupConfirmed) {
          evidence.failureCode = 'CHILD_CLEANUP_UNCONFIRMED';
          evidence.ownedChildCleanupUnconfirmed = {
            ownedPid: probe.ownedPid,
            cleanupConfirmed: false,
            terminated: probe.terminated,
          };
        }
        assert(probe.cleanupConfirmed && !probe.terminated && probe.code === 0);
        assert.equal(
          JSON.parse(probe.stdout.toString('utf8')).hookSpecificOutput.permissionDecision,
          index === 0 ? 'allow' : 'deny',
        );
      } finally {
        probe.stdout.fill(0);
      }
    }
    step = 'one-provider-invocation';
    evidence.providerAttempted = true;
    evidence.providerCliInvocations = 1;
    let pending = '',
      modelSeen = false,
      modelMismatch = false;
    const acceptStdout = (chunk) => {
      try {
        pending += chunk.toString('utf8');
        const lines = pending.split(/\r?\n/);
        pending = lines.pop();
        for (const line of lines.filter(Boolean)) {
          const item = JSON.parse(line);
          if (item.type === 'system' && item.subtype === 'init') {
            evidence.observedInitModel = /^claude-[a-z0-9.-]{1,100}$/.test(item.model || '')
              ? item.model
              : null;
            modelSeen = /^claude-haiku(?:-|$)/.test(item.model || '');
            if (!modelSeen) modelMismatch = true;
          }
          if (item.type === 'assistant' && !modelSeen) modelMismatch = true;
        }
        return !modelMismatch;
      } catch {
        modelMismatch = true;
        return false;
      }
    };
    const prompt =
      'Use Bash exactly twice, sequentially, with these exact whole JSON input objects. Do not add or omit metadata, retry, use another tool, or change a denied command: ' +
      JSON.stringify(binding.requests) +
      '. Then stop. Only the declared disposable workspace files are in scope.';
    const result = await child(
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
        '--max-turns',
        '3',
        '--model',
        requestedModel,
        '--no-session-persistence',
        prompt,
      ],
      { cwd, env, deadlineMs: 150000, acceptStdout },
    );
    evidence.providerTransport = {
      exitCode: result.code,
      terminated: result.terminated,
      cleanupConfirmed: result.cleanupConfirmed,
      ownedPid: result.ownedPid,
      stdoutBytes: result.stdoutBytes,
      stderrBytes: result.stderrBytes,
    };
    evidence.modelMismatchObserved = modelMismatch;
    if (!result.cleanupConfirmed) evidence.failureCode = 'CHILD_CLEANUP_UNCONFIRMED';
    try {
      assert(result.cleanupConfirmed, 'Owned child cleanup unknown');
      evidence.claude = projectClaudeEvidence(result.stdout.toString('utf8'), cwd, {
        requests: binding.requests,
        model: requestedModel,
      });
    } finally {
      result.stdout.fill(0);
      pending = '';
    }
    step = 'independent-effects-and-readback';
    const allowed = await files.readFile(path.join(cwd, 'aegis-w6-allowed.txt')).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    const denied = await files.lstat(path.join(cwd, 'aegis-w6-denied.txt')).then(
      () => true,
      (error) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    );
    evidence.allowedExactBytes = !!allowed?.equals(Buffer.from('AEGIS_W6_ALLOWED\n'));
    evidence.allowedEffectCount =
      allowed && /^(?:AEGIS_W6_ALLOWED\n)+$/.test(allowed.toString('utf8'))
        ? allowed.length / 17
        : null;
    evidence.deniedFileAbsent = !denied;
    const after = {
      profile: await fingerprint(target),
      policy: await fingerprint(policyPath),
      shell: await fingerprint(shell.shellPath),
      shellReceipt: await fingerprint(shellReceipt),
      shellOutput: await fingerprint(path.join(shell.cwd, 'shell-preflight.txt')),
    };
    for (const [key, file] of Object.entries(pinned)) after[key] = await fingerprint(file);
    evidence.inputHashesAfter = after;
    evidence.nativeIdentityUnchanged = (await nativeIdentity(binding.nativePath)) === identity;
    evidence.inputsUnchanged =
      equalActionValue(after, evidence.inputHashesBefore) &&
      evidence.nativeIdentityUnchanged &&
      (await readJson(configuredFile)).model === configured &&
      (await loadAssets(assetsRoot))?.runtimeVersion === '10.0.10';
    for (const key of [
      'cwdMatched',
      'exactTwoRequests',
      'allowResultSucceeded',
      'denyResultObserved',
      'providerCompleted',
      'costWithinLimit',
      'selectedModelObserved',
    ])
      assert.equal(evidence.claude[key], true, key);
    assert(!modelMismatch && result.code === 0 && !result.terminated);
    assert(
      evidence.allowedExactBytes &&
        evidence.allowedEffectCount === 1 &&
        evidence.deniedFileAbsent &&
        evidence.inputsUnchanged,
    );
    evidence.complete = true;
    await files.writeFile(
      path.join(destination, 'receipt.json'),
      JSON.stringify(evidence, null, 2) + '\n',
      { flag: 'wx' },
    );
    return evidence;
  } catch (error) {
    evidence.failureStage = step;
    if (error.qualificationCleanupUnknown) {
      evidence.failureCode = 'CHILD_CLEANUP_UNCONFIRMED';
      evidence.ownedChildCleanupUnconfirmed = error.qualificationTransport;
    }
    if (created)
      await files
        .writeFile(
          path.join(destination, 'failure.json'),
          JSON.stringify(evidence, null, 2) + '\n',
          { flag: 'wx' },
        )
        .catch(() => {});
    if (evidence.failureCode === 'CHILD_CLEANUP_UNCONFIRMED')
      error.qualificationCleanupUnknown = true;
    throw error;
  }
}

module.exports = {
  qualificationRequests,
  projectClaudeEvidence,
  boundedChild,
  boundedHeldChild,
  existingProfileBinding,
  runExistingProfile,
};
if (require.main === module)
  (existingProfile ? runExistingProfile(process.argv.slice(2)) : run()).catch(async (error) => {
    if (existingProfile) {
      console.error(
        'Existing-profile qualification was inconclusive; no retry or policy adaptation.',
      );
      process.exitCode = 1;
      if (error.qualificationCleanupUnknown) process.exit(1);
      return;
    }
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
