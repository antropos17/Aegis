'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const project = path.resolve(__dirname, '../../..');
const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-stdio-readiness-'));
const sources = [
  'scripts/qualification/CloudGuestStdioPhase.cs',
  'scripts/qualification/CloudGuestStdio.cs',
  'scripts/qualification/CloudGuestStdioLauncher.cs',
  'scripts/qualification/stdio-fixed-task.cjs',
  'sidecar/session/GuestJobNative.cs',
  'sidecar/session/GuestJobInventory.cs',
  'tests/fixtures/native-cloud-guest-stdio-readiness/BaselineStdioPhase.cs',
  'tests/fixtures/native-cloud-guest-stdio-readiness/StdioReadinessFixture.cs',
  'tests/fixtures/native-cloud-guest-stdio-readiness/root.cjs',
  'tests/fixtures/native-cloud-guest-stdio-readiness/run.cjs',
];
const hashes = Object.fromEntries(
  sources.map((file) => [
    file,
    crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(project, file)))
      .digest('hex'),
  ]),
);

function replaceOnce(text, before, after) {
  assert.equal(text.split(before).length, 2, 'source-binding-refused');
  return text.replace(before, after);
}

function compile(label, relative) {
  let text = fs.readFileSync(path.join(project, relative), 'utf8');
  if (label === 'baseline') {
    // Adapt only the historical method's interface shape; preserve its original zero-time behavior.
    text = replaceOnce(
      text,
      'public void ObserveClosure(bool confirmed, Dictionary<string, object> receipt)',
      'public void ObserveClosure(bool confirmed, Dictionary<string, object> receipt, Stopwatch ownerClosureClock)',
    );
  }
  text = replaceOnce(
    text,
    'private const string helper = @"C:\\ProgramData\\AegisCloudLab\\trusted\\guest-stdio.exe";',
    'private static readonly string helper = System.Reflection.Assembly.GetExecutingAssembly().Location;',
  );
  text = replaceOnce(
    text,
    'GuestJobNative.RequireStandardPrincipal(Handle, sid, session);',
    'Need(GuestJobNative.Principal(Handle) == sid && GuestJobNative.Session(Handle) == session);',
  );
  text = replaceOnce(
    text,
    'GuestJobNative.RequireStandardPrincipal(root, sid, session);',
    'Need(GuestJobNative.Principal(root) == sid && GuestJobNative.Session(root) == session);',
  );
  // Keep the fixture helper gated until the real Discover census sealed its retained helper.
  text = replaceOnce(
    text,
    'Member member = Discover(); transport.Attach',
    'Member member = Discover(); StdioReadinessDiagnostic.Discovered(); transport.Attach',
  );
  // Instrument the actual exact-count predicate; no native identity, Job or census check is removed.
  assert.ok(text.includes('Need(payloads == 1);'));
  text = text.replaceAll(
    'Need(payloads == 1);',
    'StdioReadinessDiagnostic.Payloads(payloads); Need(payloads == 1);',
  );
  const altered = path.join(owned, label + '.cs');
  fs.writeFileSync(altered, text);
  const executable = path.join(owned, label + '.exe');
  execFileSync(
    path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    [
      '/nologo',
      '/target:exe',
      '/platform:x64',
      '/optimize+',
      '/warnaserror+',
      `/out:${executable}`,
      altered,
      path.join(__dirname, 'StdioReadinessFixture.cs'),
      ...[
        'scripts/qualification/CloudGuestStdio.cs',
        'scripts/qualification/CloudGuestStdioLauncher.cs',
        'sidecar/session/GuestJobNative.cs',
        'sidecar/session/GuestJobInventory.cs',
      ].map((file) => path.join(project, file)),
    ],
    { timeout: 10000, maxBuffer: 16384, windowsHide: true },
  );
  assert.ok(fs.statSync(executable).size <= 65536);
  return executable;
}

