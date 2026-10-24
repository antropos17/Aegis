import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validateTaskRoot, createTaskRoot } from './tail-build-paths.mjs';

// One offline build per invocation. The orchestrator checks resources and
// supplies a fresh task directory; this driver never removes existing output.
const [selectedRoot, selectedRuntime, kind = 'reader', sourceBase = null] = process.argv.slice(2);
if (
  process.platform !== 'win32' ||
  !selectedRoot ||
  !selectedRuntime ||
  !path.isAbsolute(selectedRoot) ||
  !path.isAbsolute(selectedRuntime) ||
  !['reader', 'fixture'].includes(kind) ||
  (sourceBase !== null && !/^[a-f0-9]{40}$/.test(sourceBase))
)
  throw Error('invalid-tail-build-input');
const runtimeRoot = path.resolve(selectedRuntime);
const here = path.dirname(fileURLToPath(import.meta.url));
const checkout = path.resolve(here, '../../..');
const root = validateTaskRoot(selectedRoot, checkout, runtimeRoot, kind);
const sdkVersion = '10.0.302';
const runtimeVersion = '10.0.10';
const executable = path.join(runtimeRoot, 'dotnet.exe');
if (
  !fs.statSync(executable).isFile() ||
  !fs.statSync(path.join(runtimeRoot, 'sdk', sdkVersion)).isDirectory() ||
  !fs
    .statSync(path.join(runtimeRoot, 'shared', 'Microsoft.NETCore.App', runtimeVersion))
    .isDirectory()
)
  throw Error('tail-build-prerequisite-unavailable');
createTaskRoot(root, checkout, runtimeRoot, kind);
const output = path.join(root, kind === 'reader' ? 'build' : 'fixture-build');
const intermediate = path.join(root, kind === 'reader' ? 'obj' : 'fixture-obj');
if (fs.existsSync(output) || fs.existsSync(intermediate)) throw Error('tail-build-output-exists');
for (const name of [
  'temp',
  'cli-home',
  'profile',
  'program-files',
  'program-files-x86',
  'nuget',
  'http-cache',
  'empty-source',
])
  fs.mkdirSync(path.join(root, name));
const appData = path.join(root, 'profile', 'AppData');
fs.mkdirSync(appData);
fs.mkdirSync(path.join(appData, 'Roaming'));
fs.mkdirSync(path.join(appData, 'Local'));
function fixedFile(name, text) {
  fs.writeFileSync(path.join(root, name), text, { flag: 'wx' });
}
fixedFile('global.json', JSON.stringify({ sdk: { version: sdkVersion, rollForward: 'disable' } }));
fixedFile(
  'nuget.config',
  '<configuration><packageSources><clear /></packageSources></configuration>',
);
const project =
  kind === 'reader'
    ? path.resolve(here, '../SessionContextReader.csproj')
    : path.resolve(here, 'TailFixture.csproj');
const args = [
  'build',
  project,
  '-c',
  'Release',
  '--no-dependencies',
  '--source',
  path.join(root, 'empty-source'),
  '-o',
  output,
  `-p:BaseIntermediateOutputPath=${intermediate}${path.sep}`,
  `-p:RestoreConfigFile=${path.join(root, 'nuget.config')}`,
  '-p:UseSharedCompilation=false',
  '-nodeReuse:false',
];
const env = {
  SystemRoot: process.env.SystemRoot,
  WINDIR: process.env.SystemRoot,
  PATH: [runtimeRoot, path.join(process.env.SystemRoot, 'System32')].join(path.delimiter),
  TEMP: path.join(root, 'temp'),
  TMP: path.join(root, 'temp'),
  DOTNET_ROOT: runtimeRoot,
  DOTNET_CLI_HOME: path.join(root, 'cli-home'),
  USERPROFILE: path.join(root, 'profile'),
  APPDATA: path.join(appData, 'Roaming'),
  LOCALAPPDATA: path.join(appData, 'Local'),
  PROGRAMFILES: path.join(root, 'program-files'),
  'PROGRAMFILES(X86)': path.join(root, 'program-files-x86'),
  NUGET_PACKAGES: path.join(root, 'nuget'),
  NUGET_HTTP_CACHE_PATH: path.join(root, 'http-cache'),
  NUGET_SCRATCH: path.join(root, 'temp'),
  NUGET_SHOW_STACK: 'true',
  DOTNET_CLI_TELEMETRY_OPTOUT: '1',
  DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
  DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false',
  DOTNET_CLI_UI_LANGUAGE: 'en-US',
  DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE: '1',
  DOTNET_CLI_DO_NOT_USE_MSBUILD_SERVER: '1',
  DOTNET_EnableDiagnostics: '0',
  COMPlus_EnableDiagnostics: '0',
  MSBUILDDISABLENODEREUSE: '1',
  MSBuildEnableWorkloadResolver: 'false',
};
const digest = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sources = [
  ...(kind === 'reader'
    ? ['Program.cs', 'SessionContextReader.csproj']
    : ['native-fixture/TailFixture.cs', 'native-fixture/TailFixture.csproj']),
  'ReadLease.cs',
  '../hook-config-target/Native.cs',
  '../hook-config-target/TargetPath.cs',
  '../hook-config-target/TargetLease.cs',
  '../hook-transaction/Wire.cs',
].map((name) => path.resolve(here, '..', name));
const sourcePins = () =>
  sources.map((file) => ({
    name: path.relative(checkout, file).split(path.sep).join('/'),
    sha256: digest(file),
  }));
