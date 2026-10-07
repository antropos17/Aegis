param([Parameter(Mandatory = $true)][string]$OutputRoot)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'cloud-guest-media.ps1')
Assert-CloudGuestRunner
if ($PSVersionTable.PSEdition -ne 'Desktop') { throw 'windows-powershell51-required' }
$expectedRoot = 'D:\aegis-cloud-guest-' + $env:GITHUB_RUN_ID + '-' + $env:GITHUB_RUN_ATTEMPT
if ([IO.Path]::GetFullPath($OutputRoot).TrimEnd('\') -cne $expectedRoot -or (Test-Path -LiteralPath $OutputRoot)) { throw 'fresh-exact-owned-root-required' }
$cursor = Get-Item -LiteralPath D:/
if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'reparse-output-parent-refused' }
New-Item -ItemType Directory -Path $OutputRoot | Out-Null
foreach ($leaf in @('evidence', 'temp', 'media', 'native', 'transfer', 'vm', 'canaries')) { New-Item -ItemType Directory -Path (Join-Path $OutputRoot $leaf) | Out-Null }
$env:TEMP = Join-Path $OutputRoot 'temp'; $env:TMP = $env:TEMP
. (Join-Path $PSScriptRoot 'cloud-hyperv-operations.ps1')
. (Join-Path $PSScriptRoot 'cloud-guest-vm.ps1')
$name = 'aegis-cloud-' + $env:GITHUB_RUN_ID + '-' + $env:GITHUB_RUN_ATTEMPT + '-' + [guid]::NewGuid().ToString('N')
$vmRoot = Join-Path $OutputRoot 'vm'; $mediaRoot = Join-Path $OutputRoot 'media'
$id = $null; $owner = $null; $unknown = $false; $createAttempted = $false; $absence = $false; $mounted = $false
$windowsIso = Join-Path $mediaRoot 'windows.iso'; $answerIso = Join-Path $mediaRoot 'answer.iso'
$report = [ordered]@{ schemaVersion = 1; scope = 'cloud-windows11-fixed-standard-user-lab'; startedAt = [DateTime]::UtcNow.ToString('o'); sourceSha = $env:EXPECTED_SOURCE_SHA;
    actualHead = $null; sourceObservation = $null; sourceHashes = [ordered]@{}; compilerSha256 = $null; stages = [Collections.Generic.List[object]]::new(); host = $null; disks = [Collections.Generic.List[object]]::new();
    media = $null; runtime = $null; hardware = $null; vmName = $name; vmId = $null; startOperation = $null; stopOperation = $null; guest = $null; keyboard = $null; keyboardWindow = $null;
    hostCanariesUnchangedAfterTask = $false; hostCanariesUnchangedAfterRemoval = $false; offObserved = $false; removedObserved = $false; operationSettlement = 'not-submitted';
    cleanupFailure = $null; failure = $null; passed = $false; launchAllowed = $false; A1Qualified = $false; sharedHostRoutesTested = $false; hostGuestVhdMounted = $false }
function RecordDisk([string]$Phase) {
    $values = @('C', 'D') | ForEach-Object { $drive = Get-PSDrive -Name $_; @{ drive = $_; freeBytes = [long]$drive.Free; usedBytes = [long]$drive.Used } }
    $report.disks.Add(@{ phase = $Phase; capturedAt = [DateTime]::UtcNow.ToString('o'); drives = @($values) })
    return @($values)
}
function Stage([string]$StageName, [scriptblock]$Operation) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    Write-Host ('stage-begin ' + $StageName + ' ' + [DateTime]::UtcNow.ToString('o'))
    try { $value = & $Operation; $report.stages.Add(@{ stage = $StageName; passed = $true; milliseconds = $watch.ElapsedMilliseconds }); return $value }
    catch {
        # Never publish dynamic guest error text: remote errors can carry credentials.
        $detail = Get-CloudGuestFailureDetails $_.Exception
        $report.stages.Add(@{ stage = $StageName; passed = $false; code = $detail.code; milliseconds = $watch.ElapsedMilliseconds; hResult = $detail.hResult; exceptionType = $detail.exceptionType; innerDepth = $detail.innerDepth; category = $_.CategoryInfo.Category.ToString() })
        $report.failure = @{ stage = $StageName; code = $detail.code; hResult = $detail.hResult; exceptionType = $detail.exceptionType; innerDepth = $detail.innerDepth; category = $_.CategoryInfo.Category.ToString() }; throw
    }
    finally { $watch.Stop(); Write-Host ('stage-end ' + $StageName + ' ' + [DateTime]::UtcNow.ToString('o')) }
}
function Compile([string]$Leaf, [string[]]$Sources, [string[]]$References) {
    $output = Join-Path $OutputRoot ('native\' + $Leaf)
    $arguments = @('/nologo', '/target:library', '/platform:x64', '/optimize+', '/warnaserror+', ('/out:"' + $output + '"'))
    foreach ($reference in $References) { $arguments += '/reference:' + $reference }
    foreach ($relative in $Sources) {
        $file = Get-Item -LiteralPath (Join-Path $project $relative) -Force
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 64KB) { throw 'native-source-budget-failed' }
        $report.sourceHashes[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        $arguments += '"' + $file.FullName + '"'
    }
    $stdout = Join-Path $OutputRoot ('native\' + $Leaf + '.txt'); $stderr = $stdout + '.error'
    $process = Start-Process -FilePath $compiler -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    try {
        $exitCode = Wait-CloudGuestNativeProcess $process 30000
        if ($exitCode -ne 0 -or (Get-Item -LiteralPath $output).Length -gt 1MB -or (Get-Item -LiteralPath $stdout).Length -gt 64KB -or (Get-Item -LiteralPath $stderr).Length -gt 64KB) { throw 'native-compile-failed' }
    }
    finally { $process.Dispose() }
    return $output
}
function CanariesUnchanged {
    foreach ($entry in $canaries) {
        if (!(Test-Path -LiteralPath $entry.path)) { return $false }
        $file = Get-Item -LiteralPath $entry.path -Force
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 1024 -or
            (Get-FileHash -LiteralPath $entry.path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry.sha256) { return $false }
    }
    return $true
}
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$canaries = @()
try {
    Stage 'host-preflight' {
        $disks = @(RecordDisk 'before')
        if (@($disks | Where-Object { ($_.drive -eq 'D' -and $_.freeBytes -lt 80GB) -or ($_.drive -eq 'C' -and $_.freeBytes -lt 8GB) }).Count) { throw 'cloud-disk-headroom-unavailable' }
        if ($report.sourceSha -notmatch '^[a-f0-9]{40}$') { throw 'expected-source-required' }
        $headFile = Join-Path $OutputRoot 'temp\head.txt'; $gitError = Join-Path $OutputRoot 'temp\git-error.txt'
        $git = Start-Process git.exe -ArgumentList @('-C', ('"' + $project + '"'), 'rev-parse', 'HEAD') -PassThru -WindowStyle Hidden -RedirectStandardOutput $headFile -RedirectStandardError $gitError
        try {
            $exitCode = Wait-CloudGuestNativeProcess $git 10000
            $report.sourceObservation = @{ exitCode = $exitCode; headBytes = (Get-Item -LiteralPath $headFile).Length; stderrBytes = (Get-Item -LiteralPath $gitError).Length }
            if ($exitCode -ne 0 -or $report.sourceObservation.headBytes -gt 128 -or $report.sourceObservation.stderrBytes -ne 0) { throw 'source-head-unavailable' }
            $report.actualHead = [IO.File]::ReadAllText($headFile).Trim()
        }
        finally { $git.Dispose() }
        if ($report.actualHead -cne $report.sourceSha) { throw 'source-head-mismatch' }
        $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
        $os = Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 5; $computer = Get-CimInstance Win32_ComputerSystem -OperationTimeoutSec 5
        $report.host = @{ caption = $os.Caption; build = $os.BuildNumber; admin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); hypervisorPresent = $computer.HypervisorPresent; memoryBytes = [long]$computer.TotalPhysicalMemory; vmms = (Get-Service vmms).Status.ToString() }
        if (!$report.host.admin -or $report.host.vmms -ne 'Running' -or [long]$os.FreePhysicalMemory * 1024 -lt 6GB) { throw 'cloud-hyperv-admin-memory-unavailable' }
        foreach ($relative in @('scripts/qualification/cloud-guest-lab.ps1', 'scripts/qualification/cloud-guest-vm.ps1', 'scripts/qualification/cloud-guest-media.ps1', 'scripts/qualification/cloud-guest-bootstrap.ps1', 'scripts/qualification/cloud-guest-task.cjs', 'scripts/qualification/cloud-hyperv-operations.ps1')) {
            $file = Get-Item -LiteralPath (Join-Path $project $relative) -Force
            if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 64KB) { throw 'script-source-budget-failed' }
            $report.sourceHashes[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
        $report.compilerSha256 = (Get-FileHash -LiteralPath $compiler -Algorithm SHA256).Hash.ToLowerInvariant()
    } | Out-Null
    Stage 'compile-fixed-native-helpers' {
        Add-Type -Path (Compile 'metadata.dll' @('scripts/qualification/CloudGuestMetadata.cs') @('System.Net.Http.dll'))
        Add-Type -Path (Compile 'vm-owner.dll' @('scripts/qualification/CloudGuestVm.cs', 'sidecar/session/OwnedVmLifecycle.cs', 'sidecar/session/VmManagementNative.cs') @('System.Management.dll'))
        $guestDll = Compile 'guest-process.dll' @('scripts/qualification/CloudGuestProcess.cs', 'sidecar/session/GuestJobNative.cs', 'sidecar/session/GuestJobInventory.cs') @()
        Copy-Item -LiteralPath $guestDll -Destination (Join-Path $OutputRoot 'transfer\guest-process.dll')
    } | Out-Null
    $report.media = Stage 'pinned-media-download-and-hash' {
        $url = 'https://software-static.download.prss.microsoft.com/dbazure/26300.9457.260913-1737.26h2_ge_release_svc_refresh_CLIENTENTERPRISEEVAL_OEMRET_x64FRE_en-us.iso'
        $digest = [CloudGuestMetadata]::Download($url, $windowsIso, 8225329152)
        if ($digest -cne 'bc3f24086ebadc94489066b5ad78089e2cf5c3491e90e790bb81a2b199c10e38') { throw 'published-media-hash-mismatch' }
        return @{ url = $url; bytes = 8225329152; sha256 = $digest; hashSource = 'https://support.microsoft.com/en-us/servicing/os/windows/docs/2026/09/verify-the-authenticity-of-a-windows-11-enterprise-evaluation-iso-file'; license = 'Microsoft 90-day evaluation; disposable testing'; verifiedBeforeMount = $true }
    }
    $metadata = Stage 'read-only-exact-wim-metadata' {
        Mount-DiskImage -ImagePath $windowsIso -Access ReadOnly -PassThru | Out-Null; $script:mounted = $true
        $volumes = @(Get-DiskImage -ImagePath $windowsIso | Get-Volume | Where-Object DriveLetter)
        if ($volumes.Count -ne 1) { throw 'pinned-media-volume-unavailable' }
        return (Get-CloudGuestImageMetadata ([CloudGuestMetadata]::ImageXml(($volumes[0].DriveLetter + ':\sources\install.wim'))))
    }
    $report.media.image = $metadata
    Dismount-DiskImage -ImagePath $windowsIso | Out-Null; $mounted = $false
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create(); $bytes = New-Object byte[] 24
    $generator.GetBytes($bytes); $adminPassword = 'Aa1!' + [Convert]::ToBase64String($bytes)
    $generator.GetBytes($bytes); $taskPassword = 'Bb2!' + [Convert]::ToBase64String($bytes); $generator.Dispose(); [Array]::Clear($bytes, 0, $bytes.Length)
    $adminCredential = [pscredential]::new('AegisSetup', (ConvertTo-SecureString $adminPassword -AsPlainText -Force))
    Stage 'tiny-answer-iso' {
        $answer = New-CloudGuestAnswerText $metadata.index $adminPassword $taskPassword
        $length = New-CloudGuestAnswerIso (Join-Path $mediaRoot 'answer') $answerIso $answer
        $report.media.answerIsoBytes = $length; $answer = $null
    } | Out-Null
    Stage 'stage-fixed-runtime-and-host-controls' {
        $transfer = Join-Path $OutputRoot 'transfer'
        $node = Get-Item -LiteralPath (Get-Command node.exe -CommandType Application).Source
        if ($node.Attributes -band [IO.FileAttributes]::ReparsePoint -or $node.Length -gt 256MB) { throw 'trusted-node-input-invalid' }
        Copy-Item -LiteralPath $node.FullName -Destination (Join-Path $transfer 'node.exe')
        $versionFile = Join-Path $OutputRoot 'temp\node-version.txt'; $errorFile = $versionFile + '.error'
        $child = Start-Process -FilePath $node.FullName -ArgumentList '--version' -PassThru -WindowStyle Hidden -RedirectStandardOutput $versionFile -RedirectStandardError $errorFile
        try {
            $exitCode = Wait-CloudGuestNativeProcess $child 5000
            if ($exitCode -ne 0 -or (Get-Item $versionFile).Length -gt 128 -or (Get-Item $errorFile).Length -ne 0) { throw 'node-version-observation-failed' }
            $report.runtime = @{ path = $node.FullName; bytes = $node.Length; version = [IO.File]::ReadAllText($versionFile).Trim(); sha256 = (Get-FileHash -LiteralPath (Join-Path $transfer 'node.exe') -Algorithm SHA256).Hash.ToLowerInvariant() }
        }
        finally { $child.Dispose() }
        foreach ($leaf in @('cloud-guest-bootstrap.ps1', 'cloud-guest-task.cjs')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $leaf) -Destination $transfer }
        $canaryEntries = @()
        foreach ($index in 1..2) {
            $selected = Join-Path $OutputRoot ('canaries\' + [guid]::NewGuid().ToString('N') + '.txt')
            [IO.File]::WriteAllText($selected, 'host-positive-control'); if ([IO.File]::ReadAllText($selected) -ne 'host-positive-control') { throw 'host-read-write-control-failed' }
            Remove-Item -LiteralPath $selected; if (Test-Path -LiteralPath $selected) { throw 'host-delete-control-failed' }
            [IO.File]::WriteAllText($selected, 'host-final-canary-' + [guid]::NewGuid().ToString('N'))
            $canaryEntries += @{ path = $selected; sha256 = (Get-FileHash -LiteralPath $selected -Algorithm SHA256).Hash.ToLowerInvariant() }
        }
        $script:canaries = $canaryEntries
        $files = @(Get-ChildItem -LiteralPath $transfer -File | ForEach-Object { @{ name = $_.Name; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() } })
        $manifestText = @{ schemaVersion = 1; scope = 'fixed-cloud-guest-task'; files = $files; hostCanaries = @($canaryEntries | ForEach-Object path) } | ConvertTo-Json -Depth 5
        [IO.File]::WriteAllText((Join-Path $transfer 'manifest.json'), $manifestText, [Text.UTF8Encoding]::new($false))
    } | Out-Null
    Stage 'create-exact-owned-vm' {
        $initial = Invoke-CloudHyperVCommand recover $name $vmRoot $null
        if ($initial.exists) { throw 'owned-name-preexisting' }; $script:absence = $true; $script:createAttempted = $true; $script:unknown = $true
        $created = Invoke-CloudHyperVCommand create $name $vmRoot $null
        if (!$created.exists -or $created.name -cne $name -or $created.vmId -notmatch '^[a-f0-9-]{36}$') { throw 'created-identity-unknown' }
        $script:id = $created.vmId; $report.vmId = $id; $script:unknown = $false
    } | Out-Null
    $report.hardware = Stage 'configure-supported-windows11-guest' {
        $script:unknown = $true; $hardware = Invoke-CloudGuestConfiguration $id $name $vmRoot $windowsIso $answerIso; $script:unknown = $false; return $hardware
    }
    Stage 'native-start-and-firmware-key' {
        $script:owner = [CloudGuestVm]::new($id)
        $running = $owner.Start(); $report.startOperation = $owner.Operation(); $script:unknown = $owner.PendingUnknown
        if (!$running -or $unknown) { throw 'native-start-unconfirmed' }
        $report.operationSettlement = 'actual-native-start-settled'
    } | Out-Null
    Stage 'optional-fixed-setup-key-window' {
        $report.keyboardWindow = @{ attempts = 0; completed = 0; optional = $true; failure = $null }
        for ($key = 0; $key -lt 6; $key++) {
            Start-Sleep -Seconds 2; $report.keyboardWindow.attempts++
            try { if ($owner.SetupSpaceKey()) { $report.keyboardWindow.completed++ } }
            catch {
                $report.keyboardWindow.failure = Get-CloudGuestFailureDetails $_.Exception
                # VM identity/current Running gates remain mandatory. A missing,
                # ambiguous, rejected or uncertain keyboard dispatches no more keys.
                if ($owner.PendingUnknown -or $owner.KeyboardObservation.phase -eq 'vm-observe') { throw }
                break
            }
        }
    } | Out-Null
    RecordDisk 'before-guest-setup' | Out-Null
    $report.guest = Stage 'actual-guest-setup-and-standard-task' {
        # A lost worker may have submitted a device mutation. Only its bounded
        # result can establish whether a later native Stop is safe to request.
        $script:unknown = $true
        $result = Invoke-CloudGuestBootstrap $id $name $vmRoot $adminCredential $taskPassword (Join-Path $OutputRoot 'transfer')
        $script:report.guest = $result
        if ($result.mediaMutationUnknown -isnot [bool]) { throw 'guest-bootstrap-failed' }
        $script:unknown = $result.mediaMutationUnknown
        if ($null -ne $result.failure) { throw $result.failure.code }
        return $result
    }
    $report.hostCanariesUnchangedAfterTask = CanariesUnchanged
    if (!$report.hostCanariesUnchangedAfterTask -or !$report.guest.guestResult.task.passed) { throw 'host-or-guest-task-control-failed' }
}
catch { if ($null -eq $report.failure) { $report.failure = @{ stage = 'driver'; hResult = $_.Exception.HResult; category = $_.CategoryInfo.Category.ToString() } } }
finally {
    $adminPassword = $null; $taskPassword = $null; $adminCredential = $null
    try {
        if ($null -ne $owner) {
            $report.keyboard = $owner.KeyboardObservation
            if ($owner.PendingUnknown) { $unknown = $true }
            if (!$unknown) { $stopped = $owner.Stop(); $report.stopOperation = $owner.Operation(); $report.offObserved = $stopped -and $owner.ObserveOff(); $unknown = $owner.PendingUnknown }
        }
        elseif ($id -and !$unknown) { $snapshot = Invoke-CloudHyperVCommand observe $name $vmRoot $id; $report.offObserved = $snapshot.exists -and $snapshot.state -eq 'Off' }
        if ($id -and !$unknown -and $report.offObserved) {
            $unknown = $true; Invoke-CloudHyperVCommand remove $name $vmRoot $id | Out-Null
            $unknown = $false; $after = Invoke-CloudHyperVCommand observe $name $vmRoot $id; $report.removedObserved = !$after.exists
            if (!$report.removedObserved) { throw 'exact-vm-removal-unconfirmed' }
        }
        elseif ($createAttempted) { throw 'vm-cleanup-refused-unsettled-or-off-unknown' }
    }
    catch { $report.cleanupFailure = @{ stage = 'exact-vm-cleanup'; hResult = $_.Exception.HResult }; if ($null -ne $owner -and $owner.PendingUnknown) { $unknown = $true } }
    finally { if ($null -ne $owner) { $owner.Dispose() } }
    if ($unknown) { $report.operationSettlement = 'unknown-provider-operation'; $report.removedObserved = $false }
    elseif ($report.removedObserved) { $report.operationSettlement = 'settled-and-exact-vm-absent' }
    try { if ($mounted) { Dismount-DiskImage -ImagePath $windowsIso | Out-Null; $mounted = $false } } catch { $report.cleanupFailure = @{ stage = 'trusted-iso-dismount'; hResult = $_.Exception.HResult } }
    $report.hostCanariesUnchangedAfterRemoval = $canaries.Count -eq 2 -and (CanariesUnchanged)
    # Only exact closed disposable files are removed. Never mount the guest disk.
    if ($report.removedObserved -and !$mounted) {
        foreach ($closed in @((Join-Path $vmRoot 'guest.vhdx'), $answerIso, (Join-Path $mediaRoot 'answer\Autounattend.xml'), $windowsIso)) {
            try { if (Test-Path -LiteralPath $closed) { $file = Get-Item -LiteralPath $closed -Force; if ($file.PSIsContainer -or $file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'closed-owned-file-invalid' }; Remove-Item -LiteralPath $closed -Force } }
            catch { $report.cleanupFailure = @{ stage = 'closed-owned-file-cleanup'; hResult = $_.Exception.HResult } }
        }
    }
    RecordDisk 'after' | Out-Null
    $report.completedAt = [DateTime]::UtcNow.ToString('o')
    $report.passed = $null -eq $report.failure -and $null -eq $report.cleanupFailure -and $report.offObserved -and $report.removedObserved -and $report.hostCanariesUnchangedAfterTask -and $report.hostCanariesUnchangedAfterRemoval
    $json = $report | ConvertTo-Json -Depth 16
    if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 1MB) { throw 'guest-receipt-budget-failed' }
    [IO.File]::WriteAllText((Join-Path $OutputRoot 'evidence\cloud-windows11.json'), $json)
    if ($env:GITHUB_STEP_SUMMARY) {
        $failureLabel = if ($null -eq $report.failure) { 'none' } else { $report.failure.stage }
        Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value ("Windows 11 guest fixed task passed: $($report.passed); failure stage: $failureLabel. PS Direct is lab-only; A1Qualified=false and launchAllowed=false.")
    }
}
if (!$report.passed) { exit 1 }
