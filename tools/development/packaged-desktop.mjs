import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { boundedCommand } from './bounded-command.mjs';
import { desktopPassed, monitoringPassed, sensorsPassed } from './desktop-contract.mjs';
import { processCoreSources } from '../../tests/fixtures/protected-gui-process/harness.mjs';
import { produceGuiManifest } from '../../scripts/produce-protected-gui-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { values } = parseArgs({
  options: {
    output: { type: 'string' },
    'source-sha': { type: 'string' },
    monitoring: { type: 'boolean', default: false },
    sensors: { type: 'boolean', default: false },
  },
});
if (!path.isAbsolute(values.output ?? '') || !/^[a-f0-9]{40}$/.test(values['source-sha'] ?? ''))
  throw new Error(
    'Usage: node tools/development/packaged-desktop.mjs --source-sha <40-hex> --output <new-absolute-directory> [--monitoring] [--sensors]',
  );
const output = path.resolve(values.output);
if (
  output.toLowerCase() === root.toLowerCase() ||
  output.toLowerCase().startsWith(root.toLowerCase() + path.sep)
)
  throw new Error('Output must be outside source');
for (let cursor = path.dirname(output); ; cursor = path.dirname(cursor)) {
  const stat = fs.lstatSync(cursor);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error('Output ancestors must be ordinary directories');
  if (cursor === path.dirname(cursor)) break;
}
fs.mkdirSync(output);
for (const name of ['temp', 'scratch', 'evidence']) fs.mkdirSync(path.join(output, name));
const evidence = path.join(output, 'evidence');
const env = {
  ...process.env,
  TEMP: path.join(output, 'temp'),
  TMP: path.join(output, 'temp'),
  TMPDIR: path.join(output, 'temp'),
  npm_config_cache: path.join(output, 'cache/npm'),
  ELECTRON_CACHE: path.join(output, 'cache/electron'),
  ELECTRON_BUILDER_CACHE: path.join(output, 'cache/builder'),
  NODE_COMPILE_CACHE: path.join(output, 'node-cache'),
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  HUSKY: '0',
};
delete env.ELECTRON_RUN_AS_NODE;
const git = (...args) =>
  execFileSync('git', args, { cwd: root, env, encoding: 'utf8', timeout: 10000 }).trim();
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const free = (folder) => {
  const stat = fs.statfsSync(folder);
  return stat.bavail * stat.bsize;
};
const receipt = {
  schemaVersion: 1,
  status: 'FAIL',
  startedAt: new Date().toISOString(),
  expectedSourceSha: values['source-sha'],
  host: { platform: process.platform, arch: process.arch, node: process.version, os: os.release() },
  commands: [],
  scope: {
    packagedElectron: true,
    windowObservation: true,
    rendererInteractions: values.monitoring
      ? 'monitoring-with-ordinary-current-user-and-playwright'
      : 'not-run',
    fileNetworkSensors: values.sensors ? 'native-owned-fixture-and-public-tcp' : 'not-run',
    modeledPrincipalProtectionAccountServiceVmAndJournal: true,
    uac: 'not-run',
    guiEnrollment: false,
    realGuestProvider: 'not-run',
    elapsedThirtyMinuteExpiry: 'not-run',
    acceptance: 'UNREVIEWED',
    launchAllowed: false,
  },
  retention: {
    diagnosticDays: 7,
    automaticDeletion: false,
    preserve: 'evidence/',
    profile: 'retained-private-do-not-upload',
  },
};
let phase = 'preflight';
async function command(name, executable, args, timeoutMs) {
  phase = name;
  if (free(output) < 3 * 1024 ** 3) throw new Error('Less than 3 GiB free on output volume');
  const result = await boundedCommand(executable, args, {
    cwd: root,
    env,
    log: path.join(output, `${name}.log`),
    timeoutMs,
  });
  receipt.commands.push({ name, ...result });
  if (result.code !== 0 || result.reason || result.error)
    throw new Error(`${name} failed; inspect its bounded log`);
}
try {
  if (
    process.platform !== 'win32' ||
    process.arch !== 'x64' ||
    process.versions.node.split('.')[0] !== '24'
  )
    throw new Error('Requires Windows x64 and Node 24');
  if (
    git('rev-parse', 'HEAD') !== values['source-sha'] ||
    git('status', '--porcelain', '--untracked-files=normal')
  )
    throw new Error('Requires the expected commit in a clean checkout');
  if (git('rev-parse', '--git-dir') === git('rev-parse', '--git-common-dir'))
    throw new Error('Run in an isolated Git worktree');
  if (fs.lstatSync(path.join(root, 'node_modules')).isSymbolicLink())
    throw new Error('Linked node_modules is unsupported');
  receipt.source = {
    head: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'),
    lockSha256: hash(path.join(root, 'package-lock.json')),
  };
  receipt.freeBefore = {
    source: free(root),
    output: free(output),
    system: free(process.env.SystemRoot ?? 'C:/Windows'),
  };
  if (receipt.freeBefore.source < 3 * 1024 ** 3)
    throw new Error('Less than 3 GiB free on source volume');
  await command(
    'electron-install',
    process.execPath,
    [path.join(root, 'node_modules/electron/install.js')],
    240000,
  );
  await command(
    'package',
    process.execPath,
    [
      path.join(root, 'node_modules/electron-builder/out/cli/cli.js'),
      '--win',
      '--dir',
      '--publish',
      'never',
      `-c.directories.output=${path.join(output, 'package')}`,
    ],
    300000,
  );
  phase = 'manifest';
  const candidate = path.join(output, 'package/win-unpacked');
  const manifest = path.join(evidence, 'manifest.json');
  fs.writeFileSync(manifest, produceGuiManifest(candidate), { flag: 'wx' });
  receipt.packageManifestSha256 = hash(manifest);
  const compiler = path.join(
    process.env.WINDIR ?? 'C:/Windows',
    'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
  );
  receipt.host.compilerSha256 = hash(compiler);
  const library = path.join(output, 'desktop.dll');
  await command(
    'compile-probe',
    compiler,
    [
      '/nologo',
      '/target:library',
      '/platform:x64',
      '/warnaserror+',
      '/reference:System.Drawing.dll',
      '/define:PROTECTED_GUI_TEST;PROTECTED_GUI_PROCESS_TEST',
      `/out:${library}`,
      ...processCoreSources(root),
      path.join(root, 'tests/fixtures/protected-gui-process/DesktopObservation.cs'),
    ],
    30000,
  );
  await command(
    'desktop',
    path.join(process.env.WINDIR ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      path.join(root, 'tests/fixtures/protected-gui-process/desktop.ps1'),
      '-Project',
      root,
      '-Assembly',
      library,
      '-Source',
      candidate,
      '-Manifest',
      manifest,
      '-Scratch',
      path.join(output, 'scratch'),
      '-Evidence',
      evidence,
    ],
    120000,
  );
  phase = 'receipt';
  const observation = path.join(evidence, 'desktop.json');
  if (fs.statSync(observation).size > 65536) throw new Error('Desktop receipt too large');
  receipt.desktop = JSON.parse(fs.readFileSync(observation, 'utf8').replace(/^\uFEFF/, ''));
  if (!desktopPassed(receipt.desktop)) throw new Error('Desktop lifecycle incomplete');
  if (fs.statSync(path.join(evidence, 'window.png')).size > 8 * 1024 ** 2)
    throw new Error('Window image too large');
  receipt.screenshotSha256 = hash(path.join(evidence, 'window.png'));
  if (values.monitoring) {
    await command(
      'monitoring',
      process.execPath,
      [
        path.join(root, 'frontend/observatory/tests/monitoring-electron.mjs'),
        '--executable',
        path.join(candidate, 'AEGIS - AI Monitoring & Threat Detection.exe'),
        '--output',
        path.join(output, 'monitoring'),
      ],
      180000,
    );
    const monitoringReceipt = path.join(output, 'monitoring/receipt.json');
    if (fs.statSync(monitoringReceipt).size > 262144)
      throw new Error('Monitoring receipt too large');
    receipt.monitoring = JSON.parse(fs.readFileSync(monitoringReceipt, 'utf8'));
    if (!monitoringPassed(receipt.monitoring))
      throw new Error('Packaged monitoring scenario incomplete');
    receipt.monitoringReceiptSha256 = hash(monitoringReceipt);
  }
  if (values.sensors) {
    await command(
      'sensors',
      process.execPath,
      [
        path.join(root, 'frontend/observatory/tests/sensors-electron.mjs'),
        '--executable',
        path.join(candidate, 'AEGIS - AI Monitoring & Threat Detection.exe'),
        '--output',
        path.join(output, 'sensors'),
      ],
      240000,
    );
    const sensorReceipt = path.join(output, 'sensors/receipt.json');
    if (fs.statSync(sensorReceipt).size > 262144) throw new Error('Sensor receipt too large');
    receipt.sensors = JSON.parse(fs.readFileSync(sensorReceipt, 'utf8'));
    if (!sensorsPassed(receipt.sensors)) throw new Error('Packaged sensor scenario incomplete');
    receipt.sensorReceiptSha256 = hash(sensorReceipt);
  }
  if (
    hash(manifest) !== receipt.packageManifestSha256 ||
    !produceGuiManifest(candidate).equals(fs.readFileSync(manifest))
  )
    throw new Error('Package changed during observation');
  if (
    git('rev-parse', 'HEAD') !== receipt.source.head ||
    git('status', '--porcelain', '--untracked-files=normal')
  )
    throw new Error('Source changed during qualification');
  receipt.status = 'PASS';
} catch (error) {
  receipt.failure = { phase, message: error.message };
  process.exitCode = 1;
} finally {
  receipt.completedAt = new Date().toISOString();
  receipt.freeAfter = {
    source: free(root),
    output: free(output),
    system: free(process.env.SystemRoot ?? 'C:/Windows'),
  };
  fs.writeFileSync(path.join(evidence, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {
    flag: 'wx',
  });
  console.log(
    JSON.stringify({ status: receipt.status, phase, receipt: path.join(evidence, 'receipt.json') }),
  );
}
