param([Parameter(Mandatory)][string]$Source,[Parameter(Mandatory)][string]$Build)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'cloud-guest-media.ps1')
Assert-CloudGuestRunner
if($PSVersionTable.PSEdition -ne 'Desktop' -or $env:RUNNER_ARCH -cne 'X64') { throw 'Hosted x64 Windows PowerShell required' }
$root='D:\aegis-native-read-'+$env:GITHUB_RUN_ID+'-'+$env:GITHUB_RUN_ATTEMPT
if([IO.Path]::GetFullPath($Source) -ine ($root+'\source') -or [IO.Path]::GetFullPath($Build) -ine ($root+'\build') -or -not (Test-Path -LiteralPath ($Build+'\evidence\reboot-build.json'))) { throw 'Owned source/build paths required' }
for($ancestor=Get-Item -LiteralPath $root;$null -ne $ancestor;$ancestor=$ancestor.Parent) { if($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked native-read controller storage refused' } }
if((Get-PSDrive D).Free -lt 32GB) { throw 'Native-read guest storage reserve unavailable' }
foreach($part in @('evidence','temp','media','native','vm')) {
  $target=Join-Path $root $part
  if(Test-Path -LiteralPath $target) { throw 'Fresh native-read controller outputs required' }
  New-Item -ItemType Directory -Path $target | Out-Null
}
('AEGIS_NATIVE_EVIDENCE='+$root+'\evidence') | Add-Content -LiteralPath $env:GITHUB_ENV
$env:TEMP=Join-Path $root 'temp';$env:TMP=$env:TEMP
. (Join-Path $PSScriptRoot 'cloud-hyperv-operations.ps1')
. (Join-Path $PSScriptRoot 'cloud-guest-vm.ps1')
. (Join-Path $PSScriptRoot 'windows-native-read-host.ps1')
$report=[ordered]@{schema='aegis-cloud-native-read/1';status='RUNNING';sourceSha=$env:GITHUB_SHA;runId=$env:GITHUB_RUN_ID;attempt=$env:GITHUB_RUN_ATTEMPT;productionAdmission=$false;guest=$null;stages=@();phaseTasks=@{};diskSamples=@();consents=@();cleanup=@{offObserved=$false;removedObserved=$false;filesRemoved=@();leafObservations=@();retainedTaskDirectories=@('build','bundle','bootstrap','source','native','temp','git-preflight','package-preflight')};error=$null;cleanupError=$null}
$name='aegis-cloud-'+$env:GITHUB_RUN_ID+'-'+$env:GITHUB_RUN_ATTEMPT+'-'+[guid]::NewGuid().ToString('N')
$vmRoot=Join-Path $root 'vm';$iso=Join-Path $root 'media/windows.iso';$answerIso=Join-Path $root 'media/answer.iso'
$id=$null;$owner=$null;$session=$null;$mounted=$false;$unknown=$false;$consent=[Collections.ArrayList]::new()
function SaveReport { $report.consents=@($consent);$report | ConvertTo-Json -Depth 18 | Set-Content -LiteralPath (Join-Path $root 'evidence/cloud.json') -Encoding UTF8 }
function Sample([string]$Phase) {
  $free=(Get-PSDrive D).Free;$disk=Join-Path $vmRoot 'guest.vhdx'
  if($report.diskSamples.Count -lt 160) { $report.diskSamples+=@{phase=$Phase;at=[DateTime]::UtcNow.ToString('o');freeBytes=$free;vhdBytes=$(if(Test-Path -LiteralPath $disk){(Get-Item -LiteralPath $disk).Length}else{0})} }
  SaveReport;if($free -lt 3GB) { throw 'Native-read storage reserve exhausted' }
}
function Stage([string]$Label,[scriptblock]$Action) {
  Write-Host ('Stage: '+$Label);$started=[DateTime]::UtcNow
  $report.currentStage=@{name=$Label;status='RUNNING';startedAt=$started.ToString('o')};SaveReport
  try { $value=& $Action;$report.currentStage.status='PASS';$report.stages+=@{name=$Label;status='PASS';seconds=([DateTime]::UtcNow-$started).TotalSeconds};SaveReport;return $value }
  catch { $report.currentStage.status='FAIL';$report.stages+=@{name=$Label;status='FAIL';seconds=([DateTime]::UtcNow-$started).TotalSeconds};SaveReport;throw }
}
function WaitGuest([bool]$AfterRestart) {
  $deadline=[DateTime]::UtcNow.AddMinutes($(if($AfterRestart){6}else{18}));$attempt=0
  $watch=[Diagnostics.Stopwatch]::StartNew();$nextHeartbeat=0
  do {
    Sample $(if($AfterRestart){'restart-readiness'}else{'setup-readiness'})
    if($watch.Elapsed.TotalSeconds -ge $nextHeartbeat) {
      Write-Host ('Guest readiness: afterRestart='+$AfterRestart+'; elapsed='+[int]$watch.Elapsed.TotalSeconds+'s; attempts='+$attempt)
      $nextHeartbeat=$watch.Elapsed.TotalSeconds+30
    }
    try {
      $script:session=New-PSSession -VMId ([guid]$id) -Credential $credential -ErrorAction Stop
      $ready=Invoke-Command -Session $session -ScriptBlock {
        $os=Get-CimInstance Win32_OperatingSystem;$current=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
        if((Get-ItemProperty 'HKLM:\SYSTEM\Setup').SystemSetupInProgress -ne 0 -or -not @(Get-Process explorer -ErrorAction SilentlyContinue | Where-Object SessionId -gt 0).Count) { return $null }
        if($env:USERNAME -ne 'AegisSetup' -or $os.Caption -notmatch 'Windows 11' -or $os.ProductType -ne 1 -or $os.BuildNumber -ne '26300' -or $current.UBR -ne 9457 -or $current.EditionID -ne 'EnterpriseEval' -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'Exact native-read guest mismatch' }
        return @{caption=$os.Caption;build=$os.BuildNumber;ubr=$current.UBR;edition=$current.EditionID;architecture='x64';boot=$os.LastBootUpTime.ToUniversalTime().ToString('o');observedAt=[DateTime]::UtcNow.ToString('o');interactiveProfileReady=$true}
      }
      if($ready) { return $ready }
    } catch { $report.lastReadinessError=$_.Exception.GetType().Name }
    if($session) { Remove-PSSession $session -ErrorAction SilentlyContinue;$script:session=$null }
    $attempt++
    if(-not $AfterRestart -and $attempt -in @(12,36,72,102)) { $index=[array]::IndexOf(@(12,36,72,102),$attempt)+1;$report.setupCapture=Save-NativeReadCapture $id $name $vmRoot (Join-Path $root 'evidence') $index 'setup' }
    Start-Sleep -Seconds 10
  } while([DateTime]::UtcNow -lt $deadline)
  throw 'Native-read guest readiness deadline exceeded'
}
try {
  $os=Get-CimInstance Win32_OperatingSystem;$computer=Get-CimInstance Win32_ComputerSystem
  if($os.Caption -notmatch 'Windows Server 2025' -or -not $computer.HypervisorPresent -or (Get-Service vmms).Status -ne 'Running' -or $computer.TotalPhysicalMemory -lt 8GB -or @(Get-CimInstance Win32_Processor | Where-Object Architecture -ne 9).Count) { throw 'Disposable hosted Hyper-V prerequisites unavailable' }
  if((git -C $Source rev-parse HEAD) -cne $env:GITHUB_SHA -or (git -C $Source status --porcelain --untracked-files=normal)) { throw 'Cloud source revision/cleanliness mismatch' }
  $report.host=@{caption=$os.Caption;build=$os.BuildNumber;architecture=$env:RUNNER_ARCH;hypervisorPresent=$true;memoryBytes=$computer.TotalPhysicalMemory}
  Stage 'preflight-actual-marked-package-window-before-vm' {
    $preflightOutput=Join-Path $root 'package-preflight'
    & node (Join-Path $Source 'tools/development/etw-window-preflight.mjs') --source-sha $env:GITHUB_SHA --candidate (Join-Path $Build 'package/win-unpacked') --build-receipt (Join-Path $Build 'evidence/reboot-build.json') --config (Join-Path $Build 'etw-builder.json') --output $preflightOutput | Out-Host
    $preflightExit=$LASTEXITCODE
    $receiptPath=Join-Path $preflightOutput 'receipt.json'
    if(-not (Test-Path -LiteralPath $receiptPath)) { throw 'Actual package-window preflight receipt unavailable' }
    $receiptFile=Get-Item -LiteralPath $receiptPath -Force
    if($receiptFile.PSIsContainer -or ($receiptFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $receiptFile.Length -lt 1 -or $receiptFile.Length -gt 16384) { throw 'Actual package-window preflight receipt budget/layout refused' }
    try { $proof=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($receiptPath)) -ErrorAction Stop }
    catch { throw 'Actual package-window preflight receipt refused' }
    if($proof -isnot [pscustomobject] -or $proof.schema -isnot [string] -or $proof.schema -cne 'aegis-package-window-preflight/1' -or $proof.sourceHead -isnot [string] -or $proof.sourceHead -cne $env:GITHUB_SHA -or $proof.status -isnot [string] -or $proof.status -cnotin @('PASS','FAIL')) { throw 'Actual package-window preflight identity refused' }
    # Preserve failed actual flags before refusing, without copying the owned profile/home.
    $report.packageWindowPreflight=$proof
    $evidencePath=Join-Path $root 'evidence/package-window-preflight.json'
    if(Test-Path -LiteralPath $evidencePath) { throw 'Fresh actual package-window evidence required' }
    Copy-Item -LiteralPath $receiptPath -Destination $evidencePath
    SaveReport
    if($preflightExit -ne 0 -or $proof.status -cne 'PASS') { throw 'Actual package-window preflight refused; retained receipt contains actual flags' }
    foreach($field in @('bindingObserved','bindingUnchanged','normalCloseRequested','normalCloseObserved','noEtwArguments','outputWithinBudget')) {
      if($proof.$field -isnot [bool] -or $proof.$field -ne $true) { throw 'Actual package-window preflight closure/binding refused' }
    }
    if($proof.window -isnot [pscustomobject]) { throw 'Actual package-window preflight observation refused' }
    foreach($field in @('observationValid','packaged','diagnosticBuild','windowPresent','sameWindow','windowStateObserved','isolationRequested','windowInputIsolated','settled')) {
      if($proof.window.$field -isnot [bool] -or $proof.window.$field -ne $true) { throw 'Actual package-window preflight observation refused' }
    }
    foreach($field in @('timedOut','focusable','focused')) {
      if($proof.window.$field -isnot [bool] -or $proof.window.$field -ne $false) { throw 'Actual package-window preflight isolation refused' }
    }
    if(($proof.exitCode -isnot [int] -and $proof.exitCode -isnot [long]) -or $proof.exitCode -ne 0 -or $null -ne $proof.failureCode -or $null -ne $proof.closeFailureCode) { throw 'Actual package-window preflight ordinary close refused' }
  } | Out-Null
  $bundle=Stage 'freeze-portable-current-candidate-inputs-before-vm' {
    $staging=Join-Path $root 'bundle'
    & node (Join-Path $Source 'tools/development/cloud-native-read-inputs.mjs') --source $Source --build $Build --output $staging | Out-Host
    if($LASTEXITCODE -ne 0) { throw 'Native-read input construction or sterile Git preflight failed' }
    $reader=(Get-Command ConvertFrom-NativeReadManifest -CommandType Function).ScriptBlock.ToString()
    $report.inputPreflight=Test-NativeReadInputFiles $staging $reader
    $report.portableGit=Get-Content -LiteralPath (Join-Path $root 'evidence/portable-git.json') -Raw | ConvertFrom-Json
    if($report.portableGit.status -cne 'PASS' -or $report.portableGit.preflight.originalPathFallback -ne $false) { throw 'Portable Git preflight was not confirmed' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip=Join-Path $root 'input.zip';[IO.Compression.ZipFile]::CreateFromDirectory($staging,$zip,[IO.Compression.CompressionLevel]::Fastest,$false)
    if((Get-Item -LiteralPath $zip).Length -gt 1GB) { throw 'Native-read compressed input budget' }
    return @{path=$zip;bytes=(Get-Item -LiteralPath $zip).Length;sha256=(Get-FileHash -LiteralPath $zip).Hash.ToLowerInvariant()}
  }
  $report.bundle=@{bytes=$bundle.bytes;sha256=$bundle.sha256}
  Stage 'compile-existing-owned-vm-helpers' {
    Add-Type -Path (Join-Path $PSScriptRoot 'CloudGuestMetadata.cs') -ReferencedAssemblies @('System.dll','System.Core.dll','System.Net.Http.dll')
    $files=@('scripts/qualification/CloudGuestVm.cs','scripts/qualification/CloudGuestBootDiagnostics.cs','sidecar/session/OwnedVmLifecycle.cs','sidecar/session/VmManagementNative.cs')
    Add-Type -Path @($files | ForEach-Object { Join-Path $Source $_ }) -ReferencedAssemblies @('System.dll','System.Core.dll','System.Management.dll')
  } | Out-Null
  Stage 'create-exact-owned-vm' {
    if((Invoke-CloudHyperVCommand recover $name $vmRoot $null).exists) { throw 'VM name already exists' }
    $script:unknown=$true;$created=Invoke-CloudHyperVCommand create $name $vmRoot $null
    if(-not $created.exists -or $created.vmId -cnotmatch '^[a-f0-9-]{36}$') { throw 'Owned VM creation unresolved' }
    $script:id=$created.vmId;$report.vmId=$id;$script:unknown=$false
  } | Out-Null
  $report.media=Stage 'download-pinned-microsoft-evaluation-iso' {
    $url='https://software-static.download.prss.microsoft.com/dbazure/26300.9457.260913-1737.26h2_ge_release_svc_refresh_CLIENTENTERPRISEEVAL_OEMRET_x64FRE_en-us.iso'
    $observation=[CloudGuestMetadata+DownloadObservation]::new();$hash=[CloudGuestMetadata]::Download($url,$iso,8225329152,$observation)
    if($hash -cne 'bc3f24086ebadc94489066b5ad78089e2cf5c3491e90e790bb81a2b199c10e38') { throw 'Evaluation ISO hash mismatch' }
    return @{url=$url;bytes=8225329152;sha256=$hash;license='Microsoft 90-day Enterprise Evaluation; disposable testing'}
  }
  $metadata=Stage 'verify-exact-read-only-image' {
    Mount-DiskImage -ImagePath $iso -Access ReadOnly | Out-Null;$script:mounted=$true
    $volumes=@(Get-DiskImage -ImagePath $iso | Get-Volume | Where-Object DriveLetter)
    if($volumes.Count -ne 1) { throw 'Pinned ISO read-only volume unavailable' }
    $value=Get-CloudGuestImageMetadata ([CloudGuestMetadata]::ImageXml(($volumes[0].DriveLetter+':\sources\install.wim')))
    Dismount-DiskImage -ImagePath $iso | Out-Null;$script:mounted=$false;return $value
  }
  $adminPassword=[guid]::NewGuid().ToString('N')+'aA1!';$taskPassword=[guid]::NewGuid().ToString('N')+'bB2!'
  $credential=[pscredential]::new('AegisSetup',(ConvertTo-SecureString $adminPassword -AsPlainText -Force))
  Stage 'prepare-bounded-two-logon-answer' {
    $text=New-CloudGuestAnswerText $metadata.index $adminPassword $taskPassword
    $text=Set-NativeReadSecondLogon $text
    New-CloudGuestAnswerIso (Join-Path $root 'media/answer') $answerIso $text
  } | Out-Null
  $report.hardware=Stage 'configure-offline-native-guest' {
    $script:unknown=$true;$value=Invoke-CloudGuestConfiguration $id $name $vmRoot $iso $answerIso;$script:unknown=$false;return $value
  }
  Stage 'boot-native-windows11' {
    $script:owner=[CloudGuestVm]::new($id)
    if(-not $owner.Start() -or $owner.PendingUnknown) { throw 'Owned VM start unconfirmed' }
    $boot=Invoke-CloudGuestBootWindow $owner -KeyWindowMilliseconds 8000
    if($boot.mandatoryFailure) { throw 'Owned guest boot key outcome unresolved' };$report.boot=$boot
  } | Out-Null
  $report.guest=Stage 'observe-first-interactive-boot' { WaitGuest $false }
  Stage 'detach-owned-installation-media' { Remove-CloudGuestInstallationMedia $id $name $vmRoot ([ref]$unknown) | Out-Null } | Out-Null
  $report.input=Stage 'verify-inputs-and-reconstruct-real-isolated-worktree' { Initialize-NativeReadGuest $session $bundle }
  Stage 'observe-unchanged-native-object-capability-before-recovery' {
    $report.capability=Test-NativeReadCapability $session
    if($report.capability.status -cne 'PASS') { throw 'Exact guest object bridge capability refused; token privileges were not changed' }
  } | Out-Null
  $report.preparation=Stage 'prepare-current-candidate-recovery' { Invoke-NativeReadPhase $session $root 'prepare' $consent $id $name $vmRoot }
  Stage 'restart-only-exact-owned-guest-after-prepared' {
    $prepared=Invoke-Command -Session $session -ScriptBlock { Get-Content -LiteralPath 'C:\aegis-native-read\evidence\prepare\receipt.json' -Raw | ConvertFrom-Json }
    if($prepared.status -cne 'PREPARED' -or $prepared.phase -cne 'prepare' -or $prepared.sourceHead -cne $env:GITHUB_SHA -or $prepared.productionAdmission -ne $false -or -not $prepared.completedAt) { throw 'Prepared recovery restart prerequisite failed' }
    $report.preparedCompletedAt=$prepared.completedAt
    $vm=Get-VM -Id ([guid]$id)
    if($vm.Name -cne $name -or $vm.State -ne 'Running' -or -not $vm.ConfigurationLocation.StartsWith($vmRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Guest restart ownership changed' }
    Invoke-Command -Session $session -ScriptBlock { & ($env:SystemRoot+'\System32\shutdown.exe') /r /t 2 /f;if($LASTEXITCODE -ne 0) { throw 'Guest restart request refused' } }
    Remove-PSSession $session;$script:session=$null
    Start-Sleep -Seconds 15
  } | Out-Null
  $report.afterRestart=Stage 'observe-new-interactive-boot' { WaitGuest $true }
  if([DateTime]::Parse($report.afterRestart.boot) -le [DateTime]::Parse($report.preparedCompletedAt) -or $report.afterRestart.boot -ceq $report.guest.boot) { throw 'A genuine later guest restart was not observed' }
  Stage 'remove-guest-only-autologon-secrets' {
    Invoke-Command -Session $session -ScriptBlock {
      $key='HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
      Set-ItemProperty -LiteralPath $key -Name AutoAdminLogon -Value '0'
      Remove-ItemProperty -LiteralPath $key -Name DefaultPassword,AutoLogonCount -ErrorAction SilentlyContinue
      $value=Get-ItemProperty -LiteralPath $key
      if($value.AutoAdminLogon -ne '0' -or $null -ne $value.PSObject.Properties['DefaultPassword'] -or $null -ne $value.PSObject.Properties['AutoLogonCount']) { throw 'Guest autologon secret cleanup unconfirmed' }
    }
  } | Out-Null
  $report.recovery=Stage 'qualify-restart-recovery-and-fresh-sync-pending-io' { Invoke-NativeReadPhase $session $root 'resume' $consent $id $name $vmRoot }
  $report.admission=Stage 'qualify-real-object-read-alert-and-displayed-risk' { Invoke-NativeReadPhase $session $root 'admission' $consent $id $name $vmRoot }
  $report.status='PASS'
} catch { $report.status='FAIL';$report.error=$_.Exception.Message;Write-Warning $report.error }
finally {
  if($session) { try { Copy-NativeReadEvidence $session $root } catch { $report.evidenceError=$_.Exception.Message;$report.status='FAIL' };Remove-PSSession $session -ErrorAction SilentlyContinue }
  try {
    if($owner) {
      if($owner.PendingUnknown -or $unknown) { throw 'Owned VM provider outcome unresolved' }
      if(-not $owner.Stop() -or -not $owner.ObserveOff()) { throw 'Owned VM off state unconfirmed' };$report.cleanup.offObserved=$true
    }
    if($id -and -not $unknown) {
      if((Invoke-CloudHyperVCommand observe $name $vmRoot $id).state -ne 'Off') { throw 'Exact VM must be off before removal' }
      $removed=Invoke-CloudHyperVCommand remove $name $vmRoot $id
      if(-not $removed.removedCommandCompleted -or (Invoke-CloudHyperVCommand observe $name $vmRoot $id).exists) { throw 'Owned VM removal unconfirmed' };$report.cleanup.removedObserved=$true
    }
    if($mounted) { Dismount-DiskImage -ImagePath $iso | Out-Null;$mounted=$false }
    if($report.cleanup.removedObserved) {
      foreach($file in @($iso,$answerIso,(Join-Path $root 'media/answer/Autounattend.xml'),(Join-Path $root 'input.zip'),(Join-Path $vmRoot 'guest.vhdx'))) {
        $full=[IO.Path]::GetFullPath($file)
        if(-not $full.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Owned cleanup escaped controller root' }
        $existed=Test-Path -LiteralPath $full;$beforeBytes=0
        if($existed) {
          $item=Get-Item -LiteralPath $full
          if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Owned cleanup refuses linked/non-file leaf' }
          $beforeBytes=$item.Length
          Remove-Item -LiteralPath $full -Force
        }
        $absentAfter=-not (Test-Path -LiteralPath $full)
        $report.cleanup.leafObservations+=@{name=[IO.Path]::GetFileName($full);existed=$existed;beforeBytes=$beforeBytes;absentAfter=$absentAfter}
        if(-not $absentAfter) { throw 'Owned cleanup leaf absence unconfirmed' }
        if($existed) { $report.cleanup.filesRemoved+=[IO.Path]::GetFileName($full) }
      }
    }
  } catch { $report.cleanupError=$_.Exception.Message;$report.status='FAIL' }
  if($owner) { $owner.Dispose() }
  if($report.status -ceq 'PASS' -and (-not $report.cleanup.offObserved -or -not $report.cleanup.removedObserved)) { $report.status='FAIL' }
  Sample 'complete';SaveReport
}
if($report.status -cne 'PASS') { throw ('Cloud native-read qualification failed: '+$report.error+'; cleanup: '+$report.cleanupError) }
