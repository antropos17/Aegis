'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const project = path.resolve(__dirname, '../../..');
const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-stdio-retained-exit-'));
const phasePath = path.join(project, 'scripts/qualification/CloudGuestStdioPhase.cs');
const original = fs.readFileSync(phasePath, 'utf8');
let phase = original;
for (const [before, after] of [
  [
    'private const string helper = @"C:\\ProgramData\\AegisCloudLab\\trusted\\guest-stdio.exe";',
    'private static readonly string helper = System.Reflection.Assembly.GetExecutingAssembly().Location;',
  ],
  [
    'GuestJobNative.RequireStandardPrincipal(Handle, sid, session);',
    'Need(GuestJobNative.Principal(Handle) == sid && GuestJobNative.Session(Handle) == session);',
  ],
  [
    'GuestJobNative.RequireStandardPrincipal(root, sid, session);',
    'Need(GuestJobNative.Principal(root) == sid && GuestJobNative.Session(root) == session);',
  ],
  [
    'Member member = Discover(); transport.Attach',
    'Member member = Discover(); StdioReadinessDiagnostic.Discovered(); transport.Attach',
  ],
]) {
  assert.equal(phase.split(before).length, 2, 'source-binding-refused');
  phase = phase.replace(before, after);
}
phase = phase.replaceAll(
  'Need(payloads == 1);',
  'StdioReadinessDiagnostic.Payloads(payloads); Need(payloads == 1);',
);
assert.ok([2, 3].includes(phase.split('GuestJobNative.WaitForSingleObject(member.Handle,').length));
phase = phase.replaceAll(
  'GuestJobNative.WaitForSingleObject(member.Handle,',
  'ClosureSchedule.Wait(member.Handle,',
);
const altered = path.join(owned, 'phase.cs');
fs.writeFileSync(altered, phase);
const executable = path.join(owned, 'retained-exit.exe');
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
    path.join(__dirname, 'RetainedExitFixture.cs'),
    ...[
      'scripts/qualification/CloudGuestStdio.cs',
      'scripts/qualification/CloudGuestStdioLauncher.cs',
      'sidecar/session/GuestJobNative.cs',
      'sidecar/session/GuestJobInventory.cs',
    ].map((file) => path.join(project, file)),
  ],
  { timeout: 10000, maxBuffer: 16384, windowsHide: true },
);
const observations = [];
for (const mode of [
  'closure-transient',
  'closure-invalid-once',
  'closure-timeout',
  'zero-budget',
]) {
  const result = spawnSync(
    executable,
    [
      process.execPath,
      path.join(project, 'tests/fixtures/native-cloud-guest-stdio-readiness/root.cjs'),
      path.join(project, 'scripts/qualification/stdio-fixed-task.cjs'),
      '5',
      mode,
    ],
    { timeout: 12000, maxBuffer: 8192, windowsHide: true },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(result.stderr.length, 0);
  const receipt = JSON.parse(result.stdout.toString());
  observations.push({ mode, ...receipt });
  fs.writeFileSync(path.join(owned, 'observations.json'), JSON.stringify(observations, null, 2));
  assert.equal(receipt.jobClosed, true);
  assert.equal(receipt.eventuallyExited, true, 'independent-native-retained-exit');
  assert.ok(receipt.memberWaits.every((member) => member.eventual === 0));
  assert.equal(receipt.diagnosticCount, receipt.memberWaits.length);
  assert.equal(receipt.standardUserQualified, false);
  if (mode === 'closure-transient') {
    assert.ok(receipt.scheduledTimeouts > 0);
    assert.equal(
      receipt.retainedExited,
      true,
      'transient-retained-exit-timeout-must-settle-within-owner-budget',
    );
    assert.equal(receipt.stdioPassed, true);
    assert.ok(receipt.closureElapsed >= 80 && receipt.closureElapsed < 2000);
  } else {
    assert.equal(receipt.retainedExited, false);
    assert.equal(receipt.stdioPassed, false);
    if (mode === 'closure-invalid-once') {
      assert.equal(receipt.scheduledWaitFailures, 1);
      assert.equal(receipt.nativeWaitError, 6);
      assert.equal(receipt.diagnosticFailures, 1);
      assert.equal(receipt.diagnosticError, 6);
      assert.equal(receipt.failedIdentityRecorded, true);
      assert.ok(receipt.closureElapsed < 500);
    }
    if (mode === 'closure-timeout') {
      assert.ok(receipt.diagnosticTimeouts > 0);
      assert.ok(receipt.closureElapsed >= 1950 && receipt.closureElapsed < 2300);
    }
    if (mode === 'zero-budget') {
      assert.equal(receipt.diagnosticUnobserved, receipt.diagnosticCount);
      assert.ok(receipt.closureElapsed >= 2000 && receipt.observationElapsed < 500);
    }
  }
}
assert.equal(fs.readFileSync(phasePath, 'utf8'), original);
const receipt = {
  scope: 'actual-native-job-processes-with-synthetic-exit-visibility-schedule',
  passed: true,
  controls: observations.length,
  observations,
  ownedFixtureRoot: owned,
  sourceSha256: crypto.createHash('sha256').update(original).digest('hex'),
  hostedFailingMemberIdentified: false,
  standardUserQualified: false,
  launchAllowed: false,
  e2Qualified: false,
};
fs.writeFileSync(path.join(owned, 'receipt.json'), JSON.stringify(receipt, null, 2));
process.stdout.write(
  JSON.stringify({
    ...receipt,
    observations: observations.map(({ memberWaits, ...observation }) => ({
      ...observation,
      independentRetainedHandles: memberWaits.length,
    })),
  }) + '\n',
);
