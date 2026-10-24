'use strict';
const assert = require('node:assert/strict');
const { assertInstallPath } = require('./windows-installer-paths.cjs');
const root = 'C:\\aegis-installer-qa\\all-users-update';
const exe = 'C:\\Program Files\\aegis\\AEGIS - AI Monitoring & Threat Detection.exe';
const env = {
  GITHUB_ACTIONS: 'true',
  RUNNER_ENVIRONMENT: 'github-hosted-hyperv-guest',
  RUNNER_ARCH: 'X64',
  USERNAME: 'AegisSetup',
  ProgramFiles: 'C:\\Program Files',
};
assert.equal(assertInstallPath(root, exe, env), 'all-users');
assert.equal(assertInstallPath(root.toUpperCase(), exe.toUpperCase(), env), 'all-users');
for (const key of Object.keys(env))
  assert.throws(() => assertInstallPath(root, exe, { ...env, [key]: 'untrusted' }));
for (const target of [
  exe + '.other',
  exe.replace('aegis\\', 'other\\'),
  root + '\\install\\app.exe',
])
  assert.throws(() => assertInstallPath(root, target, env));
for (const otherRoot of [root + '-other', 'C:\\aegis-installer-qa\\auto-update'])
  assert.throws(() => assertInstallPath(otherRoot, exe, env));
assert.equal(
  assertInstallPath('C:\\guest\\case', 'C:\\guest\\case\\install\\app.exe', {}),
  'current-user',
);
assert.throws(() =>
  assertInstallPath('C:\\guest\\case', 'C:\\guest\\case\\install-else\\app.exe', {}),
);
assert.throws(() =>
  assertInstallPath('C:\\guest\\case', 'C:\\guest\\case\\install\\..\\app.exe', {}),
);
console.log(JSON.stringify({ status: 'PASS', cases: 15, nativeExecution: false }));
