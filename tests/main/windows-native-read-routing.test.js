import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const folders = [];
afterEach(() => {
  for (const folder of folders.splice(0)) {
    expect(path.dirname(folder)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(folder).startsWith('aegis-native-routing-')).toBe(true);
    expect(fs.lstatSync(folder).isSymbolicLink()).toBe(false);
    fs.rmSync(folder, { recursive: true });
  }
});

function routingFixture(scenario) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-native-routing-'));
  folders.push(folder);
  const script = path.join(folder, 'fixture.ps1');
  fs.writeFileSync(
    script,
    String.raw`param([string]$Source,[string]$Scenario)
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$WarningPreference='SilentlyContinue';$cases=0
function Parse([string]$Relative) {
  $tokens=$null;$errors=$null;$value=[Management.Automation.Language.Parser]::ParseFile((Join-Path $Source $Relative),[ref]$tokens,[ref]$errors)
  if($errors.Count){throw 'fixture-source-refused'};return $value
}
function Import-Function($Ast,[string]$Name) {
  $found=@($Ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $Name},$false))
  if($found.Count -ne 1){throw 'fixture-function-refused'}
  return $found[0].Extent.Text
}
try {
  if($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1){throw 'fixture-engine-refused'}
  $hostAst=Parse 'scripts/qualification/windows-native-read-host.ps1'
  if($Scenario -cin @('cloud-success','cloud-early-failure')) {
    $cloud=Parse 'scripts/qualification/windows-native-read-cloud.ps1'
    $try=@($cloud.EndBlock.Statements | Where-Object {$_ -is [Management.Automation.Language.TryStatementAst]})
    if($try.Count -ne 1){throw 'fixture-cloud-try'}
    $statements=@($try[0].Body.Statements);$first=-1;$last=-1
    for($i=0;$i -lt $statements.Count;$i++) {
      if($statements[$i].Extent.Text.StartsWith("Stage 'observe-unchanged-native-object-capability-before-recovery'")){$first=$i}
      if($statements[$i].Extent.Text -ceq '$report.status=''PASS'''){$last=$i}
    }
    if($first -lt 0 -or $last -le $first){throw 'fixture-cloud-segment'}
    $body=($statements[$first..$last] | ForEach-Object {$_.Extent.Text}) -join [Environment]::NewLine
    $entry='try {'+[Environment]::NewLine+$body+[Environment]::NewLine+'} catch '+$try[0].CatchClauses[0].Body.Extent.Text+' finally '+$try[0].Finally.Extent.Text
    $root=$PSScriptRoot;$vmRoot=Join-Path $root 'vm';New-Item -ItemType Directory -Path $vmRoot | Out-Null
    $iso=Join-Path $root 'windows.iso';$answerIso=Join-Path $root 'answer.iso';$media=Join-Path $root 'media/answer';New-Item -ItemType Directory -Path $media | Out-Null
    foreach($file in @($iso,($iso+'.partial'),$answerIso,(Join-Path $media 'Autounattend.xml'),(Join-Path $root 'input.zip'),(Join-Path $vmRoot 'guest.vhdx'))){[IO.File]::WriteAllText($file,'inert fixture')}
    $session=$null;$consent=@();$id='00000000-0000-0000-0000-000000000001';$name='owned';$unknown=$false;$mounted=$false;$vmCreationAttempted=$true
    $script:off=$false;$script:removed=$false;$script:phases=[Collections.Generic.List[string]]::new();$script:stages=[Collections.Generic.List[string]]::new()
    $report=@{status='RUNNING';guest=@{boot='2026-10-24T00:00:00Z'};cleanup=@{offObserved=$false;removedObserved=$false;filesRemoved=@();leafObservations=@()}}
    $owner=[pscustomobject]@{PendingUnknown=$false}
    $owner | Add-Member ScriptMethod Stop {$script:off=$true;return $true}
    $owner | Add-Member ScriptMethod ObserveOff {return $script:off}
    $owner | Add-Member ScriptMethod Dispose {}
    function SaveReport {}
    function Sample($Phase) {}
    function Test-NativeReadCapability($Session) {return @{status='PASS'}}
    function Stage([string]$Label,[scriptblock]$Action) {
      [void]$script:stages.Add($Label)
      if($Label -ceq 'restart-only-exact-owned-guest-after-prepared'){$report.preparedCompletedAt='2026-10-24T00:01:00Z';return}
      if($Label -ceq 'remove-guest-only-autologon-secrets'){return}
      return & $Action
    }
    function WaitGuest($AfterRestart) {if(-not $AfterRestart){throw 'fixture-unexpected-boot'};return @{boot='2026-10-24T00:02:00Z'}}
    function Invoke-NativeReadPhase($Session,$Root,[string]$Phase,$Consent,$Id,$Name,$VmRoot) {
      [void]$script:phases.Add($Phase)
      if($Phase -ceq 'admission-preflight' -and $Scenario -ceq 'cloud-early-failure'){throw 'fixture-early-admission-refused'}
      return @{status='PASS';phase=$Phase}
    }
    function Invoke-CloudHyperVCommand($Operation,$Name,$VmRoot,$Id) {
      if($Operation -ceq 'remove'){$script:removed=$true;return @{removedCommandCompleted=$true}}
      if($Operation -cne 'observe'){throw 'fixture-unexpected-provider'};return @{state=$(if($script:off){'Off'}else{'Running'});exists=(-not $script:removed)}
    }
    . ([scriptblock]::Create($entry))
    if($Scenario -ceq 'cloud-success') {
      if(($script:phases -join ',') -cne 'admission-preflight,prepare,resume,admission' -or $report.status -cne 'PASS' -or $report.admissionPreflight.phase -cne 'admission-preflight' -or $report.admission.phase -cne 'admission'){throw 'fixture-target-first-order'}
      $restart=$script:stages.IndexOf('restart-only-exact-owned-guest-after-prepared');$pre=$script:stages.IndexOf('qualify-object-read-alert-and-risk-before-recovery');$post=$script:stages.IndexOf('qualify-real-object-read-alert-and-displayed-risk')
      if($pre -lt 0 -or $restart -le $pre -or $post -le $restart){throw 'fixture-final-admission-before-reboot'};$cases++
    } else {
      if(($script:phases -join ',') -cne 'admission-preflight' -or $report.status -cne 'FAIL' -or $report.error -cne 'fixture-early-admission-refused' -or $report.ContainsKey('preparation') -or $report.ContainsKey('admission')){throw 'fixture-early-failure-continued'};$cases++
    }
    if(-not $report.cleanup.offObserved -or -not $report.cleanup.removedObserved -or $report.cleanup.leafObservations.Count -ne 6 -or @($report.cleanup.leafObservations | Where-Object {-not $_.absentAfter}).Count){throw 'fixture-owned-cleanup-not-preserved'};$cases++
  } elseif($Scenario.StartsWith('media-', [StringComparison]::Ordinal)) {
    $cloud=Parse 'scripts/qualification/windows-native-read-cloud.ps1'
    $try=@($cloud.EndBlock.Statements | Where-Object {$_ -is [Management.Automation.Language.TryStatementAst]})
    if($try.Count -ne 1){throw 'fixture-cloud-try'}
    $selected=@($try[0].Body.Statements | Where-Object {
      $_.Extent.Text.StartsWith('$report.media=Stage ''download-pinned-microsoft-evaluation-iso''') -or
      $_.Extent.Text.StartsWith('$metadata=Stage ''verify-exact-read-only-image''') -or
      $_.Extent.Text.StartsWith("Stage 'create-exact-owned-vm'")
    })
    if($selected.Count -ne 3){throw 'fixture-media-segment'}
    $body=($selected | ForEach-Object {$_.Extent.Text}) -join [Environment]::NewLine
    $entry='try {'+[Environment]::NewLine+$body+[Environment]::NewLine+'} catch '+$try[0].CatchClauses[0].Body.Extent.Text+' finally '+$try[0].Finally.Extent.Text
    # Replace only external HTTP/image/provider boundaries. The maintained
    # stage bodies, integrity gate, diagnostic finally and cleanup execute.
    Add-Type -TypeDefinition @'
using System;
using System.IO;
public static class CloudGuestMetadata {
  public static string Mode;
  public sealed class DownloadObservation {
    public string Phase = "Read";
    public int ResponseStatusCode = 206, RequestCount = 2, ResumeRequests = 1, TransientFailures = 1;
    public long ExpectedBytes = 8225329152L, DeclaredBytes = 4096, BytesRead = 8192, BytesWritten = 8192, ReadCalls = 3;
    public long ElapsedMilliseconds = 12, LastReadMilliseconds = 10, LastWriteMilliseconds = 11;
    public bool DeadlineExpired, IntegrityVerified, Promoted;
  }
  public static string Download(string url, string destination, long expected, DownloadObservation observation) {
    File.WriteAllText(destination + ".partial", "inert partial fixture");
    if (Mode == "media-download-failure") throw new IOException("fixture-download-failed");
    if (Mode == "media-hash-failure") return new string('0', 64);
    observation.IntegrityVerified = Mode != "media-unverified";
    observation.Promoted = Mode != "media-unpromoted";
    observation.Phase = "Complete";
    File.Move(destination + ".partial", destination);
    return "bc3f24086ebadc94489066b5ad78089e2cf5c3491e90e790bb81a2b199c10e38";
  }
  public static string ImageXml(string path) { return "fixture-image"; }
}
'@
    [CloudGuestMetadata]::Mode=$Scenario
    $root=$PSScriptRoot;$vmRoot=Join-Path $root 'vm';$media=Join-Path $root 'media/answer'
    New-Item -ItemType Directory -Path $vmRoot,$media | Out-Null
    $iso=Join-Path $root 'media/windows.iso';$answerIso=Join-Path $root 'media/answer.iso'
    $canary=Join-Path $root 'preserved-receipt.json';[IO.File]::WriteAllText($canary,'preserve receipt')
    [IO.File]::WriteAllText((Join-Path $root 'input.zip'),'inert bundled fixture')
    $session=$null;$owner=$null;$consent=@();$id=$null;$name='owned';$unknown=$false;$mounted=$false;$vmCreationAttempted=$false
    $script:metadataVerified=$false;$script:created=$false;$script:removed=$false;$script:mounts=0;$script:dismounts=0
    $script:stages=[Collections.Generic.List[string]]::new();$script:saved=[Collections.Generic.List[string]]::new()
    $report=@{status='RUNNING';cleanup=@{offObserved=$false;removedObserved=$false;filesRemoved=@();leafObservations=@()};error=$null;cleanupError=$null}
    function SaveReport {[void]$script:saved.Add(($report | ConvertTo-Json -Depth 8 -Compress))}
    function Sample($Phase) {}
    function Stage([string]$Label,[scriptblock]$Action) {[void]$script:stages.Add($Label);return & $Action}
    function Mount-DiskImage($ImagePath,$Access) {
      if(-not $report.media.verifiedBeforeVmCreation -or -not $report.mediaDownload.integrityVerified -or -not $report.mediaDownload.promoted){throw 'fixture-mounted-unverified-media'}
      $script:mounts++
    }
    function Get-DiskImage($ImagePath) {return [pscustomobject]@{DriveLetter='Z'}}
    function Get-Volume {process {return $_}}
    function Get-CloudGuestImageMetadata($Xml) {
      if($Scenario -ceq 'media-metadata-failure'){throw 'fixture-image-metadata-failed'}
      $script:metadataVerified=$true;return @{index=1}
    }
    function Dismount-DiskImage($ImagePath) {$script:dismounts++}
    function Invoke-CloudHyperVCommand($Operation,$Name,$VmRoot,$Id) {
      if($Operation -ceq 'recover'){return @{exists=$false}}
      if($Operation -ceq 'create') {
        if(-not $script:metadataVerified -or -not $report.mediaDownload.integrityVerified -or -not $report.mediaDownload.promoted -or $mounted){throw 'fixture-created-before-verified-media'}
        $script:created=$true;return @{exists=$true;vmId='00000000-0000-0000-0000-000000000001'}
      }
      if($Operation -ceq 'remove'){$script:removed=$true;return @{removedCommandCompleted=$true}}
      if($Operation -ceq 'observe'){return @{state='Off';exists=(-not $script:removed)}}
      throw 'fixture-unexpected-provider'
    }
    . ([scriptblock]::Create($entry))
    $success=$Scenario -ceq 'media-success'
    if($script:created -ne $success -or $vmCreationAttempted -ne $success -or $report.cleanup.vmCreationAttempted -ne $success){throw 'fixture-media-created-on-failure'};$cases++
    if($success) {
      if($report.status -cne 'RUNNING' -or -not $report.cleanup.removedObserved -or $report.error -or ($script:stages -join ',') -cne 'download-pinned-microsoft-evaluation-iso,verify-exact-read-only-image,create-exact-owned-vm'){throw 'fixture-media-success-order'}
    } else {
      if($report.status -cne 'FAIL' -or $report.cleanup.removedObserved -or -not $report.error -or $script:stages.Contains('create-exact-owned-vm')){throw 'fixture-media-failure-continued'}
      if($Scenario -ceq 'media-metadata-failure' -and $report.error -cne 'fixture-image-metadata-failed'){throw 'fixture-metadata-failure-lost'}
    };$cases++
    $saved=@($script:saved | ForEach-Object {ConvertFrom-Json -InputObject $_} | Where-Object {$_.mediaDownload})
    if(-not $saved.Count -or $saved[0].mediaDownload.requestCount -ne 2 -or $saved[0].mediaDownload.resumeRequests -ne 1 -or $saved[0].mediaDownload.bytesWritten -ne 8192){throw 'fixture-media-diagnostic-not-persisted'};$cases++
    if($report.cleanup.offObserved -or $report.cleanup.leafObservations.Count -ne 6 -or @($report.cleanup.leafObservations | Where-Object {-not $_.absentAfter}).Count -or $report.cleanupError -or [IO.File]::ReadAllText($canary) -cne 'preserve receipt'){throw 'fixture-media-closed-cleanup-failed'};$cases++
    $expectedMounts=if($success -or $Scenario -ceq 'media-metadata-failure'){1}else{0}
    if($script:mounts -ne $expectedMounts -or $script:dismounts -ne $expectedMounts -or $mounted){throw 'fixture-media-mount-lifetime-failed'};$cases++
  } elseif($Scenario -ceq 'guest-route') {
    $guest=Parse 'scripts/qualification/windows-native-read-guest.ps1'
    $valid=@($guest.ParamBlock.Parameters[0].Attributes | Where-Object {$_.TypeName.Name -ceq 'ValidateSet'})[0].PositionalArguments | ForEach-Object {$_.Value}
    if($valid -cnotcontains 'admission-preflight'){throw 'fixture-guest-alias-refused'}
    $branch=@($guest.FindAll({param($node) $node -is [Management.Automation.Language.IfStatementAst] -and $node.Extent.Text.Contains("'scripts/qualification/windows-native-read-probe.mjs'")},$false))
    if($branch.Count -ne 1){throw 'fixture-guest-branch'}
    $context=@{sourceSha=('a'*40)};$root=$PSScriptRoot;$bundle=Join-Path $root 'input'
    $outputs=@()
    foreach($Phase in @('admission-preflight','admission','prepare','resume')) {
      $arguments=@();. ([scriptblock]::Create($branch[0].Extent.Text))
      $probe=$Phase -cin @('admission-preflight','admission')
      if($arguments[0] -cne $(if($probe){'scripts/qualification/windows-native-read-probe.mjs'}else{'tools/development/etw-reboot.mjs'})){throw 'fixture-wrong-driver'}
      $outputIndex=[array]::IndexOf($arguments,'--output');$expected=Join-Path $root ('evidence/'+$Phase)
      if($outputIndex -lt 0 -or $arguments[$outputIndex+1] -cne $expected){throw 'fixture-shared-phase-output'}
      if($probe -and ($arguments -ccontains '--phase' -or $arguments -ccontains '--prepared')){throw 'fixture-probe-arguments'}
      $outputs+=@($arguments[$outputIndex+1]);$cases++
    }
    if(@($outputs | Select-Object -Unique).Count -ne 4){throw 'fixture-not-fresh-phase-outputs'}
  } elseif($Scenario -ceq 'host-entry') {
    foreach($name in @('Get-NativeReadPhaseInvocation','Get-NativeReadPhaseCommand')){. ([scriptblock]::Create((Import-Function $hostAst $name)))}
    $path=Join-Path $PSScriptRoot 'fixed-guest.ps1';[IO.File]::WriteAllText($path,'param([string]$Phase) return ("entered:"+$Phase)',[Text.UTF8Encoding]::new($false));$sha=[Security.Cryptography.SHA256]::Create();try{$hash=[BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($path))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
    $definition=Import-Function $hostAst 'Get-NativeReadPhaseInvocation'
    if([regex]::Matches($definition,[regex]::Escape("'C:\aegis-native-read\input\guest.ps1'")).Count -ne 1){throw 'fixture-fixed-entry-path'}
    . ([scriptblock]::Create($definition.Replace("'C:\aegis-native-read\input\guest.ps1'",("'"+$path.Replace("'","''")+"'"))))
    foreach($phase in @('admission-preflight','prepare','resume','admission')) {
      $encoded=Get-NativeReadPhaseCommand $phase $hash;$value=& ([scriptblock]::Create([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($encoded))))
      if($value -cne ('entered:'+$phase)){throw 'fixture-alias-entry-failed'};$cases++
    }
    $refused=$false;try{[void](Get-NativeReadPhaseCommand 'admission-preflight-other' $hash)}catch{if($_.Exception.Message -cne 'Native phase entry refused'){throw};$refused=$true}
    if(-not $refused){throw 'fixture-arbitrary-phase-accepted'};$cases++
    $phaseAst=@($hostAst.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-NativeReadPhase'},$false))[0]
    $guard=$phaseAst.Body.EndBlock.Statements[0].Extent.Text
    $Phase='admission-preflight';. ([scriptblock]::Create($guard));$cases++
    $capture=@($hostAst.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Save-NativeReadCapture'},$false))[0]
    $purpose=@($capture.Parameters | Where-Object {$_.Name.VariablePath.UserPath -ceq 'Purpose'})[0]
    $purposeValues=@($purpose.Attributes | Where-Object {$_.TypeName.Name -ceq 'ValidateSet'})[0].PositionalArguments | ForEach-Object {$_.Value}
    if($purposeValues -cnotcontains 'admission-preflight'){throw 'fixture-capture-alias-refused'};$cases++
  } elseif($Scenario -ceq 'evidence') {
    . ([scriptblock]::Create((Import-Function $hostAst 'Copy-NativeReadEvidence')))
    $script:seen=[Collections.Generic.List[object]]::new()
    function Invoke-Command {param($Session,$ScriptBlock,$ArgumentList)
      if($ArgumentList){[void]$script:seen.Add(@{file=$ArgumentList[0];budget=[long]$ArgumentList[1]})};return $false
    }
    Copy-NativeReadEvidence 'mock-owned-session' $PSScriptRoot
    $expected=@(
      @{leaf='evidence\admission-preflight\receipt.json';budget=262144},@{leaf='evidence\admission-preflight\window-observation.json';budget=4096},@{leaf='evidence\admission-preflight\view.png';budget=2097152},
      @{leaf='admission-preflight-desktop.json';budget=4096},@{leaf='admission-preflight-done.json';budget=65536},@{leaf='admission-preflight.log';budget=2097152}
    )
    foreach($leaf in $expected){$matches=@($script:seen | Where-Object {$_.file -ceq ('C:\aegis-native-read\'+$leaf.leaf)});if($matches.Count -ne 1 -or $matches[0].budget -ne $leaf.budget){throw 'fixture-preflight-leaf-budget'};$cases++}
    foreach($phase in @('prepare','resume','admission')){
      $done=@($script:seen | Where-Object {$_.file -ceq ('C:\aegis-native-read\'+$phase+'-done.json')})
      $receipt=@($script:seen | Where-Object {$_.file -ceq ('C:\aegis-native-read\evidence\'+$phase+'\receipt.json')})
      if($done.Count -ne 1 -or $receipt.Count -ne 1){throw 'fixture-existing-phase-evidence-lost'}
      if($done[0].budget -ne 2097152 -or $receipt[0].budget -ne 2097152){throw 'fixture-existing-phase-budget-changed'}
    }
  } else {throw 'fixture-scenario-refused'}
  @{status='PASS';scenario=$Scenario;cases=$cases;vmExecuted=$false;nativeInputExecuted=$false;version=$PSVersionTable.PSVersion.ToString()} | ConvertTo-Json -Compress
} catch {@{status='FAIL';scenario=$Scenario;cases=$cases;code=$_.Exception.Message;line=$_.InvocationInfo.ScriptLineNumber}|ConvertTo-Json -Compress;exit 2}
`,
  );
  const result = spawnSync(
    path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-File', script, '-Source', root, '-Scenario', scenario],
    {
      cwd: folder,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 8192,
      env: {
        ...process.env,
        PSModulePath: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules'),
      },
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.stderr).toBe('');
  const receipt = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
  expect(result.status, JSON.stringify(receipt)).toBe(0);
  return receipt;
}

describe.skipIf(process.platform !== 'win32')(
  'target-first native qualification uses distinct owned phases',
  () => {
    it.each([
      ['cloud-success', 2],
      ['cloud-early-failure', 2],
      ['media-success', 5],
      ['media-download-failure', 5],
      ['media-hash-failure', 5],
      ['media-unverified', 5],
      ['media-unpromoted', 5],
      ['media-metadata-failure', 5],
      ['guest-route', 4],
      ['host-entry', 7],
      ['evidence', 6],
    ])(
      'exercises maintained %s path without VM or native input',
      (scenario, cases) => {
        expect(routingFixture(scenario)).toMatchObject({
          status: 'PASS',
          scenario,
          cases,
          vmExecuted: false,
          nativeInputExecuted: false,
          version: expect.stringMatching(/^5\.1\./),
        });
      },
      20000,
    );
  },
);
