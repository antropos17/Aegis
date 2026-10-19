import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { createOracle, fixtureEvent, pacedFeed } from './qualification/event-pipeline-oracle.mjs';

const require = createRequire(import.meta.url);
const MiB = 1024 * 1024;
const defaults = { capacity: 512, byteCapacity: MiB, diskQuotaBytes: 32 * MiB,
  maxFiles: 1024, intervalMs: 150 };
const limits = { heapBytes: 256 * MiB, heapGrowthBytes: 128 * MiB,
  sampleIntervalMs: 250, minimumRateFraction: 0.98, maxLatenessMs: 1000 };

function safeDirectory(directory) {
  for (let cursor = directory;; cursor = path.dirname(cursor)) {
    const stat = fs.lstatSync(cursor);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'plain-directory-required');
    if (path.dirname(cursor) === cursor) return;
  }
}

function diskSample(directory) {
  let bytes = 0;
  let files = 0;
  const iterator = fs.opendirSync(directory);
  try {
    for (let entry; (entry = iterator.readSync());) {
      assert.ok(++files <= defaults.maxFiles + 2, 'disk-file-bound');
      const stat = fs.lstatSync(path.join(directory, entry.name));
      assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'plain-spill-file-required');
      bytes += stat.size;
    }
  } finally { iterator.closeSync(); }
  assert.ok(bytes <= defaults.diskQuotaBytes, 'independent-disk-quota');
  return { bytes, files };
}

function inputHashes(sourceRoot) {
  const files = Object.keys(require.cache).filter((filename) =>
    filename.startsWith(path.join(sourceRoot, 'src') + path.sep));
  assert.ok(files.length > 0 && files.length < 128, 'bounded-source-inventory');
  files.push(path.join(sourceRoot, 'package.json'), path.join(sourceRoot, 'package-lock.json'));
  const hashes = {};
  for (const filename of files.sort()) {
    hashes[path.relative(sourceRoot, filename).replaceAll('\\', '/')] =
      createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
  }
  return hashes;
}

function harnessHashes() {
  return Object.fromEntries(['./verify-event-pipeline.mjs', './qualification/event-pipeline-oracle.mjs']
    .map((relative) => [relative, createHash('sha256')
      .update(fs.readFileSync(new URL(relative, import.meta.url))).digest('hex')]));
}

async function loadCase(factory, runRoot, definition) {
  const { name, rate, durationMs, stallStartMs, stallDurationMs } = definition;
  const directory = path.join(runRoot, name);
  const epoch = Date.now();
  const expected = rate * durationMs / 1000;
  const oracle = createOracle(expected, epoch, rate);
  let started = Infinity;
  let consumerError = null;
  let refusals = 0;
  let lastSample = -Infinity;
  let peakHeap = process.memoryUsage().heapUsed;
  const baselineHeap = peakHeap;
  const peaks = { diskBytes: 0, diskFiles: 0, pendingRecords: 0 };
  const batcher = factory({ ...defaults, directory, consume(records) {
    const elapsed = performance.now() - started;
    if (elapsed >= stallStartMs && elapsed < stallStartMs + stallDurationMs) {
      refusals++;
      return false;
    }
    if (consumerError) return false;
    try { oracle.accept(records); return true; }
    catch (error) { consumerError = error; return false; }
  } });
  function sample(elapsed, force = false) {
    if (consumerError) throw consumerError;
    const heap = process.memoryUsage().heapUsed;
    peakHeap = Math.max(peakHeap, heap);
    assert.ok(heap <= limits.heapBytes, 'sampled-heap-absolute-bound');
    assert.ok(heap - baselineHeap <= limits.heapGrowthBytes, 'sampled-heap-growth-bound');
    if (!force && elapsed - lastSample < limits.sampleIntervalMs) return;
    lastSample = elapsed;
    const stats = batcher.getStats();
    for (const sensor of Object.values(stats.sensors)) {
      assert.ok(sensor.buffered <= defaults.capacity && sensor.highWater <= defaults.capacity,
        'per-sensor-record-bound');
      assert.ok(sensor.bufferedBytes <= defaults.byteCapacity && sensor.highWaterBytes <= defaults.byteCapacity,
        'per-sensor-byte-bound');
      assert.equal(sensor.lost, 0, 'normal-storage-loss-counter');
    }
    assert.equal(stats.unknownLoss, false, 'unknown-loss-forbidden');
    assert.equal(stats.pendingLoss, 0, 'normal-storage-pending-loss');
    const disk = diskSample(directory);
    peaks.diskBytes = Math.max(peaks.diskBytes, disk.bytes);
    peaks.diskFiles = Math.max(peaks.diskFiles, disk.files);
    peaks.pendingRecords = Math.max(peaks.pendingRecords, stats.spill.records);
  }
  try {
    started = performance.now();
    const schedule = await pacedFeed({ rate, durationMs,
      push: (index) => { assert.equal(batcher.push(fixtureEvent(index, epoch, rate)), true, 'admission-required'); },
      tick: sample });
    batcher.flush();
    const drainStart = performance.now();
    while (oracle.snapshot().delivered < expected && performance.now() - drainStart < 5000) {
      sample(performance.now() - started, true);
      await sleep(10);
      batcher.flush();
    }
    sample(performance.now() - started, true);
    oracle.assertComplete();
    assert.ok(refusals > 0, 'consumer-stall-exercised');
    assert.ok(peaks.diskBytes > 0 && peaks.pendingRecords > 0, 'real-disk-spill-required');
    assert.ok(schedule.actualOfferedPerSecond >= rate * limits.minimumRateFraction, 'offered-rate-too-low');
    assert.ok(schedule.maxLatenessMs <= limits.maxLatenessMs, 'scheduler-lateness-bound');
    assert.deepEqual(diskSample(directory), { bytes: 0, files: 0 }, 'acknowledged-spill-deleted');
    const stats = batcher.getStats();
    assert.equal(stats.spill.records, 0, 'spill-drained');
    assert.equal(stats.replayPending, false, 'startup-replay-complete');
    assert.equal(stats.health.state, 'HEALTHY', 'health-recovers-after-successful-drain');
    for (const [id, sensor] of Object.entries(stats.sensors)) {
      assert.equal(sensor.buffered, 0, 'memory-drained');
      assert.equal(sensor.accepted, oracle.snapshot().bySensor[id], 'admission-counter-matches-oracle');
      assert.equal(sensor.delivered, oracle.snapshot().bySensor[id], 'delivery-counter-matches-oracle');
    }
    return { ...definition, status: 'pass', schedule, oracle: oracle.snapshot(),
      consumerRefusals: refusals, peaks, baselineHeapBytes: baselineHeap, sampledPeakHeapBytes: peakHeap,
      sampledHeapGrowthBytes: peakHeap - baselineHeap, drainMs: performance.now() - drainStart, stats };
  } finally { batcher.destroy(); }
}