const beforeSources = sourcePins();
const maxBytes = 2 * 1024 * 1024;
const started = Date.now();
const result = spawnSync(executable, args, {
  cwd: root,
  env,
  windowsHide: true,
  encoding: 'utf8',
  timeout: 240000,
  maxBuffer: maxBytes,
  killSignal: 'SIGKILL',
});
const log = Buffer.from(`${result.stdout || ''}${result.stderr || ''}`);
fs.writeFileSync(path.join(root, `${kind}-build.log`), log.subarray(0, maxBytes));
const afterSources = sourcePins();
const sourceUnchanged = JSON.stringify(beforeSources) === JSON.stringify(afterSources);
const receipt = {
  at: new Date().toISOString(),
  kind,
  sourceBase,
  machine: {
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    hostname: os.hostname(),
  },
  node: process.version,
  sdkVersion,
  runtimeVersion,
  outputRoots: {
    temp: env.TEMP,
    cliHome: env.DOTNET_CLI_HOME,
    userProfile: env.USERPROFILE,
    appData: env.APPDATA,
    localAppData: env.LOCALAPPDATA,
    programFiles: env.PROGRAMFILES,
    programFilesX86: env['PROGRAMFILES(X86)'],
    packages: env.NUGET_PACKAGES,
    httpCache: env.NUGET_HTTP_CACHE_PATH,
    intermediate,
    output,
  },
  executable,
  args,
  cwd: root,
  elapsedMs: Date.now() - started,
  code: result.status,
  signal: result.signal,
  errorCode: result.error?.code || null,
  logTruncated: log.length > maxBytes,
  logSha256: digest(path.join(root, `${kind}-build.log`)),
  sources: beforeSources,
  afterSources,
  sourceUnchanged,
  result:
    result.status === 0 && !result.error && log.length <= maxBytes && sourceUnchanged
      ? 'PASS'
      : 'FAIL',
};
if (receipt.result === 'PASS') {
  try {
    const pins = (folder) =>
      fs
        .readdirSync(folder)
        .sort()
        .map((name) => {
          const file = path.join(folder, name);
          const stat = fs.lstatSync(file);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
            throw Error('tail-build-asset-entry');
          return { name, sha256: digest(file) };
        });
    const hostFiles = pins(output);
    const assembly = kind === 'reader' ? 'SessionContextReader' : 'TailFixture';
    const required = ['exe', 'dll', 'deps.json', 'runtimeconfig.json'].map(
      (extension) => `${assembly}.${extension}`,
    );
    if (
      hostFiles.length !== required.length ||
      required.some((name) => !hostFiles.some((pin) => pin.name === name))
    )
      throw Error('tail-build-host-bundle');
    receipt.outputs = hostFiles;
    if (kind === 'reader') {
      const assets = {
        hostRoot: output,
        hostFiles,
        runtimeRoot,
        runtimeVersion,
        runtimeFiles: pins(
          path.join(runtimeRoot, 'shared', 'Microsoft.NETCore.App', runtimeVersion),
        ),
        hostFxrSha256: digest(path.join(runtimeRoot, 'host', 'fxr', runtimeVersion, 'hostfxr.dll')),
      };
      fs.writeFileSync(path.join(root, 'assets.json'), JSON.stringify(assets, null, 2), {
        flag: 'wx',
      });
    }
  } catch {
    receipt.result = 'FAIL';
    receipt.errorCode = 'tail-build-assets-unavailable';
  }
}
fs.writeFileSync(path.join(root, `${kind}-build.json`), JSON.stringify(receipt, null, 2), {
  flag: 'wx',
});
console.log(
  JSON.stringify({
    kind,
    result: receipt.result,
    code: receipt.code,
    elapsedMs: receipt.elapsedMs,
  }),
);
if (receipt.result !== 'PASS') process.exitCode = 1;
