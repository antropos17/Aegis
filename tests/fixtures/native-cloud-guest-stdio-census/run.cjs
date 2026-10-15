'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const project = path.resolve(__dirname, '../../..');
const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-stdio-census-'));
const phasePath = 'scripts/qualification/CloudGuestStdioPhase.cs';
const files = [
  phasePath,
  'scripts/qualification/CloudGuestStdio.cs',
  'sidecar/session/GuestJobNative.cs',
  'tests/fixtures/native-cloud-guest-stdio-census/CensusFixture.cs',
  'tests/fixtures/native-cloud-guest-stdio-census/run.cjs',
];
const hash = (file) =>
  crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(project, file)))
    .digest('hex');
const sourceHashes = Object.fromEntries(files.map((file) => [file, hash(file)]));
let source = fs.readFileSync(path.join(project, phasePath), 'utf8');
function replace(before, after) {
  assert.equal(source.split(before).length, 2, before);
  source = source.replace(before, after);
}
replace(
  'private const string helper = @"C:\\ProgramData\\AegisCloudLab\\trusted\\guest-stdio.exe";',
  'private static readonly string helper = System.Reflection.Assembly.GetExecutingAssembly().Location;',
);
replace(
  'GuestJobNative.RequireStandardPrincipal(Handle, sid, session);',
  'Need(GuestJobNative.Principal(Handle) == sid && GuestJobNative.Session(Handle) == session);',
);
replace(
  'GuestJobNative.RequireStandardPrincipal(root, sid, session);',
  'Need(GuestJobNative.Principal(root) == sid && GuestJobNative.Session(root) == session);',
);
// Schedule real Job additions/removals at three native observation boundaries.
replace(
  'var before = GuestJobNative.Counts(job); uint[] pids = GuestJobNative.Members(job);',
  'var before = GuestJobNative.Counts(job); CensusFixture.At("before-members"); uint[] pids = GuestJobNative.Members(job);',
);
replace(
  'var after = GuestJobNative.Counts(job); uint[] again = GuestJobNative.Members(job);',
  'CensusFixture.At("before-after-count"); var after = GuestJobNative.Counts(job); CensusFixture.At("before-last-members"); uint[] again = GuestJobNative.Members(job);',
);
const altered = path.join(owned, 'phase.cs');
fs.writeFileSync(altered, source);
const exe = path.join(owned, 'census.exe');
cp.execFileSync(
  path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
  [
    '/nologo',
    '/target:exe',
    '/platform:x64',
    '/optimize+',
    '/warnaserror+',
    '/out:' + exe,
    altered,
    ...files
      .filter((file) => file.endsWith('.cs') && file !== phasePath)
      .map((file) => path.join(project, file)),
  ],
  { timeout: 10000, maxBuffer: 16384, windowsHide: true },
);
assert.ok(fs.statSync(exe).size <= 65536);
fs.copyFileSync(exe, path.join(owned, 'unknown.exe'), fs.constants.COPYFILE_EXCL);
const observations = [];
for (const [mode, operation, refusal] of [
  ['stable', 'discover', false],
  ['before-members', 'discover', false],
  ['before-after-count', 'discover', false],
  ['before-last-members', 'discover', false],
  ['exit-before-members', 'discover', true],
  ['exit-before-after-count', 'discover', true],
  ['exit-before-last-members', 'discover', true],
  ['unknown', 'discover', true],
  ['missing', 'discover', true],
  ['before-members', 'capture', true],
  ['before-members', 'cancel', true],
]) {
  const result = cp.spawnSync(exe, [process.execPath, mode, operation], {
    timeout: 9000,
    maxBuffer: 8192,
    windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, mode + ':' + operation + ':' + result.stderr.toString());
  assert.equal(result.stderr.length, 0);
  const value = JSON.parse(result.stdout.toString());
  assert.ok(Number.isInteger(value.retries) && value.retries >= 0 && value.retries <= 64);
  assert.ok(Number.isInteger(value.checkpoint) && value.checkpoint >= 1 && value.checkpoint <= 7);
  if (operation === 'discover' && mode.startsWith('before-')) {
    assert.ok(value.retries >= 1);
    assert.ok(value.observed >= 2 && value.elapsed < 3000);
  }
  if (operation !== 'discover' || mode.startsWith('exit-')) assert.equal(value.retries, 0);
  if (mode === 'missing') assert.ok(value.elapsed >= 3000 && value.elapsed < 4000);
  observations.push({ mode, operation, expectedRefusal: refusal, ...value });
  fs.writeFileSync(path.join(owned, 'progress.json'), JSON.stringify(observations, null, 2));
}
for (const [file, before] of Object.entries(sourceHashes)) assert.equal(hash(file), before);
const passed = observations.every(
  (row) => row.refused === row.expectedRefusal && row.closed && row.retainedExited,
);
const receipt = {
  schemaVersion: 1,
  passed,
  controls: observations.length,
  observations,
  sourceHashes,
  scope: 'actual-native-job-processes-with-controlled-startup-census-schedule',
  ownedFixtureRoot: owned,
  hostedCauseProved: false,
  standardUserQualified: false,
  e2Qualified: false,
  launchAllowed: false,
};
fs.writeFileSync(path.join(owned, 'receipt.json'), JSON.stringify(receipt, null, 2));
process.stdout.write(JSON.stringify(receipt) + '\n');
assert.equal(passed, true, 'startup-census-behavior-refused');
