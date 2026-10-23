'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * Validate the exact machine path only inside the dedicated disposable guest case.
 * @param {string} root Qualification output root.
 * @param {string} exe Installed application path.
 * @param {NodeJS.ProcessEnv} [env] Disposable guest environment.
 * @returns {'current-user'|'all-users'} Validated installation scope.
 * @since 0.20.1
 */
function assertInstallPath(root, exe, env = process.env) {
  const normalize = (value) => path.win32.resolve(value).toLowerCase();
  const qa = normalize(root);
  const target = normalize(exe);
  if (qa !== 'c:\\aegis-installer-qa\\all-users-update') {
    assert(target.startsWith(qa + '\\install\\'), 'Installer path escaped guest scratch');
    return 'current-user';
  }
  assert.equal(env.GITHUB_ACTIONS, 'true');
  assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted-hyperv-guest');
  assert.equal(env.RUNNER_ARCH, 'X64');
  assert.equal(env.USERNAME, 'AegisSetup');
  assert.equal(normalize(env.ProgramFiles || ''), 'c:\\program files');
  assert.equal(target, 'c:\\program files\\aegis\\aegis - ai monitoring & threat detection.exe');
  return 'all-users';
}

module.exports = { assertInstallPath };
