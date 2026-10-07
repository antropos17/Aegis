'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path').win32;
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, 'cloud-guest-task.cjs'), 'utf8');
const trusted = 'C:\\ProgramData\\AegisCloudLab\\trusted';
const root = 'C:\\AegisLab';
function run(mode) {
  const host = [
    'D:\\aegis-cloud-guest-123-1\\canaries\\' + 'a'.repeat(32) + '.txt',
    'D:\\aegis-cloud-guest-123-1\\canaries\\' + 'b'.repeat(32) + '.txt',
  ];
  const files = new Map([
    [
      path.join(trusted, 'manifest.json'),
      JSON.stringify({ hostCanaries: mode === 'wrong-path' ? ['X:/unexpected', host[1]] : host }),
    ],
    [path.join(root, 'input', 'numbers.json'), '{"a":2,"b":3}'],
    [
      path.join(root, 'work', 'sum.cjs'),
      mode === 'wrong-work' ? 'changed' : 'module.exports=(a,b)=>a-b;\n',
    ],
  ]);
  const fail = (code) => {
    throw Object.assign(new Error('synthetic'), { code });
  };
  const doubles = {
    readFileSync(selected) {
      if (mode === 'input-private-error' && selected.endsWith('numbers.json')) return fail('PRIVATE_SENTINEL');
      if (files.has(selected)) return files.get(selected);
      if (host.includes(selected)) return fail('ENOENT');
      return fail(mode === 'protection-open' ? 'ENOENT' : 'EACCES');
    },
    writeFileSync(selected, text) {
      if (host.includes(selected)) return fail('ENOENT');
      files.set(selected, text);
    },
    appendFileSync() {
      fail('EACCES');
    },
    openSync() {
      fail('EACCES');
    },
    closeSync() {},
    unlinkSync() {
      fail('ENOENT');
    },
  };
  const spawnSync = (exe, args) => {
    if (args[0] === '--test') {
      assert.equal(files.get(path.join(root, 'work', 'sum.cjs')), 'module.exports=(a,b)=>a+b;\n');
      return { status: mode === 'unit-test-nonzero' ? 7 : 0, stdout: Buffer.from('test-control') };
    }
    if (args[0] === '-e' && args.length === 2) {
      files.set(path.join(root, 'scratch', 'positive-child.txt'), 'descendant-control');
      return { status: 0 };
    }
    if (args[0] === '/d' && args[2].includes('positive.txt'))
      return {
        status: mode === 'shell-control-fails' ? 1 : 0,
        stdout: Buffer.from('guest-scratch-control'),
      };
    return { status: args[0] === '-e' ? 0 : 1 };
  };
  const process = {
    platform: 'win32',
    env: { AEGIS_CLOUD_GUEST_TASK: '1' },
    execPath: path.join(trusted, 'node.exe'),
    exit() {
      throw new Error('guard');
    },
  };
  const requireDouble = (name) => {
    if (name === 'node:fs') return doubles;
    if (name === 'node:path') return path;
    if (name === 'node:child_process') return { spawnSync };
    if (name === path.join(root, 'work', 'sum.cjs')) {
      const module = { exports: null };
      vm.runInNewContext(files.get(name), { module });
      return module.exports;
    }
    throw new Error('unapproved-require');
  };
  vm.runInNewContext(source, { require: requireDouble, process, Buffer }, { timeout: 1000 });
  const result = JSON.parse(files.get(path.join(root, 'work', 'result.json')));
  return { result, process, files };
}
const positive = run('positive');
assert.equal(positive.process.exitCode, 0);
assert.equal(positive.result.passed, true);
assert.equal(positive.result.readEditTestPassed, true);
assert.equal(positive.result.shellAndDescendantPositive, true);
assert.equal(positive.result.protectedProbes.length, 4);
assert.equal(positive.result.hostPathProbes.length, 14);
assert.equal(
  positive.files
    .get(path.join(root, 'work', 'sum.cjs'))
    .charCodeAt(positive.files.get(path.join(root, 'work', 'sum.cjs')).length - 1),
  10,
);
for (const mode of ['wrong-path', 'wrong-work', 'protection-open', 'shell-control-fails', 'unit-test-nonzero', 'input-private-error']) {
  const refused = run(mode);
  assert.equal(refused.result.passed, false, mode);
  assert.equal(refused.process.exitCode, 1, mode);
  if (mode === 'unit-test-nonzero') {
    assert.equal(refused.result.stage, 'unit-test');
    assert.deepEqual(refused.result.failure, { stage: 'unit-test', childExitCode: 7 });
  }
  if (mode === 'input-private-error') {
    assert.equal(refused.result.stage, 'input');
    assert.deepEqual(refused.result.failure, { stage: 'input', childExitCode: null });
    assert.equal(JSON.stringify(refused.result).includes('PRIVATE_SENTINEL'), false);
  }
}
console.log(
  JSON.stringify({
    cases: 7,
    passed: 7,
    scope: 'synthetic-task-source-behavior-no-guest-or-VM-effects',
  }),
);
