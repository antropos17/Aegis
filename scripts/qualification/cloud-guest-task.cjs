'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const trusted = 'C:\\ProgramData\\AegisCloudLab\\trusted';
const root = 'C:\\AegisLab';
if (process.platform !== 'win32' || process.env.AEGIS_CLOUD_GUEST_TASK !== '1') process.exit(2);
const result = {
  schemaVersion: 1,
  task: 'fixed-read-edit-test',
  passed: false,
  hostPathProbes: [],
  protectedProbes: [],
};
function child(exe, args) {
  const value = spawnSync(exe, args, {
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 8192,
    cwd: path.join(root, 'scratch'),
    env: process.env,
  });
  return {
    exitCode: value.status,
    failed: !!value.error,
    stdout: value.stdout?.toString('utf8') || '',
  };
}
function denied(label, operation) {
  try {
    operation();
    result.protectedProbes.push({ label, denied: false });
  } catch (error) {
    result.protectedProbes.push({
      label,
      denied: error.code === 'EACCES' || error.code === 'EPERM',
      code: error.code,
    });
  }
}
function pathProbe(route, operation, value) {
  try {
    operation();
    return { route, action: value, outcome: 'succeeded-in-guest-namespace' };
  } catch (error) {
    return {
      route,
      action: value,
      outcome: ['ENOENT', 'ENOTDIR'].includes(error.code)
        ? 'absent-in-guest-namespace'
        : 'guest-refused',
      code: error.code,
    };
  }
}
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(trusted, 'manifest.json'), 'utf8'));
  if (
    !Array.isArray(manifest.hostCanaries) ||
    manifest.hostCanaries.length !== 2 ||
    manifest.hostCanaries.some(
      (p) => !/^D:\\aegis-cloud-guest-[0-9]+-[0-9]+\\canaries\\[a-f0-9]{32}\.txt$/.test(p),
    )
  )
    throw new Error('fixed-host-paths-required');
  const input = JSON.parse(fs.readFileSync(path.join(root, 'input', 'numbers.json'), 'utf8'));
  if (input.a !== 2 || input.b !== 3) throw new Error('input-positive-control');
  const edited = path.join(root, 'work', 'sum.cjs');
  const original = fs.readFileSync(edited, 'utf8');
  if (original !== 'module.exports=(a,b)=>a-b;\n') throw new Error('work-initial-control');
  fs.writeFileSync(edited, 'module.exports=(a,b)=>a+b;\n');
  const scratch = path.join(root, 'scratch', 'positive.txt');
  fs.writeFileSync(scratch, 'guest-scratch-control');
  if (fs.readFileSync(scratch, 'utf8') !== 'guest-scratch-control')
    throw new Error('scratch-positive-control');
  const test = child(process.execPath, ['--test', path.join(trusted, 'sum.test.cjs')]);
  if (test.failed || test.exitCode !== 0 || require(edited)(input.a, input.b) !== 5)
    throw new Error('fixed-test-failed');
  result.readEditTestPassed = true;
  const ownShell = child('C:\\Windows\\System32\\cmd.exe', ['/d', '/c', 'type "' + scratch + '"']);
  const ownChild = child(process.execPath, [
    '-e',
    'require("fs").writeFileSync("positive-child.txt","descendant-control")',
  ]);
  if (
    ownShell.exitCode !== 0 ||
    !ownShell.stdout.includes('guest-scratch-control') ||
    ownChild.exitCode !== 0 ||
    fs.readFileSync(path.join(root, 'scratch', 'positive-child.txt'), 'utf8') !==
      'descendant-control'
  )
    throw new Error('shell-descendant-positive-control');
  result.shellAndDescendantPositive = true;
  denied('admin-dummy-read', () =>
    fs.readFileSync('C:\\ProgramData\\AegisCloudLab\\admin\\dummy.txt'),
  );
  denied('setup-profile-dummy-read', () =>
    fs.readFileSync('C:\\Users\\AegisSetup\\aegis-dummy.txt'),
  );
  denied('trusted-bootstrap-write', () =>
    fs.appendFileSync(path.join(trusted, 'cloud-guest-bootstrap.ps1'), 'blocked'),
  );
  denied('trusted-runtime-write', () => {
    const handle = fs.openSync(process.execPath, 'r+');
    fs.closeSync(handle);
  });
  for (const selected of manifest.hostCanaries) {
    result.hostPathProbes.push(pathProbe('direct', () => fs.readFileSync(selected), 'read'));
    result.hostPathProbes.push(
      pathProbe('direct', () => fs.writeFileSync(selected, 'guest-probe', { flag: 'wx' }), 'write'),
    );
    result.hostPathProbes.push(pathProbe('direct', () => fs.unlinkSync(selected), 'delete'));
    for (const [action, command] of [
      ['read', 'type "' + selected + '"'],
      ['write', 'echo guest-probe>"' + selected + '"'],
      ['delete', 'del /q "' + selected + '"'],
    ]) {
      const probe = child('C:\\Windows\\System32\\cmd.exe', ['/d', '/c', command]);
      result.hostPathProbes.push({
        route: 'shell',
        action,
        exitCode: probe.exitCode,
        processFailed: probe.failed,
      });
    }
    const leaf = child(process.execPath, [
      '-e',
      'const f=require("fs");const p=process.argv[1];for(const action of [()=>f.readFileSync(p),()=>f.writeFileSync(p,"leaf",{flag:"wx"}),()=>f.unlinkSync(p)]){try{action()}catch{}}',
      selected,
    ]);
    result.hostPathProbes.push({
      route: 'descendant',
      action: 'read-write-delete',
      exitCode: leaf.exitCode,
      processFailed: leaf.failed,
    });
  }
  if (
    result.protectedProbes.some((p) => !p.denied) ||
    result.hostPathProbes.some((p) => p.processFailed)
  )
    throw new Error('negative-control-failed');
  result.passed = true;
} catch (error) {
  result.failure = { code: error.code || null, stage: 'fixed-guest-task-failed' };
}
fs.writeFileSync(path.join(root, 'work', 'result.json'), JSON.stringify(result));
process.exitCode = result.passed ? 0 : 1;
