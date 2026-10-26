'use strict';

// One genuine installed Claude session, current OS scanner and production IPC/UI.
// Read uses a LAB observation. Write consumes the real owned-project watcher event.
// Neither mode establishes native read-sensor acceptance.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');

const root = process.cwd();
const mode = process.env.AEGIS_CLAUDE_QUALIFICATION_MODE || 'read';
const scenario = process.env.AEGIS_CLAUDE_QUALIFICATION_SCENARIO || 'single';
const selectedTool = mode === 'write' ? 'Write' : 'Read';
const out = path.resolve(
  process.env.AEGIS_CLAUDE_QUALIFICATION_OUT || 'out/development/live-claude',
);
const cli = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
const id = randomUUID();
let eventId = randomUUID();
const project =
    mode === 'write' && scenario === 'single'
      ? path.join(root, 'out', 'development', 'w4-write-' + id, 'project')
      : path.join(out, 'project'),
  file = path.join(project, mode === 'write' ? 'w4-real-write.txt' : 'w4-native-fixture.env'),
  transcript = path.join(
    os.homedir(),
    '.claude',
    'projects',
    project.replace(/[/\\:.]/g, '-'),
    `${id}.jsonl`,
  );
const marker = 'W4_PRIVATE_FIXTURE_' + randomUUID();
const writeStages = {
  watcherEventVerified: false,
  independentWriteVerified: false,
  auditMatched: false,
  stableIPCBinding: false,
  DOMDetailsVerified: false,
  originalAuditRowsPreserved: false,
};
const heldActors = [];
const instanceStages = {
  peerHeldDuringPrimary: false,
  primaryOnlyModelReleased: false,
  primaryOnlyWriteVerified: false,
  peerRetiredBeforeRestart: false,
  replacementNewGeneration: false,
  oldEventRejectedIPC: false,
  oldEventRejectedDOM: false,
  originalAuditRowsPreserved: false,
};
let scenarioFailure = null,
  primaryCancelAttempted = false,
  primaryCancelSucceeded = null,
  primaryReportedCost = null,
  peerPreflightDiagnostic = null,
  projectSelectionDiagnostic = null;

/** Seed only an owned disposable profile through the real selection owner before startup.
 * Scripted fixture authorization is not native owner consent.
 * @param {string} profile Fresh owned profile. @param {string} project Selected external owned directory.
 * @param {string} sourceRoot Blocked application source. @returns {Promise<object>} Closed fixture evidence.
 * @since v0.21.0 */
async function seedOwnedProjectSelection(profile, project, sourceRoot) {
  const { createProjectWatchSelection } = require('../../src/main/project-watch-selection');
  await fs.mkdir(profile);
  const fixtureWindow = { isDestroyed: () => false };
  const owner = createProjectWatchSelection({
    userData: profile,
    getWindow: () => fixtureWindow,
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [project] }) },
    blockedTrees: [sourceRoot],
  });
  try {
    assert.deepEqual(await owner.handle('select', () => true), {
      success: true,
      code: 'SELECTED',
      selected: true,
      available: true,
    });
    return {
      authority: 'scripted-owned-profile-fixture',
      nativeOwnerConsent: false,
      fixturePersisted: true,
      appUserDataMatched: false,
      publicStatusSelected: false,
      projectRootReady: false,
    };
  } finally {
    owner.close();
  }
}

/** Project peer ownership conditions from the actual renderer scan snapshot.
 * @param {object} selection Selected owner identifiers/CWD; tests may supply the scan rows.
 * @returns {object} Closed counts, enums and booleans only. @since v0.21.0 */
function peerComponentDiagnostic({ agents = globalThis.window?.__w4Agents, pid, primaryPid, cwd }) {
  const population = Array.isArray(agents) ? agents : [];
  const peers = population.filter((row) => row.agent === 'Claude Code');
  const rows = population.filter((row) => row.pid === pid);
  const row = rows.length === 1 ? rows[0] : null;
  const normalize = (value) =>
    typeof value === 'string' && value.length > 0
      ? value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
      : null;
  const raw = row?.createTime100ns;
  const rawBirthValid =
    typeof raw === 'string' &&
    /^[1-9][0-9]{0,19}$/.test(raw) &&
    BigInt(raw) <= 18446744073709551615n;
  const startValid = Number.isSafeInteger(row?.startTime) && row.startTime > 0;
  return {
    sameNameCount: Math.min(peers.length, 128),
    primaryPresent: peers.some((peer) => peer.pid === primaryPid),
    ownedRowCount: Math.min(rows.length, 128),
    rowUnique: rows.length === 1,
    agentExpected: row?.agent === 'Claude Code',
    sourceExpected: row?.instanceIdSource === 'os',
    keyCoherent: startValid && row.instanceId === `${pid}:${row.startTime}`,
    rawBirthValid,
    birthMatchesStart:
      rawBirthValid &&
      startValid &&
      Number((BigInt(raw) - 116444736000000000n) / 10000n) === row.startTime,
    witnessSourceEnum: ['createTime100ns', 'sequence', 'startTimeMs'].includes(
      row?.generationWitnessSource,
    )
      ? row.generationWitnessSource
      : 'unavailable',
    witnessMatchesRaw: typeof row?.generationWitness === 'string' && row.generationWitness === raw,
    cwdPresent: normalize(row?.cwd) !== null,
    cwdMatchesExpected: normalize(cwd) !== null && normalize(row?.cwd) === normalize(cwd),
  };
}

/** Own one held CLI's deadline and one confirmed stop before its 90s hook expiry.
 * @param {object} processChild Owned child process. @param {'peer'|'replacement'} role Fixed owner role.
 * @param {object} [options] Kill/deadline and cancellation dependencies.
 * @returns {object} Held-state query and idempotent bounded cleanup. @since v0.21.0 */
function createHeldOwner(processChild, role, options = {}) {
  assert(['peer', 'replacement'].includes(role));
  const deadlineMs = options.deadlineMs ?? 60000;
  assert(Number.isSafeInteger(deadlineMs) && deadlineMs > 0 && deadlineMs <= 60000);
  const killTree =
    options.killTree ??
    ((pid) =>
      execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: 5000,
      }));
  const startedAt = performance.now();
  let closed = false,
    exited = false,
    plannedStop = false,
    stopTask,
    exit = null,
    deadlineExpired = false;
  let timer,
    stdoutBytes = 0,
    stderrBytes = 0,
    failure = null;
  const fail = (reason) => {
    if (failure) return;
    failure = reason;
    options.onFailure?.(reason);
  };
  const done = new Promise((resolve) => {
    processChild.once('exit', (code, signal) => {
      exited = true;
      exit = { code, signal };
      clearTimeout(timer);
      if (!plannedStop) fail('held-actor-exited-before-release');
    });
    processChild.once('close', (code, signal) => {
      closed = true;
      exit = { code, signal };
      clearTimeout(timer);
      resolve(exit);
      if (!plannedStop) fail('held-actor-exited-before-release');
    });
    processChild.once('error', () => fail('held-actor-start-failed'));
  });
  for (const [stream, kind] of [
    [processChild.stdout, 'stdout'],
    [processChild.stderr, 'stderr'],
  ]) {
    stream?.on('data', (bytes) => {
      if (kind === 'stdout') stdoutBytes += bytes.length;
      else stderrBytes += bytes.length;
      if (stdoutBytes + stderrBytes > 65536) fail('held-actor-output-limit');
    });
  }
  const stop = () => {
    if (stopTask) return stopTask;
    plannedStop = true;
    clearTimeout(timer);
    stopTask = (async () => {
      let killSucceeded = null;
      if (
        !closed &&
        !exited &&
        processChild.exitCode === null &&
        processChild.signalCode === null
      ) {
        try {
          assert(Number.isSafeInteger(processChild.pid) && processChild.pid > 0);
          killTree(processChild.pid);
          killSucceeded = true;
        } catch {
          killSucceeded = false;
        }
      }
      let waitTimer;
      try {
        await Promise.race([
          done,
          new Promise((resolve) => {
            waitTimer = setTimeout(resolve, 5000);
          }),
        ]);
      } finally {
        clearTimeout(waitTimer);
      }
      const confirmed = closed && killSucceeded !== false;
      if (!confirmed) fail('held-actor-termination-unconfirmed');
      return {
        role,
        deadlineMs,
        modelRequestReleased: false,
        reportedTotalCostUsd: null,
        deadlineExpired,
        exit,
        killSucceeded,
        confirmed,
        stoppedBeforeHookExpiry: closed && performance.now() - startedAt < 90000,
        stdoutBytes: Math.min(stdoutBytes, 65537),
        stderrBytes: Math.min(stderrBytes, 65537),
        failure,
      };
    })();
    return stopTask;
  };
  timer = setTimeout(() => {
    deadlineExpired = true;
    fail('held-actor-deadline');
    void stop();
  }, deadlineMs);
  return {
    child: processChild,
    role,
    done,
    stop,
    held: () =>
      !closed &&
      !exited &&
      !plannedStop &&
      !failure &&
      processChild.exitCode === null &&
      processChild.signalCode === null,
  };
}

