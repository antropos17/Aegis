import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, appendFile, statfs, lstat } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { packagedStep } from './token-accounting-soak-runtime.mjs';
import {
  checkSample,
  treeBytes,
  cleanup,
  checkAncestors,
  stopOwned,
  checkWorkload,
  createDeadline,
} from './token-accounting-soak-support.mjs';

// Explicit opt-in; invoking this file without settings never starts an app.
assert.equal(process.env.AEGIS_TOKEN_SOAK_OPT_IN, '1', 'opt-in-required');
assert.equal(process.platform, 'win32', 'windows-x-drive-required');
const executable = path.resolve(process.env.AEGIS_TOKEN_SOAK_EXECUTABLE || '');
assert.ok(process.env.AEGIS_TOKEN_SOAK_EXECUTABLE && executable.toLowerCase().endsWith('.exe'));
const executableHash = createHash('sha256');
for await (const bytes of createReadStream(executable)) executableHash.update(bytes);
const smoke = process.env.AEGIS_TOKEN_SOAK_SMOKE === '1';
const durationMs = smoke ? 15_000 : 7_200_000;
const intervalMs = smoke ? 1_000 : 5_000;
const parent = 'X:\\tmp\\aegis-token-soaks';
const taskkillPath = 'C:\\Windows\\System32\\taskkill.exe';
await checkAncestors(path.dirname(taskkillPath));
const taskkillInfo = await lstat(taskkillPath);
assert.ok(taskkillInfo.isFile() && !taskkillInfo.isSymbolicLink(), 'system-taskkill-required');
await checkAncestors(parent);
await mkdir(parent, { recursive: true });
await checkAncestors(parent);
await treeBytes(parent); // Refuse preexisting junctions/reparse entries.
const initialDisk = await statfs(parent);
assert.ok(initialDisk.bavail * initialDisk.bsize >= 2 * 1024 ** 3, 'disk-space-low');
const runRoot = await mkdtemp(path.join(parent, 'run-'));
const disposable = path.join(runRoot, 'disposable');
const home = path.join(disposable, 'home');
const profile = path.join(disposable, 'profile');
const temp = path.join(disposable, 'temp');
const receiptPath = path.join(runRoot, 'receipt.json');
const samplesPath = path.join(runRoot, 'samples.jsonl');
const startTime = Date.now();
const procs = [
  { pid: 600001, startTime, instanceId: `600001:${startTime}`, agent: 'Claude Code' },
  { pid: 600002, startTime, instanceId: `600002:${startTime}`, agent: 'Claude Code' },
];
const transcripts = [];
const config = { home, profile, procs, ledger: path.join(profile, 'soak-ledger.sqlite') };
const receipt = {
  scope: 'packaged-module-fixture',
  mode: smoke ? 'smoke' : 'two-hour-soak',
  status: 'running',
  startedAt: new Date().toISOString(),
  durationMs,
  executableSha256: executableHash.digest('hex'),
  samples: 0,
  uniqueMessages: 0,
  restarts: 0,
  elapsedMs: 0,
  messagesPerIdentity: [0, 0],
  identitiesObserved: [false, false],
  cleanup: 'pending',
  peakDisposableBytes: 0,
  limitations: [
    'synthetic identities',
    'isolated module cache',
    'no scanner/IPC/provider acceptance',
  ],
};
const owner = { app: undefined, stopping: undefined, launchUnconfirmed: false };
const deadline = createDeadline(durationMs + 120_000);
const monotonicStart = performance.now();
let failureStage = 'fixture-setup';
const env = {
  ...process.env,
  USERPROFILE: home,
  HOME: home,
  APPDATA: profile,
  LOCALAPPDATA: profile,
  TEMP: temp,
  TMP: temp,
};
delete env.ELECTRON_RUN_AS_NODE;
async function stop() {
  await stopOwned(owner, async (pid) => {
    await new Promise((resolve, reject) => {
      execFile(taskkillPath, ['/PID', String(pid), '/T', '/F'], { timeout: 10_000 }, (error) => {
        if (error) reject(Error('process-cleanup-failed'));
        else resolve();
      });
    });
  });
}
async function launch() {
  assert.ok(!deadline.cancelled, 'run-timeout');
  assert.ok(!owner.app && !owner.launchUnconfirmed, 'previous-app-unclosed');
  const { _electron } = await import('playwright');
  owner.launchUnconfirmed = true;
  owner.app = await _electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${profile}`],
    env,
    timeout: 30_000,
  });
  owner.launchUnconfirmed = false;
  if (deadline.cancelled) {
    await stop();
    throw Error('run-timeout');
  }
  const identity = await deadline.guard(
    owner.app.evaluate(({ app }) => ({
      packaged: app.isPackaged,
      profile: app.getPath('userData'),
      home: process.getBuiltinModule('node:os').homedir(),
    })),
  );
  assert.equal(identity.packaged, true, 'packaged-required');
  assert.equal(path.resolve(identity.profile), profile, 'profile-isolation-failed');
  assert.equal(path.resolve(identity.home), home, 'home-isolation-failed');
}
async function sample() {
  let timeout;
  let actual;
  try {
    actual = await deadline.guard(
      Promise.race([
        owner.app.evaluate(packagedStep, config),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(Error('sample-timeout')), 20_000);
        }),
      ]),
    );
  } finally {
    clearTimeout(timeout);
  }
  for (const identity of actual.identities) {
    if (identity.slot === 0 || identity.slot === 1)
      receipt.identitiesObserved[identity.slot] ||=
        identity.inputTokens > 0 && identity.outputTokens > 0;
  }
  const bytes = await treeBytes(disposable);
  receipt.peakDisposableBytes = Math.max(receipt.peakDisposableBytes, bytes);
  assert.ok(bytes <= 256 * 1024 ** 2, 'disposable-size-limit');
  const disk = await statfs(parent);
  assert.ok(disk.bavail * disk.bsize >= 1024 ** 3, 'disk-space-low');
  receipt.samples++;
  assert.ok(receipt.samples <= (smoke ? 24 : 1450), 'sample-limit');
  await appendFile(
    samplesPath,
    JSON.stringify({
      elapsedMs: performance.now() - monotonicStart,
      ...actual,
      disposableBytes: bytes,
    }) + '\n',
  );
  assert.ok((await treeBytes(samplesPath)) <= 1024 ** 2, 'receipt-size-limit');
  checkSample(actual, receipt.uniqueMessages); // Retain collection/ledger diagnostics on failure.
}
try {
  for (const directory of [profile, temp, path.join(home, '.claude', 'sessions')])
    await mkdir(directory, { recursive: true });
  for (const proc of procs) {
    const cwd = `X:\\fixture\\soak-${proc.pid}`;
    const sessionId = `fixture-${proc.pid}`;
    const project = path.join(home, '.claude', 'projects', cwd.replace(/[/\\:.]/g, '-'));
    await mkdir(project, { recursive: true });
    await writeFile(
      path.join(home, '.claude', 'sessions', `${proc.pid}.json`),
      JSON.stringify({ sessionId, cwd, startedAt: startTime }),
    );
    const transcript = path.join(project, `${sessionId}.jsonl`);
    await writeFile(transcript, '');
    transcripts.push(transcript);
  }
  failureStage = 'initial-launch';
  await deadline.guard(launch());
  let restarted = false;
  let sequence = 0;
  while (performance.now() - monotonicStart < durationMs) {
    assert.ok(!deadline.cancelled, 'run-timeout');
    const index = sequence % transcripts.length;
    const line =
      JSON.stringify({
        type: 'assistant',
        message: {
          id: `fixture-message-${sequence}`,
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 100, output_tokens: 20 },
        },
      }) + '\n';
    // Repeat the same message in the same transcript: oracle counts it once.
    await appendFile(transcripts[index], line + line);
    receipt.uniqueMessages++;
    receipt.messagesPerIdentity[index]++;
    sequence++;
    failureStage = 'accounting-sample';
    await sample();
    if (!restarted && performance.now() - monotonicStart >= durationMs / 2) {
      failureStage = 'midpoint-restart';
      await stop();
      await deadline.guard(launch());
      receipt.restarts++;
      await sample(); // Durable replay must preserve committed totals exactly.
      restarted = true;
    }
    await deadline.guard(new Promise((resolve) => setTimeout(resolve, intervalMs)));
  }
  failureStage = 'final-restart';
  await stop();
  await deadline.guard(launch());
  receipt.restarts++;
  await sample();
  assert.ok(restarted, 'mid-run-restart-missing');
  checkWorkload(receipt);
  assert.ok(!deadline.cancelled, 'run-timeout');
  receipt.status = smoke ? 'smoke-passed' : 'soak-passed';
} catch (error) {
  receipt.status = deadline.cancelled ? 'timeout' : 'failed';
  receipt.failureStage = failureStage;
  const known = new Set([
    'run-timeout',
    'packaged-required',
    'profile-isolation-failed',
    'home-isolation-failed',
    'sample-timeout',
    'collection-unavailable',
    'input-divergence',
    'output-divergence',
    'cost-divergence',
    'ledger-size-limit',
    'process-exit-unconfirmed',
    'disk-space-low',
  ]);
  receipt.failureCode = known.has(error?.message) ? error.message : 'unexpected';
  process.exitCode = 1;
} finally {
  deadline.close();
  receipt.elapsedMs = performance.now() - monotonicStart;
  try {
    await stop();
    assert.ok(!owner.app && !owner.launchUnconfirmed, 'process-exit-unconfirmed');
    await checkAncestors(runRoot);
    await cleanup(runRoot, disposable);
    receipt.cleanup = 'complete';
  } catch {
    receipt.cleanup = 'failed-preserved';
    receipt.status = 'failed';
    process.exitCode = 1;
  }
  const finalDisk = await statfs(parent);
  receipt.freeBytesBefore = initialDisk.bavail * initialDisk.bsize;
  receipt.freeBytesAfter = finalDisk.bavail * finalDisk.bsize;
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  console.log(receiptPath);
}
