import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSealedImportFixture, digest } from './sealed-import-build.mjs';
import { inspectSealedImportBundle } from './sealed-import-oracle.mjs';
import { validateSealedImportReport } from './sealed-import-report.mjs';

const modes = new Set(['positive', 'junction', 'hardlink', 'ads', 'swap', 'budget']);
const corpusBytes = Buffer.from('DISPOSABLE_CLEAN_CORPUS\n', 'utf8');
const fail = (code) => {
  throw new Error(code);
};

/**
 * Qualify fixed dummy inputs only, with no operator-selected project or command.
 * @param {string} mode One documented fixed native scenario.
 * @param {string} parent Exact task-owned scratch parent.
 * @returns {object} Bounded, redacted diagnostic receipt.
 * @since v0.17.0
 */
export function collectSealedImportQualification(mode = 'positive', parent = os.tmpdir()) {
  if (!modes.has(mode)) fail('sealed-import-mode-invalid');
  const build = buildSealedImportFixture(parent);
  const fixture = fs.mkdtempSync(path.join(fs.realpathSync(parent), 'aegis-sealed-collector-'));
  const source = path.join(fixture, 'source');
  const output = path.join(fixture, 'output');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'readme.txt'), corpusBytes, { flag: 'wx' });
  if (mode === 'positive') {
    fs.mkdirSync(path.join(source, 'lib'));
    fs.mkdirSync(path.join(source, 'empty-dir'));
    fs.writeFileSync(path.join(source, 'lib', 'binary.bin'), Buffer.from([0, 255, 42, 10]), {
      flag: 'wx',
    });
    fs.writeFileSync(path.join(source, 'empty.txt'), '', { flag: 'wx' });
  } else if (mode === 'junction' || mode === 'hardlink') {
    const outside = path.join(fixture, 'outside');
    fs.mkdirSync(outside);
    const canary = path.join(outside, 'canary.txt');
    fs.writeFileSync(canary, 'DISPOSABLE_OUTSIDE_CANARY', { flag: 'wx' });
    if (mode === 'junction') fs.symlinkSync(outside, path.join(source, 'junction'), 'junction');
    else fs.linkSync(canary, path.join(source, 'linked.txt'));
  } else if (mode === 'ads')
    fs.writeFileSync(path.join(source, 'readme.txt:hidden'), 'dummy', { flag: 'wx' });
  else if (mode === 'budget')
    fs.writeFileSync(path.join(source, 'large.bin'), Buffer.alloc(65537), { flag: 'wx' });
  const result = spawnSync(build.executable, [source, output, mode === 'swap' ? 'swap' : 'none'], {
    cwd: build.scratch,
    timeout: 30000,
    maxBuffer: 65536,
    windowsHide: true,
    encoding: 'utf8',
    env: { ...process.env, TEMP: parent, TMP: parent },
  });
  if (
    result.error ||
    (result.status !== 0 && result.status !== 2) ||
    Buffer.byteLength(result.stderr || '') > 1024 ||
    result.stderr !== ''
  )
    fail('sealed-import-native-unavailable');
  if (digest(fs.readFileSync(build.executable)) !== build.provenance.executableSha256)
    fail('sealed-import-provenance-changed');
  const report = validateSealedImportReport(result.stdout);
  const expected = {
    junction: 'import-reparse',
    hardlink: 'import-hardlink',
    ads: 'import-stream',
    swap: 'import-identity-changed',
    budget: 'import-file-size-budget',
  };
  if (mode === 'positive') {
    if (result.status !== 0 || !report.sealed) fail('sealed-import-positive-failed');
    const observed = inspectSealedImportBundle(path.join(output, 'bundle.aegis'), source);
    if (
      observed.bundleSha256 !== report.bundleSha256 ||
      observed.manifestSha256 !== report.manifestSha256 ||
      observed.fileCount !== 3 ||
      observed.totalBytes !== corpusBytes.length + 4
    )
      fail('sealed-import-oracle-mismatch');
  } else if (
    result.status !== 2 ||
    report.sealed ||
    report.code !== expected[mode] ||
    fs.existsSync(path.join(output, 'bundle.aegis'))
  )
    fail('sealed-import-refusal-failed');
  return {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    mode,
    provenance: build.provenance,
    corpusSha256: digest(corpusBytes),
    nativeExitCode: result.status,
    report,
    independentOracleRun: mode === 'positive',
    windowsNativeRun: true,
    launchAllowed: false,
    vmEffectsRun: false,
    guestImportQualified: false,
    productionCaller: false,
    artifactRetention: 'owned-closed-fixtures-retained-7days-review-no-recursive-cleanup',
  };
}

/**
 * Parse the fixed collector CLI, refusing arbitrary source/command options.
 * @param {string[]} args Argument vector excluding executable/script.
 * @returns {object} Mode and new receipt path.
 * @since v0.17.0
 */
export function parseSealedImportArguments(args) {
  if (args.length !== 4 || args[0] !== '--mode' || !modes.has(args[1]) || args[2] !== '--receipt')
    fail('sealed-import-options-invalid');
  const destination = args[3];
  if (
    !path.isAbsolute(destination) ||
    path.extname(destination) !== '.json' ||
    destination.startsWith('\\\\') ||
    destination.indexOf(':', 2) !== -1 ||
    fs.existsSync(destination)
  )
    fail('sealed-import-receipt-invalid');
  return { mode: args[1], destination };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { mode, destination } = parseSealedImportArguments(process.argv.slice(2));
    const receipt = collectSealedImportQualification(mode);
    const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
    if (bytes.length > 131072) fail('sealed-import-receipt-budget');
    const file = fs.openSync(destination, 'wx');
    try {
      fs.writeFileSync(file, bytes);
      fs.fsyncSync(file);
    } finally {
      fs.closeSync(file);
    }
    process.stdout.write(
      JSON.stringify({
        mode,
        nativeExitCode: receipt.nativeExitCode,
        code: receipt.report.code,
        launchAllowed: false,
      }) + '\n',
    );
  } catch {
    process.stderr.write('sealed-import-qualification-unavailable\n');
    process.exitCode = 2;
  }
}
