'use strict';

// Offline preparation consumed by the existing Electron hook-review boundary.
// No installation, runtime download or personal profile access occurs here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const replace = args.includes('--replace');
if (replace) args.splice(args.indexOf('--replace'), 1);
if (
  args.length % 2 ||
  args.some((value, index) => index % 2 === 0 && !['--output', '--runtime-root'].includes(value))
)
  throw Error('Unsupported asset preparation arguments');
const options = Object.fromEntries(
  Array.from({ length: args.length / 2 }, (_, index) => [args[index * 2], args[index * 2 + 1]]),
);
const destination = path.resolve(options['--output'] || path.join(root, 'build', 'hook-review'));
if (replace && options['--output'])
  throw Error('--replace only applies to the default build output');
const output = replace ? destination + '-next-' + process.pid : destination;
const runtimeRoot = path.resolve(
  options['--runtime-root'] || path.join(process.env.ProgramFiles || 'C:/Program Files', 'dotnet'),
);
const runtimeVersion = ['10.0.14', '10.0.10'].find((version) =>
  fs.existsSync(path.join(runtimeRoot, 'shared', 'Microsoft.NETCore.App', version)),
);
if (!runtimeVersion) throw Error('Requires an installed .NET runtime 10.0.14 or 10.0.10');
const dotnet = path.join(runtimeRoot, 'dotnet.exe');
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (process.platform !== 'win32' || fs.existsSync(output))
  throw Error('Requires Windows and a fresh owned output directory');
const sdk = execFileSync(dotnet, ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
if (!/^10\.0\.\d+$/.test(sdk) || Number(sdk.split('.')[2]) < 302)
  throw Error(
    'Requires an existing .NET 10 SDK version 10.0.302 or later; no installation is performed',
  );
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
// The package is x64-only; do not silently ship a runtime selected from an x86 install.
for (const selected of [
  dotnet,
  path.join(runtimeRoot, 'host', 'fxr', runtimeVersion, 'hostfxr.dll'),
  path.join(runtime, 'coreclr.dll'),
]) {
  const fd = fs.openSync(selected, 'r');
  try {
    const header = Buffer.alloc(4096);
    const length = fs.readSync(fd, header, 0, header.length, 0);
    const pe = header.readUInt32LE(0x3c);
    if (
      length < 64 ||
      header.toString('ascii', 0, 2) !== 'MZ' ||
      pe + 6 > length ||
      header.toString('binary', pe, pe + 4) !== 'PE\0\0' ||
      header.readUInt16LE(pe + 4) !== 0x8664
    )
      throw Error('Requires an x64 .NET runtime and host');
  } finally {
    fs.closeSync(fd);
  }
}
const portableRuntime = path.join(output, 'runtime');
const portableShared = path.join(
  portableRuntime,
  'shared',
  'Microsoft.NETCore.App',
  runtimeVersion,
);
const portableFxr = path.join(portableRuntime, 'host', 'fxr', runtimeVersion);
fs.mkdirSync(portableShared, { recursive: true });
fs.mkdirSync(portableFxr, { recursive: true });
for (const name of fs.readdirSync(runtime)) {
  const source = path.join(runtime, name);
  if (!fs.lstatSync(source).isFile()) throw Error('Unexpected runtime asset');
  fs.copyFileSync(source, path.join(portableShared, name), fs.constants.COPYFILE_EXCL);
}
fs.copyFileSync(dotnet, path.join(portableRuntime, 'dotnet.exe'), fs.constants.COPYFILE_EXCL);
fs.copyFileSync(
  path.join(runtimeRoot, 'host', 'fxr', runtimeVersion, 'hostfxr.dll'),
  path.join(portableFxr, 'hostfxr.dll'),
  fs.constants.COPYFILE_EXCL,
);
const manifest = {
  schemaVersion: 2,
  hostFiles: names.map((name) => ({ name, sha256: hash(path.join(host, name)) })),
  runtimeVersion,
  runtimeFiles: fs
    .readdirSync(portableShared)
    .map((name) => ({ name, sha256: hash(path.join(portableShared, name)) })),
  hostFxrSha256: hash(path.join(portableFxr, 'hostfxr.dll')),
  executableSha256: hash(path.join(portableRuntime, 'dotnet.exe')),
};
require('../src/main/claude-hook-windows-io-wire').qualifyAssets({
  ...Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'schemaVersion')),
  hostRoot: path.win32.normalize(host),
  runtimeRoot: path.win32.normalize(portableRuntime),
  portable: true,
});
fs.writeFileSync(path.join(output, 'assets.json'), JSON.stringify(manifest, null, 2) + '\n', {
  flag: 'wx',
});
if (replace) {
  if (fs.existsSync(destination)) removePrevious(destination);
  fs.renameSync(output, destination);
}
console.log('Prepared hook-review assets: ' + destination);
console.log(
  'Build diagnostics retained under ' + staging + '; review closed diagnostics after seven days.',
);

