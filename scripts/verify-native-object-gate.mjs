/** Cloud-only load-bearing mutations of actual native producers and operational consumers. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
  throw new Error('Keep mutation evidence outside the source checkout');
const LOGS = OUTPUT.replace(/\.json$/i, '') + '-logs';
if (fs.existsSync(OUTPUT) || fs.existsSync(LOGS)) throw new Error('Evidence output must be fresh');
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.mkdirSync(LOGS);
const deadline = Date.now() + 20 * 60 * 1000;
const admission = 'src/main/platform/etw-file-admission.js';
const lease = 'sidecar/etw-file/FileObjectLease.cs';
const mapping = 'sidecar/etw-file/FileMapping.cs';
const runtime = 'src/main/platform/etw-file-runtime.js';
const supervisor = 'src/main/platform/etw-file-supervisor.js';
const observer = 'sidecar/etw-file/FileOrphanObserver.cs';
const main = 'src/main/main.js';
const ingress = 'src/main/native-file-ingress.js';
const baselines = 'src/main/baselines.js';
const normalizer = 'src/shared/ecs-normalizer.js';
const risk = 'src/renderer/lib/utils/enrich-agents.ts';
const logon = 'scripts/qualification/windows-native-read-host.ps1';
const tests = [
  'tests/main/platform/etw-file-operational-runtime.test.js',
  'tests/main/platform/etw-file-admission.test.js',
  'tests/main/live-native-file-ingress.test.js',
  'tests/main/live-native-object-consumers.test.js',
  'tests/main/live-native-main-wiring.test.js',
  'tests/main/windows-native-read-logon.test.js',
  'tests/main/windows-native-read-manifest.test.js',
  'tests/main/windows-native-read-invocation.test.js',
];
const minimumAssertions = 59 + 4 + 7 + 4;
const project = path.join(ROOT, 'sidecar/etw-file/EtwFile.csproj');
const executable = path.join(ROOT, 'sidecar/etw-file/bin/Release/net10.0-windows/EtwFile.exe');
const originals = new Map(
  [
    admission,
    lease,
    mapping,
    runtime,
    supervisor,
    observer,
    main,
    ingress,
    baselines,
    normalizer,
    risk,
    logon,
  ].map((name) => [name, fs.readFileSync(path.join(ROOT, name))]),
);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const receipt = {
  schema: 1,
  status: 'FAIL',
  source: null,
  platform: 'windows-x64-actions',
  startedAt: new Date().toISOString(),
  controls: [],
  mutations: [],
  restored: false,
  error: null,
  sourceHashes: Object.fromEntries([...originals].map(([name, bytes]) => [name, sha(bytes)])),
  focusedSuites: tests,
};

function run(label, command, argv, timeout = 120000) {
  const available = deadline - Date.now();
  if (available <= 0) throw new Error('Overall mutation deadline exceeded');
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
  fs.writeFileSync(path.join(LOGS, `${label}.log`), `${stdout}\n${stderr}`.slice(-128 * 1024));
  if (result.error || result.signal || !Number.isInteger(result.status))
    throw new Error(`Command unavailable/timed out: ${label}`);
  return { status: result.status, stdout };
}
function git(...argv) {
  const value = run(
    `git-${argv[0]}-${receipt.controls.length}-${receipt.mutations.length}`,
    'git',
    argv,
  );
  if (value.status !== 0) throw new Error('Git observation failed');
  return value.stdout.trim();
}
function clean() {
  return git('status', '--porcelain=v1', '--untracked-files=all') === '';
}
function restore() {
  for (const [name, bytes] of originals) fs.writeFileSync(path.join(ROOT, name), bytes);
  if (
    [...originals].some(
      ([name, bytes]) => sha(fs.readFileSync(path.join(ROOT, name))) !== sha(bytes),
    )
  )
    throw new Error('Original source hash restoration failed');
}
function edit(name, replacements) {
  let text = originals.get(name).toString('utf8');
  for (const [find, replacement] of replacements) {
    if (text.split(find).length !== 2) throw new Error(`Mutation anchor must match once: ${name}`);
    text = text.replace(find, replacement);
  }
  if (sha(text) === sha(originals.get(name))) throw new Error('Mutation did not change source');
  fs.writeFileSync(path.join(ROOT, name), text);
}
function javascript(label, expectedPass) {
  const reportPath = path.join(LOGS, `${label}.json`);
  const result = run(label, process.execPath, [
    path.join(ROOT, 'node_modules/vitest/vitest.mjs'),
    'run',
    '--project',
    'main',
    ...tests,
    '--reporter=json',
    '--outputFile',
    reportPath,
  ]);
  if (!fs.existsSync(reportPath) || fs.statSync(reportPath).size > 256 * 1024)
    throw new Error(`Missing/oversized test receipt: ${label}`);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const assertions = (report.testResults ?? []).flatMap((suite) => suite.assertionResults ?? []);
  if (
    report.testResults?.length !== tests.length ||
    assertions.length < minimumAssertions ||
    (report.numRuntimeErrorTestSuites ?? 0) !== 0 ||
    report.testResults.some((suite) => !suite.assertionResults?.length) ||
    assertions.some((test) => !['passed', 'failed'].includes(test.status))
  )
    throw new Error(`Incomplete test selection: ${label}`);
  const failed = assertions.filter((test) => test.status === 'failed');
  const meaningful =
    failed.length > 0 &&
    failed.every(
      (test) =>
        test.failureMessages?.length > 0 &&
        test.failureMessages.every(
          (text) =>
            text.includes('AssertionError') &&
            !/SyntaxError|ReferenceError|TypeError|Cannot find module|Failed to load/.test(text),
        ),
    );
  if (
    expectedPass ? result.status !== 0 || failed.length !== 0 : result.status === 0 || !meaningful
  )
    throw new Error(`Expected ${expectedPass ? 'GREEN' : 'behavioral RED'}: ${label}`);
  return {
    status: expectedPass ? 'PASS' : 'KILLED',
    tests: assertions.length,
    failed: failed.length,
  };
}
function native(label, expectedPass, expectedFailure) {
  const build = run(
    `${label}-build`,
    'dotnet',
    [
      'build',
      project,
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
  if (build.status !== 0)
    throw new Error(`Native compiler failure is not a killed mutant: ${label}`);
  const result = run(label, executable, ['self-test']);
  const passed = (result.stdout.match(/^PASS /gm) ?? []).length;
  if (
    expectedPass
      ? result.status !== 0 || passed === 0 || /^FAIL /m.test(result.stdout)
      : result.status === 0 || !result.stdout.includes(`FAIL ${expectedFailure}`)
  )
    throw new Error(`Expected native ${expectedPass ? 'GREEN' : 'named behavioral RED'}: ${label}`);
  return { status: expectedPass ? 'PASS' : 'KILLED', passedBeforeFailure: passed };
}
const mutants = [
  {
    id: 'restricted-fixed-phase-inline-entry',
    file: logon,
    edits: [['& ([scriptblock]::Create($source)) -Phase $Phase', '& $fixedPath -Phase $Phase']],
  },
  {
    id: 'manifest-json-array-materialization',
    file: logon,
    edits: [
      [
        '$parsed=ConvertFrom-Json -InputObject $text -ErrorAction Stop',
        '$parsed=@(ConvertFrom-Json -InputObject $text -ErrorAction Stop)',
      ],
    ],
  },
  {
    id: 'second-logon-literal-string-count',
    file: logon,
    edits: [
      [
        '[regex]::Matches($AnswerText,[regex]::Escape($marker)).Count -ne 1',
        '$AnswerText.Split($marker).Length -ne 2',
      ],
    ],
  },
  {
    id: 'main-operational-callback',
    file: main,
    edits: [
      [
        'onOperationalRead: (observation) => nativeFileIngress?.offer(observation) === true,',
        'onOperationalRead: () => false,',
      ],
    ],
  },
  {
    id: 'main-live-publisher',
    file: main,
    edits: [
      ['publishLive: (event) => publishLiveFileEvent(event, true),', 'publishLive: () => {},'],
    ],
  },
  {
    id: 'ingress-audit-custody',
    file: ingress,
    edits: [
      [
        "if (accepted !== true) return reject('native-audit-custody-rejected');",
        "if (false) return reject('native-audit-custody-rejected');",
      ],
    ],
  },
  {
    id: 'baseline-object-cohort',
    file: baselines,
    edits: [
      [
        'if (sd.files.size === 0 && sd.sensitiveCount === 0 && sd.endpoints.size === 0) continue;',
        '// Deliberately mixed object-only sessions into legacy path training.',
      ],
    ],
  },
  {
    id: 'normalizer-object-path',
    file: normalizer,
    edits: [
      [
        'const fields = {};',
        "const fields = {}; if (event.observationKind === 'bound-object-read') fields.file = { path: 'MUTANT-LABEL-AS-PATH' };",
      ],
    ],
  },
  {
    id: 'risk-fullbirth-join',
    file: risk,
    edits: [
      [
        'objectRead && (!raw.createTime100ns || ev.createTime100ns !== raw.createTime100ns)',
        'false',
      ],
    ],
  },
  {
    id: 'audit-replay-live-effects',
    file: main,
    edits: [
      [
        'consume: (records) => audit.persistBatch(records),',
        'consume: (records) => { records.forEach(publishLiveFileEvent); return audit.persistBatch(records); },',
      ],
    ],
  },
  {
    id: 'native-ack-equality',
    file: lease,
    edits: [['qpc <= entry.BoundFrom', 'qpc < entry.BoundFrom']],
    failure: 'actual object lease never backfills its discovering or queued earlier read',
  },
  {
    id: 'native-terminal-dispose',
    file: lease,
    edits: [['if (disposed) return null;', '// Deliberately omitted terminal guard.']],
    failure: 'expired, exited and invalidated object leases never preserve authority',
  },
  {
    id: 'js-lifetime-object-key',
    file: admission,
    edits: [
      [
        '${bound.bindingId}:${bound.volumeSerial}:${bound.fileId128}',
        '${bound.volumeSerial}:${bound.fileId128}',
      ],
    ],
  },
  {
    id: 'js-policy-ack-time',
    file: admission,
    edits: [['proof.fromQpc !== bound.ack ||', 'false ||']],
  },
  {
    id: 'js-later-watermark',
    file: admission,
    edits: [
      ['BigInt(proof.toQpc) > BigInt(context.watermarkQpc)', 'false'],
      ['BigInt(item.record.objectProof.toQpc) > BigInt(context.watermarkQpc)', 'false'],
    ],
  },
  {
    id: 'native-private-address',
    file: mapping,
    edits: [
      [
        '[JsonIgnore] public ulong NativeObject { get; init; }',
        'public ulong NativeObject { get; init; }',
      ],
    ],
    failure: 'private kernel addresses never enter serialized observations',
  },
  {
    id: 'js-runtime-intake',
    file: runtime,
    edits: [['admission.accept(records);', '// Deliberately disconnected raw intake.']],
  },
  {
    id: 'js-runtime-state',
    file: runtime,
    edits: [
      ['onAdmissionState: (context) => admission.update(context),', 'onAdmissionState: () => {},'],
    ],
  },
  {
    id: 'js-runtime-loss-mapping',
    file: supervisor,
    edits: [['continuous: zero && current?.sticky.length === 0,', 'continuous: true,']],
  },
  {
    id: 'native-original-closure',
    file: observer,
    edits: [
      [
        'int[]? originalExits = waitOriginals == null ? null : await waitOriginals();',
        'int[]? originalExits = null;',
      ],
    ],
    failure:
      'normal terminal observer waits for all original objects and preserves actual exit codes',
  },
];
let failure;
let restorationFailure;
let controlsStarted = false;
try {
  if (!clean()) throw new Error('Checkout must be clean before mutation');
  receipt.source = git('rev-parse', 'HEAD');
  controlsStarted = true;
  receipt.controls.push({ phase: 'before', js: javascript('before-js', true) });
  receipt.controls.push({ phase: 'before', native: native('before-native', true) });
  for (const mutant of mutants) {
    let mutantFailure;
    try {
      edit(mutant.file, mutant.edits);
      const result = mutant.failure
        ? native(mutant.id, false, mutant.failure)
        : javascript(mutant.id, false);
      receipt.mutations.push({ id: mutant.id, ...result });
    } catch (error) {
      mutantFailure = error;
    }
    try {
      restore();
    } catch (error) {
      restorationFailure ??= error;
    }
    // Preserve the mutation's own failure even if byte restoration also failed.
    if (mutantFailure) throw mutantFailure;
    if (restorationFailure) throw restorationFailure;
  }
} catch (error) {
  failure = error;
} finally {
  try {
    restore();
    if (controlsStarted) {
      receipt.controls.push({ phase: 'restored', js: javascript('restored-js', true) });
      receipt.controls.push({ phase: 'restored', native: native('restored-native', true) });
    }
    receipt.restored = clean();
    if (!receipt.restored) restorationFailure ??= new Error('Checkout is dirty after restoration');
  } catch (error) {
    restorationFailure ??= error;
  }
  failure ??= restorationFailure;
  receipt.restorationError = restorationFailure?.message ?? null;
  receipt.error = failure?.message ?? null;
  receipt.status =
    !failure && receipt.restored && receipt.mutations.length === mutants.length ? 'PASS' : 'FAIL';
  receipt.endedAt = new Date().toISOString();
  const bytes = JSON.stringify(receipt, null, 2);
  if (Buffer.byteLength(bytes) > 256 * 1024) {
    receipt.status = 'FAIL';
    receipt.error = 'Gate receipt budget exceeded';
    fs.writeFileSync(
      OUTPUT,
      JSON.stringify({ status: 'FAIL', error: receipt.error, restored: receipt.restored }),
    );
  } else fs.writeFileSync(OUTPUT, bytes);
}
console.log(
  JSON.stringify({
    status: receipt.status,
    killed: receipt.mutations.length,
    restored: receipt.restored,
  }),
);
process.exitCode = receipt.status === 'PASS' ? 0 : 1;
