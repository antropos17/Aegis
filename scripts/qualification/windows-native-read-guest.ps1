param([Parameter(Mandatory)][ValidateSet('admission-preflight','prepare','resume','admission')][string]$Phase)

function Assert-NativeReadDesktopScope($Scope) {
  if($Scope.root -cne 'C:\aegis-native-read' -or $Scope.source -cne 'C:\aegis-native-read\source' -or $Scope.bundle -cne 'C:\aegis-native-read\input' -or
    $Scope.runner -cne 'github-hosted-hyperv-guest' -or $Scope.githubActions -cne 'true' -or $Scope.ci -cne 'true' -or $Scope.runnerOS -cne 'Windows' -or $Scope.runnerArch -cne 'X64' -or
    $Scope.username -cne 'AegisSetup' -or $Scope.interactive -ne $true -or $Scope.sessionId -le 0 -or $Scope.integritySid -cne 'S-1-16-8192' -or
    $Scope.sourceSha -cnotmatch '^[a-f0-9]{40}$' -or $Scope.sourceSha -cne $Scope.expectedSourceSha -or $Scope.runId -cnotmatch '^[1-9][0-9]*$' -or $Scope.attempt -cnotmatch '^[1-9][0-9]*$' -or
    $Scope.caption -notmatch 'Windows 11' -or $Scope.productType -ne 1 -or $Scope.build -cne '26300' -or $Scope.ubr -ne 9457 -or $Scope.architecture -cne 'AMD64') { throw 'Native desktop scope refused' }
}

function Read-NativeReadDesktopObservation([scriptblock]$Read,$Proof) {
  $value=& $Read
  $visibility=@{windowExists=$null;visibleStyle=$null;cloakKnown=$false;cloaked=$null;boundsKnown=$false;nonEmptyBounds=$null;onMonitor=$null;stillForeground=$null}
  $raw=$null
  try { $raw=$value.windowVisibility } catch {}
  foreach($name in @('windowExists','visibleStyle','onMonitor','stillForeground')) {
    try { $flag=$raw.$name;if($flag -is [bool]) { $visibility[$name]=$flag } } catch {}
  }
  try {
    $known=$raw.cloakKnown;$flag=$raw.cloaked
    if($known -is [bool] -and $known -eq $true -and $flag -is [bool]) { $visibility.cloakKnown=$true;$visibility.cloaked=$flag }
  } catch {}
  try {
    $known=$raw.boundsKnown;$flag=$raw.nonEmptyBounds
    if($known -is [bool] -and $known -eq $true -and $flag -is [bool]) { $visibility.boundsKnown=$true;$visibility.nonEmptyBounds=$flag }
  } catch {}
  $observation=$Proof.windowVisibility
  if($null -eq $observation.first) { $observation.first=$visibility }
  $observation.last=$visibility;$observation.samples=[Math]::Min(512,([long]$observation.samples+1))
  return $value
}

