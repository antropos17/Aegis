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
const selectedTool = mode === 'write' ? 'Write' : 'Read';
const out = path.resolve(
  process.env.AEGIS_CLAUDE_QUALIFICATION_OUT || 'out/development/live-claude',
);
const cli = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
const id = randomUUID();
let eventId = randomUUID();
const project =
    mode === 'write'
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
let app,
  page,
  child,
  timer,
  childDone,
  processPreflight = null,
  pendingReceipt = null,
  failedReceipt = null,
  ownerScanTiming = null,
  sourceBefore = null,
  hashesBefore = null,
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

async function waitFile(name, timeout = 90000) {
  const start = Date.now();
  for (;;) {
    try {
      return JSON.parse(await fs.readFile(path.join(out, name), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (child?.exitCode !== null || Date.now() - start > timeout)
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
async function main() {
  assert(['read', 'write'].includes(mode), 'unknown-qualification-mode');
  if (mode === 'write') {
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
  await fs.mkdir(out, { recursive: true });
  await fs.mkdir(project, { recursive: true });
  assert(!(await fs.readdir(out)).includes('receipt.json'), 'Use a fresh output directory');
  sourceBefore = sourceIdentity();
  assert(sourceBefore.clean, 'Qualification source must be clean');
  hashesBefore = await componentHashes();
  if (mode === 'read') await fs.writeFile(file, marker + '\n');
  const hookFile = path.join(out, 'hook.cjs');
  await fs.writeFile(
    hookFile,
    `const fs=require('node:fs');const path=require('node:path');const root=${JSON.stringify(out)};
let bytes=0,text='';process.stdin.setEncoding('utf8');process.stdin.on('data',v=>{bytes+=Buffer.byteLength(v);if(bytes>65536)process.exit(2);text+=v});process.stdin.on('end',async()=>{
try {const row=JSON.parse(text);const kind=row.hook_event_name;const data={kind,sessionId:row.session_id,at:Date.now(),tool:row.tool_name||null};
const stage=kind==='PreToolUse'&&row.tool_name===${JSON.stringify(selectedTool)}&&row.tool_input?.file_path===${JSON.stringify(file)}?${JSON.stringify(selectedTool)}:kind==='SessionStart'||kind==='Stop'?kind:null;
if(stage){fs.writeFileSync(path.join(root,stage==='Read'?'read.json':stage==='Write'?'write.json':stage+'.json'),JSON.stringify(data));const release=path.join(root,'release-'+stage);const start=Date.now();while(!fs.existsSync(release)&&Date.now()-start<90000)await new Promise(r=>setTimeout(r,100));}
}catch{process.exitCode=2;}});`,
  );
  const command = `"${process.execPath.replaceAll('\\', '/')}" "${hookFile.replaceAll('\\', '/')}"`;
  const settings = path.join(out, 'settings.json');
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
  );
  const config = JSON.parse(
    await fs
      .readFile(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8')
      .catch(() => '{}'),
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CLAUDECODE;
  app = await electron.launch({
    args: [
      root,
      '--user-data-dir=' + path.join(out, 'profile'),
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
    env,
    timeout: 45000,
  });
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
      if (ready) break;
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
    if (child.exitCode === null) {
      try {
        execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          timeout: 5000,
        });
      } catch {
        /* Final cleanup records an unconfirmed exit and preserves failure. */
      }
    }
  }, 150000);
  console.log('Started owned Claude process; configured model preserved');
  const start = await waitFile('SessionStart.json');
  ownerScanTiming.sessionStartAt = Date.now();
  assert.equal(start.sessionId, id);
  await page.waitForFunction(
    (pid) =>
      window.__w4Agents.some(
        (row) => row.pid === pid && row.agent === 'Claude Code' && row.instanceIdSource === 'os',
      ),
    child.pid,
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
  if (mode === 'write') {
    const unique = await page.evaluate(
      ({ pid, target }) => {
        const normalized = target.replaceAll('\\', '/').toLowerCase();
        const candidates = window.__w4Agents.filter((row) => {
          if (row.category !== 'ai' || typeof row.cwd !== 'string') return false;
          const cwd = row.cwd.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
          return normalized === cwd || normalized.startsWith(cwd + '/');
        });
        return (
          candidates.length === 1 &&
          candidates[0].pid === pid &&
          candidates[0].generationWitnessSource === 'createTime100ns' &&
          candidates[0].generationWitness === candidates[0].createTime100ns
        );
      },
      { pid: child.pid, target: file },
    );
    assert(
      unique &&
        typeof observed.cwd === 'string' &&
        path.resolve(observed.cwd).toLowerCase() === project.toLowerCase(),
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
  await fs.writeFile(path.join(out, 'release-SessionStart'), 'release');
  modelRequestReleased = true;
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
      await app.evaluate(() => globalThis.__w4ReadOverlap?.restore()).catch(() => {});
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
  // Reuse the returned explanation's real UI command after the one-second rate gate.
  await page
    .locator('.sidebar')
    .getByRole('button', { name: 'Events', exact: true })
    .evaluate((button) => button.click());
  await page.getByLabel('Search events').fill(path.basename(file));
  await page
    .locator('.observation-open')
    .first()
    .evaluate((button) => button.click());
  await page.waitForFunction(
    () =>
      document.querySelector('.tool-context button') ||
      document.querySelector('.observation-history .recent-event'),
  );
  if (await page.locator('.observation-history .recent-event').count()) {
    const selected =
      mode === 'write'
        ? page.locator('[data-detail-focus="record-event:' + eventId + '"]')
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
    assert.deepEqual(
      auditAfter,
      writeObservation.auditBefore,
      'explanation-changed-recorded-audit',
    );
    const auditBytes = JSON.stringify(auditAfter);
    assert(!auditBytes.includes(marker));
    writeObservation.auditUnchanged = true;
    writeObservation.auditRecords = auditAfter.length;
    writeObservation.auditSha256 = createHash('sha256').update(auditBytes).digest('hex');
    delete writeObservation.auditBefore;
  }
  await fs.writeFile(path.join(out, 'release-Stop'), 'release');
  const exit = await childDone;
  clearTimeout(timer);
  assert.equal(exit.code, 0, 'Genuine Claude did not complete');
  const result = JSON.parse(output);
  assert(!result.is_error, 'Genuine Claude reported failure');
  assert(result.result.includes(mode === 'write' ? 'WRITE_OK' : 'READ_OK'));
  const receipt = {
    passed: true,
    sessionBinding: 'confirmed',
    association: 'inferred',
    genuineClaude: true,
    mode,
    processObservation:
      'production scanner plus held-handle full-resolution birth/cwd/session selector',
    osEventSynthetic: mode !== 'write',
    nativeReadSensorQualified: false,
    rawContentDisclosed: false,
    claudeExit: exit,
    stderrBytes,
    reply: reply.toolContext,
    processPreflight,
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
main()
  .catch(async (error) => {
    await fs.writeFile(path.join(out, 'failure.txt'), String(error));
    let ownedRowDiagnostic = { available: false };
    if (page && Number.isSafeInteger(child?.pid)) {
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
      claudeSpawned: Number.isSafeInteger(child?.pid),
      modelRequestReleased,
      processPreflight,
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
      treeKillSucceeded: null,
      claudeExit: null,
      electronExitCode: null,
      confirmed: true,
    };
    if (app) await app.evaluate(() => globalThis.__w4ReadOverlap?.restore()).catch(() => {});
    if (child?.exitCode === null) {
      try {
        execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          timeout: 5000,
        });
        cleanup.treeKillSucceeded = true;
      } catch {
        cleanup.treeKillSucceeded = false;
        cleanup.confirmed = false;
      }
    }
    if (childDone) {
      cleanup.claudeExit = await Promise.race([
        childDone,
        new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
      ]);
      if (!cleanup.claudeExit) cleanup.confirmed = false;
    }
    if (!child || cleanup.claudeExit) clearTimeout(timer);
    // Cleanup never opens a held model/tool barrier, even if termination is uncertain.
    if (app) {
      const own = app.process();
      const appExited =
        own.exitCode !== null
          ? Promise.resolve(own.exitCode)
          : new Promise((resolve) => own.once('exit', (code) => resolve(code)));
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
        await app.close();
        const code = await appExited;
        cleanup.electronExitCode = code;
        if (code !== 0) cleanup.confirmed = false;
      } catch {
        cleanup.confirmed = false;
      } finally {
        clearTimeout(kill);
      }
    }
    if (pendingReceipt) {
      try {
        assert(cleanup.confirmed, 'Owned cleanup unconfirmed');
        assert.deepEqual(sourceIdentity(), sourceBefore, 'Qualification source changed');
        assert.deepEqual(await componentHashes(), hashesBefore, 'Qualification components changed');
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
    if (finalReceipt) {
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
