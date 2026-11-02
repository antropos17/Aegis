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
    expect(path.basename(folder).startsWith('aegis-cloaked-search-')).toBe(true);
    expect(fs.lstatSync(folder).isSymbolicLink()).toBe(false);
    fs.rmSync(folder, { recursive: true });
  }
});

function cloakedFixture(scenario) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-cloaked-search-'));
  folders.push(folder);
  const script = path.join(folder, 'fixture.ps1');
  fs.writeFileSync(
    script,
    String.raw`param([string]$Source,[string]$Scenario)
$ErrorActionPreference='Stop';$cases=0;$observation=$null
try {
  $tokens=$null;$errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $Source 'scripts/qualification/windows-native-read-guest.ps1'),[ref]$tokens,[ref]$errors)
  if($errors.Count){throw 'fixture-policy-syntax'}
  foreach($name in @('Assert-NativeReadDesktopScope','Read-NativeReadDesktopObservation','Test-NativeReadNonPresentedSearch','Invoke-NativeReadDesktopPreparation')){
    $nodes=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$false))
    if($name -ceq 'Test-NativeReadNonPresentedSearch' -and $nodes.Count -eq 0){continue}
    if($nodes.Count -ne 1){throw 'fixture-policy-function'}
    . ([scriptblock]::Create($nodes[0].Extent.Text))
  }
  function Add-Type {throw 'fixture-native-compilation-forbidden'}
  function Scope {
    return @{root='C:\aegis-native-read';source='C:\aegis-native-read\source';bundle='C:\aegis-native-read\input';runner='github-hosted-hyperv-guest';githubActions='true';ci='true';runnerOS='Windows';runnerArch='X64';username='AegisSetup';interactive=$true;sessionId=2;integritySid='S-1-16-8192';sourceSha=('a'*40);expectedSourceSha=('a'*40);runId='123';attempt='1';caption='Windows 11';productType=1;build='26300';ubr=9457;architecture='AMD64'}
  }
  function Visibility([bool]$Cloaked){
    return @{windowExists=$true;visibleStyle=$true;cloakKnown=$true;cloaked=$Cloaked;boundsKnown=$true;nonEmptyBounds=$true;onMonitor=$true;stillForeground=$true}
  }
  function Run-Case([string]$Mode){
    $proof=@{};$clock=@{ms=0;read=0;sent=0};$refused=$false
    $read={
      $clock.read++
      $cloaked=$Mode -notin @('uncloaked','hidden')
      if($Mode -ceq 'fresh-cloaked' -and $clock.read -eq 1){$cloaked=$false}
      if($Mode -cin @('after-escape','after-escape-desktop')){$cloaked=$clock.sent -gt 0}
      if($Mode -ceq 'becomes-visible'){$cloaked=$clock.ms -lt 300}
      $visibility=Visibility $cloaked
      if($Mode -ceq 'hidden'){$visibility.visibleStyle=$false}
      if($Mode -ceq 'unknown-marker'){$visibility.cloakKnown=$false}
      if($Mode -ceq 'string-marker'){$visibility.cloakKnown='true'}
      if($Mode -ceq 'null-cloak'){$visibility.cloaked=$null}
      $kind=if($Mode -ceq 'start'){'start'}else{'search'}
      if(($Mode -ceq 'desktop-later' -and $clock.ms -ge 400) -or ($Mode -ceq 'after-escape-desktop' -and $clock.sent -gt 0 -and $clock.ms -ge 400) -or ($Mode -ceq 'becomes-visible' -and $clock.sent -gt 0)){$kind='desktop';$visibility=Visibility $false}
      $none=$Mode -ceq 'null-foreground' -and $clock.ms -ge 200
      return @{noConsent=($Mode -cne 'consent');activeDefault=($Mode -cne 'secure');noForeground=$none;ownerVerified=($Mode -cne 'unsigned');sameSession=($Mode -cne 'session');kind=$(if($none){'none'}elseif($Mode -ceq 'unknown-kind'){'unknown'}else{$kind});witness=$(if($none -or $Mode -ceq 'missing-witness'){$null}elseif($kind -ceq 'desktop'){'verified-desktop'}else{'verified-overlay'});windowVisibility=$visibility}
    }
    $dismiss={param($Expected)
      if($Expected.kind -cnotin @('start','search') -or $Expected.witness -cne 'verified-overlay'){throw 'fixture-input-target'}
      $clock.sent++;return 2
    }
    try {Invoke-NativeReadDesktopPreparation (Scope) $proof $read $dismiss -Elapsed {$clock.ms} -Pause {param($Milliseconds) $clock.ms+=$Milliseconds}}
    catch {if($_.Exception.Message -cne 'Native desktop precondition refused'){throw};$refused=$true}
    return @{proof=$proof;clock=$clock;refused=$refused}
  }
  function Summary($Value){
    return @{status=$Value.proof.status;code=$Value.proof.code;sent=$Value.clock.sent;elapsedMs=$Value.clock.ms;closedFacts=@($Value.proof.overlayDismissals | Where-Object {$_.closedObserved}).Count}
  }
  if($Scenario -ceq 'cloaked'){
    # Matches the retained cloud endpoints: all eight diagnostic fields true,
    # including visible style AND a known DWM-cloaked Search foreground.
    $value=Run-Case 'cloaked';$observation=Summary $value
    if(-not $value.refused -or $value.proof.status -cne 'FAIL' -or $value.proof.code -cne 'deadline' -or $value.clock.sent -ne 0 -or $value.clock.ms -ne 10000 -or $value.proof.overlayDismissals.Count){throw 'fixture-cloaked-search-input'}
    if($value.proof.windowVisibility.first.cloaked -ne $true -or $value.proof.windowVisibility.last.cloaked -ne $true){throw 'fixture-cloak-diagnostics-lost'};$cases++
  } elseif($Scenario -ceq 'transitions'){
    foreach($mode in @('desktop-later','fresh-cloaked','after-escape','after-escape-desktop','becomes-visible','null-foreground')){
      $value=Run-Case $mode;$summary=Summary $value
      if($mode -ceq 'desktop-later'){
        if($value.refused -or $value.proof.status -cne 'READY' -or $value.clock.sent -ne 0 -or $value.clock.ms -ne 400){throw 'fixture-no-independent-desktop'}
      } elseif($mode -ceq 'after-escape-desktop'){
        if($value.refused -or $value.proof.status -cne 'READY' -or $value.clock.sent -ne 1 -or $summary.closedFacts -ne 1){throw 'fixture-post-input-desktop'}
      } elseif($mode -ceq 'becomes-visible'){
        if($value.refused -or $value.proof.status -cne 'READY' -or $value.clock.sent -ne 1 -or $value.clock.ms -ne 300){throw 'fixture-visible-search-path'}
      } else {
        $expected=if($mode -ceq 'after-escape'){1}else{0}
        if(-not $value.refused -or $value.proof.status -cne 'FAIL' -or $value.clock.sent -ne $expected -or $value.clock.ms -ne 10000 -or $summary.closedFacts -ne 0){throw 'fixture-cloak-transition-authority'}
      };$cases++
    }
  } elseif($Scenario -ceq 'authority'){
    foreach($mode in @('uncloaked','hidden','unknown-marker','string-marker','null-cloak','start','consent','secure','unsigned','session','unknown-kind','missing-witness')){
      $value=Run-Case $mode;$expected=if($mode -ceq 'start'){1}elseif($mode -cin @('uncloaked','hidden','unknown-marker','string-marker','null-cloak')){3}else{0}
      if(-not $value.refused -or $value.proof.status -cne 'FAIL' -or $value.clock.sent -ne $expected -or @($value.proof.overlayDismissals | Where-Object {$_.closedObserved}).Count){throw 'fixture-existing-authority-changed'}
      if($expected -eq 0 -and $value.clock.ms -ne 0){throw 'fixture-guard-became-wait'};$cases++
    }
  } elseif($Scenario -ceq 'native-dismiss-race'){
    $nodes=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$dismiss'},$true))
    if($nodes.Count -ne 1){throw 'fixture-native-dismiss-source'}
    foreach($mode in @('fresh-cloaked','stale-first-cloaked','hidden','unknown-cloak','start')){
      $proof=@{windowVisibility=@{samples=0;first=(Visibility ($mode -ceq 'stale-first-cloaked'));last=(Visibility $false)}}
      $freshVisibility=Visibility ($mode -cin @('fresh-cloaked','start'))
      if($mode -ceq 'unknown-cloak'){$freshVisibility.cloakKnown=$false;$freshVisibility.cloaked=$true}
      if($mode -ceq 'hidden'){$freshVisibility.visibleStyle=$false}
      $kind=if($mode -ceq 'start'){'start'}else{'search'}
      $item=@{kind=$kind;witness='same-verified-owner';noConsent=$true;activeDefault=$true;ownerVerified=$true;sameSession=$true;window=123;pid=456;windowVisibility=$freshVisibility}
      $read={return $item}
      . ([scriptblock]::Create($nodes[0].Extent.Text))
      $errorCode=$null
      try {& $dismiss @{kind=$kind;witness='same-verified-owner'}}
      catch {$errorCode=$_.FullyQualifiedErrorId;if($_.Exception.Message -ceq 'Native desktop changed'){$errorCode='native-desktop-changed'}}
      # No NativeReadDesktop type is loaded in this process. An allowed path
      # reaches only PowerShell's TypeNotFound boundary, never a native method.
      if($mode -ceq 'fresh-cloaked'){
        if($errorCode -cne 'native-desktop-changed'){throw 'fixture-native-cloak-race-input'}
      } elseif($errorCode -cne 'TypeNotFound'){throw 'fixture-native-current-observation-changed'}
      if($proof.windowVisibility.samples -ne 1){throw 'fixture-native-fresh-read-missing'};$cases++
    }
  } else {throw 'fixture-scenario'}
  @{status='PASS';scenario=$Scenario;cases=$cases;observation=$observation;nativeMethodsInvoked=$false;keyboardInputExecuted=$false;version=$PSVersionTable.PSVersion.ToString()} | ConvertTo-Json -Depth 5 -Compress
} catch {
  @{status='FAIL';code=$_.Exception.Message;scenario=$Scenario;cases=$cases;observation=$observation;line=$_.InvocationInfo.ScriptLineNumber} | ConvertTo-Json -Depth 5 -Compress;exit 2
}
`,
  );
  const result = spawnSync(
    path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-File', script, '-Source', root, '-Scenario', scenario],
    {
      cwd: folder,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 12000,
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
  'known DWM-cloaked Search policy without native calls',
  () => {
    it('does not send Escape to the known cloaked Search witness', () => {
      expect(cloakedFixture('cloaked')).toMatchObject({
        status: 'PASS',
        cases: 1,
        observation: {
          status: 'FAIL',
          code: 'deadline',
          sent: 0,
          elapsedMs: 10000,
          closedFacts: 0,
        },
        nativeMethodsInvoked: false,
        keyboardInputExecuted: false,
      });
    }, 20000);
    it.each([
      ['transitions', 6],
      ['authority', 12],
      ['native-dismiss-race', 5],
    ])(
      'preserves actual %s authority and closure guards',
      (scenario, cases) => {
        expect(cloakedFixture(scenario)).toMatchObject({
          status: 'PASS',
          scenario,
          cases,
          nativeMethodsInvoked: false,
          keyboardInputExecuted: false,
        });
      },
      20000,
    );
  },
);
