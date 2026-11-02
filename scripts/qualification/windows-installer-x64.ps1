param([Parameter(Mandatory)][ValidateSet('fresh','upgrade','auto-update','all-users','all-users-update')][string]$Scenario)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'cloud-guest-media.ps1')
Assert-CloudGuestRunner
if($PSVersionTable.PSEdition -ne 'Desktop' -or $env:RUNNER_ARCH -ne 'X64') { throw 'Hosted native x64 Windows PowerShell required' }
$root='D:\aegis-installer-x64-'+$env:GITHUB_RUN_ID+'-'+$env:GITHUB_RUN_ATTEMPT+'-'+$Scenario
if(Test-Path -LiteralPath $root) { throw 'Fresh owned cloud root required' }
$ancestor=Get-Item -LiteralPath D:/
while($null -ne $ancestor) { if($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked cloud storage refused' };$ancestor=$ancestor.Parent }
if((Get-PSDrive D).Free -lt 32GB) { throw 'At least 32 GiB free on data drive required before Windows guest preparation' }
New-Item -ItemType Directory -Path $root | Out-Null
foreach($part in @('evidence','temp','media','native','vm')) { New-Item -ItemType Directory -Path (Join-Path $root $part) | Out-Null }
('AEGIS_X64_EVIDENCE='+$root+'\evidence') | Add-Content -LiteralPath $env:GITHUB_ENV
$env:TEMP=Join-Path $root 'temp';$env:TMP=$env:TEMP
. (Join-Path $PSScriptRoot 'cloud-hyperv-operations.ps1')
. (Join-Path $PSScriptRoot 'cloud-guest-vm.ps1')
. (Join-Path $PSScriptRoot 'windows-installer-x64-bundle.ps1')
. (Join-Path $PSScriptRoot 'windows-updater-network.ps1')
. (Join-Path $PSScriptRoot 'windows-installer-setup-diagnostics.ps1')
. (Join-Path $PSScriptRoot 'windows-installer-all-users-host.ps1')
. (Join-Path $PSScriptRoot 'windows-all-users-update-host.ps1')
$report=[ordered]@{schema='aegis-installer-hyperv/1';status='RUNNING';sourceSha=$env:GITHUB_SHA;runId=$env:GITHUB_RUN_ID;attempt=$env:GITHUB_RUN_ATTEMPT;scenario=$Scenario;host=$null;media=$null;hardware=$null;bundle=$null;guest=$null;diskSamples=@();stages=@();cleanup=@{offObserved=$false;removedObserved=$false;filesRemoved=@()};error=$null;cleanupError=$null}
$name='aegis-cloud-'+$env:GITHUB_RUN_ID+'-'+$env:GITHUB_RUN_ATTEMPT+'-'+[guid]::NewGuid().ToString('N')
$vmRoot=Join-Path $root 'vm';$iso=Join-Path $root 'media/windows.iso';$answerIso=Join-Path $root 'media/answer.iso'
$id=$null;$owner=$null;$session=$null;$mounted=$false;$unknown=$false;$networkAttempted=$false;$networkUnknown=$false
function SaveReport { $report | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath (Join-Path $root 'evidence/hyperv.json') -Encoding UTF8 }
function Sample([string]$Phase) {
  $free=(Get-PSDrive D).Free
  $disk=Join-Path $vmRoot 'guest.vhdx'
  $report.diskSamples+=@{phase=$Phase;at=[DateTime]::UtcNow.ToString('o');freeBytes=$free;vhdBytes=$(if(Test-Path -LiteralPath $disk){(Get-Item -LiteralPath $disk).Length}else{0})}
  SaveReport
  if($free -lt 3GB) { throw 'Cloud storage reserve exhausted' }
}
function Stage([string]$Label,[scriptblock]$Action) {
  Write-Host ('Stage: '+$Label)
  $started=[DateTime]::UtcNow
  try { $value=& $Action; $report.stages+=@{name=$Label;status='PASS';seconds=([DateTime]::UtcNow-$started).TotalSeconds};SaveReport;return $value }
  catch { $report.stages+=@{name=$Label;status='FAIL';seconds=([DateTime]::UtcNow-$started).TotalSeconds};SaveReport;throw }
}
try {
  $os=Get-CimInstance Win32_OperatingSystem;$computer=Get-CimInstance Win32_ComputerSystem
  if($os.Caption -notmatch 'Windows Server 2025' -or -not $computer.HypervisorPresent -or (Get-Service vmms).Status -ne 'Running' -or $computer.TotalPhysicalMemory -lt 8GB -or @(Get-CimInstance Win32_Processor | Where-Object Architecture -ne 9).Count) { throw 'Hosted x64 Hyper-V prerequisites unavailable' }
  $report.host=@{caption=$os.Caption;build=$os.BuildNumber;architecture=$os.OSArchitecture;runnerArchitecture=$env:RUNNER_ARCH;hypervisorPresent=$computer.HypervisorPresent;memoryBytes=$computer.TotalPhysicalMemory;vmms='Running'}
  if((git -C $env:GITHUB_WORKSPACE rev-parse HEAD) -ne $env:GITHUB_SHA) { throw 'Workflow source SHA mismatch' }
  Sample 'preflight'
  if($Scenario -in @('auto-update','all-users-update')) {
    Stage 'preflight-isolated-update-network' {
      if(@(Get-NetNat).Count -or @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -like '192.168.241.*').Count) { throw 'Existing/conflicting hosted NAT refused before guest preparation' }
      return @{existingNatCount=0;subnetAvailable=$true}
    } | Out-Null
  }
  Stage 'compile-existing-media-and-vm-helpers' {
    Add-Type -Path (Join-Path $PSScriptRoot 'CloudGuestMetadata.cs') -ReferencedAssemblies @('System.dll','System.Core.dll','System.Net.Http.dll')
    $sources=@('scripts/qualification/CloudGuestVm.cs','scripts/qualification/CloudGuestBootDiagnostics.cs','sidecar/session/OwnedVmLifecycle.cs','sidecar/session/VmManagementNative.cs')
    Add-Type -Path @($sources | ForEach-Object { Join-Path $env:GITHUB_WORKSPACE $_ }) -ReferencedAssemblies @('System.dll','System.Core.dll','System.Management.dll')
  } | Out-Null
  Stage 'create-owned-vm' {
    if((Invoke-CloudHyperVCommand recover $name $vmRoot $null).exists) { throw 'VM already exists' }
    $script:unknown=$true
    $created=Invoke-CloudHyperVCommand create $name $vmRoot $null
    if(-not $created.exists -or $created.vmId -notmatch '^[a-f0-9-]{36}$') { throw 'VM creation unresolved' }
    $script:id=$created.vmId;$report.vmId=$id;$script:unknown=$false
  } | Out-Null
  if($Scenario -in @('auto-update','all-users-update')) {
    Stage 'prepare-owned-update-network-before-media' {
      $script:networkAttempted=$true;$script:networkUnknown=$true
      $report.networkPreparation=Invoke-UpdaterNetwork 'prepare' $id $name $vmRoot
      $script:networkUnknown=$false
      if($report.networkPreparation.status -ne 'PASS') { throw ('Update network '+$report.networkPreparation.phase+': '+$report.networkPreparation.error) }
    } | Out-Null
  }
  $report.media=Stage 'download-and-verify-microsoft-evaluation-iso' {
    $url='https://software-static.download.prss.microsoft.com/dbazure/26300.9457.260913-1737.26h2_ge_release_svc_refresh_CLIENTENTERPRISEEVAL_OEMRET_x64FRE_en-us.iso'
    $observation=[CloudGuestMetadata+DownloadObservation]::new()
    $hash=[CloudGuestMetadata]::Download($url,$iso,8225329152,$observation)
    if($hash -ne 'bc3f24086ebadc94489066b5ad78089e2cf5c3491e90e790bb81a2b199c10e38') { throw 'Microsoft ISO pin mismatch' }
    return @{url=$url;bytes=8225329152;sha256=$hash;license='Microsoft 90-day Enterprise Evaluation; disposable testing';hashSource='https://support.microsoft.com/en-us/servicing/os/windows/docs/2026/09/verify-the-authenticity-of-a-windows-11-enterprise-evaluation-iso-file'}
  }
  $metadata=Stage 'verify-exact-windows-image' {
    Mount-DiskImage -ImagePath $iso -Access ReadOnly | Out-Null;$script:mounted=$true
    $volumes=@(Get-DiskImage -ImagePath $iso | Get-Volume | Where-Object DriveLetter)
    if($volumes.Count -ne 1) { throw 'Read-only ISO volume unavailable' }
    $value=Get-CloudGuestImageMetadata ([CloudGuestMetadata]::ImageXml(($volumes[0].DriveLetter+':\sources\install.wim')))
    Dismount-DiskImage -ImagePath $iso | Out-Null;$script:mounted=$false
    return $value
  }
  $report.media.image=$metadata
  $adminPassword=[guid]::NewGuid().ToString('N')+'aA1!';$taskPassword=[guid]::NewGuid().ToString('N')+'bB2!'
  $credential=[pscredential]::new('AegisSetup',(ConvertTo-SecureString $adminPassword -AsPlainText -Force))
  Stage 'prepare-owned-answer-media' { New-CloudGuestAnswerIso (Join-Path $root 'media/answer') $answerIso (New-CloudGuestAnswerText $metadata.index $adminPassword $taskPassword) } | Out-Null
  $report.hardware=Stage 'configure-secure-boot-tpm-offline-guest' {
    $script:unknown=$true
    $value=Invoke-CloudGuestConfiguration $id $name $vmRoot $iso $answerIso
    $script:unknown=$false;return $value
  }
  $report.bundle=Stage 'prepare-pinned-offline-test-inputs' { New-InstallerGuestBundle $root $Scenario $id }
  Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
  Sample 'before-boot'
  Stage 'boot-hardware-virtualized-x64-windows' {
    $script:owner=[CloudGuestVm]::new($id)
    if(-not $owner.Start() -or $owner.PendingUnknown) { throw 'VM native start not confirmed' }
    $report.startOperation=$owner.Operation()
    # Accept the initial DVD prompt; stop sending Space before Windows Setup can
    # consume it as dialog input. Keep the shared W7 lane's default unchanged.
    $boot=Invoke-CloudGuestBootWindow $owner -KeyWindowMilliseconds 8000
    $report.boot=$boot
    if($boot.mandatoryFailure) { throw 'VM boot key operation unresolved' }
  } | Out-Null
  $report.guest=Stage 'wait-for-windows11-x64-interactive-profile' {
    $deadline=[DateTime]::UtcNow.AddMinutes(18)
    $started=[DateTime]::UtcNow;$captureAt=@(120,360,720,1020);$captureIndex=0
    $report.setupDiagnostics=@();$report.readiness=New-CloudGuestReadinessObservation
    do {
      Sample 'guest-setup'
      Step-CloudGuestReadinessAttempt $report.readiness
      $readinessPhase='SessionCreate'
      try {
        $script:session=New-PSSession -VMId ([guid]$id) -Credential $credential -ErrorAction Stop
        $readinessPhase='ProfileCheck'
        $ready=Invoke-Command -Session $session -ScriptBlock {
          $os=Get-CimInstance Win32_OperatingSystem
          $current=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
          $explorer=@(Get-Process explorer -ErrorAction SilentlyContinue | Where-Object SessionId -gt 0)
          if((Get-ItemProperty 'HKLM:\SYSTEM\Setup').SystemSetupInProgress -ne 0 -or $explorer.Count -eq 0) { return $null }
          if($env:USERNAME -ne 'AegisSetup' -or $os.Caption -notmatch 'Windows 11' -or $os.ProductType -ne 1 -or $os.BuildNumber -ne '26300' -or $current.EditionID -ne 'EnterpriseEval' -or $current.UBR -ne 9457 -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -or @(Get-CimInstance Win32_Processor | Where-Object Architecture -ne 9).Count) { throw 'Guest architecture/version mismatch' }
          return @{caption=$os.Caption;build=$os.BuildNumber;ubr=$current.UBR;edition=$current.EditionID;processorArchitecture=$env:PROCESSOR_ARCHITECTURE;cpuArchitecture=9;consoleSessionIds=@($explorer.SessionId);profileReady=$true}
        }
        if($ready) { return $ready }
        Add-CloudGuestReadinessFailure $report.readiness $readinessPhase $null
      } catch { $report.lastReadinessError=$_.Exception.GetType().Name;Add-CloudGuestReadinessFailure $report.readiness $readinessPhase $_ }
      if($session) { Remove-PSSession $session;$script:session=$null }
      if($captureIndex -lt 4 -and ([DateTime]::UtcNow-$started).TotalSeconds -ge $captureAt[$captureIndex]) {
        $captureIndex++
        $report.setupDiagnostics+=Save-InstallerSetupDiagnostic $id $name $vmRoot (Join-Path $root 'evidence') $captureIndex
        SaveReport
      }
      Start-Sleep -Seconds 10
    } while([DateTime]::UtcNow -lt $deadline)
    $report.readiness.deadlineExpired=$true
    throw 'Windows 11 guest setup deadline exceeded'
  }
  Stage 'detach-owned-installation-media' {
    Remove-CloudGuestInstallationMedia $id $name $vmRoot ([ref]$unknown) | Out-Null
  } | Out-Null
  if($Scenario -in @('auto-update','all-users-update')) {
    $report.network=Stage 'connect-owned-outbound-update-network' {
      $script:networkAttempted=$true;$script:networkUnknown=$true
      $network=Invoke-UpdaterNetwork 'connect' $id $name $vmRoot
      $script:networkUnknown=$false
      if($network.status -ne 'PASS') { $report.network=$network;throw ('Update network '+$network.phase+': '+$network.error) }
      $guestNetwork=Invoke-Command -Session $session -ArgumentList (,$network.dns) -ScriptBlock {
        param($Dns)
        $deadline=[DateTime]::UtcNow.AddSeconds(60)
        do {
          $adapter=@(Get-NetAdapter | Where-Object Status -eq 'Up')
          if($adapter.Count) { break }
          Start-Sleep -Seconds 1
        } while([DateTime]::UtcNow -lt $deadline)
        if($adapter.Count -ne 1) { throw 'Expected one guest update NIC' }
        New-NetIPAddress -InterfaceIndex $adapter[0].ifIndex -IPAddress 192.168.241.2 -PrefixLength 24 -DefaultGateway 192.168.241.1 | Out-Null
        Set-DnsClientServerAddress -InterfaceIndex $adapter[0].ifIndex -ServerAddresses $Dns
        return @{address='192.168.241.2';gateway='192.168.241.1';dns=$Dns;firewallUnchanged=$true}
      }
      $network.guest=$guestNetwork;return $network
    }
  }
  $report.lifecycle=Stage 'execute-published-installer-lifecycle' { Invoke-InstallerGuestTest $session $root $report.bundle $Scenario }
  $report.status='PASS'
} catch { $report.status='FAIL';$report.error=$_.Exception.Message;Write-Warning $report.error }
finally {
  if($session) { Remove-PSSession $session -ErrorAction SilentlyContinue }
  try {
    if($owner) {
      if($owner.PendingUnknown -or $unknown) { throw 'VM provider outcome unresolved; no conflicting cleanup' }
      if(-not $owner.Stop() -or -not $owner.ObserveOff()) { throw 'VM off state unconfirmed' }
      $report.cleanup.offObserved=$true;$report.stopOperation=$owner.Operation()
    }
    if($id -and -not $unknown) {
      $snapshot=Invoke-CloudHyperVCommand observe $name $vmRoot $id
      if($snapshot.state -ne 'Off') { throw 'VM must be off before exact-ID removal' }
      $removed=Invoke-CloudHyperVCommand remove $name $vmRoot $id
      if(-not $removed.removedCommandCompleted -or (Invoke-CloudHyperVCommand observe $name $vmRoot $id).exists) { throw 'VM removal not confirmed' }
      $report.cleanup.removedObserved=$true
    }
    if($mounted) { Dismount-DiskImage -ImagePath $iso | Out-Null;$mounted=$false }
    if($report.cleanup.removedObserved) {
      if($networkAttempted) {
        if($networkUnknown) { throw 'Network operation unresolved; cleanup cannot be claimed' }
        $report.cleanup.network=Invoke-UpdaterNetwork 'remove' $id $name $vmRoot
        if($report.cleanup.network.status -ne 'PASS') { throw ('Update network cleanup '+$report.cleanup.network.phase+': '+$report.cleanup.network.error) }
      }
      foreach($path in @($iso,($iso+'.partial'),$answerIso,(Join-Path $root 'media/answer/Autounattend.xml'),(Join-Path $root 'input.zip'),(Join-Path $vmRoot 'guest.vhdx'))) {
        $full=[IO.Path]::GetFullPath($path)
        if(-not $full.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup escaped owned root' }
        if(Test-Path -LiteralPath $full) {
          $item=Get-Item -LiteralPath $full
          if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Cleanup refuses linked/non-file leaf' }
          Remove-Item -LiteralPath $full -Force
          $report.cleanup.filesRemoved+=([IO.Path]::GetFileName($full))
        }
      }
    }
  } catch { $report.cleanupError=$_.Exception.Message;$report.status='FAIL' }
  if($owner) { $owner.Dispose() }
  if($report.status -eq 'PASS' -and (-not $report.cleanup.offObserved -or -not $report.cleanup.removedObserved)) { $report.status='FAIL' }
  Sample 'complete';SaveReport
}
if($report.status -ne 'PASS') { throw ('Windows 11 x64 qualification failed: '+$report.error+'; cleanup: '+$report.cleanupError) }
