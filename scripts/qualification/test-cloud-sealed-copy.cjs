'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { test, after } = require('node:test');
const subject = require('./cloud-sealed-copy.cjs');
assert.equal(process.argv.length, 3);
assert.ok(process.env.TEMP);
const parent = path.resolve(process.env.TEMP);
const scratch = path.resolve(process.argv[2]);
assert.match(path.basename(parent), /^aegis-sealed-copy-controls-[a-f0-9]{32}$/);
assert.equal(scratch, path.join(parent, 'native'));
for (let selected = parent; ; selected = path.dirname(selected)) {
  const stat = fs.lstatSync(selected);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  if (path.dirname(selected) === selected) break;
}
fs.mkdirSync(scratch);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
let artifact;
test('native host capture/seal and independent guest parser read/edit/test', async () => {
  const base = __dirname + '/';
  const { buildSealedImportFixture } = await import(
    pathToFileURL(base + 'sealed-import-build.mjs')
  );
  const { inspectSealedImportBundle } = await import(
    pathToFileURL(base + 'sealed-import-oracle.mjs')
  );
  const { stageFixedSealedCopy, recheckFixedSealedCopy } =
    await import('./cloud-sealed-copy-host.mjs');
  const lab = path.join(scratch, 'lab');
  fs.mkdirSync(lab);
  fs.mkdirSync(path.join(lab, 'temp'));
  fs.mkdirSync(path.join(lab, 'transfer'));
  const staged = stageFixedSealedCopy(lab, { buildSealedImportFixture, inspectSealedImportBundle });
  assert.equal(staged.passed, true);
  assert.equal(staged.nativeRetentionMutationDenied, true);
  assert.equal(
    staged.bundleSha256,
    hash(fs.readFileSync(path.join(lab, 'transfer/sealed-copy.aegis'))),
  );
  const fromStaging = subject.consumeFixedCopy(
    fs.readFileSync(path.join(lab, 'transfer/sealed-copy.aegis')),
    staged.bundleSha256,
    path.join(scratch, 'staged-guest-copy'),
  );
  assert.equal(fromStaging.testExitCode, 0);
  assert.equal(
    recheckFixedSealedCopy(lab, staged.bundleSha256, { inspectSealedImportBundle }).sourceUnchanged,
    true,
  );
  fs.writeFileSync(path.join(lab, 'temp/sealed-copy/input/sum.cjs'), 'changed');
  assert.throws(() =>
    recheckFixedSealedCopy(lab, staged.bundleSha256, { inspectSealedImportBundle }),
  );
  fs.writeFileSync(path.join(scratch, 'host-staging.json'), JSON.stringify(staged));
  const fixture = buildSealedImportFixture(scratch);
  fs.writeFileSync(path.join(scratch, 'build-provenance.json'), JSON.stringify(fixture.provenance));
  function native(seam) {
    const input = path.join(scratch, 'input-' + seam);
    fs.mkdirSync(input);
    for (const [name, text] of Object.entries(subject.fixedCorpus))
      fs.writeFileSync(path.join(input, name), text, { flag: 'wx' });
    const output = path.join(scratch, 'sealed-' + seam);
    const run = spawnSync(fixture.executable, [input, output, seam], {
      timeout: 30000,
      maxBuffer: 8192,
      windowsHide: true,
      env: { ...process.env, TEMP: scratch, TMP: scratch },
    });
    assert.equal(run.error, undefined);
    assert.equal(run.stderr.length, 0);
    const report = JSON.parse(run.stdout.toString());
    fs.writeFileSync(
      path.join(scratch, seam + '.json'),
      JSON.stringify({ exitCode: run.status, report }),
    );
    return { input, output, report, status: run.status };
  }
  const positive = native('retention');
  assert.equal(positive.status, 0);
  assert.equal(positive.report.sealed, true);
  artifact = fs.readFileSync(path.join(positive.output, 'bundle.aegis'));
  const independent = inspectSealedImportBundle(
    path.join(positive.output, 'bundle.aegis'),
    positive.input,
  );
  assert.equal(independent.bundleSha256, positive.report.bundleSha256);
  assert.equal(independent.manifestSha256, positive.report.manifestSha256);
  const receipt = subject.consumeFixedCopy(
    artifact,
    positive.report.bundleSha256,
    path.join(scratch, 'guest-copy'),
  );
  assert.equal(receipt.passed, true);
  assert.equal(receipt.testExitCode, 0);
  assert.equal(receipt.initialTestExitCode, 1);
  assert.equal(receipt.sourceUnchanged, true);
  assert.equal(receipt.guestEdited, true);
  for (const [name, text] of Object.entries(subject.fixedCorpus))
    assert.equal(fs.readFileSync(path.join(positive.input, name), 'utf8'), text);
  fs.writeFileSync(
    path.join(scratch, 'local-consumption.json'),
    JSON.stringify({ evidence: 'native-host-seal-local-guest-algorithm-control-no-VM', receipt }),
  );
  for (const seam of ['swap', 'content', 'membership', 'staged', 'size']) {
    const negative = native(seam);
    assert.equal(negative.status, 2);
    assert.equal(negative.report.sealed, false);
    assert.equal(fs.existsSync(path.join(negative.output, 'bundle.aegis')), false);
  }
});
after(() => {
  let bytes = 0,
    entries = 0;
  function measure(directory, depth) {
    assert.ok(depth <= 8);
    for (const name of fs.readdirSync(directory)) {
      assert.ok(++entries <= 256);
      const selected = path.join(directory, name),
        stat = fs.lstatSync(selected);
      assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory()) measure(selected, depth + 1);
      else {
        assert.ok(stat.isFile());
        bytes += stat.size;
        assert.ok(bytes <= 16 * 1024 * 1024);
      }
    }
  }
  measure(scratch, 0);
  fs.writeFileSync(
    path.join(scratch, 'control-summary.json'),
    JSON.stringify({
      schemaVersion: 1,
      kind: 'fixed-sealed-copy-native-controls',
      tests: 2,
      bytes,
      artifactObserved: !!artifact,
      actualGuestRun: false,
      e2Qualified: false,
      launchAllowed: false,
    }),
    { flag: 'wx' },
  );
});
test('refuse hash mismatch, corrupt payload, foreign path and existing destination before writes', () => {
  assert.ok(artifact);
  const destination = path.join(scratch, 'refused');
  assert.throws(() => subject.consumeFixedCopy(artifact, '0'.repeat(64), destination));
  assert.equal(fs.existsSync(destination), false);
  const mutated = Buffer.from(artifact);
  mutated[mutated.length - 1] ^= 1;
  assert.throws(() => subject.consumeFixedCopy(mutated, hash(mutated), destination));
  assert.equal(fs.existsSync(destination), false);
  const foreign = Buffer.from(artifact);
  const index = foreign.indexOf(Buffer.from('readme.txt'));
  foreign.write('../bad.txt', index, 'ascii');
  assert.throws(() => subject.consumeFixedCopy(foreign, hash(foreign), destination));
  assert.equal(fs.existsSync(destination), false);
  const original = fs.readFileSync(path.join(scratch, 'guest-copy/sum.cjs'));
  assert.throws(() =>
    subject.consumeFixedCopy(artifact, hash(artifact), path.join(scratch, 'guest-copy')),
  );
  assert.deepEqual(fs.readFileSync(path.join(scratch, 'guest-copy/sum.cjs')), original);
});