# Reuse the installer's verified Start/Search Escape precondition. Callback seams
# permit normal local fixtures to exercise this decision loop without Win32/input.
function Invoke-NativeReadDesktopPreparation($Scope,$Proof,[scriptblock]$Read,[scriptblock]$Dismiss,[scriptblock]$Elapsed=$null,[scriptblock]$Pause=$null) {
  Assert-NativeReadDesktopScope $Scope
  $watch=[Diagnostics.Stopwatch]::StartNew()
  if($null -eq $Elapsed) { $Elapsed={ $watch.Elapsed.TotalMilliseconds } }
  if($null -eq $Pause) { $Pause={param($Milliseconds) Start-Sleep -Milliseconds $Milliseconds} }
  $Proof.status='RUNNING';$Proof.code=$null;$Proof.scopeVerified=$true;$Proof.overlayDismissals=@();$Proof.noForegroundPolls=0
  $Proof.windowVisibility=@{samples=0;first=$null;last=$null}
  $refuse={param($Code) $Proof.status='FAIL';$Proof.code=$Code;throw 'Native desktop precondition refused'}
  $sample={
    param([double]$SliceDeadline=10000)
    do {
      Assert-NativeReadDesktopScope $Scope
      if((& $Elapsed) -ge 10000) { & $refuse 'deadline' }
      $value=Read-NativeReadDesktopObservation $Read $Proof
      if((& $Elapsed) -ge 10000) { & $refuse 'deadline' }
      if($value.noConsent -ne $true) { & $refuse 'consent-present' }
      if($value.activeDefault -ne $true) { & $refuse 'desktop-unavailable' }
      # NULL foreground is a documented deactivation transition, never closure.
      if($value.noForeground -eq $true -and $value.kind -ceq 'none' -and $null -eq $value.witness) {
        $Proof.noForegroundPolls++
        $sampleTime=& $Elapsed
        if($sampleTime -ge 10000) { & $refuse 'deadline' }
        if($SliceDeadline -lt 10000 -and $sampleTime -ge $SliceDeadline) { return $null }
        & $Pause 100;continue
      }
      if($value.ownerVerified -ne $true -or $value.sameSession -ne $true -or $value.kind -cnotin @('start','search','desktop') -or [string]::IsNullOrEmpty($value.witness)) { & $refuse 'foreground-unavailable' }
      $sampleTime=& $Elapsed
      if($sampleTime -ge 10000) { & $refuse 'deadline' }
      if($SliceDeadline -lt 10000 -and $sampleTime -ge $SliceDeadline) { return $null }
      return $value
    } while((& $Elapsed) -lt 10000)
    & $refuse 'deadline'
  }
  while((& $Elapsed) -lt 10000) {
    $before=& $sample
    if($before.kind -ceq 'desktop') { $Proof.status='READY';$Proof.activeDefaultObserved=$true;$Proof.noConsentObserved=$true;return }
    if($Proof.overlayDismissals.Count -ge 3) { & $refuse 'overlay-budget' }
    $pending=@()
    do {
      $fresh=& $sample
      if($fresh.witness -cne $before.witness -or $fresh.kind -cne $before.kind) { & $refuse 'foreground-changed' }
      Assert-NativeReadDesktopScope $Scope
      if((& $Elapsed) -ge 10000) { & $refuse 'deadline' }
      $sent=& $Dismiss $fresh
      if($sent -ne 2) { & $refuse 'input-unconfirmed' }
      $fact=@{kind=$fresh.kind;ownerRevalidated=$true;activeDefaultObserved=$true;inputEvents=2;closedObserved=$false}
      $Proof.overlayDismissals+=@($fact);$pending+=@($fact)
      # A Search Escape can leave the same verified overlay. Revalidate before
      # another bounded attempt; Start retains its single-attempt observation.
      $observeUntil=if($fresh.kind -ceq 'search' -and $Proof.overlayDismissals.Count -lt 3){[Math]::Min(10000,((& $Elapsed)+1000))}else{10000}
      do {
        $after=& $sample $observeUntil
        # Slice expiry/NULL foreground is unknown, never disappearance or input authority.
        if($null -eq $after) { break }
        if($after.witness -cne $fresh.witness) {
          # Each fact observes later disappearance of this same pinned witness;
          # it does not attribute closure to any individual Escape attempt.
          foreach($item in $pending) { $item.closedObserved=$true }
          break
        }
        & $Pause 100
      } while((& $Elapsed) -lt $observeUntil)
      if($fact.closedObserved) { break }
      if($fresh.kind -cne 'search' -or $Proof.overlayDismissals.Count -ge 3) { & $refuse 'overlay-not-closed' }
      # A full validated sample is required after every slice, including NULL.
      $before=& $sample
      if($null -eq $before) { & $refuse 'foreground-unavailable' }
      if($before.witness -cne $fresh.witness) {
        foreach($item in $pending) { $item.closedObserved=$true }
        break
      }
      if($before.kind -cne $fresh.kind) { & $refuse 'foreground-changed' }
    } while((& $Elapsed) -lt 10000)
    if(-not $fact.closedObserved) { & $refuse 'overlay-not-closed' }
  }
  & $refuse 'deadline'
}

