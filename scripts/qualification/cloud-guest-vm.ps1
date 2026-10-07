Set-StrictMode -Version Latest

# Remove credential-bearing drives, then query a newly obtained exact VM object.
# A retained VirtualMachine object may carry cached device inventory.
function Remove-CloudGuestInstallationMedia([string]$Id, [string]$Name, [string]$VmRoot, [ref]$MutationUnknown) {
    Assert-CloudGuestRunner
    if ($Id -cnotmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' -or
        $Name -cnotmatch '^aegis-cloud-[0-9]+-[0-9]+-[a-f0-9]{32}$') { throw 'media-eject-owner-mismatch' }
    $expected = [IO.Path]::GetFullPath($VmRoot).TrimEnd('\')
    $before = 0
    foreach ($step in 0..2) {
        $current = Get-VM -Id ([guid]$Id) -ErrorAction Stop
        $actual = [IO.Path]::GetFullPath($current.ConfigurationLocation).TrimEnd('\')
        if ($current.Id.ToString() -cne $Id -or $current.Name -cne $Name -or $current.State -ne 'Running' -or
            (!$actual.Equals($expected, [StringComparison]::OrdinalIgnoreCase) -and !$actual.StartsWith($expected + '\', [StringComparison]::OrdinalIgnoreCase))) { throw 'media-eject-owner-mismatch' }
        $drives = @(Get-VMDvdDrive -VM $current -ErrorAction Stop)
        if ($step -eq 0) { $before = $drives.Count }
        if ($step -eq 2) {
            if ($drives.Count -ne 0) { throw 'answer-dvd-ejection-unconfirmed' }
            return @{ drivesBefore = $before; drivesAfter = 0; freshExactVmObserved = $true }
        }
        if ($drives.Count -ne (2 - $step) -or @($drives | Where-Object { $_.ControllerNumber -ne 0 -or $_.ControllerLocation -notin @(1, 2) -or $_.VMId.ToString() -cne $Id }).Count -ne 0 -or
            @($drives | Select-Object -ExpandProperty ControllerLocation -Unique).Count -ne $drives.Count) { throw 'media-eject-inventory-unexpected' }
        $MutationUnknown.Value = $true
        Remove-VMDvdDrive -VMDvdDrive $drives[0] -Confirm:$false -ErrorAction Stop
        $MutationUnknown.Value = $false
    }
}

# All inputs originate in the guarded fresh lab driver; no guest request is routed here.
function Invoke-CloudGuestConfiguration([string]$Id, [string]$Name, [string]$VmRoot, [string]$WindowsIso, [string]$AnswerIso) {
    Assert-CloudGuestRunner
    $job = Start-Job -ArgumentList $Id, $Name, $VmRoot, $WindowsIso, $AnswerIso -ScriptBlock {
        param($Id, $Name, $VmRoot, $WindowsIso, $AnswerIso)
        $ErrorActionPreference = 'Stop'; Import-Module Hyper-V
        if ($Id -notmatch '^[a-f0-9-]{36}$' -or $Name -notmatch '^aegis-cloud-[0-9]+-[0-9]+-[a-f0-9]{32}$') { throw 'owned-vm-input-invalid' }
        $vm = Get-VM -Id ([guid]$Id)
        $actual = [IO.Path]::GetFullPath($vm.ConfigurationLocation).TrimEnd('\'); $expected = [IO.Path]::GetFullPath($VmRoot).TrimEnd('\')
        if ($vm.Name -cne $Name -or $vm.State -ne 'Off' -or (!$actual.Equals($expected, [StringComparison]::OrdinalIgnoreCase) -and !$actual.StartsWith($expected + '\', [StringComparison]::OrdinalIgnoreCase))) { throw 'owned-vm-configuration-mismatch' }
        $cursor = Get-Item -LiteralPath $VmRoot
        while ($null -ne $cursor) { if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'reparse-vm-path-refused' }; $cursor = $cursor.Parent }
        $disk = Join-Path $VmRoot 'guest.vhdx'
        if (Test-Path -LiteralPath $disk) { throw 'fresh-guest-vhd-required' }
        New-VHD -Path $disk -Dynamic -SizeBytes 64GB | Out-Null
        Add-VMHardDiskDrive -VM $vm -Path $disk
        Set-VM -VM $vm -AutomaticCheckpointsEnabled $false -AutomaticStartAction Nothing -AutomaticStopAction TurnOff
        Set-VMMemory -VM $vm -DynamicMemoryEnabled $false -StartupBytes 4GB
        Set-VMProcessor -VM $vm -Count 2
        foreach ($adapter in @(Get-VMNetworkAdapter -VM $vm)) { Remove-VMNetworkAdapter -VMNetworkAdapter $adapter -Confirm:$false }
        Add-VMDvdDrive -VM $vm -Path $WindowsIso -ControllerNumber 0 -ControllerLocation 1
        Add-VMDvdDrive -VM $vm -Path $AnswerIso -ControllerNumber 0 -ControllerLocation 2
        $dvd = Get-VMDvdDrive -VM $vm -ControllerNumber 0 -ControllerLocation 1
        Set-VMFirmware -VM $vm -EnableSecureBoot On -SecureBootTemplate MicrosoftWindows -FirstBootDevice $dvd
        Set-VMKeyProtector -VM $vm -NewLocalKeyProtector
        Enable-VMTPM -VM $vm
        $vm = Get-VM -Id ([guid]$Id); $security = Get-VMSecurity -VM $vm; $firmware = Get-VMFirmware -VM $vm
        $drives = @(Get-VMHardDiskDrive -VM $vm)
        if ($vm.Generation -ne 2 -or $vm.MemoryStartup -ne 4GB -or $vm.ProcessorCount -ne 2 -or
            @(Get-VMNetworkAdapter -VM $vm).Count -ne 0 -or $drives.Count -ne 1 -or $drives[0].Path -ne $disk -or
            [long](Get-VHD -Path $disk).Size -ne 64GB -or !$security.TpmEnabled -or $firmware.SecureBoot -ne 'On') { throw 'guest-hardware-observation-failed' }
        return @{ vmId = $Id; generation = 2; memoryBytes = 4294967296; processors = 2; diskVirtualBytes = 68719476736; nics = 0; secureBoot = 'On'; tpmEnabled = $true; hostGuestVhdMounted = $false }
    }
    try {
        if ($null -eq (Wait-Job -Job $job -Timeout 90)) { throw 'guest-configure-provider-unknown' }
        $values = @(Receive-Job -Job $job -ErrorAction Stop)
        if ($job.State -ne 'Completed' -or $values.Count -ne 1) { throw 'guest-configure-provider-unknown' }
        return $values[0]
    }
    finally { if ($job.State -in @('Running', 'NotStarted')) { Stop-Job -Job $job -ErrorAction SilentlyContinue }; Remove-Job -Job $job -Force -ErrorAction SilentlyContinue }
}

function Invoke-CloudGuestBootstrap([string]$Id, [string]$Name, [string]$VmRoot, [pscredential]$Admin, [string]$TaskPassword, [string]$TransferRoot) {
    Assert-CloudGuestRunner
    $job = Start-Job -ArgumentList $Id, $Name, $VmRoot, $Admin, $TaskPassword, $TransferRoot, $PSScriptRoot -ScriptBlock {
        param($Id, $Name, $VmRoot, $Admin, $TaskPassword, $TransferRoot, $SupportRoot)
        $ErrorActionPreference = 'Stop'; Import-Module Hyper-V
        . (Join-Path $SupportRoot 'cloud-guest-media.ps1')
        . (Join-Path $SupportRoot 'cloud-guest-vm.ps1')
        $session = $null; $watch = [Diagnostics.Stopwatch]::StartNew(); $lastDisk = -60
        $diskSamples = [Collections.Generic.List[object]]::new()
        $mediaMutationUnknown = $false
        $progress = @{ phase = 'psdirect-profile-readiness'; sessionEstablished = $false; profileReady = $false; installedOs = $null; transferHashesVerified = $false; mediaDetached = $null; standardTaskSubmitted = $false }
        try {
            while ($watch.Elapsed.TotalSeconds -lt 1080) {
                if ($watch.Elapsed.TotalSeconds - $lastDisk -ge 60) {
                    $free = [long](Get-PSDrive -Name D).Free
                    $diskSamples.Add(@{ seconds = [int]$watch.Elapsed.TotalSeconds; freeBytes = $free }); $lastDisk = $watch.Elapsed.TotalSeconds
                    if ($free -lt 10GB) { throw 'guest-setup-disk-headroom-failed' }
                }
                try {
                    $session = New-PSSession -VMId ([guid]$Id) -Credential $Admin -ErrorAction Stop
                    $progress.sessionEstablished = $true
                    $profileReady = Invoke-Command -Session $session -ScriptBlock {
                        return $env:USERNAME -eq 'AegisSetup' -and (Test-Path -LiteralPath C:/Users/AegisSetup) -and
                            (Get-ItemProperty 'HKLM:\SYSTEM\Setup').SystemSetupInProgress -eq 0
                    }
                    if ($profileReady -eq $true) { $progress.profileReady = $true; break }
                    Remove-PSSession -Session $session -ErrorAction SilentlyContinue; $session = $null
                }
                catch { if ($null -ne $session) { Remove-PSSession -Session $session -ErrorAction SilentlyContinue; $session = $null } }
                Start-Sleep -Seconds 10
            }
            if ($null -eq $session) { throw 'guest-setup-psdirect-not-ready' }
            $progress.phase = 'exact-installed-os'
            $ready = Invoke-Command -Session $session -ScriptBlock {
                $os = Get-CimInstance Win32_OperatingSystem
                if ($os.BuildNumber -ne '26300' -or !(Test-Path -LiteralPath C:/Users/AegisSetup) -or $env:USERNAME -ne 'AegisSetup') { throw 'exact-installed-guest-not-ready' }
                $edition = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').EditionID
                if ($edition -ne 'EnterpriseEval' -or (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').UBR -ne 9457) { throw 'guest-edition-version-mismatch' }
                $disks = @(Get-CimInstance Win32_DiskDrive)
                if ($disks.Count -ne 1 -or [long]$disks[0].Size -gt 68719476736 -or [long]$disks[0].Size -lt 68000000000) { throw 'owned-guest-disk-layout-unexpected' }
                New-Item -ItemType Directory -Path C:/ProgramData/AegisCloudLab/trusted -ErrorAction Stop | Out-Null
                return @{ build = 26300; ubr = 9457; edition = 'EnterpriseEval'; setupProfileObserved = $true; guestDiskCount = 1 }
            }
            if ($null -eq $ready -or $ready.build -ne 26300 -or $ready.ubr -ne 9457 -or $ready.edition -cne 'EnterpriseEval') { throw 'guest-readiness-observation-failed' }
            $progress.installedOs = $ready
            $progress.phase = 'fixed-runtime-transfer'
            foreach ($file in @(Get-ChildItem -LiteralPath $TransferRoot -File)) { Copy-Item -LiteralPath $file.FullName -Destination C:/ProgramData/AegisCloudLab/trusted/ -ToSession $session }
            Invoke-Command -Session $session -ScriptBlock {
                $trusted = 'C:\ProgramData\AegisCloudLab\trusted'
                $manifest = Get-Content -LiteralPath "$trusted\manifest.json" -Raw | ConvertFrom-Json
                foreach ($expected in $manifest.files) {
                    if ($expected.name -notmatch '^[a-zA-Z0-9-]+\.(dll|exe|ps1|cjs)$' -or $expected.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'guest-transfer-manifest-invalid' }
                    $file = Get-Item -LiteralPath (Join-Path $trusted $expected.name) -Force
                    if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or
                        (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expected.sha256) { throw 'guest-transfer-hash-mismatch' }
                }
            }
            $progress.transferHashesVerified = $true
            # Eject both media before releasing any standard-user code. The answer
            # DVD carries lab credentials and is excluded from every artifact.
            $progress.phase = 'detach-installation-media'
            $progress.mediaDetached = Remove-CloudGuestInstallationMedia $Id $Name $VmRoot ([ref]$mediaMutationUnknown)
            $progress.phase = 'trusted-bootstrap-and-standard-task'; $progress.standardTaskSubmitted = $true
            $result = Invoke-Command -Session $session -ArgumentList $TaskPassword, $Id -ScriptBlock {
                param($Password, $VmId)
                $env:AEGIS_CLOUD_GUEST_LAB = 'trusted-bootstrap-v1'
                $env:AEGIS_CLOUD_GUEST_VM_ID = $VmId
                $env:GITHUB_ACTIONS = 'true'; $env:RUNNER_ENVIRONMENT = 'github-hosted'; $env:RUNNER_OS = 'Windows'
                & C:/ProgramData/AegisCloudLab/trusted/cloud-guest-bootstrap.ps1 -TaskPassword $Password
            }
            $progress.phase = 'completed'
            return @{ guestResult = $result; progress = $progress; failure = $null; mediaMutationUnknown = $mediaMutationUnknown; answerDvdEjectedBeforeTask = $true; setupWaitMilliseconds = $watch.ElapsedMilliseconds; setupDiskSamples = @($diskSamples) }
        }
        catch { return @{ guestResult = $null; progress = $progress; failure = (Get-CloudGuestFailureDetails $_.Exception); mediaMutationUnknown = $mediaMutationUnknown; answerDvdEjectedBeforeTask = $null -ne $progress.mediaDetached; setupWaitMilliseconds = $watch.ElapsedMilliseconds; setupDiskSamples = @($diskSamples) } }
        finally { if ($null -ne $session) { Remove-PSSession -Session $session -ErrorAction SilentlyContinue }; $watch.Stop() }
    }
    try {
        if ($null -eq (Wait-Job -Job $job -Timeout 1200)) { throw 'guest-setup-or-task-deadline' }
        $values = @(Receive-Job -Job $job -ErrorAction Stop)
        if ($job.State -ne 'Completed' -or $values.Count -ne 1) { throw 'guest-bootstrap-failed' }
        return $values[0]
    }
    finally { if ($job.State -in @('Running', 'NotStarted')) { Stop-Job -Job $job -ErrorAction SilentlyContinue }; Remove-Job -Job $job -Force -ErrorAction SilentlyContinue }
}
