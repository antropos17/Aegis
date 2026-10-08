'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
if (process.platform !== 'win32') throw new Error('windows-native-control-required');
const source = fs.readFileSync(process.argv[2] || path.join(__dirname, 'cloud-guest-task.cjs'), 'utf8');
const begin = source.indexOf('function child('), end = source.indexOf('function denied(');
assert.ok(begin > 0 && end > begin);
const helper = source.slice(begin, end);
const shellBegin = source.indexOf('  const ownShell = child(');
const shellEnd = source.indexOf('\n  if (', shellBegin);
assert.ok(shellBegin > 0 && shellEnd > shellBegin);
assert.equal(source.indexOf('  const ownShell = child(', shellBegin + 1), -1);
const shell = source.slice(shellBegin, shellEnd);
const descendantBegin = source.indexOf('  const ownChild = child(');
const descendantEnd = source.indexOf('\n  if (', descendantBegin);
assert.ok(descendantBegin > 0 && descendantEnd > descendantBegin);
assert.equal(source.indexOf('  const ownChild = child(', descendantBegin + 1), -1);
const descendant = source.slice(descendantBegin, descendantEnd);
const base = fs.mkdtempSync(path.join(process.env.TEMP, 'aegis-fixed-shell-'));
const root = path.join(base, 'path with spaces & ampersand');
const scratchDirectory = path.join(root, 'scratch');
fs.mkdirSync(scratchDirectory, { recursive: true });
const scratch = path.join(scratchDirectory, 'positive.txt');
const marker = 'guest-scratch-control';
fs.writeFileSync(scratch, marker, { flag: 'wx' });
let controls = 0;
try {
  function evaluate(body, selected = scratch) {
    const context = { path, root, scratch: selected, process: { env: process.env, execPath: process.execPath },
      spawnSync(exe, args, options) {
        assert.equal(options.windowsHide, true); assert.equal(options.timeout, 10000); assert.equal(options.maxBuffer, 8192);
        return spawnSync(exe, args, options);
      } };
    vm.runInNewContext('let childExitCode = null;\n' + helper + body, context, { timeout: 15000 });
    return context.result;
  }
  const positive = evaluate(shell + '\nresult = ownShell;');
  assert.equal(positive.failed, false); assert.equal(positive.exitCode, 0); assert.equal(positive.stdout, marker); controls++;
  const missing = evaluate(shell + '\nresult = ownShell;', path.join(scratchDirectory, 'absent.txt'));
  assert.equal(missing.failed, false); assert.notEqual(missing.exitCode, 0); assert.equal(missing.stdout.includes(marker), false); controls++;
  const leaf = evaluate(descendant + '\nresult = ownChild;');
  assert.equal(leaf.failed, false); assert.equal(leaf.exitCode, 0);
  assert.equal(fs.readFileSync(path.join(scratchDirectory, 'positive-child.txt'), 'utf8'), 'descendant-control'); controls++;
  console.log(JSON.stringify({ schemaVersion: 1, nativeCases: controls, passed: true,
    scope: 'actual-source-fixed-cmd-and-node-descendant-disposable-controls', samePrincipal: true,
    privateDesktopOrGuestObserved: false, launchAllowed: false }));
} finally {
  for (const name of ['positive.txt', 'positive-child.txt']) {
    const selected = path.join(scratchDirectory, name);
    if (!fs.existsSync(selected)) continue;
    const stat = fs.lstatSync(selected);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1024);
    fs.unlinkSync(selected);
  }
  fs.rmdirSync(scratchDirectory); fs.rmdirSync(root); fs.rmdirSync(base);
}
