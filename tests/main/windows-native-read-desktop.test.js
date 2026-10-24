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
    expect(path.basename(folder).startsWith('aegis-native-desktop-')).toBe(true);
    expect(fs.lstatSync(folder).isSymbolicLink()).toBe(false);
    fs.rmSync(folder, { recursive: true });
  }
});

function desktopFixture(scenario) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-native-desktop-'));
  folders.push(folder);
  const script = path.join(folder, 'fixture.ps1');
  fs.writeFileSync(
    script,
    String.raw`param([string]$Source,[string]$Scenario)
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$cases=0
try {
  if($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { throw 'fixture-engine-refused' }
  # Parse the maintained guest entry. Never dot-source its top-level driver,
  # compile its native adapter, probe a desktop, or issue real keyboard input.
  $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $Source 'scripts/qualification/windows-native-read-guest.ps1'),[ref]$tokens,[ref]$errors)
  if($errors.Count) { throw 'fixture-source-refused' }
  foreach($name in @('Assert-NativeReadDesktopScope','Invoke-NativeReadDesktopPreparation','Initialize-NativeReadDesktop')) {
    $found=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$false))
    if($found.Count -ne 1) { throw 'fixture-source-refused' }
    . ([scriptblock]::Create($found[0].Extent.Text))
  }
  function Scope {
    return @{root='C:\aegis-native-read';source='C:\aegis-native-read\source';bundle='C:\aegis-native-read\input';runner='github-hosted-hyperv-guest';githubActions='true';ci='true';runnerOS='Windows';runnerArch='X64';username='AegisSetup';interactive=$true;sessionId=2;integritySid='S-1-16-8192';sourceSha=('a'*40);expectedSourceSha=('a'*40);runId='123';attempt='1';caption='Microsoft Windows 11 Enterprise Evaluation';productType=1;build='26300';ubr=9457;architecture='AMD64'}
  }
  function Run-Case([string]$Mode,$ScopeOverride=$null) {
    $scope=if($null -eq $ScopeOverride){Scope}else{$ScopeOverride};$proof=@{};$clock=@{ms=0;read=0;sent=0;native=0;closedBeforeDesktop=$false;sentAt=@();retryReads=0;deadlineEdge=0};$refused=$false
    $read={
      $clock.read++
      $kind=if($Mode -ceq 'clear' -or ($clock.sent -gt 0 -and $Mode -cne 'stuck')){'desktop'}elseif($Mode -ceq 'search'){'search'}else{'start'}
      $retry=$Mode.StartsWith('search-')
      if($retry){
        $kind='search'
        if(($Mode -ceq 'search-two' -and $clock.sent -ge 2) -or ($Mode -ceq 'search-three' -and $clock.sent -ge 3) -or ($Mode -ceq 'search-before-retry' -and $clock.sent -gt 0 -and $clock.ms -ge 1000) -or ($Mode -ceq 'search-null-transient' -and $clock.sent -ge 2)){$kind='desktop'}
        if($clock.sent -gt 0 -and $clock.ms -ge 1000){$clock.retryReads++}
        if($Mode -ceq 'search-deadline-edge' -and $clock.sent -gt 0 -and $clock.ms -ge 1000 -and $clock.deadlineEdge -eq 0){$clock.deadlineEdge=1}
        if($Mode -ceq 'search-read-deadline' -and $clock.sent -gt 0 -and $clock.ms -ge 1000){$clock.ms=10000}
      }
      $witness=if($kind -ceq 'desktop'){'desktop-witness'}else{'overlay-witness'}
      if($Mode -ceq 'changed' -and $clock.read -eq 2){$witness='replacement-witness'}
      $none=$clock.sent -gt 0 -and ($Mode -ceq 'zero-stuck' -or ($Mode -ceq 'zero-transient' -and $clock.read -eq 3))
      if($Mode -ceq 'search-null' -and $clock.sent -gt 0){$none=$true}
      if($Mode -ceq 'search-null-transient' -and $clock.sent -eq 1 -and $clock.ms -ge 900 -and $clock.ms -lt 1100){$none=$true}
      $race=$retry -and $clock.sent -gt 0 -and $clock.ms -ge 1000
      if($Mode -ceq 'search-witness-race' -and $clock.retryReads -ge 2){$witness='replacement-witness'}
      if($Mode -ceq 'search-kind-race' -and $clock.retryReads -ge 2){$kind='start'}
      if($Mode -ceq 'search-unknown-race' -and $race){$kind='unknown'}
      return @{noConsent=($Mode -cne 'consent' -and -not ($Mode -ceq 'consent-race' -and $clock.read -eq 2) -and -not ($Mode -ceq 'search-consent-race' -and $race));activeDefault=($Mode -cne 'secure' -and -not ($Mode -ceq 'search-default-race' -and $race));noForeground=$none;sameSession=($Mode -cne 'session' -and -not ($Mode -ceq 'search-session-race' -and $race));ownerVerified=($Mode -cne 'unsigned' -and -not ($Mode -ceq 'search-unsigned-race' -and $race));kind=$(if($none){'none'}elseif($Mode -ceq 'unknown'){'unknown'}else{$kind});witness=$(if($none){$null}else{$witness})}
    }
    $dismiss={param($Expected)
      if($Expected.witness -cne 'overlay-witness' -or $Expected.kind -cnotin @('start','search')) { throw 'fixture-wrong-input-target' }
      if($Mode.StartsWith('search-') -and @($proof.overlayDismissals | Where-Object {$_.closedObserved}).Count) { $clock.closedBeforeDesktop=$true }
      $clock.sentAt+=@($clock.ms);$clock.sent++
      if($Mode -ceq 'search-send-deadline'){$clock.ms=10000}
      return $(if($Mode -ceq 'input-short' -or ($Mode -ceq 'search-retry-short' -and $clock.sent -eq 2)){1}else{2})
    }
    $elapsed={
      # Cross the hard deadline between the full sample's post-read and slice checks.
      if($Mode -ceq 'search-deadline-edge' -and $clock.deadlineEdge -eq 1){$clock.deadlineEdge=2;$clock.ms=9999}
      elseif($Mode -ceq 'search-deadline-edge' -and $clock.deadlineEdge -eq 2){$clock.deadlineEdge=3;$clock.ms=10000}
      return $clock.ms
    }
    try { Invoke-NativeReadDesktopPreparation $scope $proof $read $dismiss -Elapsed $elapsed -Pause {param($Milliseconds) $clock.ms+=$Milliseconds} }
    catch { if($_.Exception.Message -cnotin @('Native desktop precondition refused','Native desktop scope refused')){throw};$refused=$true }
    return @{proof=$proof;clock=$clock;refused=$refused}
  }
  if($Scenario -ceq 'positive') {
    foreach($mode in @('start','search','zero-transient')) {
      $value=Run-Case $mode
      if($value.refused -or $value.proof.status -cne 'READY' -or $value.proof.scopeVerified -ne $true -or $value.proof.activeDefaultObserved -ne $true -or $value.proof.noConsentObserved -ne $true -or $value.clock.sent -ne 1 -or $value.clock.read -lt 4 -or $value.proof.overlayDismissals.Count -ne 1 -or $value.proof.overlayDismissals[0].closedObserved -ne $true -or $value.proof.overlayDismissals[0].ownerRevalidated -ne $true) { throw 'fixture-positive-refused' }
      if($mode -ceq 'zero-transient' -and ($value.proof.noForegroundPolls -ne 1 -or $value.clock.ms -ne 100)) { throw 'fixture-zero-transition' };$cases++
    }
    $value=Run-Case 'clear'
    if($value.refused -or $value.proof.status -cne 'READY' -or $value.clock.read -ne 1 -or $value.clock.sent -ne 0 -or $value.proof.overlayDismissals.Count -ne 0) { throw 'fixture-clear-input' };$cases++
    # Execute the actual entry's preparation/persistence segment, with only the
    # native initializer replaced. The later Node driver remains an inert marker.
    $initial=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$result.desktopPreparation'},$true))
    $nodeEntry=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$node'},$true))
    if($initial.Count -ne 1 -or $nodeEntry.Count -ne 1 -or $initial[0].Extent.StartOffset -ge $nodeEntry[0].Extent.StartOffset) { throw 'fixture-entry-order' }
    $entryText=[IO.File]::ReadAllText((Join-Path $Source 'scripts/qualification/windows-native-read-guest.ps1'))
    $entry=[scriptblock]::Create($entryText.Substring($initial[0].Extent.StartOffset,$nodeEntry[0].Extent.StartOffset-$initial[0].Extent.StartOffset))
    function Initialize-NativeReadDesktop($Scope,$Proof) {
      [void]$script:order.Add('preparation');$Proof.status=if($entryMode -ceq 'ready'){'READY'}else{'FAIL'}
      if($entryMode -cne 'ready') { $Proof.code='mock-refusal';throw 'fixture-initializer-failure' }
    }
    foreach($entryMode in @('ready','fail')) {
      $Phase=if($entryMode -ceq 'ready'){'prepare'}else{'resume'};$root=$PSScriptRoot;$source=$Source;$bundle=$PSScriptRoot
      $result=@{sessionId=2;integritySid='S-1-16-8192'};$context=@{sourceSha=('a'*40);runId='123';attempt='1'};$os=@{Caption='Windows 11';ProductType=1;BuildNumber='26300'};$current=@{UBR=9457};$script:order=[Collections.Generic.List[string]]::new();$declined=$false
      try { . $entry } catch { if($entryMode -ceq 'ready' -or $_.Exception.Message -cne 'fixture-initializer-failure'){throw};$declined=$true }
      $proofFile=Join-Path $PSScriptRoot ($Phase+'-desktop.json')
      if(-not (Test-Path -LiteralPath $proofFile) -or (Get-Item -LiteralPath $proofFile).Length -gt 4096) { throw 'fixture-entry-proof-missing' }
      $retained=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($proofFile))
      if($retained.status -cne $(if($entryMode -ceq 'ready'){'READY'}else{'FAIL'}) -or $script:order.Count -ne 1 -or $script:order[0] -cne 'preparation' -or $declined -ne ($entryMode -ceq 'fail')) { throw 'fixture-entry-proof-order' }
      if($entryMode -ceq 'ready') { [void]$script:order.Add('node-marker') }
      if($entryMode -ceq 'fail' -and $script:order.Count -ne 1) { throw 'fixture-node-after-refusal' };$cases++
    }
  } elseif($Scenario -ceq 'search-retry') {
    foreach($mode in @('search-two','search-three','search-null-transient','search-before-retry')){
      $value=Run-Case $mode;$expected=if($mode -ceq 'search-three'){3}elseif($mode -ceq 'search-before-retry'){1}else{2}
      $failureObservation=@{mode=$mode;status=$value.proof.status;code=$value.proof.code;sent=$value.clock.sent;elapsedMs=$value.clock.ms;dismissals=$value.proof.overlayDismissals.Count;firstKind=$value.proof.overlayDismissals[0].kind;firstClosed=$value.proof.overlayDismissals[0].closedObserved}
      if($value.refused -or $value.proof.status -cne 'READY' -or $value.clock.sent -ne $expected -or $value.clock.ms -le 0 -or $value.clock.ms -ge 10000 -or $value.clock.closedBeforeDesktop -ne $false -or $value.proof.overlayDismissals.Count -ne $expected -or $value.proof.activeDefaultObserved -ne $true -or $value.proof.noConsentObserved -ne $true){throw 'fixture-search-retry-refused'}
      foreach($fact in $value.proof.overlayDismissals){if($fact.Keys.Count -ne 5 -or $fact.kind -cne 'search' -or $fact.ownerRevalidated -ne $true -or $fact.activeDefaultObserved -ne $true -or $fact.inputEvents -ne 2 -or $fact.closedObserved -ne $true){throw 'fixture-search-closure-record'}}
      if($expected -gt 1 -and $value.clock.sentAt[1] -lt 1000){throw 'fixture-search-retry-too-early'}
      if($expected -eq 3 -and $value.clock.sentAt[2]-$value.clock.sentAt[1] -lt 1000){throw 'fixture-third-search-too-early'}
      if($mode -ceq 'search-null-transient' -and ($value.proof.noForegroundPolls -lt 1 -or $value.clock.sentAt[1] -lt 1100)){throw 'fixture-null-input-authority'};$cases++
    }
  } elseif($Scenario -ceq 'search-deadline-edge') {
    $value=Run-Case 'search-deadline-edge'
    $closed=@($value.proof.overlayDismissals | Where-Object {$_.closedObserved}).Count
    $failureObservation=@{status=$value.proof.status;code=$value.proof.code;sent=$value.clock.sent;elapsedMs=$value.clock.ms;dismissals=$value.proof.overlayDismissals.Count;closedFacts=$closed}
    if(-not $value.refused -or $value.proof.status -cne 'FAIL' -or $value.proof.code -cne 'deadline' -or $value.clock.sent -ne 1 -or $value.clock.ms -ne 10000 -or $value.proof.overlayDismissals.Count -ne 1 -or $closed -ne 0 -or $value.proof.activeDefaultObserved -eq $true -or $value.proof.noConsentObserved -eq $true){throw 'fixture-deadline-false-closure'};$cases++
  } elseif($Scenario -ceq 'search-guards') {
    foreach($mode in @('search-stuck','search-null','search-consent-race','search-default-race','search-session-race','search-unsigned-race','search-unknown-race','search-witness-race','search-kind-race','search-read-deadline','search-send-deadline','search-retry-short')){
      $value=Run-Case $mode;$expected=if($mode -ceq 'search-stuck'){3}elseif($mode -ceq 'search-retry-short'){2}else{1}
      $failureObservation=@{mode=$mode;status=$value.proof.status;code=$value.proof.code;sent=$value.clock.sent;elapsedMs=$value.clock.ms;dismissals=$value.proof.overlayDismissals.Count}
      if(-not $value.refused -or $value.proof.status -cne 'FAIL' -or $value.clock.sent -ne $expected -or $value.clock.ms -gt 10000 -or $value.proof.activeDefaultObserved -eq $true -or $value.proof.noConsentObserved -eq $true){throw 'fixture-search-guard-input'}
      foreach($fact in $value.proof.overlayDismissals){if($fact.Keys.Count -ne 5 -or $fact.kind -cne 'search' -or $fact.ownerRevalidated -ne $true -or $fact.activeDefaultObserved -ne $true -or $fact.inputEvents -ne 2 -or $fact.closedObserved -ne $false){throw 'fixture-search-false-closure'}}
      if($mode -ceq 'search-stuck' -and ($value.clock.ms -ne 10000 -or $value.proof.code -cne 'overlay-not-closed' -or $value.proof.overlayDismissals.Count -ne 3)){throw 'fixture-search-stuck-record'}
      if($mode -ceq 'search-null' -and ($value.clock.ms -ne 10000 -or $value.proof.overlayDismissals.Count -ne 1 -or $value.proof.noForegroundPolls -lt 1)){throw 'fixture-null-closure'}
      if($mode -cin @('search-read-deadline','search-send-deadline') -and ($value.clock.ms -ne 10000 -or $value.proof.code -cne 'deadline')){throw 'fixture-search-global-deadline'};$cases++
    }
  } elseif($Scenario -ceq 'refusal') {
    foreach($mode in @('secure','consent','consent-race','session','unsigned','unknown','changed')) {
      $value=Run-Case $mode
      if(-not $value.refused -or $value.proof.status -cne 'FAIL' -or $value.clock.sent -ne 0) { throw 'fixture-refusal-input' };$cases++
    }
  } elseif($Scenario -ceq 'closure') {
    foreach($mode in @('stuck','zero-stuck','input-short')) {
      $value=Run-Case $mode
      if(-not $value.refused -or $value.proof.status -cne 'FAIL' -or $value.clock.sent -ne 1 -or $value.proof.activeDefaultObserved -eq $true) { throw 'fixture-closure-accepted' }
      if($mode -cin @('stuck','zero-stuck') -and ($value.clock.ms -ne 10000 -or $value.proof.overlayDismissals[0].closedObserved -ne $false)) { throw 'fixture-closure-budget' };$cases++
    }
  } elseif($Scenario -ceq 'scope') {
    $mutations=@(@{key='root';value='C:\other'},@{key='source';value='C:\other'},@{key='runner';value='github-hosted'},@{key='username';value='personal'},@{key='interactive';value=$false},@{key='sessionId';value=0},@{key='integritySid';value='S-1-16-12288'},@{key='sourceSha';value=('b'*40)},@{key='runId';value='local'},@{key='caption';value='Windows Server'},@{key='ubr';value=9458},@{key='architecture';value='ARM64'})
    foreach($mutation in $mutations) {
      $scope=Scope;$scope[$mutation.key]=$mutation.value;$value=Run-Case 'start' $scope
      if(-not $value.refused -or $value.clock.read -ne 0 -or $value.clock.sent -ne 0) { throw 'fixture-scope-input' };$cases++
    }
    # The actual native-wrapper guard must run before even Add-Type is reached.
    $scope=Scope;$scope.runner='local';$script:compileCalls=0
    function Add-Type { $script:compileCalls++;throw 'fixture-native-adapter-reached' }
    $denied=$false
    try { Initialize-NativeReadDesktop $scope @{} } catch { if($_.Exception.Message -cne 'Native desktop scope refused'){throw};$denied=$true }
    if(-not $denied -or $script:compileCalls -ne 0) { throw 'fixture-native-before-scope' };$cases++
    $scope=Scope;$denied=$false
    try { Initialize-NativeReadDesktop $scope @{} } catch { if($_.Exception.Message -cne 'Native desktop scope refused'){throw};$denied=$true }
    if(-not $denied -or $script:compileCalls -ne 0) { throw 'fixture-native-on-primary' };$cases++
  } else { throw 'fixture-scenario-refused' }
  @{status='PASS';scenario=$Scenario;cases=$cases;nativeDesktopExecuted=$false;keyboardInputExecuted=$false;version=$PSVersionTable.PSVersion.ToString()} | ConvertTo-Json -Compress
} catch { @{status='FAIL';code='native-desktop-fixture-refused';scenario=$Scenario;cases=$cases;line=$_.InvocationInfo.ScriptLineNumber;observation=$failureObservation} | ConvertTo-Json -Depth 4 -Compress;exit 2 }
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
  'normal native guest desktop precondition with mocked Win32/input',
  () => {
    it.each([
      ['positive', 6],
      ['search-retry', 4],
      ['search-deadline-edge', 1],
      ['search-guards', 12],
      ['refusal', 7],
      ['closure', 3],
      ['scope', 14],
    ])(
      'exercises actual %s decision path without accessing the primary desktop',
      (scenario, cases) => {
        expect(desktopFixture(scenario)).toMatchObject({
          status: 'PASS',
          scenario,
          cases,
          nativeDesktopExecuted: false,
          keyboardInputExecuted: false,
          version: expect.stringMatching(/^5\.1\./),
        });
      },
      20000,
    );
  },
);