function Initialize-NativeReadDesktop($Scope,$Proof) {
  Assert-NativeReadDesktopScope $Scope
  if($env:USERNAME -cne 'AegisSetup' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted-hyperv-guest' -or $env:GITHUB_ACTIONS -cne 'true' -or $env:CI -cne 'true' -or $env:GITHUB_WORKSPACE -cne $Scope.source -or $env:GITHUB_SHA -cne $Scope.sourceSha -or $env:GITHUB_RUN_ID -cne $Scope.runId -or $env:GITHUB_RUN_ATTEMPT -cne $Scope.attempt -or -not [Environment]::UserInteractive -or (Get-Process -Id $PID).SessionId -ne $Scope.sessionId -or (Get-Location).Path -cne $Scope.source) { throw 'Native desktop scope refused' }
  foreach($folder in @($Scope.root,$Scope.source,$Scope.bundle)) { $item=Get-Item -LiteralPath $folder -Force;if(-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Native desktop scope refused'} }
  # No native probe or input can run before the exact guest/normal-token guard.
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class NativeReadDesktop {
  [StructLayout(LayoutKind.Sequential)] public struct MouseInput { public int X,Y; public uint Data,Flags,Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Sequential)] public struct KeyStroke { public ushort Vk,Scan; public uint Flags,Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Explicit)] public struct KeyUnion { [FieldOffset(0)] public MouseInput Size; [FieldOffset(0)] public KeyStroke Key; }
  [StructLayout(LayoutKind.Sequential)] public struct KeyInput { public uint Type; public KeyUnion Data; }
  [StructLayout(LayoutKind.Sequential)] struct WindowRect { public int Left,Top,Right,Bottom; }
  public sealed class State { public bool ActiveDefault; public long Window; public uint Pid; public string ClassName; }
  public sealed class VisibilityState {
    public bool? WindowExists,VisibleStyle,Cloaked,NonEmptyBounds,OnMonitor,StillForeground;
    public bool CloakKnown,BoundsKnown;
  }
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint thread);
  [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool GetUserObjectInformation(IntPtr obj,int index,StringBuilder value,int length,out int needed);
  [DllImport("user32.dll",EntryPoint="GetUserObjectInformationW")] static extern bool GetInputFlag(IntPtr obj,int index,out int value,int length,out int needed);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window,StringBuilder text,int count);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out WindowRect rect);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr window,uint flags);
  [DllImport("dwmapi.dll",PreserveSig=true)] static extern int DwmGetWindowAttribute(IntPtr window,uint attribute,out uint value,uint size);
  [DllImport("user32.dll",EntryPoint="SendInput",SetLastError=true)] static extern uint SendKeyboardInput(uint count,KeyInput[] inputs,int size);
  static bool Named(IntPtr obj,string expected) { int needed;var name=new StringBuilder(256);return obj!=IntPtr.Zero && GetUserObjectInformation(obj,2,name,512,out needed) && string.Equals(name.ToString(),expected,StringComparison.OrdinalIgnoreCase); }
  public static State Probe() {
    var result=new State();int input,needed;var thread=GetThreadDesktop(GetCurrentThreadId());
    if(!Named(GetProcessWindowStation(),"WinSta0") || !Named(thread,"Default") || !GetInputFlag(thread,6,out input,4,out needed) || input==0) return result;
    var desktop=OpenInputDesktop(0,false,1);if(desktop==IntPtr.Zero) return result;
    try { if(!Named(desktop,"Default")) return result; } finally { CloseDesktop(desktop); }
    result.ActiveDefault=true;var window=GetForegroundWindow();result.Window=window.ToInt64();if(window==IntPtr.Zero) return result;
    uint pid;GetWindowThreadProcessId(window,out pid);var name=new StringBuilder(256);GetClassName(window,name,256);
    result.Pid=pid;result.ClassName=name.ToString();return result;
  }
  // Read-only diagnostics are separate from Probe/Escape's input revalidation.
  public static VisibilityState ReadWindowVisibility(long handle) {
    var result=new VisibilityState();var window=new IntPtr(handle);
    if(window==IntPtr.Zero) return result;
    try { result.WindowExists=IsWindow(window); } catch {}
    if(result.WindowExists==true) {
      try { result.VisibleStyle=IsWindowVisible(window); } catch {}
      try {
        uint cloaked;
        if(DwmGetWindowAttribute(window,14u,out cloaked,4u)==0) { result.CloakKnown=true;result.Cloaked=cloaked!=0; }
      } catch {}
      try {
        WindowRect rect;
        if(GetWindowRect(window,out rect)) { result.BoundsKnown=true;result.NonEmptyBounds=rect.Right>rect.Left && rect.Bottom>rect.Top; }
      } catch {}
      try { result.OnMonitor=MonitorFromWindow(window,0)!=IntPtr.Zero; } catch {}
    }
    try {
      var foreground=GetForegroundWindow();
      if(foreground!=IntPtr.Zero) result.StillForeground=foreground==window;
    } catch {}
    return result;
  }
  public static uint Escape(long window,uint pid) {
    var fresh=Probe();if(!fresh.ActiveDefault || fresh.Window!=window || fresh.Pid!=pid) throw new InvalidOperationException("Native desktop changed");
    var keys=new KeyInput[2];keys[0].Type=keys[1].Type=1;keys[0].Data.Key.Vk=keys[1].Data.Key.Vk=27;keys[1].Data.Key.Flags=2;
    return SendKeyboardInput(2,keys,Marshal.SizeOf(typeof(KeyInput)));
  }
}
'@
  $read={
    Assert-NativeReadDesktopScope $Scope
    $empty=@{noConsent=$false;activeDefault=$false;noForeground=$false;ownerVerified=$false;sameSession=$false;kind='unknown';witness=$null;windowVisibility=$null}
    if(@(Get-CimInstance Win32_Process -Filter "Name='consent.exe'").Count) { return $empty }
    $empty.noConsent=$true;$native=[NativeReadDesktop]::Probe()
    if(-not $native.ActiveDefault) { return $empty };$empty.activeDefault=$true
    try { $empty.windowVisibility=[NativeReadDesktop]::ReadWindowVisibility($native.Window) } catch {}
    if($native.Window -eq 0) { $empty.noForeground=$true;$empty.kind='none';return $empty }
    $owner=Get-CimInstance Win32_Process -Filter ('ProcessId='+$native.Pid)
    if(-not $owner -or $owner.SessionId -ne $Scope.sessionId -or -not $owner.CreationDate) { return $empty };$empty.sameSession=$true
    $kind=if($owner.Name -ieq 'StartMenuExperienceHost.exe' -and $owner.ExecutablePath -match '^C:\\Windows\\SystemApps\\[^\\]+\\StartMenuExperienceHost\.exe$'){'start'}elseif($owner.Name -ieq 'SearchHost.exe' -and $owner.ExecutablePath -match '^C:\\Windows\\SystemApps\\[^\\]+\\SearchHost\.exe$'){'search'}elseif($owner.Name -ieq 'explorer.exe' -and $owner.ExecutablePath -ieq 'C:\Windows\explorer.exe' -and $native.ClassName -cin @('Progman','WorkerW','Shell_TrayWnd')){'desktop'}else{'unknown'}
    if($kind -ceq 'unknown') { return $empty }
    $signature=Get-AuthenticodeSignature -LiteralPath $owner.ExecutablePath
    if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft') { return $empty }
    return @{noConsent=$true;activeDefault=$true;ownerVerified=$true;sameSession=$true;kind=$kind;witness=($native.Window.ToString()+':'+$owner.ProcessId+':'+$owner.CreationDate.ToUniversalTime().ToString('o'));window=$native.Window;pid=$owner.ProcessId;windowVisibility=$empty.windowVisibility}
  }
  $dismiss={param($Expected)
    $fresh=Read-NativeReadDesktopObservation $read $Proof
    if($fresh.witness -cne $Expected.witness -or $fresh.noConsent -ne $true -or $fresh.activeDefault -ne $true -or $fresh.kind -cnotin @('start','search')) { throw 'Native desktop changed' }
    return [NativeReadDesktop]::Escape([long]$fresh.window,[uint32]$fresh.pid)
  }
  try { Invoke-NativeReadDesktopPreparation $Scope $Proof $read $dismiss }
  catch { $Proof.status='FAIL';if(-not $Proof.code){$Proof.code='probe-or-input-refused'};throw 'Native desktop precondition refused' }
}

