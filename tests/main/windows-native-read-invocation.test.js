import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { probeRetainedObjectRelease } from '../../scripts/qualification/windows-native-read-support.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const folders = [];
afterEach(() => {
  for (const folder of folders.splice(0)) {
    expect(path.dirname(path.resolve(folder))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(folder).startsWith('aegis-native-invocation-')).toBe(true);
    expect(fs.realpathSync(folder)).toBe(path.resolve(folder));
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
function directory() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-native-invocation-'));
  folders.push(folder);
  return folder;
}
function restrictedFixture(scenario) {
  const folder = directory();
  const script = path.join(folder, 'fixture.ps1');
  fs.writeFileSync(
    script,
    String.raw`param([string]$Source,[string]$Scenario)
$ErrorActionPreference='Stop'
try {
  if($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { throw 'fixture-engine-refused' }
  $support=Join-Path $Source 'scripts/qualification/windows-native-read-host.ps1'
  . $support
  $path=Join-Path $PSScriptRoot 'fixed-guest.ps1';$marker=Join-Path $PSScriptRoot 'entered.txt'
  $payload='param([string]$Phase) if($Phase -cne "prepare"){throw "fixture-phase-binding"};[IO.File]::WriteAllText("'+$marker.Replace('"','""')+'","entered");return "PHASE_EXECUTED"'
  [IO.File]::WriteAllText($path,$payload,[Text.UTF8Encoding]::new($false))
  $hash=(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant()
  # Replace only the established fixed-path literal in this extracted helper for the fixture.
  $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($support,[ref]$tokens,[ref]$errors)
  $definition=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Get-NativeReadPhaseInvocation'},$false))
  if($errors.Count -ne 0 -or $definition.Count -ne 1) { throw 'fixture-entry-source' }
  $fixed=@($definition[0].FindAll({param($node) $node -is [Management.Automation.Language.StringConstantExpressionAst] -and $node.Value -ceq 'C:\aegis-native-read\input\guest.ps1'},$true))
  if($fixed.Count -ne 1) { throw 'fixture-entry-path' }
  $text=$definition[0].Extent.Text;$offset=$fixed[0].Extent.StartOffset-$definition[0].Extent.StartOffset
  $text=$text.Remove($offset,$fixed[0].Extent.Text.Length).Insert($offset,("'"+$path.Replace("'","''")+"'"))
  . ([scriptblock]::Create($text))
  if($Scenario -ceq 'wrong-hash') { $hash='0'*64 }
  $encoded=Get-NativeReadPhaseCommand 'prepare' $hash
  $processSource=Get-NativeReadProcessSource
  $control=@'
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
try {
  $before=(Get-ExecutionPolicy).ToString();$beforeAll=Get-ExecutionPolicy -List | ConvertTo-Json -Compress
  if($before -cne 'Restricted') { throw 'fixture-policy-control' }
  $path='FIXED_PATH';$marker='MARKER_PATH';$scenario='SCENARIO'
  $refused=$false
  try { & $path -Phase 'prepare' | Out-Null }
  catch { if($_.Exception.GetType().Name -cne 'PSSecurityException') { throw 'fixture-file-exception' };$refused=$true }
  if(-not $refused -or (Test-Path -LiteralPath $marker)) { throw 'fixture-file-control' }
  . ([scriptblock]::Create([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('PROCESS_SOURCE'))))
  if($scenario -ceq 'runner') {
    $code=Invoke-CloudGuestNativeProcess ($env:SystemRoot+'\System32\cmd.exe') @('/d','/c','exit','17') ($path+'.out') ($path+'.err') 5000
    if($code -ne 17 -or (Get-Item -LiteralPath ($path+'.out')).Length -ne 0 -or (Get-Item -LiteralPath ($path+'.err')).Length -ne 0) { throw 'fixture-native-result' }
  } else {
    $command=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('PHASE_COMMAND'))
    $rejected=$false;$value=$null
    try { $value=& ([scriptblock]::Create($command)) }
    catch { if($scenario -cne 'wrong-hash' -or $_.Exception.Message -cne 'Native phase entry refused') { throw 'fixture-phase-refusal' };$rejected=$true }
    if($scenario -ceq 'phase' -and ($value -cne 'PHASE_EXECUTED' -or -not (Test-Path -LiteralPath $marker))) { throw 'fixture-phase-not-executed' }
    if($scenario -ceq 'wrong-hash' -and (-not $rejected -or (Test-Path -LiteralPath $marker))) { throw 'fixture-wrong-hash-entered' }
  }
  $after=(Get-ExecutionPolicy).ToString();$afterAll=Get-ExecutionPolicy -List | ConvertTo-Json -Compress
  if($before -cne $after -or $beforeAll -cne $afterAll) { throw 'fixture-policy-changed' }
  @{status='PASS';version=$PSVersionTable.PSVersion.ToString();scenario=$scenario;baselineFileRefused=$refused;policyBefore=$before;policyAfter=$after;allPolicyScopesUnchanged=$true} | ConvertTo-Json -Compress
} catch { @{status='FAIL';code='native-restricted-child-refused'} | ConvertTo-Json -Compress;exit 2 }
'@
  $control=$control.Replace('FIXED_PATH',$path.Replace("'","''")).Replace('MARKER_PATH',$marker.Replace("'","''")).Replace('SCENARIO',$Scenario).Replace('PROCESS_SOURCE',[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($processSource))).Replace('PHASE_COMMAND',$encoded)
  $controlPath=Join-Path $PSScriptRoot 'control.txt';[IO.File]::WriteAllText($controlPath,$control,[Text.UTF8Encoding]::new($false))
  $loader="& ([scriptblock]::Create([IO.File]::ReadAllText('"+$controlPath.Replace("'","''")+"')))"
  $childCode=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($loader))
  & ($env:SystemRoot+'\System32\WindowsPowerShell\v1.0\powershell.exe') -NoProfile -NonInteractive -ExecutionPolicy Restricted -EncodedCommand $childCode
  if($LASTEXITCODE -ne 0) { exit 2 }
} catch { @{status='FAIL';code='native-restricted-fixture-refused'} | ConvertTo-Json -Compress;exit 2 }
`,
  );
  const result = spawnSync(
    path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-File', script, '-Source', root, '-Scenario', scenario],
    { cwd: folder, encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 8192 },
  );
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
}

describe.skipIf(process.platform !== 'win32')(
  'native guest trusted execution under Restricted policy',
  () => {
    it.each(['runner', 'phase', 'wrong-hash'])(
      'exercises the actual %s route without changing any policy scope',
      (scenario) => {
        expect(restrictedFixture(scenario)).toMatchObject({
          status: 'PASS',
          version: expect.stringMatching(/^5\.1\./),
          scenario,
          baselineFileRefused: true,
          policyBefore: 'Restricted',
          policyAfter: 'Restricted',
          allPolicyScopesUnchanged: true,
        });
      },
      20000,
    );

    it('runs the actual bounded owned-file release probe under inherited Restricted policy', async () => {
      const folder = directory();
      const fixture = path.join(folder, 'fixture');
      fs.mkdirSync(fixture);
      const file = path.join(fixture, '.env');
      fs.writeFileSync(file, Buffer.alloc(4096, 46));
      const receipt = await probeRetainedObjectRelease(file, folder, {
        ...process.env,
        PSExecutionPolicyPreference: 'Restricted',
      });
      expect(receipt).toMatchObject({
        released: true,
        policyBefore: 'Restricted',
        policyAfter: 'Restricted',
      });
      expect(fs.existsSync(file)).toBe(false);
      expect(fs.existsSync(path.join(fixture, '.env-after-issuer-close'))).toBe(true);
    }, 30000);
  },
);
