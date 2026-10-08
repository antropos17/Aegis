'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { runFixed } = require('./cloud-guest-git.cjs');
if (process.argv.length !== 4) throw new Error('owned-runtime-and-temp-paths-required');
const runtime = path.resolve(process.argv[2]);
const temp = path.resolve(process.argv[3]);
for (const selected of [runtime, temp]) {
  assert.equal(fs.lstatSync(selected).isSymbolicLink(), false);
  assert.equal(fs.lstatSync(selected).isDirectory(), true);
}
const fixtures = [];
const originalConfig = process.env.GIT_CONFIG_GLOBAL;
try {
  for (let index = 0; index < 3; index++) {
    const scratch = fs.mkdtempSync(path.join(temp, 'git-controls-')); fixtures.push(scratch);
    const poison = path.join(scratch, 'ambient-config');
    // Would prevent any repo operation if inherited; no global config is changed.
    fs.writeFileSync(poison, '[core]\nrepositoryformatversion=999\n[commit]\ngpgSign=true\n');
    process.env.GIT_CONFIG_GLOBAL = poison;
    const receipt = runFixed(runtime, scratch);
    assert.equal(receipt.passed, true, JSON.stringify(receipt));
    assert.equal(receipt.commands, 13); assert.ok(receipt.elapsedMilliseconds < 3000);
    assert.equal(receipt.localCommitObserved, true); assert.equal(receipt.remotesAbsent, true);
    const again = runFixed(runtime, scratch); assert.equal(again.passed, false); assert.equal(again.commands, 0);
    assert.equal(runFixed(runtime, scratch, 4000).passed, false);
    process.stdout.write(JSON.stringify({sample:index,receipt,existingDirectoryRefused:true,changedDeadlineRefused:true})+'\n');
  }
} finally {
  if (originalConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = originalConfig;
  for (const fixture of fixtures) {
    const resolved = fs.realpathSync(fixture);
    assert.ok(resolved.toLowerCase().startsWith((fs.realpathSync(temp)+path.sep).toLowerCase()));
    for (const entry of fs.readdirSync(fixture, {recursive:true, withFileTypes:true})) assert.equal(entry.isSymbolicLink(), false);
    fs.rmSync(fixture, {recursive:true});
  }
}
