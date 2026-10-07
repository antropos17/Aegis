'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const BEFORE = 'module.exports=(a,b)=>a-b;\n';
const AFTER = 'module.exports=(a,b)=>a+b;\n';
const DIFF = 'diff --git a/sum.cjs b/sum.cjs\nindex '; // Index hashes vary with object format.

// Fixed disposable workflow only. No operation/command is accepted from a caller.
function runFixed(runtime, scratch, deadline = 3000) {
  const begin = performance.now();
  const receipt = { schemaVersion: 1, scope: 'fixed-disposable-git', passed: false,
    version: null, initialClean: false, statusModified: false, diffObserved: false,
    localCommitObserved: false, finalClean: false, remotesAbsent: false,
    commands: 0, elapsedMilliseconds: 0, stage: 'fresh-directory', exitCode: null,
    e2Qualified: false, e6Qualified: false, launchAllowed: false };
  try {
    if (deadline !== 3000 || !path.isAbsolute(runtime) || !path.isAbsolute(scratch)) throw new Error('refused');
    for (const selected of [runtime, scratch]) if (!fs.lstatSync(selected).isDirectory() || fs.lstatSync(selected).isSymbolicLink()) throw new Error('refused');
    const project = path.join(scratch, 'git-work');
    fs.mkdirSync(project); // Existing paths are never adopted or cleared.
    const empty = path.join(project, 'empty');
    fs.mkdirSync(empty);
    const config = path.join(empty, 'config'); fs.writeFileSync(config, '', { flag: 'wx' });
    const env = { SystemRoot: process.env.SystemRoot || 'C:\\Windows',
      TEMP: scratch, TMP: scratch, HOME: empty, USERPROFILE: empty,
      PATH: path.join(runtime, 'cmd'), GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_SYSTEM: config, GIT_CONFIG_GLOBAL: config, GIT_ATTR_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LC_ALL: 'C',
      GIT_AUTHOR_DATE: '2026-10-07T00:00:00+0000', GIT_COMMITTER_DATE: '2026-10-07T00:00:00+0000' };
    const common = ['-c','core.hooksPath='+empty,'-c','credential.helper=',
      '-c','protocol.allow=never','-c','core.autocrlf=false','-c','core.safecrlf=false',
      '-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','commit.gpgSign=false',
      '-c','gc.auto=0','-c','maintenance.auto=false','-c','user.name=Aegis Lab',
      '-c','user.email=aegis-lab@example.invalid'];
    function git(stage, args) {
      receipt.stage = stage;
      const remaining = Math.floor(deadline - (performance.now() - begin));
      if (remaining < 1) throw new Error('deadline');
      const child = spawnSync(path.join(runtime, 'cmd', 'git.exe'), [...common, ...args],
        { cwd: project, env, timeout: remaining, maxBuffer: 4096, windowsHide: true, encoding: 'utf8' });
      receipt.commands++;
      receipt.exitCode = Number.isInteger(child.status) ? child.status : null;
      if (child.error || child.status !== 0 || (child.stderr || '') !== '' || performance.now() - begin >= deadline) throw new Error('refused');
      return child.stdout;
    }
    if (git('version', ['--version']) !== 'git version 2.56.0.windows.2\n') throw new Error('version');
    receipt.version = '2.56.0.windows.2';
    git('init', ['init','--quiet','--initial-branch=lab','--template='+empty]);
    // The configuration home/hooks folder is outside the tracked fixed file.
    fs.writeFileSync(path.join(project, '.gitignore'), '/empty/\n');
    fs.writeFileSync(path.join(project, 'sum.cjs'), BEFORE);
    git('baseline-add', ['add','--','.gitignore','sum.cjs']);
    git('baseline-commit', ['commit','--quiet','--no-gpg-sign','-m','fixed baseline']);
    if (git('initial-status', ['status','--porcelain=v1','--untracked-files=all']) !== '') throw new Error('dirty');
    receipt.initialClean = true;
    fs.writeFileSync(path.join(project, 'sum.cjs'), AFTER);
    if (git('modified-status', ['status','--porcelain=v1','--untracked-files=all']) !== ' M sum.cjs\n') throw new Error('status');
    receipt.statusModified = true;
    const diff = git('diff', ['diff','--no-ext-diff','--no-textconv','--','sum.cjs']);
    if (!diff.startsWith(DIFF) || !diff.endsWith('@@ -1 +1 @@\n-' + BEFORE + '+' + AFTER)) throw new Error('diff');
    receipt.diffObserved = true;
    git('edit-add', ['add','--','sum.cjs']);
    git('local-commit', ['commit','--quiet','--no-gpg-sign','-m','fixed sum correction']);
    if (git('head-content', ['show','HEAD:sum.cjs']) !== AFTER) throw new Error('commit');
    if (git('commit-count', ['rev-list','--count','HEAD']) !== '2\n') throw new Error('commit');
    receipt.localCommitObserved = true;
    if (git('final-status', ['status','--porcelain=v1','--untracked-files=all']) !== '') throw new Error('dirty');
    receipt.finalClean = true;
    if (git('remotes', ['remote']) !== '') throw new Error('remote');
    receipt.remotesAbsent = true; receipt.stage = 'completed'; receipt.passed = true;
  } catch { /* Fixed stage/numeric exit only; never publish process/error text. */ }
  receipt.elapsedMilliseconds = Math.ceil(performance.now() - begin);
  return receipt;
}
if (require.main === module) {
  if (process.platform !== 'win32' || process.env.AEGIS_CLOUD_GUEST_TASK !== '1' || process.argv.length !== 2) process.exit(2);
  const receipt = runFixed('C:\\ProgramData\\AegisCloudLab\\trusted\\git', 'C:\\AegisLab\\scratch');
  process.stdout.write(JSON.stringify(receipt)); process.exitCode = receipt.passed ? 0 : 1;
}
module.exports = { runFixed };
