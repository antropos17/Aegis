import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { boundedCommand } from '../../../tools/development/bounded-command.mjs';
const report = 'X:/tmp/aegis-ten-hour-20261019/reports/05-windows-context-reader';
const source = `${report}/final-source/sidecar`;
const copied = `${report}/eof-mutant/sidecar`;
assert.ok(fs.existsSync(`${report}/final-source/manifest.json`), 'source-freeze-required');
fs.cpSync(source, copied, { recursive: true, errorOnExist: true, force: false });
const file = `${copied}/session-context-reader/ReadLease.cs`;
const clean = fs.readFileSync(file, 'utf8');
assert.equal(clean.split('eof = probe;').length, 2);
const changed = clean.replace('eof = probe;', 'eof = false;');
fs.writeFileSync(file, changed);
const env = {
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
};
const build = await boundedCommand(
  'C:/Program Files/dotnet/dotnet.exe',
  [
    'build',
    `${copied}/session-context-reader/native-fixture/MetadataFixture.csproj`,
    '-c',
    'Release',
    '--source',
    `${report}/empty-source`,
    '-o',
    `${report}/mutant-build`,
    `-p:BaseIntermediateOutputPath=${report}/mutant-obj/`,
    '-p:UseSharedCompilation=false',
    '-nodeReuse:false',
  ],
  {
    cwd: process.cwd(),
    env,
    log: `${report}/mutant-build.log`,
    timeoutMs: 120000,
    maxBytes: 2 * 1024 * 1024,
  },
);
assert.equal(build.code, 0);
assert.equal(build.reason, null);
const observed = await boundedCommand(
  process.execPath,
  ['sidecar/session-context-reader/native-fixture/metadata.mjs', 'mutant'],
  {
    cwd: process.cwd(),
    env,
    log: `${report}/mutant-observed.log`,
    timeoutMs: 10000,
    maxBytes: 2 * 1024 * 1024,
  },
);
assert.equal(observed.code, 1);
assert.equal(observed.reason, null);
const receipt = {
  mutation: 'remove-native-single-EOF-consumption',
  cleanSha256: createHash('sha256').update(clean).digest('hex'),
  mutantSha256: createHash('sha256').update(changed).digest('hex'),
  build,
  observed,
  killedBy: 'real-native-fixture-requires-repeated-EOF-refusal',
};
fs.writeFileSync(`${report}/mutant.json`, JSON.stringify(receipt, null, 2));
console.log(
  JSON.stringify({
    mutant: 'native-single-EOF',
    killed: true,
    childTermination: observed.termination,
  }),
);
