import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
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
  $capabilityReader=(Get-Command ConvertFrom-NativeReadCapability -CommandType Function).ScriptBlock.ToString()
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
  $capabilityCases=0
  if($scenario -ceq 'runner') {
    $code=Invoke-CloudGuestNativeProcess ($env:SystemRoot+'\System32\cmd.exe') @('/d','/c','exit','17') ($path+'.out') ($path+'.err') 5000
    if($code -ne 17 -or (Get-Item -LiteralPath ($path+'.out')).Length -ne 0 -or (Get-Item -LiteralPath ($path+'.err')).Length -ne 0) { throw 'fixture-native-result' }
    $reader=[scriptblock]::Create([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('CAPABILITY_READER')))
    $success='{"profile":"win11-x64-26300.9457-experimental","qualified":true,"code":"Qualified"}'
    $failure='{"profile":"win11-x64-26300.9457-experimental","qualified":false,"code":"InventoryLibraryRefused"}'
    $good=& $reader $success 0;$declined=& $reader $failure 2
    if($good.qualified -ne $true -or $good.code -cne 'Qualified' -or $declined.qualified -ne $false -or $declined.code -cne 'InventoryLibraryRefused') { throw 'fixture-capability-valid-shape' };$capabilityCases+=2
    $invalid=@(
      @{json=$success;exitCode=2},@{json=$failure;exitCode=0},
      @{json=$success.Replace('"qualified":true','"qualified":false');exitCode=2},
      @{json=$failure.Replace('"qualified":false','"qualified":true');exitCode=0},
      @{json=$success.Replace('"qualified":true','"qualified":false');exitCode=0},
      @{json=$failure.Replace('"qualified":false','"qualified":true');exitCode=2},
      @{json=$failure.Replace('InventoryLibraryRefused','UnknownCode');exitCode=2},
      @{json=$success.Replace('Qualified','qualified');exitCode=0},
      @{json=$success.Replace('"qualified":true','"qualified":"true"');exitCode=0},
      @{json=$success.Replace('experimental','other');exitCode=0},
      @{json=$success.Replace('}',',"extra":1}');exitCode=0},
      @{json='['+$success+']';exitCode=0},@{json='invalid';exitCode=0},@{json=$failure;exitCode=70}
    )
    foreach($sample in $invalid) {
      $rejected=$false
      try { [void](& $reader $sample.json $sample.exitCode) }
      catch { if($_.Exception.Message -cne 'Capability probe response refused') { throw 'fixture-capability-refusal-code' };$rejected=$true }
      if(-not $rejected) { throw 'fixture-capability-invalid-accepted' };$capabilityCases++
    }
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
  @{status='PASS';version=$PSVersionTable.PSVersion.ToString();scenario=$scenario;baselineFileRefused=$refused;policyBefore=$before;policyAfter=$after;allPolicyScopesUnchanged=$true;capabilityCases=$capabilityCases} | ConvertTo-Json -Compress
} catch { @{status='FAIL';code='native-restricted-child-refused'} | ConvertTo-Json -Compress;exit 2 }
'@
  $control=$control.Replace('FIXED_PATH',$path.Replace("'","''")).Replace('MARKER_PATH',$marker.Replace("'","''")).Replace('SCENARIO',$Scenario).Replace('PROCESS_SOURCE',[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($processSource))).Replace('CAPABILITY_READER',[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($capabilityReader))).Replace('PHASE_COMMAND',$encoded)
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

