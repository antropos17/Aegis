'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { startWorker } = require('./lib/native-task-process');
const { sha, hash, expectedOutput } = require('./lib/native-task-plan');
const { evaluateNativeResources } = require('./lib/native-resource-model');
const { summarizeResourceRun, resourceMarkdown } = require('./lib/native-task-report');
const SOURCES = [
  'bench/native-resource-run.cjs',
  'bench/native-task/Worker.cs',
  'bench/native-task/ResourceReader.cs',
  'bench/lib/native-resource-model.js',
  'bench/lib/native-task-process.js',
  'bench/lib/native-task-plan.js',
  'bench/lib/native-task-report.js',
  'bench/lib/resource-intervals.js',
  'bench/lib/resource-input.js',
];
const json = (file, value) =>
  fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let activeOut = null;
async function ordinary(directory) {
  for (let current = directory; ;) {
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('ordinary-directory-required');
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
async function inventory(root) {
  return Object.fromEntries(
    await Promise.all(
      SOURCES.map(async (name) => [name, sha(await fs.readFile(path.join(root, name)))]),
    ),
  );
}
function compile(root, out, source, name) {
  const target = path.join(out, name);
  execFileSync(
    path.join(
      process.env.SystemRoot || 'C:/Windows',
      'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
    ),
    [
      '/nologo',
      '/target:exe',
      '/platform:x64',
      '/optimize+',
      '/warnaserror+',
      '/reference:System.Web.Extensions.dll',
      `/out:${target}`,
      path.join(root, source),
    ],
    { timeout: 30000, windowsHide: true, stdio: 'pipe' },
  );
  return target;
}
async function one(root, out, fixture, fixtureSha256, workerExe, readerExe, id, context) {
  const directory = path.join(out, id),
    project = path.join(directory, 'project'),
    outside = path.join(directory, 'owned-sibling');
  await fs.mkdir(directory);
  await fs.mkdir(project);
  await fs.mkdir(outside);
  const repetition = { id, context, samples: [], tasks: [], usefulOutput: [], cleanup: null };
  let worker, reader;
  try {
    worker = startWorker(workerExe, [fixture, project, outside, '--cwd', project]);
    const ready = await worker.ready();
    if (ready.kind !== 'ready' || ready.pid !== worker.pid || !/^[0-9]+$/.test(ready.birthTicks))
      throw Error('worker-not-ready');
    repetition.ready = ready;
    reader = startWorker(readerExe, [String(ready.pid), ready.birthTicks]);
    if ((await reader.ready()).version !== 'win32-owned-resource-reader/1')
      throw Error('reader-not-ready');
    const epoch = process.hrtime.bigint();
    for (let i = 0; i < 4; i++) {
      const scheduledUs = i * 1000000;
      await delay(Math.max(0, scheduledUs / 1000 - Number(process.hrtime.bigint() - epoch) / 1e6));
      const begin = process.hrtime.bigint();
      const before = await reader.request('snapshot');
      const self = await worker.request('resource');
      const after = await reader.request('snapshot');
      const end = process.hrtime.bigint();
      if (before.kind !== 'snapshot' || after.kind !== 'snapshot' || self.kind !== 'resource')
        throw Error('acquisition-failed');
      repetition.samples.push({
        id: 's' + i,
        scheduledUs,
        actualUs: Number((end - epoch) / 1000n),
        acquisitionUs: Number((end - begin) / 1000n),
        before,
        self,
        after,
      });
      if (i < 2) {
        const task = i ? 'outside-write' : 'ordinary';
        const response = await worker.request(task);
        repetition.tasks.push(response);
        const target = i ? outside : project;
        const file = i ? 'controlled-summary.txt' : 'ordinary-summary.txt';
        const exactBytes =
          (await fs.readFile(path.join(target, file), 'utf8')) === expectedOutput(2000000);
        const files = await fs.readdir(target);
        repetition.usefulOutput.push({
          task,
          exactBytes,
          inventoryMatches: files.length === 1 && files[0] === file,
          inputUnchanged: sha(await fs.readFile(fixture)) === fixtureSha256,
        });
      }
    }
  } catch (error) {
    repetition.failure = String(error.message).slice(0, 2000);
  } finally {
    repetition.cleanup = {
      reader: reader ? await reader.stop() : null,
      worker: worker ? await worker.stop() : null,
    };
  }
  // Preserve raw acquisition and any first failure before invoking arithmetic.
  await json(path.join(directory, 'raw.json'), repetition);
  if (repetition.samples.length)
    repetition.evaluation = evaluateNativeResources(repetition, context.sourceSha256);
  await json(path.join(directory, 'evaluated.json'), {
    context,
    evaluation: repetition.evaluation || { state: 'unavailable' },
  });
  return repetition;
}
async function main() {
  if (process.platform !== 'win32' || process.argv.length !== 4 || process.argv[2] !== '--output')
    throw Error('windows-and-output-required');
  const root = path.resolve(__dirname, '..'),
    out = path.resolve(process.argv[3]);
  if (
    !path.isAbsolute(process.argv[3]) ||
    out.toLowerCase().startsWith(root.toLowerCase() + path.sep)
  )
    throw Error('external-output-required');
  await ordinary(path.dirname(out));
  await fs.mkdir(out);
  activeOut = out;
  const disk = await fs.statfs(out);
  if (Number(disk.bavail) * Number(disk.bsize) < 2 * 1024 ** 3) throw Error('insufficient-space');
  if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim())
    throw Error('clean-source-required');
  const source = await inventory(root),
    sourceSha256 = hash(source);
  const workerExe = compile(root, out, 'bench/native-task/Worker.cs', 'csv-worker.exe');
  const readerExe = compile(
    root,
    out,
    'bench/native-task/ResourceReader.cs',
    'resource-reader.exe',
  );
  const fixture = path.join(out, 'input.csv');
  const lines = Array.from({ length: 2000000 }, (_, i) => `${i},${i % 1000}\n`).join('');
  await fs.writeFile(fixture, lines, { flag: 'wx' });
  const fixtureSha256 = sha(lines);
  const context = {
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    source,
    sourceSha256,
    recordedAt: new Date().toISOString(),
    machine: sha(os.hostname()).slice(0, 16),
    os: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      logicalCpus: os.cpus().length,
    },
    agent: { name: 'controlled native CSV worker', version: 'native-csv-worker/1' },
    sensorMode: 'not-started; workload resource observation only',
    method: 'win32-native-worker-resource-brackets/1',
    nodeVersion: process.version,
    fixtureSha256,
    binaries: {
      worker: sha(await fs.readFile(workerExe)),
      reader: sha(await fs.readFile(readerExe)),
    },
  };
  const plan = {
    context,
    repetitions: ['rep1', 'rep2', 'rep3'],
    rows: 2000000,
    scheduledUs: [0, 1000000, 2000000, 3000000],
    tasksAfterSamples: { s0: 'ordinary', s1: 'outside-write' },
    expectedOutput: expectedOutput(2000000),
    expectedFiles: ['project/ordinary-summary.txt', 'owned-sibling/controlled-summary.txt'],
    cpuFloorAllowanceUs: 2,
    workingSetSanityBytes: [1024 ** 2, 1024 ** 3],
    physicalCalibration: false,
    calibratedOverhead: false,
    observerCostQualified: false,
  };
  await json(path.join(out, 'plan.json'), plan);
  const evidence = { context, repetitions: [] };
  for (const id of plan.repetitions) {
    const r = await one(root, out, fixture, fixtureSha256, workerExe, readerExe, id, context);
    // Each actual source-byte check is separate from the independent output rubric.
    r.inputUnchanged = sha(await fs.readFile(fixture)) === fixtureSha256;
    evidence.repetitions.push(r);
  }
  evidence.sourceEndpointsUnchanged = hash(await inventory(root)) === sourceSha256;
  await json(path.join(out, 'result.json'), evidence);
  if (evidence.repetitions.every((r) => r.evaluation)) {
    const summary = summarizeResourceRun(evidence);
    await json(path.join(out, 'summary.json'), summary);
    await fs.writeFile(path.join(out, 'summary.md'), resourceMarkdown(summary), { flag: 'wx' });
  }
  const pass =
    evidence.sourceEndpointsUnchanged &&
    evidence.repetitions.every(
      (r) =>
        !r.failure &&
        r.inputUnchanged &&
        r.evaluation?.corroboration.state === 'corroborated' &&
        r.usefulOutput.length === 2 &&
        r.usefulOutput.every((x) => x.exactBytes && x.inventoryMatches && x.inputUnchanged) &&
        r.tasks.every((x) => x.kind === 'result' && x.completed === true) &&
        r.cleanup.reader?.code === 0 &&
        r.cleanup.worker?.code === 0,
    );
  console.log(JSON.stringify({ pass, output: out }));
  if (!pass) process.exitCode = 1;
}
main().catch(async (error) => {
  if (activeOut)
    await json(path.join(activeOut, 'failure.json'), {
      error: String(error.message).slice(0, 4000),
      stderr: String(error.stderr || '').slice(0, 65536),
    }).catch(() => {});
  console.error('native-resource-run-failed');
  process.exitCode = 1;
});