/** Run production-module qualification with finite owned disk and report output.
 * @param {object} options Explicit sourceRoot and existing outputDirectory.
 * @returns {Promise<object>} Receipt including source hashes and measured results.
 * @since 0.19.2
 */
export async function qualify({ sourceRoot, outputDirectory, smoke = false }) {
  sourceRoot = fs.realpathSync(path.resolve(sourceRoot));
  outputDirectory = path.resolve(outputDirectory);
  safeDirectory(outputDirectory);
  const disk = fs.statfsSync(outputDirectory);
  assert.ok(disk.bavail * disk.bsize >= 128 * MiB, 'qualification-free-space');
  const runRoot = fs.mkdtempSync(path.join(outputDirectory, 'event-pipeline-'));
  const receiptPath = path.join(runRoot, 'receipt.json');
  const { createSecurityBatcher } = require(path.join(sourceRoot, 'src/main/ipc-batcher.js'));
  assert.equal(typeof createSecurityBatcher, 'function', 'production-security-batcher-required');
  const before = inputHashes(sourceRoot);
  const harnessBefore = harnessHashes();
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot,
    encoding: 'utf8', timeout: 10_000, windowsHide: true, maxBuffer: 4096 }).trim();
  const receipt = { schemaVersion: 1, status: 'running', startedAt: new Date().toISOString(),
    scope: 'production-security-batcher-with-synthetic-synchronous-acknowledgement',
    mode: smoke ? 'smoke-not-acceptance' : 'w1-pipe-load-qualification',
    sourceRevision: revision, sourceHashes: before, harnessHashes: harnessBefore, runtime: { node: process.version,
      platform: process.platform, arch: process.arch, osRelease: os.release(),
      cpuModel: os.cpus()[0]?.model ?? 'unknown', logicalCpus: os.availableParallelism() },
    configuration: defaults, limits, cases: [],
    limitations: ['Synthetic metadata only; no native sensor, Electron renderer or real audit consumer.',
      'Heap and independent disk peaks are sampled; queue high-water counters cover between-sample queue peaks.',
      'Restart, full-disk and corruption semantics require the separately recorded focused runtime tests.'] };
  const definitions = smoke
    ? [{ name: 'smoke', rate: 20_000, durationMs: 2000, stallStartMs: 300, stallDurationMs: 600 }]
    : [{ name: 'burst-20k', rate: 20_000, durationMs: 30_000, stallStartMs: 1000, stallDurationMs: 600 },
      { name: 'sustained-2k', rate: 2000, durationMs: 5000, stallStartMs: 1000, stallDurationMs: 2000 }];
  try {
    for (const definition of definitions) receipt.cases.push(await loadCase(createSecurityBatcher, runRoot, definition));
    assert.deepEqual(inputHashes(sourceRoot), before, 'source-changed-during-qualification');
    assert.deepEqual(harnessHashes(), harnessBefore, 'harness-changed-during-qualification');
    receipt.status = 'pass';
  } catch (error) {
    receipt.status = 'fail';
    receipt.failure = { code: error.code ?? 'assertion', message: String(error.message).slice(0, 500) };
  } finally {
    receipt.completedAt = new Date().toISOString();
    const json = JSON.stringify(receipt, null, 2) + '\n';
    assert.ok(Buffer.byteLength(json) < 64 * 1024, 'receipt-size-bound');
    fs.writeFileSync(receiptPath, json, { flag: 'wx' });
  }
  return { ...receipt, receiptPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const value = (name) => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
    assert.ok(value('--output-dir'), '--output-dir must name an existing disposable-output parent');
    const result = await qualify({ sourceRoot: value('--source-root') ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
      outputDirectory: value('--output-dir'), smoke: args.includes('--smoke') });
    console.log(JSON.stringify({ status: result.status, mode: result.mode, receiptPath: result.receiptPath,
      failure: result.failure, cases: result.cases.map(({ name, schedule, oracle, peaks }) => ({ name, schedule, oracle, peaks })) }));
    process.exitCode = result.status === 'pass' ? 0 : 1;
  } catch (error) { console.error(String(error.message).slice(0, 500)); process.exitCode = 1; }
}
