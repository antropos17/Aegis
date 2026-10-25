/** Cloud-only, single-pass controls for native producers and operational consumers. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { appendGateCommandLog } from '../tools/development/gate-command-log.mjs';
import {
  NATIVE_OBJECT_SUITES,
  NATIVE_OBJECT_SOURCE_PATHS,
  validateJavascriptControls,
  validateNativeControls,
  validateNativeObjectControls,
} from '../tools/development/native-object-controls.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--output' || !path.isAbsolute(args[1]))
  throw new Error(
    'Usage: node scripts/verify-native-object-gate.mjs --output <absolute-receipt.json>',
  );
if (
  process.platform !== 'win32' ||
  process.arch !== 'x64' ||
  process.env.GITHUB_ACTIONS !== 'true' ||
  process.env.CI !== 'true' ||
  !process.env.GITHUB_WORKSPACE ||
  fs.realpathSync(process.env.GITHUB_WORKSPACE) !== fs.realpathSync(ROOT)
)
  throw new Error('Requires the disposable Windows Actions checkout; local execution is forbidden');

const OUTPUT = path.resolve(args[1]);
const relativeOutput = path.relative(ROOT, OUTPUT);
if (
  relativeOutput === '' ||
  (!relativeOutput.startsWith('..' + path.sep) && !path.isAbsolute(relativeOutput))
)
  throw new Error('Keep control evidence outside the source checkout');
const LOGS = OUTPUT.replace(/\.json$/i, '') + '-logs';
if (fs.existsSync(OUTPUT) || fs.existsSync(LOGS)) throw new Error('Evidence output must be fresh');
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.mkdirSync(LOGS);
const deadline = Date.now() + 20 * 60 * 1000;
const receipt = {
  schema: 'aegis-native-object-controls/1',
  mode: 'controls-only',
  status: 'FAIL',
  source: null,
  sourceAfter: null,
  sourceHashes: null,
  sourceHashesAfter: null,
  platform: 'windows-x64-actions',
  startedAt: new Date().toISOString(),
  controls: {},
  execution: { javascriptRuns: 0, nativeBuilds: 0, nativeRuns: 0 },
  mutationsPerformed: 0,
  sourceUnchanged: false,
  focusedSuites: [...NATIVE_OBJECT_SUITES],
  diskSamples: [],
  error: null,
};
let commandNumber = 0;
function run(label, command, argv, timeout = 120000) {
  const available = deadline - Date.now();
  if (available <= 0) throw new Error('Overall controls deadline exceeded');
  const result = spawnSync(command, argv, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: Math.min(available, timeout),
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' },
  });
  const stdout = result.stdout ?? '',
    stderr = result.stderr ?? '';
  appendGateCommandLog(
    LOGS,
    `${++commandNumber}-${label}`,
    `${stdout}\n${stderr}`.slice(-128 * 1024),
  );
  if (result.error || result.signal || !Number.isInteger(result.status))
    throw new Error(`Command unavailable/timed out: ${label}`);
  return { status: result.status, stdout };
}
function git(...argv) {
  const value = run(`git-${argv[0]}`, 'git', argv);
  if (value.status !== 0) throw new Error('Git observation failed');
  return value.stdout.trim();
}
function source() {
  const observed = {
    head: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'),
    clean: git('status', '--porcelain=v1', '--untracked-files=all') === '',
  };
  if (
    !observed.clean ||
    !/^[a-f0-9]{40}$/.test(observed.head) ||
    !/^[a-f0-9]{40}$/.test(observed.tree)
  )
    throw new Error('A clean source HEAD and tree are required');
  return observed;
}
function disk(stage) {
  for (const [location, directory] of [
    ['source', ROOT],
    ['evidence', LOGS],
  ]) {
    const stat = fs.statfsSync(directory, { bigint: true });
    const freeBytes = Number(stat.bavail * stat.bsize);
    receipt.diskSamples.push({ stage, location, freeBytes });
    if (!Number.isSafeInteger(freeBytes) || freeBytes < 6 * 1024 ** 3)
      throw new Error('Insufficient control build storage');
  }
}
function sourceHashes() {
  return Object.fromEntries(
    NATIVE_OBJECT_SOURCE_PATHS.map((name) => [
      name,
      createHash('sha256')
        .update(fs.readFileSync(path.join(ROOT, name)))
        .digest('hex'),
    ]),
  );
}
let failure;
try {
  receipt.source = source();
  receipt.sourceHashes = sourceHashes();
  disk('before-javascript');
  const reportPath = path.join(LOGS, 'controls-js.json');
  receipt.execution.javascriptRuns++;
  const js = run('controls-js', process.execPath, [
    path.join(ROOT, 'node_modules/vitest/vitest.mjs'),
    'run',
    '--project',
    'main',
    ...NATIVE_OBJECT_SUITES,
    '--reporter=json',
    '--outputFile',
    reportPath,
  ]);
  if (!fs.existsSync(reportPath) || fs.statSync(reportPath).size > 256 * 1024)
    throw new Error('Missing/oversized JavaScript control report');
  receipt.controls.javascript = validateJavascriptControls(
    JSON.parse(fs.readFileSync(reportPath, 'utf8')),
    js.status,
    ROOT,
  );
  disk('before-native');
  receipt.execution.nativeBuilds++;
  const build = run(
    'controls-native-build',
    'dotnet',
    [
      'build',
      path.join(ROOT, 'sidecar/etw-file/EtwFile.csproj'),
      '--configuration',
      'Release',
      '--nologo',
      '--no-incremental',
      '--disable-build-servers',
      '/p:UseSharedCompilation=false',
      '/nodeReuse:false',
    ],
    240000,
  );
  if (build.status !== 0) throw new Error('Native controls build failed');
  receipt.execution.nativeRuns++;
  const native = run(
    'controls-native',
    path.join(ROOT, 'sidecar/etw-file/bin/Release/net10.0-windows/EtwFile.exe'),
    ['self-test'],
  );
  receipt.controls.native = validateNativeControls(native.stdout, native.status, build.status);
} catch (error) {
  failure = error;
} finally {
  try {
    receipt.sourceAfter = source();
    receipt.sourceHashesAfter = sourceHashes();
    receipt.sourceUnchanged =
      receipt.source?.head === receipt.sourceAfter.head &&
      receipt.source?.tree === receipt.sourceAfter.tree &&
      NATIVE_OBJECT_SOURCE_PATHS.every(
        (name) => receipt.sourceHashes?.[name] === receipt.sourceHashesAfter[name],
      );
    if (!receipt.sourceUnchanged) throw new Error('Source changed during controls');
  } catch (error) {
    failure ??= error;
  }
  try {
    disk('after-controls');
  } catch (error) {
    failure ??= error;
  }
  receipt.endedAt = new Date().toISOString();
  if (!failure) {
    try {
      receipt.status = 'PASS';
      validateNativeObjectControls(receipt);
    } catch (error) {
      failure = error;
    }
  }
  if (failure) {
    receipt.status = 'FAIL';
    receipt.error = failure.message;
  }
  const bytes = JSON.stringify(receipt, null, 2);
  if (Buffer.byteLength(bytes) > 256 * 1024) throw new Error('Controls receipt budget exceeded');
  fs.writeFileSync(OUTPUT, bytes, { flag: 'wx' });
}
console.log(
  JSON.stringify({
    status: receipt.status,
    mode: receipt.mode,
    mutationsPerformed: receipt.mutationsPerformed,
    sourceUnchanged: receipt.sourceUnchanged,
  }),
);
process.exitCode = receipt.status === 'PASS' ? 0 : 1;
