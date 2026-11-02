import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const folders = [];
afterEach(() => {
  for (const folder of folders.splice(0)) {
    expect(path.dirname(path.resolve(folder))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(folder).startsWith('aegis-native-manifest-')).toBe(true);
    expect(fs.realpathSync(folder)).toBe(path.resolve(folder));
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
function manifestFixture(scenario) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-native-manifest-'));
  folders.push(folder);
  const input = path.join(folder, 'input');
  fs.mkdirSync(input);
  const rows = ['one.bin', 'two.bin'].map((name, index) => {
    const data = Buffer.from('NATIVE_MANIFEST_CONTENT_CANARY_' + index);
    fs.writeFileSync(path.join(input, name), data);
    return {
      path: name,
      bytes: data.length,
      sha256: crypto.createHash('sha256').update(data).digest('hex'),
    };
  });
  let value = rows;
  if (scenario === 'singleton') value = rows.slice(0, 1);
  if (scenario === 'nested') value = [rows];
  if (scenario === 'scalar-path') rows[0].path = ['one.bin', 'two.bin'];
  if (scenario === 'scalar-root') value = rows[0];
  if (scenario === 'invalid-size') rows[0].bytes = String(rows[0].bytes);
  if (scenario === 'invalid-hash') rows[0].sha256 = 'NOT_A_SHA256';
  const manifest = path.join(folder, 'manifest.json');
  fs.writeFileSync(manifest, JSON.stringify(value));
  const script = path.join(folder, 'fixture.ps1');
  fs.writeFileSync(
    script,
    `param([string]$Source,[string]$Manifest,[string]$InputRoot,[string]$Scenario)
$ErrorActionPreference='Stop'
try {
  if($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { throw 'fixture-engine-refused' }
  . (Join-Path $Source 'scripts/qualification/windows-native-read-host.ps1')
  $reader=(Get-Command ConvertFrom-NativeReadManifest -CommandType Function).ScriptBlock.ToString()
  $json=[IO.File]::ReadAllText($Manifest)
  if($Scenario -in @('multi','singleton')) {
    $parsed=& ([scriptblock]::Create($reader)) $json
    $files=$parsed.files
    $expected=if($Scenario -ceq 'multi'){2}else{1}
    if($files -isnot [array] -or $files.Count -ne $expected) { throw 'fixture-row-count' }
    $visited=0
    foreach($file in $files) {
      if($file.path -isnot [string]) { throw 'fixture-path-not-scalar' }
      $target=[IO.Path]::GetFullPath((Join-Path $InputRoot $file.path))
      if(-not $target.StartsWith($InputRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or (Get-Item -LiteralPath $target).Length -ne $file.bytes -or (Get-FileHash -LiteralPath $target).Hash -ine $file.sha256) { throw 'fixture-row-verification' }
      $visited++
    }
    if($visited -ne $expected) { throw 'fixture-not-all-rows-visited' }
    @{status='PASS';version=$PSVersionTable.PSVersion.ToString();visited=$visited;scalarPaths=$true;hashesAndSizesVerified=$true} | ConvertTo-Json -Compress
  } else {
    $refused=$false
    try { [void](& ([scriptblock]::Create($reader)) $json) }
    catch { if($_.Exception.Message -cne 'Native input manifest refused') { throw 'fixture-refusal-code' };$refused=$true }
    if(-not $refused) { throw 'fixture-malformed-manifest-accepted' }
    @{status='PASS';version=$PSVersionTable.PSVersion.ToString();refused=$true} | ConvertTo-Json -Compress
  }
} catch { @{status='FAIL';code='native-manifest-fixture-refused';scenario=$Scenario} | ConvertTo-Json -Compress;exit 2 }
`,
  );
  const executable = path.join(
    process.env.SystemRoot,
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
  const result = spawnSync(
    executable,
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      script,
      '-Source',
      root,
      '-Manifest',
      manifest,
      '-InputRoot',
      input,
      '-Scenario',
      scenario,
    ],
    { cwd: folder, encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 8192 },
  );
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(result.stdout).not.toContain('NATIVE_MANIFEST_CONTENT_CANARY');
  return JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
}
describe.skipIf(process.platform !== 'win32')(
  'native input manifest in actual Windows PowerShell 5.1',
  () => {
    it.each([
      ['multi', 2],
      ['singleton', 1],
    ])(
      'verifies every %s manifest path as a scalar with actual file hashes',
      (scenario, visited) => {
        expect(manifestFixture(scenario)).toMatchObject({
          status: 'PASS',
          version: expect.stringMatching(/^5\.1\./),
          visited,
          scalarPaths: true,
          hashesAndSizesVerified: true,
        });
      },
      20000,
    );
    it.each(['nested', 'scalar-path', 'scalar-root', 'invalid-size', 'invalid-hash'])(
      'refuses %s metadata before any path join',
      (scenario) => {
        expect(manifestFixture(scenario)).toMatchObject({
          status: 'PASS',
          version: expect.stringMatching(/^5\.1\./),
          refused: true,
        });
      },
      20000,
    );
  },
);
