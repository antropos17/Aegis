'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { sha, hash, expectedOutput, createPlan } = require('./native-task-plan');
const SOURCES = [
  'bench/native-task-run.cjs',
  'bench/lib/native-task-setup.js',
  'bench/native-task/Worker.cs',
  'bench/lib/native-task-plan.js',
  'bench/lib/native-task-process.js',
  'bench/lib/native-task-monitor.js',
  'bench/lib/native-task-report.js',
  'bench/lib/paired-task-latency.js',
  'bench/lib/task-false-alarms.js',
];

async function ordinaryPath(file) {
  for (let current = path.resolve(file); ;) {
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('linked-or-nondirectory-path');
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
async function json(file, value) {
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
async function fileHash(file) {
  return sha(await fs.readFile(file));
}
async function createFixture(file, rows) {
  const handle = await fs.open(file, 'wx');
  const digest = createHash('sha256');
  try {
    for (let base = 0; base < rows; base += 1000) {
      const bytes = Buffer.from(
        Array.from({ length: 1000 }, (_, j) => `${base + j},${j}\n`).join(''),
      );
      digest.update(bytes);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset);
        if (!bytesWritten) throw Error('fixture-write-incomplete');
        offset += bytesWritten;
      }
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  return digest.digest('hex');
}
/** Prepare and freeze one clean-source native workload run. @param {string} root Repository. @param {object} options New output/fixture settings. @returns {Promise<object>} Frozen inputs. @since 0.21.0 */
async function prepareRun(root, options) {
  if (process.platform !== 'win32') throw Error('windows-required');
  const rows = options.rows ?? 2000000,
    warmupMs = options.warmupMs ?? 5000;
  expectedOutput(rows);
  if (warmupMs !== 5000) throw Error('fixed-warmup-required');
  const out = path.resolve(options.output);
  if (!path.isAbsolute(options.output) || out.startsWith(root + path.sep))
    throw Error('external-absolute-output-required');
  await ordinaryPath(path.dirname(out));
  await fs.mkdir(out);
  const beforeDisk = {
    freeBytes: Number((await fs.statfs(out)).bavail) * Number((await fs.statfs(out)).bsize),
  };
  if (beforeDisk.freeBytes < 2 * 1024 ** 3) throw Error('insufficient-output-space');
  const source = Object.fromEntries(
    await Promise.all(SOURCES.map(async (name) => [name, await fileHash(path.join(root, name))])),
  );
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const dirty =
    execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !== '';
  if (dirty) throw Error('clean-source-required');
  const fixture = path.join(out, 'input.csv'),
    fixtureSha256 = await createFixture(fixture, rows);
  const executable = path.join(out, 'aegis-bench-workload.exe');
  const compiler = path.join(
    process.env.SystemRoot || 'C:/Windows',
    'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
  );
  execFileSync(
    compiler,
    [
      '/nologo',
      '/target:exe',
      '/platform:x64',
      '/optimize+',
      '/warnaserror+',
      '/reference:System.Web.Extensions.dll',
      `/out:${executable}`,
      path.join(root, 'bench/native-task/Worker.cs'),
    ],
    { timeout: 30000, windowsHide: true, stdio: 'pipe' },
  );
  const binarySha256 = await fileHash(executable);
  const productArtifacts = {};
  for (const directory of ['dist/renderer', 'build/sidecar']) {
    const visit = async (relative) => {
      for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw Error('linked-product-artifact');
        const file = path.join(relative, entry.name);
        if (entry.isDirectory()) await visit(file);
        else if (entry.isFile())
          productArtifacts[file.replaceAll('\\', '/')] = await fileHash(path.join(root, file));
      }
    };
    await visit(directory);
  }
  const context = {
    schema: 'controlled-native-task-run/1',
    sourceCommit,
    dirtySource: dirty,
    sourceSha256: hash(source),
    source,
    product: {
      sourceCommit,
      artifacts: productArtifacts,
      electronVersion: require('electron/package.json').version,
    },
    recordedAt: new Date().toISOString(),
    machine: sha(os.hostname()).slice(0, 16),
    os: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpu: os.cpus()[0]?.model || 'unknown',
      logicalCpus: os.cpus().length,
    },
    agent: {
      name: 'controlled native CSV worker',
      version: 'native-csv-worker/1',
      kind: 'controlled-native-program',
      provider: 'not-applicable',
      model: 'not-applicable',
      binarySha256,
    },
    sensorMode: 'normal-monitoring-no-file-read-opt-in',
    method: 'native-task-pairs/1',
    rows,
    warmupMs,
    drainMs: 500,
    beforeDisk,
  };
  const configuration = {
    scanIntervalSec: 1,
    notificationsEnabled: false,
    automaticUpdatesEnabled: false,
    fixtureHome: 'arm-owned-home',
    customAgent: 'fixed-native-worker',
  };
  const common = {
    agentSha256: source['bench/native-task/Worker.cs'],
    providerSha256: sha('no-provider'),
    modelSha256: sha('no-model'),
    binarySha256,
    harnessSha256: hash({ harness: context.sourceSha256, productCommit: sourceCommit }),
    osImageSha256: hash(context.os),
    privilegeSha256: sha('current-user-no-elevation'),
    oracleSha256: sha('node-fs-independent-expected-bytes-and-inventory-v1'),
    generatorSha256: source['bench/lib/native-task-setup.js'],
    instrumentationSha256: hash({
      clock: 'parent-hrtime',
      helper: source['bench/lib/native-task-process.js'],
      monitor: source['bench/lib/native-task-monitor.js'],
    }),
    configurationSha256: hash({ configuration, productArtifacts }),
  };
  const plan = createPlan(common, rows, fixtureSha256);
  await json(path.join(out, 'plan.json'), { context, configuration, fixtureSha256, plan });
  return { rows, warmupMs, out, fixture, fixtureSha256, executable, context, common, plan };
}
module.exports = { prepareRun, json, fileHash };
