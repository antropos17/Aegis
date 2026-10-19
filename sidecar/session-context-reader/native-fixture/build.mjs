import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const report = 'X:/tmp/aegis-ten-hour-20261019/reports/05-windows-context-reader';
const metadata = process.argv[2] === 'metadata';
for (const name of ['temp', 'cli-home', 'nuget', 'empty-source', 'build', 'obj'])
  fs.mkdirSync(path.join(report, name), { recursive: true });
const result = spawnSync(
  'C:/Program Files/dotnet/dotnet.exe',
  [
    'build',
    metadata
      ? 'sidecar/session-context-reader/native-fixture/MetadataFixture.csproj'
      : 'sidecar/session-context-reader/SessionContextReader.csproj',
    '-c',
    'Release',
    '--no-dependencies',
    '--source',
    path.join(report, 'empty-source'),
    '-o',
    path.join(report, metadata ? 'metadata-build' : 'build'),
    `-p:BaseIntermediateOutputPath=${report}/${metadata ? 'metadata-obj' : 'obj'}/`,
    '-p:UseSharedCompilation=false',
    '-nodeReuse:false',
  ],
  {
    windowsHide: true,
    stdio: 'inherit',
    timeout: 240000,
    env: {
      ...process.env,
      TEMP: `${report}/temp`,
      TMP: `${report}/temp`,
      DOTNET_CLI_HOME: `${report}/cli-home`,
      NUGET_PACKAGES: `${report}/nuget`,
      DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false',
      DOTNET_CLI_TELEMETRY_OPTOUT: '1',
      DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
      DOTNET_CLI_UI_LANGUAGE: 'en-US',
      MSBUILDDISABLENODEREUSE: '1',
    },
  },
);
if (result.error) console.log('reader-build-child-failed');
process.exitCode = result.status ?? 1;
