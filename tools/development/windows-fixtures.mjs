import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { boundedCommand } from './bounded-command.mjs';
import { WINDOWS_SUITES, validateTestReport } from './verification-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { values } = parseArgs({
  options: {
    'source-sha': { type: 'string' },
    output: { type: 'string' },
    install: { type: 'boolean' },
  },
});
if (!/^[a-f0-9]{40}$/.test(values['source-sha'] ?? '') || !path.isAbsolute(values.output ?? ''))
  throw new Error(
    'Usage: node tools/development/windows-fixtures.mjs --source-sha <40-hex> --output <new-absolute-directory>',
  );
const output = path.resolve(values.output);
// Require an existing, ordinary parent and a fresh leaf; never clean a reused directory.
for (let cursor = path.dirname(output); ; cursor = path.dirname(cursor)) {
  if (!fs.lstatSync(cursor).isDirectory() || fs.lstatSync(cursor).isSymbolicLink())
    throw new Error('Output ancestors must be ordinary directories');
  if (cursor === path.dirname(cursor)) break;
}
fs.mkdirSync(output);
const scratch = path.join(output, 'temp');
fs.mkdirSync(scratch);
const evidence = path.join(output, 'evidence');
fs.mkdirSync(evidence);
const env = {
  ...process.env,
  TEMP: scratch,
  TMP: scratch,
  TMPDIR: scratch,
  NODE_COMPILE_CACHE: path.join(output, 'node-cache'),
  AEGIS_SEALED_IMPORT_TEST_TMP: scratch,
  npm_config_cache: path.join(output, 'cache/npm'),
  ELECTRON_CACHE: path.join(output, 'cache/electron'),
  ELECTRON_BUILDER_CACHE: path.join(output, 'cache/builder'),
  CI: 'true',
  HUSKY: '0',
};
delete env.AEGIS_SEALED_IMPORT_TEST_RECEIPT;
const git = (...args) =>
  execFileSync('git', args, { cwd: root, env, encoding: 'utf8', timeout: 10000 }).trim();
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const free = (dir) => {
  const stat = fs.statfsSync(dir);
  return stat.bavail * stat.bsize;
};
const receipt = {
  schemaVersion: 1,
  status: 'FAIL',
  startedAt: new Date().toISOString(),
  expectedSourceSha: values['source-sha'],
  source: null,
  host: { platform: process.platform, arch: process.arch, node: process.version },
  suites: WINDOWS_SUITES,
  commands: [],
  scope: {
    disposableNativeFixtures: true,
    electronBridge: 'not-run',
    installer: 'not-run',
    vm: 'not-run',
    providerAuthentication: 'not-run',
    acceptance: 'UNREVIEWED',
    launchAllowed: false,
  },
  retention: { diagnosticDays: 7, automaticDeletion: false, preserve: 'evidence/receipt.json' },
};
let phase = 'preflight';
try {
  if (
    process.platform !== 'win32' ||
    process.arch !== 'x64' ||
    process.versions.node.split('.')[0] !== '24'
  )
    throw new Error('Requires Windows x64 and Node 24');
  const head = git('rev-parse', 'HEAD');
  if (head !== values['source-sha']) throw new Error('Expected source SHA differs from HEAD');
  if (git('status', '--porcelain', '--untracked-files=normal'))
    throw new Error('Source checkout is dirty');
  const modules = path.join(root, 'node_modules');
  if (
    fs.existsSync(modules) &&
    (!fs.lstatSync(modules).isDirectory() || fs.lstatSync(modules).isSymbolicLink())
  )
    throw new Error('Linked node_modules is unsupported');
  const compiler = path.join(
    process.env.WINDIR ?? 'C:\\Windows',
    'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
  );
  receipt.host.compilerSha256 = hash(compiler);
  receipt.source = {
    head,
    tree: git('rev-parse', 'HEAD^{tree}'),
    lockSha256: hash(path.join(root, 'package-lock.json')),
  };
  receipt.freeBefore = { source: free(root), output: free(output) };
  if (Math.min(...Object.values(receipt.freeBefore)) < 2 * 1024 ** 3)
    throw new Error('Less than 2 GiB available');
  if (values.install) {
    phase = 'dependency-setup';
    if (!process.env.npm_execpath || !fs.existsSync(process.env.npm_execpath))
      throw new Error('Use npm run dev:windows -- --install to locate npm');
    const installed = await boundedCommand(
      process.execPath,
      [process.env.npm_execpath, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
      {
        cwd: root,
        env,
        log: path.join(output, 'install.log'),
        timeoutMs: 240000,
      },
    );
    receipt.commands.push({ name: 'npm-ci', ...installed });
    if (installed.code !== 0 || installed.error || installed.reason)
      throw new Error('Dependency setup failed');
  }
  if (!fs.existsSync(path.join(modules, 'vitest/vitest.mjs')))
    throw new Error('Run npm ci or use --install');
  receipt.freeAfterSetup = { source: free(root), output: free(output) };
  if (Math.min(...Object.values(receipt.freeAfterSetup)) < 2 * 1024 ** 3)
    throw new Error('Less than 2 GiB available after setup');
  phase = 'fixtures';
  const reportPath = path.join(output, 'tests.json');
  const command = await boundedCommand(
    process.execPath,
    [
      path.join(root, 'node_modules/vitest/vitest.mjs'),
      'run',
      ...WINDOWS_SUITES,
      '--maxWorkers=1',
      '--reporter=json',
      `--outputFile=${reportPath}`,
    ],
    { cwd: root, env, log: path.join(output, 'fixtures.log'), timeoutMs: 180000 },
  );
  receipt.commands.push({ name: 'native-fixtures', ...command });
  if (command.code !== 0 || command.error || command.reason)
    throw new Error('Fixture command failed; inspect private fixtures.log');
  if (fs.statSync(reportPath).size > 4 * 1024 ** 2) throw new Error('Test report exceeds 4 MiB');
  receipt.tests = validateTestReport(JSON.parse(fs.readFileSync(reportPath, 'utf8')), root);
  receipt.testReportSha256 = hash(reportPath);
  phase = 'source-drift';
  if (git('rev-parse', 'HEAD') !== head || git('status', '--porcelain', '--untracked-files=normal'))
    throw new Error('Source changed while fixtures ran');
  if (hash(path.join(root, 'package-lock.json')) !== receipt.source.lockSha256)
    throw new Error('Dependency lock changed');
  receipt.status = 'PASS';
} catch (error) {
  receipt.failure = { phase, message: error.message, rootCause: 'unclassified' };
} finally {
  receipt.finishedAt = new Date().toISOString();
  receipt.freeAfter = { source: free(root), output: free(output) };
  // Existing fixtures own their cleanup. Report leftovers without following or removing links.
  receipt.cleanup = { retainedEntries: fs.readdirSync(scratch).length, automaticDeletion: false };
  // Junction-refusal fixtures intentionally preserve their links during teardown.
  // Fixture PASS does not imply an empty directory or authorize recursive cleanup.
  receipt.cleanup.status = receipt.cleanup.retainedEntries ? 'retained-for-review' : 'empty';
  fs.writeFileSync(path.join(evidence, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {
    flag: 'wx',
  });
  console.log(
    JSON.stringify({
      status: receipt.status,
      source: receipt.source?.head,
      tests: receipt.tests,
      failure: receipt.failure,
    }),
  );
  process.exitCode = receipt.status === 'PASS' ? 0 : 1;
}