const baseline = compile(
  'baseline',
  'tests/fixtures/native-cloud-guest-stdio-readiness/BaselineStdioPhase.cs',
);
const candidate = compile('candidate', 'scripts/qualification/CloudGuestStdioPhase.cs');
const originalTask = fs.readFileSync(
  path.join(project, 'scripts/qualification/stdio-fixed-task.cjs'),
  'utf8',
);
const task = path.join(owned, 'fixed-task.cjs');
fs.writeFileSync(task, originalTask);
const absentTask = path.join(owned, 'absent-ready.cjs');
fs.writeFileSync(
  absentTask,
  replaceOnce(
    originalTask,
    'if (kind === 5) setImmediate(() => process.stdout.write(Buffer.from([82])));',
    '',
  ),
);
const wrongTask = path.join(owned, 'wrong-ready.cjs');
fs.writeFileSync(wrongTask, replaceOnce(originalTask, 'Buffer.from([82])', 'Buffer.from([81])'));
const observations = [];
function run(label, exe, kind, mode, selectedTask = task) {
  const result = spawnSync(
    exe,
    [process.execPath, path.join(__dirname, 'root.cjs'), selectedTask, String(kind), mode],
    { timeout: 12000, maxBuffer: 8192, windowsHide: true },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, label + ':' + String(result.stderr));
  assert.equal(result.stderr.length, 0);
  const receipt = JSON.parse(result.stdout.toString());
  assert.equal(receipt.jobClosed, true);
  assert.equal(receipt.retainedExited, true);
  assert.equal(receipt.standardUserQualified, false);
  observations.push({ label, ...receipt });
  fs.writeFileSync(path.join(owned, 'progress.json'), JSON.stringify(observations, null, 2));
  return receipt;
}

const red = run('baseline-delayed-start', baseline, 5, 'baseline');
assert.equal(red.refused, true);
assert.equal(red.payloadPredicate, 0);
assert.equal(red.outcome, 'Cancelled');
assert.equal(red.input, 0);
assert.equal(red.connectedMask, 0);
assert.equal(red.readyBeforeTimer, false);
for (const mode of ['immediate', 'delayed']) {
  const positive = run('candidate-' + mode, candidate, 5, mode);
  assert.equal(positive.refused, false);
  assert.equal(positive.stdioPassed, true);
  assert.equal(positive.payloadPredicate, 1);
  assert.equal(positive.outcome, 'Cancelled');
  assert.equal(positive.readyBeforeTimer, true);
  assert.equal(positive.input, 8192);
  if (mode === 'delayed') assert.ok(positive.elapsed >= 850);
}
for (let kind = 1; kind <= 4; kind++) {
  const positive = run('unchanged-case-' + kind, candidate, kind, 'immediate');
  assert.equal(positive.refused, false);
  assert.equal(positive.stdioPassed, true);
  assert.equal(positive.outcome, kind <= 2 ? 'Complete' : 'OutputLimit');
}
for (const [label, mode, selectedTask] of [
  ['never-released-startup', 'never', task],
  ['absent-marker', 'immediate', absentTask],
  ['wrong-marker', 'immediate', wrongTask],
  ['marker-without-payload', 'helper-marker', task],
]) {
  const negative = run(label, candidate, 5, mode, selectedTask);
  assert.equal(negative.refused, true);
  assert.equal(negative.stdioPassed, false);
  assert.equal(negative.readyBeforeTimer, false);
  if (label === 'marker-without-payload') assert.equal(negative.payloadPredicate, 0);
  if (label === 'never-released-startup' || label === 'absent-marker') {
    assert.equal(negative.outcome, 'Deadline');
    assert.ok(negative.elapsed >= 5000 && negative.elapsed < 7000);
  }
}
for (const [file, hash] of Object.entries(hashes))
  assert.equal(
    crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(project, file)))
      .digest('hex'),
    hash,
  );
const output = {
  schemaVersion: 1,
  scope: 'native-same-principal-stdio-phase-with-synthetic-startup-schedule',
  passed: true,
  controls: observations.length,
  observations,
  sourceHashes: hashes,
  ownedFixtureRoot: owned,
  standardUserQualified: false,
  actualHostedCauseProved: false,
  productionEnabled: false,
  launchAllowed: false,
  e2Qualified: false,
};
fs.writeFileSync(path.join(owned, 'receipt.json'), JSON.stringify(output, null, 2));
process.stdout.write(JSON.stringify(output) + '\n');