function feedbackFixture(scenario) {
  const folder = directory();
  const input = path.join(folder, 'bundle');
  fs.mkdirSync(input);
  const rows = ['one.bin', 'two.bin'].map((name, index) => {
    const bytes = Buffer.alloc(3 + index, index + 1);
    fs.writeFileSync(path.join(input, name), bytes);
    if (index === 0) fs.writeFileSync(path.join(folder, 'escape.bin'), bytes);
    return {
      path: name,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  });
  fs.writeFileSync(path.join(input, 'input-manifest.json'), JSON.stringify(rows));
  for (const mode of ['wrong-size', 'path-escape']) {
    const variant = rows.map((row) => ({ ...row }));
    if (mode === 'wrong-size') variant[0].bytes++;
    else variant[0].path = '../escape.bin';
    fs.writeFileSync(path.join(folder, mode + '.json'), JSON.stringify(variant));
  }
  const script = path.join(folder, 'feedback.ps1');
  fs.writeFileSync(
    script,
    String.raw`param([string]$Source,[string]$InputRoot,[string]$Scenario)
$ErrorActionPreference='Stop'
$step='engine';$cases=0;$refusalCode=$null;$positiveScalar=$null;$positiveFiles=$null;$positiveBytes=$null
try {
  if($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { throw 'fixture-engine-refused' }
  $step='source-intake'
  . (Join-Path $Source 'scripts/qualification/windows-native-read-host.ps1')
  if($Scenario -ceq 'bundle') {
    $step='bundle-reader-intake'
    $reader=(Get-Command ConvertFrom-NativeReadManifest -CommandType Function).ScriptBlock.ToString()
    $verifier=[scriptblock]::Create((Get-Command Test-NativeReadInputFiles -CommandType Function).ScriptBlock.ToString())
    $step='bundle-positive-verify'
    $value=& $verifier $InputRoot $reader
    $positiveScalar=$value -is [pscustomobject] -and $value -isnot [array]
    if(($value.files -is [int] -or $value.files -is [long]) -and $value.files -ge 0 -and $value.files -le 30000) { $positiveFiles=[long]$value.files }
    if(($value.bytes -is [int] -or $value.bytes -is [long]) -and $value.bytes -ge 0 -and $value.bytes -le 1800MB) { $positiveBytes=[long]$value.bytes }
    $step='bundle-positive-result'
    if($value.files -ne 2 -or $value.bytes -ne 7) { throw 'fixture-bundle-positive' };$cases++
    $manifest=Join-Path $InputRoot 'input-manifest.json';$original=[IO.File]::ReadAllText($manifest)
    $first=Join-Path $InputRoot 'one.bin';$originalBytes=[IO.File]::ReadAllBytes($first)
    foreach($mode in @('same-size-hash-change','wrong-size','path-escape')) {
      $step='bundle-mutate-'+$mode
      switch($mode) {
        'same-size-hash-change' { [IO.File]::WriteAllBytes($first,[byte[]]@(9,9,9)) }
        'wrong-size' { [IO.File]::WriteAllText($manifest,[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'wrong-size.json')),[Text.UTF8Encoding]::new($false)) }
        'path-escape' { [IO.File]::WriteAllText($manifest,[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'path-escape.json')),[Text.UTF8Encoding]::new($false)) }
      }
      if($mode -ceq 'same-size-hash-change' -and [IO.File]::ReadAllText($manifest) -cne $original) { throw 'fixture-bundle-hash-manifest-changed' }
      $step='bundle-shape-'+$mode
      [void](& ([scriptblock]::Create($reader)) ([IO.File]::ReadAllText($manifest)))
      $refused=$false;$step='bundle-refuse-'+$mode
      try { [void](& $verifier $InputRoot $reader) }
      catch {
        $refusalCode=switch -CaseSensitive ($_.Exception.Message) {
          'Input manifest mismatch' {'input-mismatch'}
          'Native input manifest refused' {'manifest-shape'}
          'Input file count budget' {'file-count'}
          'Guest input links refused' {'input-links'}
          'Input manifest budget' {'manifest-budget'}
          'Native input verifier refused' {'verifier-input'}
          default {'other-refusal'}
        }
        if($_.Exception.Message -cne 'Input manifest mismatch') { throw 'fixture-bundle-refusal-code' };$refused=$true
      }
      finally { [IO.File]::WriteAllBytes($first,$originalBytes);[IO.File]::WriteAllText($manifest,$original,[Text.UTF8Encoding]::new($false)) }
      if(-not $refused) { throw 'fixture-bundle-mutation-survived' };$cases++
    }
  } elseif($Scenario -ceq 'task') {
    $step='task-observations'
    $entry=[scriptblock]::Create((Get-Command Get-NativeReadTaskObservation -CommandType Function).ScriptBlock.ToString())
    $baseline=[datetime]'2026-10-24T00:00:00Z';$launch=[datetime]'2026-10-24T01:00:00Z'
    $stamp=$launch.ToUniversalTime().Ticks.ToString()
    $samples=@(
      @{state='Ready';run=$baseline;result=1;seen=$false;stable=$true;started=$false;terminal=$false},
      @{state='Queued';run=$baseline;result=0;seen=$false;stable=$true;started=$false;terminal=$false},
      @{state='Running';run=$baseline;result=0x41301;seen=$false;stable=$true;started=$false;terminal=$false},
      @{state='Running';run=$launch;result=0x41301;seen=$false;stable=$true;started=$true;terminal=$false},
      @{state='Queued';run=$launch;result=0x41325;seen=$false;stable=$true;started=$true;terminal=$false},
      @{state='Ready';run=$launch;result=1;seen=$false;stable=$true;started=$true;terminal=$false},
      @{state='Ready';run=$launch;result=0;seen=$false;stable=$true;started=$true;terminal=$false},
      @{state='Disabled';run=$launch;result=2147942405;seen=$false;stable=$true;started=$true;terminal=$false},
      @{state='Ready';run=$launch.AddSeconds(-1);result=1;seen=$false;stable=$true;started=$false;terminal=$false},
      @{state='Ready';run=$baseline;result=1;seen=$true;stable=$true;started=$true;terminal=$false},
      @{state='Ready';run=$launch;result=1;seen=$false;stable=$false;started=$true;terminal=$false},
      @{state='Ready';run=$launch;result=0x41301;seen=$false;stable=$true;started=$true;terminal=$false},
      @{state='Ready';run=$launch;result=0x41325;seen=$false;stable=$true;started=$true;terminal=$false},
      @{state='Ready';run=$launch;result=0x41303;seen=$false;stable=$true;started=$true;terminal=$false},
      @{state='Ready';run=$launch;result=1;seen=$true;stable=$true;previous=($stamp+':Ready:1');started=$true;terminal=$true},
      @{state='Ready';run=$launch;result=0;seen=$true;stable=$true;previous=($stamp+':Ready:0');started=$true;terminal=$true},
      @{state='Disabled';run=$launch;result=2147942405;seen=$true;stable=$true;previous=($stamp+':Disabled:2147942405');started=$true;terminal=$true},
      @{state='Ready';run=$launch;result=1;seen=$true;stable=$true;previous=($stamp+':Ready:0');started=$true;terminal=$false}
    )
    foreach($sample in $samples) {
      $previous=if($sample.ContainsKey('previous')){$sample.previous}else{$null}
      $value=& $entry $sample.state $sample.run $sample.result $launch $baseline $sample.seen $sample.stable $previous
      if($value.started -isnot [bool] -or $value.terminal -isnot [bool] -or $value.started -ne $sample.started -or $value.terminal -ne $sample.terminal -or $value.lastTaskResult -ne $sample.result -or $value.state -cne $sample.state) { throw 'fixture-task-classification' };$cases++
    }
    $refused=$false
    try { [void](& $entry 'Unexpected' $launch 1 $launch $baseline $false $true) }
    catch { if($_.Exception.Message -cne 'Native task observation refused') { throw 'fixture-task-refusal-code' };$refused=$true }
    if(-not $refused) { throw 'fixture-task-unknown-state' };$cases++
  } else { throw 'fixture-feedback-scenario' }
  @{status='PASS';version=$PSVersionTable.PSVersion.ToString();scenario=$Scenario;cases=$cases} | ConvertTo-Json -Compress
} catch {
  $knownKinds=@('RuntimeException','MethodInvocationException','MethodException','PropertyNotFoundException','ItemNotFoundException','ParameterBindingException','ArgumentException','ArgumentNullException','PathTooLongException','IOException','UnauthorizedAccessException','InvalidCastException')
  $kind=$_.Exception.GetType().Name;$inner=$_.Exception;$depth=0
  while($null -ne $inner.InnerException -and $depth -lt 8) { $inner=$inner.InnerException;$depth++ }
  $innerKind=$inner.GetType().Name;$line=$_.InvocationInfo.ScriptLineNumber
  $reason=switch -CaseSensitive ($_.Exception.Message) {
    'fixture-bundle-positive' {'positive-count'}
    'fixture-bundle-hash-manifest-changed' {'hash-fixture-changed'}
    'fixture-bundle-refusal-code' {'unexpected-refusal'}
    'fixture-bundle-mutation-survived' {'guard-survived'}
    'Native input manifest refused' {'manifest-shape'}
    'Input manifest mismatch' {'input-mismatch'}
    'Native input verifier refused' {'verifier-input'}
    default {'operation-refused'}
  }
  @{status='FAIL';code='native-feedback-fixture-refused';scenario=$Scenario;step=$step;cases=$cases;reason=$reason;refusalCode=$refusalCode;exceptionKind=$(if($kind -cin $knownKinds){$kind}else{'other'});innerKind=$(if($innerKind -cin $knownKinds){$innerKind}else{'other'});line=$(if($line -ge 1 -and $line -le 4096){[int]$line}else{0});hResult=$inner.HResult;positiveScalar=$positiveScalar;positiveFiles=$positiveFiles;positiveBytes=$positiveBytes} | ConvertTo-Json -Compress
  exit 2
}
`,
  );
  const result = spawnSync(
    path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      script,
      '-Source',
      root,
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
  const receipt = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
  expect(result.status, JSON.stringify(receipt)).toBe(0);
  return receipt;
}

describe.skipIf(process.platform !== 'win32')(
  'native guest trusted execution under Restricted policy',
  () => {
    it.each([
      ['bundle', 4],
      ['task', 19],
    ])(
      'checks actual %s feedback boundaries in Windows PowerShell 5.1',
      (scenario, cases) => {
        expect(feedbackFixture(scenario)).toMatchObject({
          status: 'PASS',
          version: expect.stringMatching(/^5\.1\./),
          scenario,
          cases,
        });
      },
      20000,
    );
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
          capabilityCases: scenario === 'runner' ? 16 : 0,
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
      const raw = fs.readFileSync(path.join(folder, 'retention-probe.log'), 'utf8');
      expect(raw.trim().split(/\r?\n/)).toHaveLength(1);
      expect(raw).not.toMatch(/#< CLIXML|<Objs\b/);
      expect(JSON.parse(raw)).toEqual(receipt);
      expect(fs.existsSync(file)).toBe(false);
      expect(fs.existsSync(path.join(fixture, '.env-after-issuer-close'))).toBe(true);
    }, 30000);
  },
);
