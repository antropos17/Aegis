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
    expect(path.basename(folder).startsWith('aegis-native-visibility-')).toBe(true);
    expect(fs.lstatSync(folder).isSymbolicLink()).toBe(false);
    fs.rmSync(folder, { recursive: true });
  }
});

function visibilityFixture(scenario) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-native-visibility-'));
  folders.push(folder);
  const script = path.join(folder, 'fixture.ps1');
  fs.writeFileSync(
    script,
    String.raw`param([string]$Source,[string]$Scenario)
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$observation=$null;$cases=0
try {
  if($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1){throw 'fixture-engine-refused'}
  $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $Source 'scripts/qualification/windows-native-read-guest.ps1'),[ref]$tokens,[ref]$errors)
  if($errors.Count){throw 'fixture-source-refused'}
  if($Scenario -ceq 'compile-only'){
    $blocks=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.StringConstantExpressionAst] -and $node.Value.Contains('public static class NativeReadDesktop')},$true))
    if($blocks.Count -ne 1){throw 'fixture-inline-native-source-refused'}
    # Compile the exact maintained C# only. No constructor, Probe, Escape or
    # visibility method is invoked, and the guest entry is never executed.
    Microsoft.PowerShell.Utility\Add-Type -TypeDefinition $blocks[0].Value -ErrorAction Stop
    @{status='PASS';scenario=$Scenario;cases=1;compiledOnly=$true;nativeMethodsInvoked=$false;keyboardInputExecuted=$false;version=$PSVersionTable.PSVersion.ToString()} | ConvertTo-Json -Compress
    return
  }
  foreach($name in @('Assert-NativeReadDesktopScope','Read-NativeReadDesktopObservation','Test-NativeReadNonPresentedSearch','Invoke-NativeReadDesktopPreparation')){
    $found=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$false))
    # Optional only for the pre-implementation RED: the old policy must execute
    # normally and fail its missing diagnostic assertion, not an import guard.
    if($name -ceq 'Read-NativeReadDesktopObservation' -and $found.Count -eq 0){continue}
    if($found.Count -ne 1){throw 'fixture-source-refused'};. ([scriptblock]::Create($found[0].Extent.Text))
  }
  function Add-Type {throw 'fixture-native-adapter-forbidden'}
  function Scope {
    return @{root='C:\aegis-native-read';source='C:\aegis-native-read\source';bundle='C:\aegis-native-read\input';runner='github-hosted-hyperv-guest';githubActions='true';ci='true';runnerOS='Windows';runnerArch='X64';username='AegisSetup';interactive=$true;sessionId=2;integritySid='S-1-16-8192';sourceSha=('a'*40);expectedSourceSha=('a'*40);runId='123';attempt='1';caption='Windows 11';productType=1;build='26300';ubr=9457;architecture='AMD64'}
  }
  $keys=@('windowExists','visibleStyle','cloakKnown','cloaked','boundsKnown','nonEmptyBounds','onMonitor','stillForeground')
  function Visibility([string]$Mode){
    $value=@{windowExists=$true;visibleStyle=$true;cloakKnown=$true;cloaked=$false;boundsKnown=$true;nonEmptyBounds=$true;onMonitor=$true;stillForeground=$true}
    switch -CaseSensitive ($Mode) {
      'hidden' {$value.visibleStyle=$false}
      'cloaked' {$value.cloaked=$true}
      'unknown' {$value=@{windowExists=$null;visibleStyle=$null;cloakKnown=$false;cloaked=$null;boundsKnown=$false;nonEmptyBounds=$null;onMonitor=$null;stillForeground=$null}}
      'query-failure' {$value.cloakKnown=$false;$value.cloaked=$null;$value.boundsKnown=$false;$value.nonEmptyBounds=$null;$value.onMonitor=$null}
      'invalid' {$value.windowExists=$false;$value.visibleStyle=$false;$value.cloakKnown=$false;$value.cloaked=$null;$value.boundsKnown=$false;$value.nonEmptyBounds=$null;$value.onMonitor=$false;$value.stillForeground=$false}
      'lost-foreground' {$value.stillForeground=$false}
    }
    $value.pid=919191;$value.hwnd='PRIVATE_VISIBILITY_CANARY';$value.path='PRIVATE_VISIBILITY_CANARY';$value.coordinates=@(1,2,3,4);$value.rawError='PRIVATE_VISIBILITY_CANARY'
    return $value
  }
  function Check-Snapshot($Snapshot){
    if($null -eq $Snapshot -or $Snapshot.Keys.Count -ne 8 -or @($keys | Where-Object {-not $Snapshot.ContainsKey($_)}).Count){throw 'fixture-visibility-schema'}
    foreach($key in @('windowExists','visibleStyle','onMonitor','stillForeground')){if($null -ne $Snapshot[$key] -and $Snapshot[$key] -isnot [bool]){throw 'fixture-visibility-type'}}
    foreach($pair in @(@('cloakKnown','cloaked'),@('boundsKnown','nonEmptyBounds'))){
      if($Snapshot[$pair[0]] -isnot [bool]){throw 'fixture-visibility-marker'}
      if($Snapshot[$pair[0]]){if($Snapshot[$pair[1]] -isnot [bool]){throw 'fixture-visibility-known'}}
      elseif($null -ne $Snapshot[$pair[1]]){throw 'fixture-visibility-unknown'}
    }
  }
  function Check-Proof($Proof){
    if(-not $Proof.ContainsKey('windowVisibility')){throw 'fixture-window-visibility-missing'}
    $value=$Proof.windowVisibility
    if($value.Keys.Count -ne 3 -or -not $value.ContainsKey('samples') -or -not $value.ContainsKey('first') -or -not $value.ContainsKey('last') -or $value.samples -lt 1 -or $value.samples -gt 512){throw 'fixture-visibility-bounds'}
    Check-Snapshot $value.first;Check-Snapshot $value.last
    $json=$Proof | ConvertTo-Json -Depth 8 -Compress
    if($json.Contains('PRIVATE_VISIBILITY_CANARY') -or [Text.Encoding]::UTF8.GetByteCount($json) -gt 4096){throw 'fixture-visibility-privacy-budget'}
  }
  function Run-Case([string]$Mode){
    $scope=Scope;$proof=@{};$clock=@{ms=0;read=0;sent=0};$refused=$false
    $read={
      $clock.read++
      if($Mode -ceq 'late-error' -and $clock.read -eq 4){throw 'PRIVATE_VISIBILITY_CANARY'}
      $visibility=Visibility $Mode
      if(($Mode -ceq 'bounded' -and $clock.read -gt 512) -or ($Mode -cin @('late-error','late-deadline') -and $clock.read -ge 3)){$visibility.visibleStyle=$false}
      if($Mode -ceq 'late-deadline' -and $clock.read -eq 3){$clock.ms=10000}
      $kind=if($Mode -ceq 'ready' -or ($Mode -ceq 'closes' -and $clock.sent -gt 0)){'desktop'}elseif($Mode -ceq 'guard-unknown'){'unknown'}else{'search'}
      return @{noConsent=($Mode -cne 'guard-consent');activeDefault=($Mode -cne 'guard-default');noForeground=$false;ownerVerified=($Mode -cne 'guard-owner');sameSession=$true;kind=$kind;witness=$(if($kind -ceq 'desktop'){'owned-desktop-witness'}else{'owned-search-witness'});windowVisibility=$visibility}
    }
    $dismiss={param($Expected) if($Expected.kind -cne 'search' -or $Expected.witness -cne 'owned-search-witness'){throw 'fixture-input-target'};$clock.sent++;return 2}
    try {Invoke-NativeReadDesktopPreparation $scope $proof $read $dismiss -Elapsed {$clock.ms} -Pause {param($Milliseconds) $clock.ms+=$(if($Mode -ceq 'bounded'){10}else{$Milliseconds})}}
    catch {if($_.Exception.Message -cne 'Native desktop precondition refused' -and -not ($Mode -ceq 'late-error' -and $_.Exception.Message -ceq 'PRIVATE_VISIBILITY_CANARY')){throw};$refused=$true}
    return @{proof=$proof;clock=$clock;refused=$refused}
  }
  if($Scenario -cin @('visible','hidden','cloaked','unknown','query-failure','invalid','lost-foreground')){
    $value=Run-Case $Scenario;$proof=$value.proof
    $observation=@{status=$proof.status;code=$proof.code;sent=$value.clock.sent;elapsedMs=$value.clock.ms;closedFacts=@($proof.overlayDismissals | Where-Object {$_.closedObserved}).Count;visibilityPresent=$proof.ContainsKey('windowVisibility')}
    $expectedCode=if($Scenario -ceq 'cloaked'){'deadline'}else{'overlay-not-closed'};$expectedSent=if($Scenario -ceq 'cloaked'){0}else{3}
    if(-not $value.refused -or $proof.status -cne 'FAIL' -or $proof.code -cne $expectedCode -or $value.clock.sent -ne $expectedSent -or $value.clock.ms -ne 10000 -or $observation.closedFacts -ne 0){throw 'fixture-existing-search-contract-changed'}
    Check-Proof $proof
    $expected=Visibility $Scenario
    foreach($key in $keys){if($proof.windowVisibility.first[$key] -cne $expected[$key] -or $proof.windowVisibility.last[$key] -cne $expected[$key]){throw 'fixture-visibility-state-changed'}}
    if($proof.windowVisibility.samples -ne [Math]::Min(512,$value.clock.read)){throw 'fixture-visibility-sample-count'};$cases++
  } elseif($Scenario -ceq 'baseline'){
    foreach($mode in @('ready','closes','guard-consent','guard-default','guard-owner','guard-unknown')){
      $value=Run-Case $mode;Check-Proof $value.proof
      $expected=if($mode -ceq 'closes'){1}else{0}
      $ready=$mode -cin @('ready','closes')
      if($value.clock.sent -ne $expected -or $value.refused -eq $ready -or ($value.proof.status -ceq 'READY') -ne $ready){throw 'fixture-baseline-behavior-changed'};$cases++
    }
  } elseif($Scenario -ceq 'bounded'){
    $value=Run-Case 'bounded';Check-Proof $value.proof
    if(-not $value.refused -or $value.clock.sent -ne 3 -or $value.clock.ms -ne 10000 -or $value.clock.read -le 512 -or $value.proof.windowVisibility.samples -ne 512 -or $value.proof.windowVisibility.first.visibleStyle -ne $true -or $value.proof.windowVisibility.last.visibleStyle -ne $false){throw 'fixture-first-last-counter-bounds'};$cases++
  } elseif($Scenario -cin @('late-error','late-deadline')){
    $value=Run-Case $Scenario;Check-Proof $value.proof
    if(-not $value.refused -or $value.clock.sent -ne 1 -or $value.proof.windowVisibility.samples -ne 3 -or $value.proof.windowVisibility.first.visibleStyle -ne $true -or $value.proof.windowVisibility.last.visibleStyle -ne $false -or @($value.proof.overlayDismissals | Where-Object {$_.closedObserved}).Count){throw 'fixture-late-failure-lost-samples'}
    if($Scenario -ceq 'late-deadline' -and ($value.proof.code -cne 'deadline' -or $value.clock.ms -ne 10000)){throw 'fixture-late-deadline'};$cases++
  } elseif($Scenario -ceq 'projection'){
    foreach($field in @('windowExists','visibleStyle','onMonitor','stillForeground','cloakKnown','cloaked','boundsKnown','nonEmptyBounds')){
      $raw=Visibility 'visible';$raw[$field]='PRIVATE_VISIBILITY_CANARY';$proof=@{windowVisibility=@{samples=0;first=$null;last=$null}};$item=@{windowVisibility=$raw;kind='search';witness='owned-search-witness'};$reads=@{count=0}
      $returned=Read-NativeReadDesktopObservation {$reads.count++;return $item} $proof
      if(-not [Object]::ReferenceEquals($returned,$item) -or $reads.count -ne 1){throw 'fixture-observation-mutated'};Check-Proof $proof
      if($field -cin @('cloakKnown','cloaked')){if($proof.windowVisibility.first.cloakKnown -ne $false -or $null -ne $proof.windowVisibility.first.cloaked){throw 'fixture-cloak-marker-coercion'}}
      elseif($field -cin @('boundsKnown','nonEmptyBounds')){if($proof.windowVisibility.first.boundsKnown -ne $false -or $null -ne $proof.windowVisibility.first.nonEmptyBounds){throw 'fixture-bounds-marker-coercion'}}
      elseif($null -ne $proof.windowVisibility.first[$field]){throw 'fixture-boolean-coercion'};$cases++
    }
    foreach($pair in @(@('cloakKnown','cloaked'),@('boundsKnown','nonEmptyBounds'))){
      $raw=Visibility 'visible';$raw[$pair[0]]=$false;$raw[$pair[1]]=$true;$proof=@{windowVisibility=@{samples=0;first=$null;last=$null}}
      [void](Read-NativeReadDesktopObservation {@{windowVisibility=$raw}} $proof);Check-Proof $proof
      if($proof.windowVisibility.first[$pair[0]] -ne $false -or $null -ne $proof.windowVisibility.first[$pair[1]]){throw 'fixture-unknown-marker-coercion'};$cases++
    }
    $raw=Visibility 'visible';$proof=@{windowVisibility=@{samples=0;first=$null;last=$null}}
    [void](Read-NativeReadDesktopObservation {@{windowVisibility=$raw}} $proof);$raw.visibleStyle=$false
    if($proof.windowVisibility.first.visibleStyle -ne $true){throw 'fixture-observation-alias'};$cases++
    $raw=[pscustomobject]@{};$raw | Add-Member ScriptProperty windowExists {throw 'PRIVATE_VISIBILITY_CANARY'}
    $proof=@{windowVisibility=@{samples=0;first=$null;last=$null}};[void](Read-NativeReadDesktopObservation {@{windowVisibility=$raw}} $proof);Check-Proof $proof
    if($null -ne $proof.windowVisibility.first.windowExists -or $proof.windowVisibility.first.cloakKnown -ne $false -or $proof.windowVisibility.first.boundsKnown -ne $false){throw 'fixture-query-failure-unknown'};$cases++
  } elseif($Scenario -ceq 'activation-policy'){
    foreach($mode in @('visible','refused','unchanged','hidden','cloaked','unknown','consent','default','nonboolean','late-budget')){
      $scope=Scope;$proof=@{};$clock=@{ms=0;activations=0;keys=0;reads=0};$refused=$false
      $read={
        $clock.reads++;$after=$clock.activations -gt 0
        $kind=if($after -and $mode -cnotin @('unchanged','refused','nonboolean')){'desktop'}else{'search'}
        $visibility=Visibility $(if(-not $after -or $mode -ceq 'unchanged'){'cloaked'}elseif($mode -cin @('hidden','cloaked','unknown')){$mode}else{'visible'})
        return @{noConsent=(-not ($after -and $mode -ceq 'consent'));activeDefault=(-not ($after -and $mode -ceq 'default'));noForeground=$false;ownerVerified=$true;sameSession=$true;kind=$kind;witness=$(if($kind -ceq 'desktop'){'owned-desktop'}else{'owned-cloaked-search'});windowVisibility=$visibility}
      }
      $activate={param($Expected)
        if($Expected.kind -cne 'search' -or $Expected.witness -cne 'owned-cloaked-search'){throw 'fixture-activation-target'}
        $clock.activations++
        if($mode -ceq 'nonboolean'){return 'true'};if($mode -ceq 'late-budget'){$clock.ms=10000};return ($mode -cne 'refused')
      }
      try {Invoke-NativeReadDesktopPreparation $scope $proof $read {$clock.keys++;throw 'fixture-hidden-input'} -Elapsed {$clock.ms} -Pause {param($Milliseconds) $clock.ms+=$Milliseconds} -ActivateDesktop $activate}
      catch {if($_.Exception.Message -cne 'Native desktop precondition refused'){throw};$refused=$true}
      Check-Proof $proof
      if($clock.activations -ne 1 -or $clock.keys -ne 0 -or $clock.ms -gt 10000 -or $proof.desktopActivation.attempted -ne $true -or $proof.desktopActivation.Keys.Count -ne 3){throw 'fixture-activation-budget'}
      if($mode -ceq 'visible'){
        if($refused -or $proof.status -cne 'READY' -or -not $proof.desktopActivation.accepted -or -not $proof.desktopActivation.foregroundObserved -or $clock.reads -lt 2){throw 'fixture-activation-not-observed'}
      }else{
        if(-not $refused -or $proof.status -cne 'FAIL' -or $proof.desktopActivation.foregroundObserved -or $proof.activeDefaultObserved -eq $true -or $proof.noConsentObserved -eq $true){throw 'fixture-activation-false-ready'}
        if($mode -cin @('refused','nonboolean')){if($proof.code -cne 'desktop-activation-refused' -or $proof.desktopActivation.accepted){throw 'fixture-activation-refusal'}}
        elseif($mode -cin @('unchanged','late-budget')){if($proof.code -cne 'deadline' -or $clock.ms -ne 10000){throw 'fixture-activation-no-change'}}
        elseif($mode -cin @('hidden','cloaked','unknown')){if($proof.code -cne 'desktop-activation-unobserved'){throw 'fixture-activation-visibility'}}
      };$cases++
    }
  } elseif($Scenario -ceq 'activation-adapter'){
    # Execute the maintained adapter with managed native stand-ins. No Win32
    # method, focus request, keyboard input or host desktop probe is called.
    Microsoft.PowerShell.Utility\Add-Type -TypeDefinition 'public static class NativeReadDesktop { public sealed class State { public long Window=10; public uint Pid=20; public string ClassName="Progman"; } public static int Calls; public static State Shell=new State(); public static State ReadShell(){return Shell;} public static bool ActivateDesktop(long search,uint searchPid,long shell,uint shellPid,long remaining){if(search!=1||searchPid!=2||shell!=10||shellPid!=20||remaining<=0||remaining>10000)throw new System.Exception("fixture-native-target");Calls++;return true;} }'
    $initial=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Initialize-NativeReadDesktop'},$false))[0]
    $assignment=@($initial.Body.FindAll({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$activateDesktop'},$true))
    if($assignment.Count -ne 1){throw 'fixture-activation-source-refused'}
    $body=$assignment[0].Right.Find({param($node) $node -is [Management.Automation.Language.ScriptBlockExpressionAst]},$true)
    $activate=$body.ScriptBlock.GetScriptBlock()
    foreach($mode in @('valid','scope','shell-class','owner-session','owner-path','owner-name','signature','birth','changed-search','consent','default','owner','session','not-cloaked','late-budget')){
      $Scope=Scope;$Proof=@{windowVisibility=@{samples=0;first=$null;last=$null}};$calls=@{cim=0};[NativeReadDesktop]::Calls=0;[NativeReadDesktop]::Shell.ClassName=if($mode -ceq 'shell-class'){'WorkerW'}else{'Progman'}
      if($mode -ceq 'scope'){$Scope.runner='foreign'}
      function Get-CimInstance($ClassName,$Filter){
        if($ClassName -cne 'Win32_Process' -or $Filter -cne 'ProcessId=20'){throw 'fixture-owner-query'};$calls.cim++
        return [pscustomobject]@{SessionId=$(if($mode -ceq 'owner-session'){3}else{2});CreationDate=([datetime]'2026-10-27T00:00:00Z').AddSeconds($(if($mode -ceq 'birth' -and $calls.cim -gt 1){1}else{0}));Name=$(if($mode -ceq 'owner-name'){'other.exe'}else{'explorer.exe'});ExecutablePath=$(if($mode -ceq 'owner-path'){'C:\foreign.exe'}else{'C:\Windows\explorer.exe'})}
      }
      function Get-AuthenticodeSignature($LiteralPath){if($LiteralPath -cne 'C:\Windows\explorer.exe'){throw 'fixture-signature-query'};return @{Status=$(if($mode -ceq 'signature'){'UnknownError'}else{'Valid'});SignerCertificate=@{Subject='Microsoft Windows'}}}
      $read={return @{noConsent=($mode -cne 'consent');activeDefault=($mode -cne 'default');ownerVerified=($mode -cne 'owner');sameSession=($mode -cne 'session');kind='search';witness=$(if($mode -ceq 'changed-search'){'replaced-search'}else{'expected-search'});window=1;pid=2;windowVisibility=(Visibility $(if($mode -ceq 'not-cloaked'){'visible'}else{'cloaked'}))}}
      $rejected=$false;$accepted=$false
      try {$accepted=& $activate @{witness='expected-search'} {if($mode -ceq 'late-budget'){10000}else{0}}}catch{if($_.Exception.Message -cnotin @('Native desktop changed','Native desktop scope refused')){throw};$rejected=$true}
      if($mode -ceq 'valid'){if($rejected -or $accepted -ne $true -or [NativeReadDesktop]::Calls -ne 1){throw 'fixture-activation-valid'}}
      elseif(-not $rejected -or [NativeReadDesktop]::Calls -ne 0){throw 'fixture-activation-guard'};$cases++
    }
  } elseif($Scenario -cin @('dismiss-valid','dismiss-refused')){
    # This managed fake has no DllImport or OS calls. Invoke the exact maintained
    # dismiss body against fake Read/Escape, never the actual native adapter.
    Microsoft.PowerShell.Utility\Add-Type -TypeDefinition 'public static class NativeReadDesktop { public static int Calls; public static uint Escape(long window,uint pid){Calls++;return 2;} }'
    $initial=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Initialize-NativeReadDesktop'},$false))[0]
    $assignment=@($initial.Body.FindAll({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$dismiss'},$true))
    if($assignment.Count -ne 1){throw 'fixture-dismiss-source-refused'}
    $body=$assignment[0].Right.Find({param($node) $node -is [Management.Automation.Language.ScriptBlockExpressionAst]},$true)
    if($null -eq $body){throw 'fixture-dismiss-source-refused'};$dismiss=$body.ScriptBlock.GetScriptBlock()
    $Proof=@{windowVisibility=@{samples=0;first=$null;last=$null}};$raw=Visibility 'visible'
    $read={return @{noConsent=$true;activeDefault=$true;kind='search';witness=$(if($Scenario -ceq 'dismiss-valid'){'expected-witness'}else{'changed-witness'});window=1;pid=2;windowVisibility=$raw}}
    $rejected=$false;$sent=0
    try {$sent=& $dismiss @{witness='expected-witness'}}catch{if($_.Exception.Message -cne 'Native desktop changed'){throw};$rejected=$true}
    Check-Proof $Proof
    if($Proof.windowVisibility.samples -ne 1 -or $Proof.windowVisibility.first.visibleStyle -ne $true){throw 'fixture-dismiss-observation-lost'}
    if($Scenario -ceq 'dismiss-valid'){if($rejected -or $sent -ne 2 -or [NativeReadDesktop]::Calls -ne 1){throw 'fixture-dismiss-valid'}}
    elseif(-not $rejected -or [NativeReadDesktop]::Calls -ne 0){throw 'fixture-dismiss-guard'};$cases++
  } else {throw 'fixture-scenario-refused'}
  @{status='PASS';scenario=$Scenario;cases=$cases;observation=$observation;nativeMethodsInvoked=$false;keyboardInputExecuted=$false;version=$PSVersionTable.PSVersion.ToString()} | ConvertTo-Json -Depth 5 -Compress
} catch {@{status='FAIL';code='visibility-fixture-refused';scenario=$Scenario;reason=$_.Exception.Message;line=$_.InvocationInfo.ScriptLineNumber;observation=$observation}|ConvertTo-Json -Depth 5 -Compress;exit 2}
`,
  );
  const result = spawnSync(
    path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-File', script, '-Source', root, '-Scenario', scenario],
    {
      cwd: folder,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20000,
      maxBuffer: 16384,
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

describe.skipIf(process.platform !== 'win32')('native desktop visibility diagnostics', () => {
  it('retains actual Search visibility diagnostics without changing its refusal contract', () => {
    expect(visibilityFixture('visible')).toMatchObject({
      status: 'PASS',
      cases: 1,
      observation: { status: 'FAIL', sent: 3, closedFacts: 0, visibilityPresent: true },
      nativeMethodsInvoked: false,
      keyboardInputExecuted: false,
      version: expect.stringMatching(/^5\.1\./),
    });
  }, 25000);
  it.each([
    ['hidden', 1],
    ['cloaked', 1],
    ['unknown', 1],
    ['query-failure', 1],
    ['invalid', 1],
    ['lost-foreground', 1],
    ['baseline', 6],
    ['bounded', 1],
    ['late-error', 1],
    ['late-deadline', 1],
    ['projection', 12],
    ['activation-policy', 10],
    ['activation-adapter', 15],
    ['dismiss-valid', 1],
    ['dismiss-refused', 1],
    ['compile-only', 1],
  ])(
    'exercises actual %s path without native window/input calls',
    (scenario, cases) => {
      expect(visibilityFixture(scenario)).toMatchObject({
        status: 'PASS',
        scenario,
        cases,
        nativeMethodsInvoked: false,
        keyboardInputExecuted: false,
        version: expect.stringMatching(/^5\.1\./),
      });
    },
    25000,
  );
});