/** Bound restoration of the Read-only scheduling wrapper without holding owned cleanup.
 * @param {object} application Owned Playwright app. @returns {Promise<boolean>} Restoration acknowledged.
 * @since v0.21.0 */
async function restoreReadOverlap(application) {
  let deadline;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => application.evaluate(() => globalThis.__w4ReadOverlap?.restore()))
        .then(
          () => true,
          () => false,
        ),
      new Promise((resolve) => {
        deadline = setTimeout(() => resolve(false), 1000);
      }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
}

function cancelScenario(reason) {
  scenarioFailure ??= reason;
  for (const actor of heldActors) void actor.stop();
  if (!primaryCancelAttempted && child?.exitCode === null && child?.signalCode === null) {
    primaryCancelAttempted = true;
    try {
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: 5000,
      });
      primaryCancelSucceeded = true;
    } catch {
      primaryCancelSucceeded = false;
      /* The final receipt requires confirmed owned cleanup. */
    }
  }
}
function requireScenarioHealthy() {
  assert.equal(scenarioFailure, null, 'owned-instance-scenario-cancelled');
}
let app,
  appChild,
  page,
  child,
  timer,
  childDone,
  processPreflight = null,
  writePreflightDiagnostic = null,
  pendingReceipt = null,
  failedReceipt = null,
  ownerScanTiming = null,
  sourceBefore = null,
  hashesBefore = null,
  outputCreated = false,
  modelRequestReleased = false;

function sourceIdentity() {
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
    }).trim();
  return {
    head: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'),
    clean: git('status', '--porcelain', '--untracked-files=normal') === '',
  };
}
async function componentHashes() {
  const files = [
    'src/main/live-tool-context.js',
    'src/main/live-session-file.js',
    'src/main/file-watcher.js',
    'src/main/attribution.js',
    'src/main/project-watch-selection.js',
    'src/main/process-utils.js',
    'src/main/live-session-process.js',
    'src/main/session-context.js',
    'src/main/session-context-parser.js',
    'src/main/tool-context-record.js',
    'src/main/main.js',
    'src/main/ipc-handlers.js',
    'src/main/preload.js',
    'scripts/qualification/live-tool-context-claude.cjs',
    'build/sidecar/aegis-procsnap.exe',
    'build/sidecar/aegis-observer.exe',
    'dist/renderer/index.html',
  ];
  return Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        file,
        createHash('sha256')
          .update(await fs.readFile(path.join(root, file)))
          .digest('hex'),
      ]),
    ),
  );
}