// Remove only the exact previously qualified build product. Unexpected files, links,
// or altered bytes fail packaging and remain for inspection.
function removePrevious(dir) {
  const value = JSON.parse(fs.readFileSync(path.join(dir, 'assets.json'), 'utf8'));
  if (![1, 2].includes(value.schemaVersion)) throw Error('Unrecognized previous hook assets');
  const { schemaVersion, ...pins } = value;
  const hostRoot = path.join(dir, 'host');
  const selectedRuntime = schemaVersion === 2 ? path.join(dir, 'runtime') : pins.runtimeRoot;
  require('../src/main/claude-hook-windows-io-wire').qualifyAssets({
    ...pins,
    hostRoot: path.win32.normalize(hostRoot),
    runtimeRoot: path.win32.normalize(selectedRuntime),
    ...(schemaVersion === 2 ? { portable: true } : {}),
  });
  const expectNames = (folder, expected) => {
    const names = fs.readdirSync(folder).sort();
    if (JSON.stringify(names) !== JSON.stringify([...expected].sort()))
      throw Error('Previous hook assets contain unexpected files');
  };
  expectNames(
    dir,
    schemaVersion === 2 ? ['assets.json', 'host', 'runtime'] : ['assets.json', 'host'],
  );
  if (schemaVersion === 2) {
    const rt = selectedRuntime;
    const fxr = path.join(rt, 'host', 'fxr');
    const shared = path.join(rt, 'shared', 'Microsoft.NETCore.App');
    expectNames(rt, ['dotnet.exe', 'host', 'shared']);
    expectNames(path.join(rt, 'host'), ['fxr']);
    expectNames(fxr, [value.runtimeVersion]);
    expectNames(path.join(fxr, value.runtimeVersion), ['hostfxr.dll']);
    expectNames(path.join(rt, 'shared'), ['Microsoft.NETCore.App']);
    expectNames(shared, [value.runtimeVersion]);
    for (const entry of value.runtimeFiles)
      fs.unlinkSync(path.join(shared, value.runtimeVersion, entry.name));
    fs.rmdirSync(path.join(shared, value.runtimeVersion));
    fs.rmdirSync(shared);
    fs.rmdirSync(path.join(rt, 'shared'));
    fs.unlinkSync(path.join(fxr, value.runtimeVersion, 'hostfxr.dll'));
    fs.rmdirSync(path.join(fxr, value.runtimeVersion));
    fs.rmdirSync(fxr);
    fs.rmdirSync(path.join(rt, 'host'));
    fs.unlinkSync(path.join(rt, 'dotnet.exe'));
    fs.rmdirSync(rt);
  }
  for (const entry of value.hostFiles) fs.unlinkSync(path.join(hostRoot, entry.name));
  fs.rmdirSync(hostRoot);
  fs.unlinkSync(path.join(dir, 'assets.json'));
  fs.rmdirSync(dir);
}
