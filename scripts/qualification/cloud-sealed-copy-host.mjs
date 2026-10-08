import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import fixed from './cloud-sealed-copy.cjs';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const refuse = () => {
  throw new Error('fixed-sealed-copy-host-refused');
};
function plainDirectory(directory) {
  for (let selected = directory; ; selected = path.dirname(selected)) {
    const stat = fs.lstatSync(selected);
    if (!stat.isDirectory() || stat.isSymbolicLink()) refuse();
    if (path.dirname(selected) === selected) break;
  }
}
/**
 * Create and seal a fixed dummy corpus with maintained native identity/recheck code.
 * No caller-supplied project path, commands, credentials or Git metadata are read.
 * @param {string} outputRoot Existing owned cloud-lab output root.
 * @param {object} deps Maintained native builder and independent bundle oracle.
 * @returns {object} Bounded host provenance; guest qualification remains false.
 * @since v0.19.2
 */
export function stageFixedSealedCopy(outputRoot, deps) {
  for (const leaf of ['temp', 'transfer']) plainDirectory(path.join(outputRoot, leaf));
  const scratch = path.join(outputRoot, 'temp', 'sealed-copy');
  fs.mkdirSync(scratch);
  const input = path.join(scratch, 'input');
  fs.mkdirSync(input);
  for (const [name, text] of Object.entries(fixed.fixedCorpus))
    fs.writeFileSync(path.join(input, name), text, { flag: 'wx' });
  const native = deps.buildSealedImportFixture(scratch);
  const sealed = path.join(scratch, 'sealed');
  const child = spawnSync(native.executable, [input, sealed, 'retention'], {
    timeout: 30000,
    maxBuffer: 8192,
    windowsHide: true,
    env: { ...process.env, TEMP: scratch, TMP: scratch },
  });
  if (child.error || child.status !== 0 || child.stderr.length !== 0) refuse();
  const report = JSON.parse(child.stdout.toString('utf8'));
  if (
    report.sealed !== true ||
    report.code !== 'sealed' ||
    report.fileCount !== 4 ||
    report.developerOnly !== true ||
    report.launchAllowed !== false ||
    report.guestImportQualified !== false ||
    report.vmEffectsRun !== false ||
    report.cleanup !== 'published-retained'
  )
    refuse();
  const bundle = path.join(sealed, 'bundle.aegis');
  const oracle = deps.inspectSealedImportBundle(bundle, input);
  if (
    oracle.bundleSha256 !== report.bundleSha256 ||
    oracle.manifestSha256 !== report.manifestSha256 ||
    oracle.totalBytes !== report.totalBytes ||
    fs.statSync(bundle).size !== report.bundleBytes
  )
    refuse();
  const bytes = fs.readFileSync(bundle);
  const destination = path.join(outputRoot, 'transfer', 'sealed-copy.aegis');
  fs.writeFileSync(destination, bytes, { flag: 'wx' });
  if (
    hash(fs.readFileSync(destination)) !== oracle.bundleSha256 ||
    hash(fs.readFileSync(bundle)) !== oracle.bundleSha256
  )
    refuse();
  // Fixed fixture output retention is bounded; preserve provenance and closed artifacts.
  let total = 0,
    files = 0;
  function measure(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (++files > 64 || entry.isSymbolicLink()) refuse();
      const selected = path.join(directory, entry.name);
      if (entry.isDirectory()) measure(selected);
      else if (entry.isFile()) {
        total += fs.statSync(selected).size;
        if (total > 16 * 1024 * 1024) refuse();
      } else refuse();
    }
  }
  measure(scratch);
  const receipt = {
    schemaVersion: 1,
    kind: 'fixed-sealed-copy-host',
    passed: true,
    nativeCaptureSealPassed: true,
    nativeRetentionMutationDenied: true,
    independentOraclePassed: true,
    transferredHashRechecked: true,
    ...oracle,
    bundleBytes: bytes.length,
    fixture: native.provenance,
    outputBytes: total,
    guestImportQualified: false,
    e2Qualified: false,
    launchAllowed: false,
  };
  fs.writeFileSync(path.join(scratch, 'host-receipt.json'), JSON.stringify(receipt), {
    flag: 'wx',
  });
  return receipt;
}
/**
 * Recheck the owned dummy source and transferred bundle after the guest closes.
 * @param {string} outputRoot Existing owned cloud-lab output root.
 * @param {string} expectedHash Original host staging bundle SHA-256.
 * @param {object} deps Maintained independent bundle oracle.
 * @returns {object} Hash/count metrics for comparison with the original receipt.
 * @since v0.19.2
 */
export function recheckFixedSealedCopy(outputRoot, expectedHash, deps) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) refuse();
  const input = path.join(outputRoot, 'temp', 'sealed-copy', 'input');
  plainDirectory(input);
  plainDirectory(path.join(outputRoot, 'transfer'));
  if (fs.readdirSync(input).sort().join() !== Object.keys(fixed.fixedCorpus).join()) refuse();
  for (const [name, text] of Object.entries(fixed.fixedCorpus)) {
    const selected = path.join(input, name),
      stat = fs.lstatSync(selected);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.size !== Buffer.byteLength(text) ||
      !fs.readFileSync(selected).equals(Buffer.from(text))
    )
      refuse();
  }
  const oracle = deps.inspectSealedImportBundle(
    path.join(outputRoot, 'transfer', 'sealed-copy.aegis'),
    input,
  );
  if (oracle.bundleSha256 !== expectedHash) refuse();
  return {
    schemaVersion: 1,
    kind: 'fixed-sealed-copy-host-recheck',
    passed: true,
    sourceUnchanged: true,
    ...oracle,
    e2Qualified: false,
    launchAllowed: false,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const root = process.argv[2];
    const recheck = process.argv.length === 5 && process.argv[3] === 'recheck';
    if (
      (!recheck && process.argv.length !== 3) ||
      process.platform !== 'win32' ||
      !/^D:\\aegis-cloud-guest-[0-9]{1,20}-[0-9]{1,20}$/.test(root || '') ||
      process.env.GITHUB_ACTIONS !== 'true' ||
      process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
      process.env.RUNNER_OS !== 'Windows'
    )
      refuse();
    const oracle = await import('./sealed-import-oracle.mjs');
    if (recheck)
      process.stdout.write(JSON.stringify(recheckFixedSealedCopy(root, process.argv[4], oracle)));
    else {
      const builder = await import('./sealed-import-build.mjs');
      process.stdout.write(JSON.stringify(stageFixedSealedCopy(root, { ...builder, ...oracle })));
    }
  } catch {
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        kind: 'fixed-sealed-copy-host',
        passed: false,
        guestImportQualified: false,
        e2Qualified: false,
        launchAllowed: false,
      }),
    );
    process.exitCode = 2;
  }
}