$ErrorActionPreference='Stop'
$root='C:\aegis-native-read';$bundle=Join-Path $root 'input';$source=Join-Path $root 'source'
$context=Get-Content -LiteralPath (Join-Path $bundle 'context.json') -Raw | ConvertFrom-Json
$result=[ordered]@{schema='aegis-cloud-native-phase/1';status='FAIL';phase=$Phase;sourceSha=$context.sourceSha;sessionId=(Get-Process -Id $PID).SessionId;integritySid=$null;boot=$null;error=$null}
try {
  $os=Get-CimInstance Win32_OperatingSystem;$current=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
  if($os.Caption -notmatch 'Windows 11' -or $os.ProductType -ne 1 -or $os.BuildNumber -ne '26300' -or $current.UBR -ne 9457 -or $current.EditionID -ne 'EnterpriseEval' -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -or $env:USERNAME -ne 'AegisSetup' -or $result.sessionId -eq 0 -or -not [Environment]::UserInteractive) { throw 'Exact disposable interactive Win11 x64 guest required' }
  $groups=(& ($env:SystemRoot+'\System32\whoami.exe') /groups /fo csv /nh) -join "`n"
  if($LASTEXITCODE -ne 0 -or $groups.Length -gt 64KB -or $groups -notmatch 'S-1-16-8192' -or $groups -match 'S-1-16-12288') { throw 'Limited medium-integrity phase required' }
  $result.integritySid='S-1-16-8192';$result.boot=$os.LastBootUpTime.ToUniversalTime().ToString('o')
  $env:GITHUB_ACTIONS='true';$env:RUNNER_ENVIRONMENT='github-hosted-hyperv-guest';$env:RUNNER_OS='Windows';$env:RUNNER_ARCH='X64'
  $env:GITHUB_SHA=$context.sourceSha;$env:GITHUB_RUN_ID=$context.runId;$env:GITHUB_RUN_ATTEMPT=$context.attempt
  $env:GITHUB_WORKSPACE=$source;$env:RUNNER_TEMP=$root;$env:CI='true';$env:HUSKY='0'
  $env:GIT_CONFIG_NOSYSTEM='1';$env:GIT_CONFIG_GLOBAL=Join-Path $root 'absent-global-gitconfig';$env:GIT_CONFIG_COUNT='0'
  $env:GIT_EXEC_PATH=Join-Path $bundle 'runtime/git/libexec/git-core'
  $env:PATH=(Join-Path $bundle 'runtime')+';'+(Join-Path $bundle 'runtime/git/bin')+';'+$env:SystemRoot+'\System32;'+$env:SystemRoot+'\System32\WindowsPowerShell\v1.0;'+$env:SystemRoot+'\System32\Wbem;'+$env:SystemRoot
  $env:TEMP=Join-Path $root 'temp';$env:TMP=$env:TEMP
  Remove-Item Env:GH_TOKEN,Env:GITHUB_TOKEN,Env:AEGIS_ETW_QUALIFICATION_HOST,Env:ELECTRON_RUN_AS_NODE,Env:NODE_OPTIONS -ErrorAction SilentlyContinue
  Set-Location -LiteralPath $source
  if((git rev-parse HEAD) -cne $context.sourceSha -or (git rev-parse 'HEAD^{tree}') -cne $context.sourceTree -or (git status --porcelain --untracked-files=normal)) { throw 'Guest source binding changed' }
  $result.desktopPreparation=@{status='RUNNING';code=$null;scopeVerified=$false;activeDefaultObserved=$false;noConsentObserved=$false;overlayDismissals=@()}
  $desktopScope=@{root=$root;source=$source;bundle=$bundle;runner=$env:RUNNER_ENVIRONMENT;githubActions=$env:GITHUB_ACTIONS;ci=$env:CI;runnerOS=$env:RUNNER_OS;runnerArch=$env:RUNNER_ARCH;username=$env:USERNAME;interactive=[Environment]::UserInteractive;sessionId=$result.sessionId;integritySid=$result.integritySid;sourceSha=$context.sourceSha;expectedSourceSha=$env:GITHUB_SHA;runId=$context.runId;attempt=$context.attempt;caption=$os.Caption;productType=$os.ProductType;build=$os.BuildNumber;ubr=$current.UBR;architecture=$env:PROCESSOR_ARCHITECTURE}
  try { Initialize-NativeReadDesktop $desktopScope $result.desktopPreparation }
  catch { $result.desktopPreparation.status='FAIL';if(-not $result.desktopPreparation.code){$result.desktopPreparation.code='preparation-refused'};throw }
  finally {
    $desktopJson=$result.desktopPreparation | ConvertTo-Json -Depth 6 -Compress
    $desktopFile=Join-Path $root ($Phase+'-desktop.json')
    if([Text.Encoding]::UTF8.GetByteCount($desktopJson) -gt 4096 -or (Test-Path -LiteralPath $desktopFile)) { throw 'Desktop precondition receipt refused' }
    [IO.File]::WriteAllText($desktopFile,$desktopJson,[Text.UTF8Encoding]::new($false))
  }
  $node=Join-Path $bundle 'runtime/node.exe'
  $arguments=@()
  if($Phase -in @('admission-preflight','admission')) {
    $arguments=@('scripts/qualification/windows-native-read-probe.mjs','--source-sha',$context.sourceSha,'--candidate',(Join-Path $bundle 'candidate'),'--build-receipt',(Join-Path $bundle 'reboot-build.json'),'--config',(Join-Path $bundle 'etw-builder.json'),'--output',(Join-Path $root ('evidence/'+$Phase)))
  } else {
    $arguments=@('tools/development/etw-reboot.mjs','--phase',$Phase,'--source-sha',$context.sourceSha,'--candidate',(Join-Path $bundle 'candidate'),'--build-receipt',(Join-Path $bundle 'reboot-build.json'),'--config',(Join-Path $bundle 'etw-builder.json'),'--output',(Join-Path $root ('evidence/'+$Phase)))
    if($Phase -eq 'resume') { $arguments+=@('--prepared',(Join-Path $root 'evidence/prepare/receipt.json')) }
  }
  & $node @arguments *> (Join-Path $root ($Phase+'.log'))
  if($LASTEXITCODE -ne 0) { throw 'Bounded native-read driver failed; retain its linked receipt' }
  $receipt=Get-Content -LiteralPath (Join-Path $root ('evidence/'+$Phase+'/receipt.json')) -Raw | ConvertFrom-Json
  $expected=if($Phase -eq 'prepare') {'PREPARED'} else {'PASS'}
  if($receipt.status -cne $expected -or $receipt.sourceHead -cne $context.sourceSha) { throw 'Native-read receipt/source mismatch' }
  $result.receiptStatus=$receipt.status;$result.status='PASS'
} catch { $result.error=$_.Exception.Message }
finally { $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $root ($Phase+'-done.json')) -Encoding utf8 }
if($result.status -cne 'PASS') { exit 1 }
