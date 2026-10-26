'use strict';

// Offline preparation consumed by the existing Electron hook-review boundary.
// No installation, runtime download or personal profile access occurs here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
if (
  args.length % 2 ||
  args.some((value, index) => index % 2 === 0 && !['--output', '--runtime-root'].includes(value))
)
  throw Error('Unsupported asset preparation arguments');
const options = Object.fromEntries(
  Array.from({ length: args.length / 2 }, (_, index) => [args[index * 2], args[index * 2 + 1]]),
);
const output = path.resolve(options['--output'] || path.join(root, 'build', 'hook-review'));
const runtimeRoot = path.resolve(
  options['--runtime-root'] || path.join(process.env.ProgramFiles || 'C:/Program Files', 'dotnet'),
);
const runtimeVersion = '10.0.10';
const dotnet = path.join(runtimeRoot, 'dotnet.exe');
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (process.platform !== 'win32' || fs.existsSync(output))
  throw Error('Requires Windows and a fresh owned output directory');
if (
  execFileSync(dotnet, ['--version'], { encoding: 'utf8', windowsHide: true }).trim() !== '10.0.302'
)
  throw Error('Requires the existing .NET SDK 10.0.302; no installation is performed');
const staging = path.join(root, 'out', 'development', 'hook-review-build-' + process.pid);
fs.mkdirSync(staging, { recursive: true });
const empty = path.join(staging, 'empty-nuget-source');
fs.mkdirSync(empty);
const project = path.join(root, 'sidecar', 'hook-transaction', 'HookTransaction.csproj');
const artifacts = [
  '-p:UseArtifactsOutput=true',
  '-p:ArtifactsPath=' + path.join(staging, 'artifacts'),
];
const env = {
  ...process.env,
  DOTNET_NOLOGO: '1',
  DOTNET_CLI_TELEMETRY_OPTOUT: '1',
  DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
};
for (const command of [
  [
    'restore',
    project,
    '--source',
    empty,
    '--disable-parallel',
    '-p:NuGetAudit=false',
    ...artifacts,
  ],
  [
    'build',
    project,
    '--configuration',
    'Release',
    '--no-restore',
    '--output',
    path.join(staging, 'host'),
    ...artifacts,
  ],
])
  execFileSync(dotnet, command, {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: true,
    timeout: 120000,
  });
const host = path.join(output, 'host');
fs.mkdirSync(host, { recursive: true });
const names = [
  'HookTransaction.dll',
  'HookTransaction.deps.json',
  'HookTransaction.runtimeconfig.json',
  'HookConfigTarget.dll',
  'HookPrivateBackup.dll',
];
for (const name of names)
  fs.copyFileSync(
    path.join(staging, 'host', name),
    path.join(host, name),
    fs.constants.COPYFILE_EXCL,
  );
// Match the existing private loader's reviewed no-roll-forward/no-diagnostics config.
fs.writeFileSync(
  path.join(host, 'HookTransaction.runtimeconfig.json'),
  JSON.stringify({
    runtimeOptions: {
      tfm: 'net10.0',
      rollForward: 'Disable',
      framework: { name: 'Microsoft.NETCore.App', version: runtimeVersion },
      configProperties: {
        'System.Reflection.Metadata.MetadataUpdater.IsSupported': false,
        'System.Runtime.Serialization.EnableUnsafeBinaryFormatterSerialization': false,
        CSWINRT_USE_WINDOWS_UI_XAML_PROJECTIONS: false,
      },
    },
  }),
);
const runtime = path.join(runtimeRoot, 'shared', 'Microsoft.NETCore.App', runtimeVersion);
const manifest = {
  schemaVersion: 1,
  hostFiles: names.map((name) => ({ name, sha256: hash(path.join(host, name)) })),
  runtimeRoot: path.win32.normalize(runtimeRoot),
  runtimeVersion,
  runtimeFiles: fs
    .readdirSync(runtime)
    .map((name) => ({ name, sha256: hash(path.join(runtime, name)) })),
  hostFxrSha256: hash(path.join(runtimeRoot, 'host', 'fxr', runtimeVersion, 'hostfxr.dll')),
  executableSha256: hash(dotnet),
};
require('../src/main/claude-hook-windows-io-wire').qualifyAssets({
  ...Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'schemaVersion')),
  hostRoot: path.win32.normalize(host),
});
fs.writeFileSync(path.join(output, 'assets.json'), JSON.stringify(manifest, null, 2) + '\n', {
  flag: 'wx',
});
console.log('Prepared hook-review assets: ' + output);
console.log(
  'Build diagnostics retained under ' + staging + '; review closed diagnostics after seven days.',
);