async function waitFile(name, timeout = 90000, stageRoot = out, stageChild = child) {
  const start = Date.now();
  for (;;) {
    try {
      return JSON.parse(await fs.readFile(path.join(stageRoot, name), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (
      stageChild?.exitCode !== null ||
      stageChild?.signalCode !== null ||
      Date.now() - start > timeout
    )
      throw Error('claude-stage-unavailable:' + name);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// The genuine writer owns this file. This oracle reads bounded private bytes only.
async function genuineReadRecord(requireResult = false) {
  const { bytes } = await require('../../src/main/live-session-file').readLiveSessionFile(
    transcript,
    512 * 1024,
    true,
  );
  try {
    const rows = bytes
      .toString('utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map(JSON.parse);
    const selected = rows
      .filter((row) => row.type === 'assistant' && row.sessionId === id)
      .flatMap((row) => (Array.isArray(row.message?.content) ? row.message.content : []))
      .filter(
        (part) =>
          part.type === 'tool_use' &&
          part.name === selectedTool &&
          path.resolve(part.input?.file_path ?? '').toLowerCase() === file.toLowerCase(),
      );
    assert.equal(selected.length, 1);
    if (requireResult) {
      const results = rows
        .filter((row) => row.type === 'user' && row.sessionId === id)
        .flatMap((row) => (Array.isArray(row.message?.content) ? row.message.content : []))
        .filter((part) => part.type === 'tool_result' && part.tool_use_id === selected[0].id);
      assert.equal(results.length, 1);
      assert(results[0].is_error !== true);
      if (mode === 'read') assert(JSON.stringify(results[0].content).includes(marker));
    }
    const version = rows.find(
      (row) =>
        row.type === 'assistant' &&
        row.sessionId === id &&
        row.message?.content?.some?.((part) => part.id === selected[0].id),
    )?.version;
    assert(
      typeof version === 'string' &&
        /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version),
    );
    return { callId: selected[0].id, version };
  } catch {
    throw Error('genuine-read-record-unavailable');
  } finally {
    bytes.fill(0);
  }
}
/** Write one child's fresh private hook/settings files without reusing release bits.
 * @param {string} stageRoot Fresh owned barrier directory. @param {string} tool Selected tool.
 * @param {string} target Owned tool target. @returns {Promise<string>} Settings filename. @since v0.21.0 */
async function prepareActorSettings(stageRoot, tool, target) {
  const hookFile = path.join(stageRoot, 'hook.cjs');
  await fs.writeFile(
    hookFile,
    `const fs=require('node:fs');const path=require('node:path');const root=${JSON.stringify(stageRoot)};
let bytes=0,text='';process.stdin.setEncoding('utf8');process.stdin.on('data',v=>{bytes+=Buffer.byteLength(v);if(bytes>65536)process.exit(2);text+=v});process.stdin.on('end',async()=>{
try {const row=JSON.parse(text);const kind=row.hook_event_name;const data={kind,sessionId:row.session_id,at:Date.now(),tool:row.tool_name||null};
const stage=kind==='PreToolUse'&&row.tool_name===${JSON.stringify(tool)}&&row.tool_input?.file_path===${JSON.stringify(target)}?${JSON.stringify(tool)}:kind==='SessionStart'||kind==='Stop'?kind:null;
if(stage){fs.writeFileSync(path.join(root,stage==='Read'?'read.json':stage==='Write'?'write.json':stage+'.json'),JSON.stringify(data));const release=path.join(root,'release-'+stage);const start=Date.now();while(!fs.existsSync(release)&&Date.now()-start<90000)await new Promise(r=>setTimeout(r,100));}
}catch{process.exitCode=2;}});`,
    { flag: 'wx' },
  );
  const command = `"${process.execPath.replaceAll('\\', '/')}" "${hookFile.replaceAll('\\', '/')}"`;
  const settings = path.join(stageRoot, 'settings.json');
  await fs.writeFile(
    settings,
    JSON.stringify({
      hooks: Object.fromEntries(
        ['SessionStart', 'PreToolUse', 'Stop'].map((name) => [
          name,
          [{ hooks: [{ type: 'command', command, timeout: 100 }] }],
        ]),
      ),
    }),
    { flag: 'wx' },
  );
  return settings;
}
async function main() {
  assert(['read', 'write'].includes(mode), 'unknown-qualification-mode');
  assert(['single', 'instances-restart'].includes(scenario), 'unknown-qualification-scenario');
  assert(scenario === 'single' || mode === 'write', 'instance-scenario-requires-write');
  let peerOwner, peerRoot, peerProject, primaryAuditRows;
  const outputParent = path.dirname(out);
  const outputParentStat = await fs.lstat(outputParent);
  assert(
    outputParentStat.isDirectory() && !outputParentStat.isSymbolicLink(),
    'owned-output-parent-unavailable',
  );
  assert.equal((await fs.realpath(outputParent)).toLowerCase(), outputParent.toLowerCase());
  await fs.mkdir(out); // EEXIST refuses every prior attempt before writing anything.
  outputCreated = true;
  if (mode === 'write' && scenario === 'single') {
    for (const directory of [root, path.join(root, 'out'), path.join(root, 'out', 'development')]) {
      await fs.mkdir(directory, { recursive: true });
      const stat = await fs.lstat(directory);
      assert(stat.isDirectory() && !stat.isSymbolicLink(), 'owned-write-parent-unavailable');
      assert.equal(
        (await fs.realpath(directory)).toLowerCase(),
        path.resolve(directory).toLowerCase(),
      );
    }
    await fs.mkdir(path.dirname(project)); // Fresh owned run, never a pre-existing project.
  }
  await fs.mkdir(project, { recursive: true });
  sourceBefore = sourceIdentity();
  assert(sourceBefore.clean, 'Qualification source must be clean');
  hashesBefore = await componentHashes();
  if (mode === 'read') await fs.writeFile(file, marker + '\n');
  const settings = await prepareActorSettings(out, selectedTool, file);
  const profile = path.join(out, 'profile');
  if (scenario === 'instances-restart')
    projectSelectionDiagnostic = await seedOwnedProjectSelection(profile, project, root);
  const config = JSON.parse(
    await fs
      .readFile(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8')
      .catch(() => '{}'),
  );
  if (scenario === 'instances-restart')
    assert.equal(config.model, 'opus', 'configured-model-must-remain-opus');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CLAUDECODE;
  app = await electron.launch({
    args: [
      root,
      '--user-data-dir=' + profile,
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
    env,
    timeout: 45000,
  });
  appChild = app.process();
  if (scenario === 'instances-restart') {
    const actual = await app.evaluate(({ app }) => app.getPath('userData'));
    assert.equal(
      path.resolve(actual).toLowerCase(),
      path.resolve(profile).toLowerCase(),
      'owned-profile-not-active',
    );
    projectSelectionDiagnostic.appUserDataMatched = true;
  }
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page
    .getByRole('heading', { name: 'Monitoring', exact: true, level: 1 })
    .waitFor({ timeout: 30000 });
  const preflightDeadline = Date.now() + 30000;
  for (;;) {
    processPreflight = await app.evaluate(({ app }) => {
      const require = process.mainModule
        .require('node:module')
        .createRequire(app.getAppPath() + '/package.json');
      const snapshot = require('./src/main/platform/process-snapshot');
      const health = snapshot.getSnapshotHealth(),
        source = snapshot.getSourceStats();
      const client = require('./src/main/platform/proc-snapshot-client').getState();
      const stats = require('./src/main/main.js').getStats(),
        appHealth = stats.appHealth ?? {};
      const choice = (value, allowed) => (allowed.includes(value) ? value : null);
      const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
      const flag = (value) => (typeof value === 'boolean' ? value : null);
      return {
        snapshot: {
          state: choice(health.state, ['STARTING', 'HEALTHY', 'DEGRADED', 'FAILED']),
          lastAttemptAt: count(health.lastAttemptAt),
          lastSuccessAt: count(health.lastSuccessAt),
          lastError: choice(health.lastError, [
            null,
            'proc-snapshot-unavailable',
            'no provider produced a process map',
            'sidecar not used',
          ]),
          consecutiveFailures: count(health.consecutiveFailures),
          lossCount: count(health.lossCount),
          detail: choice(health.detail, [null, 'basic', 'class5', 'cim-fallback', 'none', 'cim']),
        },
        mode: choice(snapshot.getMode(), ['auto', 'strict', 'cim']),
        source: {
          lastSource: choice(source.lastSource, [null, 'basic', 'class5', 'cim', 'none']),
          transitions: count(source.transitions),
        },
        client: {
          available: flag(client.available),
          connected: flag(client.connected),
          failures: count(client.failures),
          sticky:
            client.sticky === null
              ? null
              : (choice(client.sticky, [
                  'restart budget exhausted',
                  'protocol version mismatch',
                  'hello carried no usable capability block',
                  'sidecar binary not found',
                ]) ?? 'unrecognized'),
          caps: client.caps
            ? {
                class: choice(client.caps.class, ['basic', 'class5']),
                sequence: flag(client.caps.sequence),
                topology: flag(client.caps.topology),
              }
            : null,
        },
        population: {
          state: choice(appHealth.populationState, [
            null,
            'STARTING',
            'HEALTHY',
            'DEGRADED',
            'FAILED',
          ]),
          reliable: flag(appHealth.populationReliable),
          observedAt: count(appHealth.populationAsOf),
          identityQuality: choice(appHealth.identityQuality, [
            null,
            'witnessed',
            'birth-time',
            'unknown',
          ]),
          degraded: flag(appHealth.identityDegraded),
        },
        cadence: {
          maxProcessGapMs: count(stats.scanCadence?.maxProcessGapMs),
          skippedProcessTicks: count(stats.scanCadence?.skippedProcessTicks),
        },
      };
    });
    if (
      processPreflight.snapshot.lastAttemptAt !== null &&
      (processPreflight.snapshot.state !== 'HEALTHY' ||
        ![null, 'STARTING'].includes(processPreflight.population.state))
    )
      break;
    if (Date.now() >= preflightDeadline) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(
    processPreflight.snapshot.lastAttemptAt !== null &&
      processPreflight.snapshot.state === 'HEALTHY' &&
      processPreflight.snapshot.lossCount === 0 &&
      ['auto', 'strict'].includes(processPreflight.mode) &&
      ['basic', 'class5'].includes(processPreflight.source.lastSource) &&
      processPreflight.client.available === true &&
      processPreflight.client.connected === true &&
      processPreflight.client.sticky === null &&
      processPreflight.population.state === 'HEALTHY' &&
      processPreflight.population.reliable === true &&
      processPreflight.population.identityQuality === 'witnessed' &&
      processPreflight.population.degraded === false,
    'process-snapshot-preflight-unqualified',
  );
  const processGap = processPreflight.cadence.maxProcessGapMs;
  assert(
    Number.isSafeInteger(processGap) && processGap > 0 && processGap + 5000 <= 60000,
    'process-scan-cadence-unqualified',
  );
  const ownerWaitMs = processGap + 5000;
  if (scenario === 'instances-restart') {
    const status = await page.evaluate(() => window.aegis.controlProjectWatch('status'));
    assert(
      status?.success === true &&
        status.code === 'SELECTED' &&
        status.selected === true &&
        status.available === true,
      'persisted-external-project-not-selected',
    );
    projectSelectionDiagnostic.publicStatusSelected = true;
  }
  if (mode === 'write') {
    const readyDeadline = Date.now() + 30000;
    for (;;) {
      const ready = await app.evaluate(({ app }) => {
        const require = process.mainModule
          .require('node:module')
          .createRequire(app.getAppPath() + '/package.json');
        const root = require('./src/main/file-watcher')
          .getWatchPlan()
          .groups.find((group) => group.id === 'project-dir');
        return root?.state === 'ready' && root.hasLiveWatcher === true;
      });
      if (ready) {
        if (projectSelectionDiagnostic) projectSelectionDiagnostic.projectRootReady = true;
        break;
      }
      assert(Date.now() < readyDeadline, 'real-project-watcher-not-ready');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  ownerScanTiming = {
    maxProcessGapMs: processGap,
    ownerWaitMs,
    subscribedAt: Date.now(),
    claudeSpawnedAt: null,
    sessionStartAt: null,
    ownerObservedAt: null,
  };
  await page.evaluate(() => {
    window.__w4Agents = [];
    window.__w4BatchCount = 0;
    window.__w4FirstBatchAt = null;
    window.__w4LastBatchAt = null;
    window.aegis.onScanBatch((batch) => {
      window.__w4BatchCount++;
      window.__w4FirstBatchAt ??= Date.now();
      window.__w4LastBatchAt = Date.now();
      if (Array.isArray(batch.agents)) window.__w4Agents = batch.agents;
    });
    window.__w4Delivered = false;
  });
  const args = [
    '--print',
    '--output-format',
    'json',
    '--session-id',
    id,
    '--setting-sources',
    '',
    '--settings',
    settings,
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--tools',
    selectedTool,
    '--allowedTools',
    selectedTool,
    '--max-budget-usd',
    '0.50',
  ];
  if (config.model) args.push('--model', config.model);
  args.push(
    mode === 'write'
      ? `Use the Write tool exactly once on ${file} with the exact content ${JSON.stringify(marker + '\n')}. Do not use another tool. Then reply exactly WRITE_OK without quoting the file.`
      : `Use the Read tool exactly once on ${file} with limit 5. Do not use another tool. Then reply exactly READ_OK without quoting the file.`,
  );
  if (scenario === 'instances-restart') {
    peerRoot = path.join(out, 'peer');
    peerProject = path.join(path.dirname(project), 'peer-project');
    await fs.mkdir(peerRoot);
    await fs.mkdir(peerProject);
    const peerId = randomUUID();
    const peerSettings = await prepareActorSettings(
      peerRoot,
      selectedTool,
      path.join(peerProject, 'peer-unwritten.txt'),
    );
    const peerArgs = args.slice(0, -1);
    peerArgs[peerArgs.indexOf('--session-id') + 1] = peerId;
    peerArgs[peerArgs.indexOf('--settings') + 1] = peerSettings;
    peerArgs.push('Remain idle until the task owner releases the startup barrier.');
    const peer = spawn(cli, peerArgs, {
      cwd: peerProject,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    peerOwner = createHeldOwner(peer, 'peer', { onFailure: cancelScenario });
    peerOwner.sessionId = peerId;
    heldActors.push(peerOwner);
  }
  child = spawn(cli, args, {
    cwd: project,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  ownerScanTiming.claudeSpawnedAt = Date.now();
  let output = '',
    stderrBytes = 0;
  child.stdout.on('data', (value) => {
    if (output.length < 65536) output += value.toString('utf8');
  });
  child.stderr.on('data', (value) => {
    stderrBytes += value.length;
  });
  childDone = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', () => resolve({ code: -1 }));
  });
  timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null && !primaryCancelAttempted) {
      primaryCancelAttempted = true;
      try {
        execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          timeout: 5000,
        });
        primaryCancelSucceeded = true;
      } catch {
        primaryCancelSucceeded = false;
        /* Final cleanup records an unconfirmed exit and preserves failure. */
      }
    }
  }, 150000);
  console.log('Started owned Claude process; configured model preserved');
  const start = await waitFile('SessionStart.json');
  ownerScanTiming.sessionStartAt = Date.now();
  assert.equal(start.sessionId, id);
  if (peerOwner) {
    const peerStage = await waitFile('SessionStart.json', 45000, peerRoot, peerOwner.child);
    assert.equal(peerStage.sessionId, peerOwner.sessionId);
    assert.notEqual(peerStage.sessionId, id);
    requireScenarioHealthy();
  }
  await page.waitForFunction(
    ({ pid, peer }) =>
      [pid, ...(peer === null ? [] : [peer])].every((wanted) =>
        window.__w4Agents.some(
          (row) =>
            row.pid === wanted && row.agent === 'Claude Code' && row.instanceIdSource === 'os',
        ),
      ),
    { pid: child.pid, peer: peerOwner?.child.pid ?? null },
    { polling: 100, timeout: ownerWaitMs },
  );
  ownerScanTiming.ownerObservedAt = Date.now();
  Object.assign(
    ownerScanTiming,
    await page.evaluate(() => ({
      batchCount: window.__w4BatchCount,
      firstBatchAt: window.__w4FirstBatchAt,
      lastBatchAt: window.__w4LastBatchAt,
    })),
  );
  const observed = await page.evaluate((pid) => {
    const row = window.__w4Agents.find((a) => a.pid === pid);
    return {
      pid: row.pid,
      startTime: row.startTime,
      instanceId: row.instanceId,
      createTime100ns: row.createTime100ns,
      cwd: row.cwd,
    };
  }, child.pid);
  assert(
    Number.isSafeInteger(observed.startTime) &&
      observed.instanceId === `${observed.pid}:${observed.startTime}` &&
      typeof observed.createTime100ns === 'string' &&
      /^[1-9][0-9]{0,19}$/.test(observed.createTime100ns) &&
      Number((BigInt(observed.createTime100ns) - 116444736000000000n) / 10000n) ===
        observed.startTime,
    'claude-process-birth-unqualified',
  );
  console.log('Production scanner observed real Claude generation');
  if (peerOwner) {
    assert(peerOwner.held(), 'peer-must-remain-at-session-start');
    peerPreflightDiagnostic = await page.evaluate(peerComponentDiagnostic, {
      pid: peerOwner.child.pid,
      primaryPid: child.pid,
      cwd: peerProject,
    });
    assert(
      peerPreflightDiagnostic.sameNameCount === 2 &&
        peerPreflightDiagnostic.primaryPresent &&
        peerPreflightDiagnostic.rowUnique &&
        peerPreflightDiagnostic.agentExpected &&
        peerPreflightDiagnostic.sourceExpected &&
        peerPreflightDiagnostic.keyCoherent &&
        peerPreflightDiagnostic.rawBirthValid &&
        peerPreflightDiagnostic.birthMatchesStart &&
        peerPreflightDiagnostic.witnessSourceEnum === 'createTime100ns' &&
        peerPreflightDiagnostic.witnessMatchesRaw &&
        peerPreflightDiagnostic.cwdPresent &&
        peerPreflightDiagnostic.cwdMatchesExpected,
      'peer-generation-and-disjoint-cwd-unavailable',
    );
    instanceStages.peerHeldDuringPrimary = true;
  }
  if (mode === 'write') {
    writePreflightDiagnostic = await page.evaluate(
      ({ pid, target, project }) => {
        const normalized = target.replaceAll('\\', '/').toLowerCase();
        const agents = window.__w4Agents;
        const candidates = agents.filter((row) => {
          if (row.category !== 'ai' || typeof row.cwd !== 'string') return false;
          const cwd = row.cwd.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
          return normalized === cwd || normalized.startsWith(cwd + '/');
        });
        const ownedRows = agents.filter((row) => row.pid === pid);
        const owned = ownedRows.length === 1 ? ownedRows[0] : null;
        const raw = owned?.createTime100ns;
        const rawbirthValid =
          typeof raw === 'string' &&
          /^[1-9][0-9]{0,19}$/.test(raw) &&
          BigInt(raw) <= 18446744073709551615n;
        const cwdPresent = typeof owned?.cwd === 'string' && owned.cwd.length > 0;
        return {
          candidateCount: Math.min(candidates.length, 128),
          ownedCandidateCount: Math.min(candidates.filter((row) => row.pid === pid).length, 128),
          cwdPresent,
          cwdMatchesProject:
            cwdPresent &&
            owned.cwd.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase() ===
              project.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase(),
          categoryExpected: owned?.category === 'ai',
          rawbirthValid,
          keyCoherent:
            owned?.instanceIdSource === 'os' &&
            Number.isSafeInteger(owned.startTime) &&
            owned.startTime > 0 &&
            owned.instanceId === `${pid}:${owned.startTime}` &&
            rawbirthValid &&
            Number((BigInt(raw) - 116444736000000000n) / 10000n) === owned.startTime,
          witnessSourceEnum: ['createTime100ns', 'sequence', 'startTimeMs'].includes(
            owned?.generationWitnessSource,
          )
            ? owned.generationWitnessSource
            : 'unavailable',
          witnessMatchesRaw:
            typeof owned?.generationWitness === 'string' && owned.generationWitness === raw,
        };
      },
      { pid: child.pid, target: file, project },
    );
    assert(
      writePreflightDiagnostic.candidateCount === 1 &&
        writePreflightDiagnostic.ownedCandidateCount === 1 &&
        writePreflightDiagnostic.cwdPresent &&
        writePreflightDiagnostic.cwdMatchesProject &&
        writePreflightDiagnostic.categoryExpected &&
        writePreflightDiagnostic.rawbirthValid &&
        writePreflightDiagnostic.keyCoherent &&
        writePreflightDiagnostic.witnessSourceEnum === 'createTime100ns' &&
        writePreflightDiagnostic.witnessMatchesRaw,
      'write-owner-not-unique',
    );
    await page.evaluate((target) => {
      window.__w4WriteEvents = [];
      window.aegis.onFileAccess((values) => {
        for (const row of Array.isArray(values) ? values : [values]) {
          if (
            typeof row.file === 'string' &&
            row.file.replaceAll('\\', '/').toLowerCase() === target &&
            window.__w4WriteEvents.length < 4
          )
            window.__w4WriteEvents.push(row);
        }
      });
    }, file.replaceAll('\\', '/').toLowerCase());
  }
  requireScenarioHealthy();
  await fs.writeFile(path.join(out, 'release-SessionStart'), 'release');
  modelRequestReleased = true;
  if (peerOwner) instanceStages.primaryOnlyModelReleased = true;
  let callId,
    writeObservation = null,
    activeReply,
    overlap;
  if (mode === 'write') {
    const stage = await waitFile('write.json');
    assert.equal(stage.sessionId, id);
    callId = await genuineReadRecord();
    assert.equal(
      await fs.stat(file).then(
        () => true,
        (error) => {
          if (error.code !== 'ENOENT') throw error;
          return false;
        },
      ),
      false,
      'write-target-must-not-preexist',
    );
    requireScenarioHealthy();
    await fs.writeFile(path.join(out, 'release-Write'), 'release');
    await page.waitForFunction(
      () => window.__w4WriteEvents.some((row) => ['created', 'modified'].includes(row.action)),
      null,
      { timeout: 20000, polling: 100 },
    );
    const event = await page.evaluate(() =>
      window.__w4WriteEvents.find((row) => ['created', 'modified'].includes(row.action)),
    );
    assert.equal(event.pid, observed.pid);
    assert.equal(event.instanceId, observed.instanceId);
    assert.equal(event.createTime100ns, observed.createTime100ns);
    assert.deepEqual(event.attribution, { status: 'inferred', evidence: ['cwd-containment'] });
    assert.match(event.eventId, /^[a-f0-9-]{36}$/i);
    writeStages.watcherEventVerified = true;
    eventId = event.eventId; // Only the actual accepted watcher UUID selects history.
    writeObservation = {
      eventId,
      action: event.action,
      attribution: event.attribution,
      candidateSnapshotBirthPreserved: true,
      osIssuerConfirmed: false,
      eventInjected: false,
    };
    console.log('Production FileWatcher delivered the genuine Claude write');
  } else {
    const read = await waitFile('read.json');
    assert.equal(read.sessionId, id);
    callId = await genuineReadRecord();
    console.log('Genuine Read record present; Claude held before the actual tool');
    await page.evaluate((selected) => {
      const off = window.aegis.onFileAccess((value) => {
        if ((Array.isArray(value) ? value : [value]).some((row) => row.eventId === selected)) {
          window.__w4Delivered = true;
          off();
        }
      });
    }, eventId);
    await app.evaluate(
      async ({ app }, data) => {
        const require = process.mainModule
          .require('node:module')
          .createRequire(app.getAppPath() + '/package.json');
        require('./src/main/main.js').onFileEvent({
          ...data.observed,
          eventId: data.eventId,
          agent: 'Claude Code',
          timestamp: data.at,
          file: data.file,
          action: 'accessed',
          category: 'ai',
          sensitive: false,
          attribution: { status: 'inferred', evidence: [] },
        });
        require('./src/main/audit-logger.js').flush();
      },
      { observed, eventId, at: read.at, file },
    );
    await page.waitForFunction(() => window.__w4Delivered, null, { polling: 100 });
    await app.evaluate(({ app }, selected) => {
      const require = process.mainModule
        .require('node:module')
        .createRequire(app.getAppPath() + '/package.json');
      const io = require('node:fs').promises;
      const path = require('node:path');
      const originalOpen = io.open;
      let handle,
        originalRead,
        originalClose,
        wrappedRead,
        wrappedClose,
        cancelled = false;
      const state = {
        captured: false,
        growthObserved: false,
        heldFileIdentityUnchanged: false,
        beforeSize: null,
        afterSize: null,
        firstReadBytes: 0,
        totalReadBytes: 0,
        readCalls: 0,
        pauseMs: 0,
        closed: false,
        restored: false,
      };
      const restore = () => {
        if (io.open === wrappedOpen) io.open = originalOpen;
        if (handle?.read === wrappedRead) handle.read = originalRead;
        if (handle?.close === wrappedClose) handle.close = originalClose;
        state.restored = true;
      };
      const wrappedOpen = async function (...args) {
        const opened = await originalOpen.apply(this, args);
        if (
          cancelled ||
          handle ||
          typeof args[0] !== 'string' ||
          path.resolve(args[0]).toLowerCase() !== selected.toLowerCase()
        )
          return opened;
        handle = opened;
        io.open = originalOpen; // One selected handle only; other app IO is untouched.
        originalRead = handle.read;
        originalClose = handle.close;
        wrappedRead = async function (...parameters) {
          const result = await originalRead.apply(this, parameters);
          state.readCalls++;
          state.totalReadBytes += result.bytesRead;
          if (!state.captured) {
            const before = await handle.stat({ bigint: true });
            state.beforeSize = Number(before.size);
            state.firstReadBytes = result.bytesRead;
            state.captured = true;
            const at = Date.now();
            // Only scheduling is controlled. All bytes/stat results remain real.
            while (!cancelled && Date.now() - at < 1000) {
              const after = await handle.stat({ bigint: true });
              if (after.size > before.size) {
                state.afterSize = Number(after.size);
                state.heldFileIdentityUnchanged =
                  after.dev === before.dev && after.ino === before.ino && after.nlink === 1n;
                state.growthObserved = state.heldFileIdentityUnchanged;
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            state.pauseMs = Date.now() - at;
            if (!state.growthObserved || cancelled)
              throw Error('genuine-transcript-append-not-observed');
          }
          return result;
        };
        wrappedClose = async function (...parameters) {
          try {
            const result = await originalClose.apply(this, parameters);
            state.closed = true;
            return result;
          } finally {
            restore();
          }
        };
        handle.read = wrappedRead;
        handle.close = wrappedClose;
        return handle;
      };
      io.open = wrappedOpen;
      globalThis.__w4ReadOverlap = {
        snapshot: () => ({ ...state }),
        restore: () => {
          cancelled = true;
          restore();
        },
      };
    }, transcript);
    const activeRequest = page
      .evaluate((selected) => window.aegis.explainToolContext(selected), eventId)
      .catch(() => null);
    try {
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline) {
        const captured = await app.evaluate(() => globalThis.__w4ReadOverlap.snapshot().captured);
        if (captured) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert(
        await app.evaluate(() => globalThis.__w4ReadOverlap.snapshot().captured),
        'reader-window-not-captured',
      );
      await fs.writeFile(path.join(out, 'release-Read'), 'release');
      activeReply = await activeRequest;
      overlap = await app.evaluate(() => globalThis.__w4ReadOverlap.snapshot());
      assert(
        overlap.captured &&
          overlap.growthObserved &&
          overlap.heldFileIdentityUnchanged &&
          overlap.closed &&
          overlap.restored,
      );
      assert(
        overlap.afterSize > overlap.beforeSize &&
          overlap.readCalls >= 2 &&
          overlap.totalReadBytes <= 512 * 1024,
      );
      assert.equal(activeReply?.availability, 'partial');
      assert.equal(activeReply.toolContext.sessionBinding, 'unavailable');
      assert.equal(activeReply.toolContext.strength, 'inferred');
      assert(
        activeReply.toolContext.reasons.includes('partial-source') &&
          activeReply.toolContext.reasons.includes('clock-skew-assumed-local'),
      );
      assert(activeReply.toolContext.candidates.some((row) => row.toolName === 'Read'));
      assert(!JSON.stringify(activeReply).includes(marker));
    } finally {
      await restoreReadOverlap(app);
      await activeRequest;
    }
  }
  const stop = await waitFile('Stop.json');
  assert.equal(stop.sessionId, id);
  assert.deepEqual(await genuineReadRecord(true), callId);
  if (mode === 'write') {
    const bytes = await fs.readFile(file);
    try {
      assert(bytes.equals(Buffer.from(marker + '\n')), 'genuine-write-bytes-mismatch');
      writeObservation.outputBytes = bytes.length;
      writeObservation.outputSha256 = createHash('sha256').update(bytes).digest('hex');
      writeStages.independentWriteVerified = true;
      if (peerOwner) {
        assert.equal(
          await fs.stat(path.join(peerProject, 'peer-unwritten.txt')).then(
            () => true,
            (error) => {
              if (error.code !== 'ENOENT') throw error;
              return false;
            },
          ),
          false,
        );
        instanceStages.primaryOnlyWriteVerified = true;
      }
    } finally {
      bytes.fill(0);
    }
    writeObservation.auditBefore = await app.evaluate(async ({ app }, target) => {
      const require = process.mainModule
        .require('node:module')
        .createRequire(app.getAppPath() + '/package.json');
      const audit = require('./src/main/audit-logger');
      audit.flush();
      return (
        await audit.getEntriesBefore(new Date(Date.now() + 1000).toISOString(), 500, [
          'file-access',
        ])
      ).filter((row) => row.path === target);
    }, file);
    assert(
      writeObservation.auditBefore.some(
        (row) =>
          row.pid === observed.pid &&
          row.instanceId === observed.instanceId &&
          row.action === writeObservation.action &&
          row.attribution?.status === 'inferred',
      ),
      'genuine-write-audit-unavailable',
    );
    writeStages.auditMatched = true;
  }
  console.log(`Genuine ${selectedTool} succeeded and Claude is held at Stop`);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const reply = await page.evaluate(
    (selected) => window.aegis.explainToolContext(selected),
    eventId,
  );
  const nextRequestAfter = Date.now() + 1000;
  assert.equal(reply.toolContext.sessionBinding, 'confirmed', JSON.stringify(reply));
  assert.equal(reply.toolContext.strength, 'inferred');
  assert(reply.toolContext.candidates.some((row) => row.toolName === selectedTool));
  assert(!JSON.stringify(reply).includes(marker));
  if (mode === 'write') writeStages.stableIPCBinding = true;
  // Reuse the returned explanation's real UI command after the one-second rate gate.
  await page
    .locator('.sidebar')
    .getByRole('button', { name: 'Events', exact: true })
    .evaluate((button) => button.click());
  await page.getByLabel('Search events').fill(path.basename(file));
  const resourceButton =
    mode === 'write'
      ? page.locator('.observation-open').filter({ has: page.getByTitle(file, { exact: true }) })
      : page.locator('.observation-open').first();
  if (mode === 'write') assert.equal(await resourceButton.count(), 1, 'write-resource-not-unique');
  await resourceButton.evaluate((button) => button.click());
  await page.waitForFunction(
    () =>
      document.querySelector('.tool-context button') ||
      document.querySelector('.observation-history .recent-event'),
  );
  if (await page.locator('.observation-history .recent-event').count()) {
    const selected =
      mode === 'write'
        ? page.locator('[data-detail-focus="record-event:' + eventId + ':0"]')
        : page.locator('.observation-history .recent-event').first();
    await selected.evaluate((button) => button.click());
  }
  const section = page.getByRole('region', { name: 'Preceding tool call' });
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, nextRequestAfter - Date.now())));
  await section
    .getByRole('button', { name: 'Explain from local history' })
    .evaluate((button) => button.click());
  await section.getByText('Claude Code · ' + selectedTool, { exact: true }).waitFor();
  const rendered = await section.innerText();
  assert(rendered.includes('Recorded session binding; association limited'));
  assert(!rendered.includes(marker));
  if (mode === 'write') writeStages.DOMDetailsVerified = true;
  await fs.writeFile(path.join(out, 'rendered-explanation.txt'), rendered);
  if (mode === 'write') {
    const auditAfter = await app.evaluate(async ({ app }, target) => {
      const require = process.mainModule
        .require('node:module')
        .createRequire(app.getAppPath() + '/package.json');
      const audit = require('./src/main/audit-logger');
      return (
        await audit.getEntriesBefore(new Date(Date.now() + 1000).toISOString(), 500, [
          'file-access',
        ])
      ).filter((row) => row.path === target);
    }, file);
    for (const original of writeObservation.auditBefore) {
      assert(
        Number.isSafeInteger(original.seq) &&
          original.seq >= 0 &&
          typeof original.hash === 'string' &&
          /^[a-f0-9]{64}$/i.test(original.hash),
        'original-audit-custody-fields-unavailable',
      );
      const retained = auditAfter.filter(
        (row) => row.seq === original.seq && row.hash === original.hash,
      );
      assert.equal(retained.length, 1, 'original-audit-record-not-retained');
      assert.deepEqual(retained[0], original, 'original-audit-record-changed');
    }
    const auditBytes = JSON.stringify(auditAfter);
    assert(!auditBytes.includes(marker));
    writeObservation.originalRecordsPreserved = true;
    writeStages.originalAuditRowsPreserved = true;
    writeObservation.originalAuditRecords = writeObservation.auditBefore.length;
    writeObservation.observedAuditRecordsAfter = auditAfter.length;
    writeObservation.auditSha256 = createHash('sha256').update(auditBytes).digest('hex');
    if (peerOwner) primaryAuditRows = writeObservation.auditBefore;
    delete writeObservation.auditBefore;
  }
  if (peerOwner) {
    requireScenarioHealthy();
    assert(peerOwner.held(), 'peer-was-not-held-through-primary-proof');
    const stopped = await peerOwner.stop();
    assert(stopped.confirmed && stopped.stoppedBeforeHookExpiry, 'held-peer-cleanup-unconfirmed');
    requireScenarioHealthy();
    instanceStages.peerRetiredBeforeRestart = true;
  }
  requireScenarioHealthy();
  await fs.writeFile(path.join(out, 'release-Stop'), 'release');
  const exit = await childDone;
  clearTimeout(timer);
  assert.equal(exit.code, 0, 'Genuine Claude did not complete');
  const result = JSON.parse(output);
  primaryReportedCost =
    Number.isFinite(result.total_cost_usd) && result.total_cost_usd >= 0
      ? result.total_cost_usd
      : null;
  assert(!result.is_error, 'Genuine Claude reported failure');
  assert(result.result.includes(mode === 'write' ? 'WRITE_OK' : 'READ_OK'));
  if (scenario === 'instances-restart') {
    const replacementRoot = path.join(out, 'replacement');
    await fs.mkdir(replacementRoot); // Never reuse the primary's already released barriers.
    const replacementSettings = await prepareActorSettings(replacementRoot, selectedTool, file);
    const replacementArgs = args.slice(0, -1);
    replacementArgs[replacementArgs.indexOf('--session-id')] = '--resume';
    replacementArgs[replacementArgs.indexOf('--settings') + 1] = replacementSettings;
    replacementArgs.push('Remain idle until the task owner releases the startup barrier.');
    const replacement = spawn(cli, replacementArgs, {
      cwd: project,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const replacementOwner = createHeldOwner(replacement, 'replacement', {
      onFailure: cancelScenario,
    });
    heldActors.push(replacementOwner);
    const replacementStage = await waitFile(
      'SessionStart.json',
      45000,
      replacementRoot,
      replacement,
    );
    assert.equal(replacementStage.sessionId, id);
    await page.waitForFunction(
      ({ pid, oldInstance, oldBirth }) => {
        const rows = window.__w4Agents;
        return (
          !rows.some((row) => row.instanceId === oldInstance) &&
          rows.some(
            (row) =>
              row.pid === pid &&
              row.agent === 'Claude Code' &&
              row.instanceIdSource === 'os' &&
              Number.isSafeInteger(row.startTime) &&
              row.instanceId === `${pid}:${row.startTime}` &&
              typeof row.createTime100ns === 'string' &&
              /^[1-9][0-9]{0,19}$/.test(row.createTime100ns) &&
              row.createTime100ns !== oldBirth &&
              Number((BigInt(row.createTime100ns) - 116444736000000000n) / 10000n) ===
                row.startTime,
          )
        );
      },
      {
        pid: replacement.pid,
        oldInstance: observed.instanceId,
        oldBirth: observed.createTime100ns,
      },
      { polling: 100, timeout: ownerWaitMs },
    );
    requireScenarioHealthy();
    assert(replacementOwner.held(), 'replacement-must-remain-at-session-start');
    instanceStages.replacementNewGeneration = true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const stale = await page.evaluate(
      (selected) => window.aegis.explainToolContext(selected),
      eventId,
    );
    assert.equal(stale.availability, 'unavailable');
    assert.equal(stale.toolContext.sessionBinding, 'unavailable');
    assert.equal(stale.toolContext.candidates.length, 0);
    assert(stale.toolContext.reasons.includes('process-identity-unavailable'));
    instanceStages.oldEventRejectedIPC = true;
    // Force the real command again; the previous positive render cannot satisfy this reason.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await section
      .getByRole('button', { name: 'Explain from local history' })
      .evaluate((button) => button.click());
    await section
      .getByText('The process identity needed for binding is unavailable.', { exact: true })
      .waitFor();
    assert.equal(await section.getByText('Claude Code · Write', { exact: true }).count(), 0);
    instanceStages.oldEventRejectedDOM = true;
    const finalRows = await app.evaluate(async ({ app }, target) => {
      const require = process.mainModule
        .require('node:module')
        .createRequire(app.getAppPath() + '/package.json');
      return (
        await require('./src/main/audit-logger').getEntriesBefore(
          new Date(Date.now() + 1000).toISOString(),
          500,
          ['file-access'],
        )
      ).filter((row) => row.path === target);
    }, file);
    for (const original of primaryAuditRows) {
      const retained = finalRows.filter(
        (row) => row.seq === original.seq && row.hash === original.hash,
      );
      assert.equal(retained.length, 1);
      assert.deepEqual(retained[0], original);
    }
    instanceStages.originalAuditRowsPreserved = true;
    requireScenarioHealthy();
    const stopped = await replacementOwner.stop();
    assert(
      stopped.confirmed && stopped.stoppedBeforeHookExpiry,
      'held-replacement-cleanup-unconfirmed',
    );
    requireScenarioHealthy();
  }
  const receipt = {
    passed: true,
    sessionBinding: 'confirmed',
    association: 'inferred',
    genuineClaude: true,
    mode,
    scenario,
    ...(scenario === 'instances-restart'
      ? {
          instanceStages: { ...instanceStages },
          peerTranscriptRead: false,
          peerPreflightDiagnostic,
          projectSelectionDiagnostic,
        }
      : {}),
    ...(mode === 'write' ? { stages: { ...writeStages } } : {}),
    processObservation:
      'production scanner plus held-handle full-resolution birth/cwd/session selector',
    osEventSynthetic: mode !== 'write',
    nativeReadSensorQualified: false,
    rawContentDisclosed: false,
    claudeExit: exit,
    stderrBytes,
    reply: reply.toolContext,
    processPreflight,
    writePreflightDiagnostic,
    ownerScanTiming,
    claudeVersion: callId.version,
    source: sourceBefore,
    componentHashes: hashesBefore,
    ...(mode === 'write'
      ? { realWrite: writeObservation }
      : {
          activeWriter: {
            scheduling: 'qualification-only-first-read-pause',
            sourceWritesByQualification: 0,
            observed: overlap,
            reply: activeReply.toolContext,
            availability: activeReply.availability,
            genuineReadSucceeded: true,
          },
        }),
    configuredModel: config.model ?? null,
    reportedTotalCostUsd:
      Number.isFinite(result.total_cost_usd) && result.total_cost_usd >= 0
        ? result.total_cost_usd
        : null,
  };
  pendingReceipt = receipt;
}
if (require.main === module) {
  main()
    .catch(async (error) => {
      if (scenario === 'instances-restart') cancelScenario('instance-scenario-failed');
      if (outputCreated)
        await fs.writeFile(path.join(out, 'failure.txt'), String(error), { flag: 'wx' });
      let ownedRowDiagnostic = { available: false };
      if (
        page &&
        appChild?.exitCode === null &&
        appChild?.signalCode === null &&
        Number.isSafeInteger(child?.pid)
      ) {
        const observed = page
          .evaluate((pid) => {
            const agents = Array.isArray(window.__w4Agents) ? window.__w4Agents : [];
            return {
              available: true,
              batchCount: window.__w4BatchCount ?? 0,
              firstBatchAt: window.__w4FirstBatchAt ?? null,
              lastBatchAt: window.__w4LastBatchAt ?? null,
              agentCount: agents.length,
              ownedRows: agents
                .filter((row) => row.pid === pid)
                .slice(0, 4)
                .map((row) => ({
                  pidMatchesOwner: true,
                  agentLabel: row.agent === 'Claude Code' ? 'Claude Code' : 'other',
                  identitySource: ['os', 'unknown', 'synthetic'].includes(row.instanceIdSource)
                    ? row.instanceIdSource
                    : null,
                  hasStartTime: Number.isSafeInteger(row.startTime) && row.startTime > 0,
                  exactInstanceKey: row.instanceId === `${pid}:${row.startTime}`,
                  hasFullBirth:
                    typeof row.createTime100ns === 'string' &&
                    /^[1-9][0-9]{0,19}$/.test(row.createTime100ns),
                })),
            };
          }, child.pid)
          .catch(() => ({ available: false }));
        ownedRowDiagnostic = await Promise.race([
          observed,
          new Promise((resolve) => setTimeout(() => resolve({ available: false }), 1000)),
        ]);
      }
      failedReceipt = {
        passed: false,
        mode,
        scenario,
        ...(scenario === 'instances-restart'
          ? {
              instanceStages: { ...instanceStages },
              peerTranscriptRead: false,
              peerPreflightDiagnostic,
              projectSelectionDiagnostic,
            }
          : {}),
        reportedTotalCostUsd: primaryReportedCost,
        ...(mode === 'write' ? { stages: { ...writeStages } } : {}),
        claudeSpawned: Number.isSafeInteger(child?.pid),
        modelRequestReleased,
        processPreflight,
        writePreflightDiagnostic,
        ownerScanTiming,
        source: sourceBefore,
        componentHashes: hashesBefore,
        ownedRowDiagnostic,
        nativeReadSensorQualified: false,
        osEventSynthetic: mode !== 'write',
      };
      console.error(String(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      const cleanup = {
        barrierReleases: 0,
        treeKillSucceeded: primaryCancelSucceeded,
        claudeExit: null,
        electronExitCode: null,
        electronCleanupTimedOut: false,
        confirmed: true,
      };
      if (heldActors.length) {
        cleanup.actors = [];
        for (const actor of heldActors) {
          const stopped = await actor.stop();
          cleanup.actors.push(stopped);
          if (!stopped.confirmed || !stopped.stoppedBeforeHookExpiry) cleanup.confirmed = false;
        }
      }
      if (child?.exitCode === null && child?.signalCode === null && !primaryCancelAttempted) {
        primaryCancelAttempted = true;
        try {
          execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            timeout: 5000,
          });
          cleanup.treeKillSucceeded = true;
          primaryCancelSucceeded = true;
        } catch {
          cleanup.treeKillSucceeded = false;
          primaryCancelSucceeded = false;
          cleanup.confirmed = false;
        }
      }
      if (primaryCancelAttempted && primaryCancelSucceeded === false) cleanup.confirmed = false;
      if (childDone) {
        cleanup.claudeExit = await Promise.race([
          childDone,
          new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
        ]);
        if (!cleanup.claudeExit) cleanup.confirmed = false;
      }
      cleanup.treeKillSucceeded = primaryCancelSucceeded;
      if (!child || cleanup.claudeExit) clearTimeout(timer);
      if (mode === 'read' && app && appChild?.exitCode === null && appChild?.signalCode === null) {
        cleanup.readerSchedulingRestored = await restoreReadOverlap(app);
        if (!cleanup.readerSchedulingRestored) cleanup.confirmed = false;
      }
      // Cleanup never opens a held model/tool barrier, even if termination is uncertain.
      if (app && !appChild) cleanup.confirmed = false;
      if (appChild) {
        try {
          const own = appChild;
          if (own.exitCode !== null || own.signalCode !== null) {
            cleanup.electronExitCode = own.exitCode;
            if (own.exitCode !== 0) cleanup.confirmed = false;
          } else {
            let onExit, deadline;
            const appExited = new Promise((resolve) => {
              onExit = (code) => resolve(code);
              own.once('exit', onExit);
            });
            const kill = setTimeout(() => {
              if (own.exitCode === null) {
                try {
                  execFileSync('taskkill.exe', ['/PID', String(own.pid), '/T', '/F'], {
                    stdio: 'ignore',
                    timeout: 5000,
                  });
                } catch {
                  /* Already exited. */
                }
              }
            }, 8000);
            try {
              const result = await Promise.race([
                (async () => {
                  await app.close();
                  return { timedOut: false, code: await appExited };
                })(),
                new Promise((resolve) => {
                  deadline = setTimeout(() => resolve({ timedOut: true }), 14000);
                }),
              ]);
              if (result.timedOut) {
                cleanup.electronCleanupTimedOut = true;
                cleanup.confirmed = false;
              } else {
                cleanup.electronExitCode = result.code;
                if (result.code !== 0) cleanup.confirmed = false;
              }
            } catch {
              cleanup.confirmed = false;
            } finally {
              clearTimeout(kill);
              clearTimeout(deadline);
              own.removeListener('exit', onExit);
            }
          }
        } catch {
          cleanup.confirmed = false;
        }
      }
      if (pendingReceipt) {
        try {
          assert(cleanup.confirmed, 'Owned cleanup unconfirmed');
          assert.deepEqual(sourceIdentity(), sourceBefore, 'Qualification source changed');
          assert.deepEqual(
            await componentHashes(),
            hashesBefore,
            'Qualification components changed',
          );
        } catch {
          failedReceipt = {
            ...pendingReceipt,
            passed: false,
            failure: 'cleanup-or-source-unconfirmed',
          };
          pendingReceipt = null;
        }
      }
      const finalReceipt = pendingReceipt ?? failedReceipt;
      if (finalReceipt && outputCreated) {
        finalReceipt.cleanup = cleanup;
        await fs.writeFile(path.join(out, 'receipt.json'), JSON.stringify(finalReceipt, null, 2), {
          flag: 'wx',
        });
      }
      if (pendingReceipt) {
        console.log(
          mode === 'write'
            ? 'PASS: genuine Write -> real FileWatcher -> audit/Details -> confirmed session binding; association inferred; owned cleanup confirmed'
            : 'PASS: genuine writer overlap -> partial explanation -> stable binding and UI; owned cleanup confirmed',
        );
      }
      if (!cleanup.confirmed) process.exitCode = 1;
    });
}
module.exports = {
  createHeldOwner,
  prepareActorSettings,
  restoreReadOverlap,
  peerComponentDiagnostic,
  seedOwnedProjectSelection,
};
