Set-StrictMode -Version Latest

# The fixed, re-hashed source is invoked in this session without changing policy.
# Only bounded metadata crosses the boundary if entry or execution fails.
function Get-CloudGuestBootstrapInvocation {
    return {
        param($Password, $VmId, $ExpectedHash)
        $ErrorActionPreference = 'Stop'
        $diagnostic = @{ phase = 'fixed-source-validation'; invocationAttempted = $false; executionPolicy = 'unknown';
            fullLanguage = $false; exceptionKind = $null; category = $null; line = $null; hResult = $null }
        try {
            $policy = (Get-ExecutionPolicy).ToString()
            if ($policy -cin @('Restricted', 'AllSigned', 'RemoteSigned', 'Unrestricted', 'Bypass', 'Undefined', 'Default')) { $diagnostic.executionPolicy = $policy }
            $diagnostic.fullLanguage = $ExecutionContext.SessionState.LanguageMode -eq 'FullLanguage'
            if (!$diagnostic.fullLanguage -or $VmId -cnotmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' -or
                $ExpectedHash -cnotmatch '^[a-f0-9]{64}$') { throw 'fixed-bootstrap-input-invalid' }
            $fixedPath = 'C:\ProgramData\AegisCloudLab\trusted\cloud-guest-bootstrap.ps1'
            $file = Get-Item -LiteralPath $fixedPath -Force
            if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -lt 1 -or $file.Length -gt 64KB) { throw 'fixed-bootstrap-source-invalid' }
            $stream = [IO.File]::Open($fixedPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
            try {
                if ($stream.Length -ne $file.Length -or $stream.Length -lt 1 -or $stream.Length -gt 64KB) { throw 'fixed-bootstrap-source-invalid' }
                $bytes = [byte[]]::new([int]$stream.Length); $offset = 0
                while ($offset -lt $bytes.Length) {
                    $count = $stream.Read($bytes, $offset, $bytes.Length - $offset)
                    if ($count -le 0) { throw 'fixed-bootstrap-source-invalid' }
                    $offset += $count
                }
                if ($stream.ReadByte() -ne -1) { throw 'fixed-bootstrap-source-invalid' }
            } finally { $stream.Dispose() }
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $hash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() }
            finally { $sha.Dispose() }
            if ($hash -cne $ExpectedHash) { throw 'fixed-bootstrap-source-invalid' }
            $source = [Text.UTF8Encoding]::new($false, $true).GetString($bytes)
            $diagnostic.phase = 'fixed-source-parse'
            $entry = [scriptblock]::Create($source)
            $env:AEGIS_CLOUD_GUEST_LAB = 'trusted-bootstrap-v1'
            $env:AEGIS_CLOUD_GUEST_VM_ID = $VmId
            $env:GITHUB_ACTIONS = 'true'; $env:RUNNER_ENVIRONMENT = 'github-hosted'; $env:RUNNER_OS = 'Windows'
            $diagnostic.phase = 'fixed-source-invocation'; $diagnostic.invocationAttempted = $true
            $value = & $entry -TaskPassword $Password
            $diagnostic.phase = 'fixed-source-returned'
            if ($value -isnot [hashtable] -or !$value.ContainsKey('task') -or $null -eq $value.task -or $value.task.passed -isnot [bool]) { throw 'fixed-bootstrap-result-invalid' }
            $value.bootstrapInvocation = $diagnostic
            return $value
        } catch {
            $diagnostic.hResult = $_.Exception.HResult
            $kind = $_.Exception.GetType().Name
            $diagnostic.exceptionKind = if ($kind -cin @('RuntimeException', 'PSSecurityException', 'UnauthorizedAccessException', 'MethodInvocationException', 'ParseException', 'CommandNotFoundException', 'ItemNotFoundException', 'ParameterBindingException')) { $kind } else { 'other' }
            $category = $_.CategoryInfo.Category.ToString()
            $diagnostic.category = if ($category -cin @('SecurityError', 'PermissionDenied', 'InvalidOperation', 'InvalidArgument', 'ObjectNotFound', 'ParserError', 'OperationStopped', 'NotSpecified')) { $category } else { 'other' }
            $line = $_.InvocationInfo.ScriptLineNumber
            if ($line -ge 1 -and $line -le 2048) { $diagnostic.line = [int]$line }
            return @{ schemaVersion = 1; passed = $false; task = @{ passed = $false }; bootstrapInvocation = $diagnostic; launchAllowed = $false }
        }
    }
}

# One initial window; provider success does not establish that firmware consumed
# a key. Closing this window precedes every credential-bearing session attempt.
function Invoke-CloudGuestBootWindow($NativeOwner) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $value = @{ attempts = 0; completed = 0; optional = $true; failure = $null; mandatoryFailure = $false;
        outcomes = [Collections.Generic.List[object]]::new(); snapshots = [Collections.Generic.List[object]]::new();
        dispatchWindowMilliseconds = 60000; providerOperationTimeoutSeconds = 5; elapsedMilliseconds = 0; closedBeforeCredentialSession = $false; stoppedOnOwnedNonrunning = $false }
    try {
        while ($watch.ElapsedMilliseconds -lt 60000 -and $value.attempts -lt 60) {
            $value.attempts++
            try { if ($NativeOwner.SetupSpaceKey()) { $value.completed++ } }
            catch {
                $value.failure = Get-CloudGuestFailureDetails $_.Exception
                $value.outcomes.Add(@{ attempt = $value.attempts; elapsedMilliseconds = $watch.ElapsedMilliseconds; failure = $value.failure })
                $observation = $NativeOwner.KeyboardObservation
                $ownedNonrunning = $observation.phase -ceq 'vm-owned-nonrunning' -and $observation.vmIdentityMatched -eq $true -and
                    $observation.enabledState -is [uint16] -and $observation.enabledState -ne 2 -and $value.failure.code -ceq 'keyboard-owned-vm-not-running'
                $value.stoppedOnOwnedNonrunning = $ownedNonrunning -and !$NativeOwner.PendingUnknown
                $value.mandatoryFailure = $NativeOwner.PendingUnknown -or $observation.phase -ceq 'vm-observe' -or ($observation.phase -ceq 'vm-owned-nonrunning' -and !$ownedNonrunning)
                break
            }
            $value.outcomes.Add(@{ attempt = $value.attempts; elapsedMilliseconds = $watch.ElapsedMilliseconds; returnCode = $NativeOwner.KeyboardObservation.returnCode; providerCompleted = $NativeOwner.KeyboardObservation.completed })
            # Early fresh-install display only; no snapshots during readiness/task.
            if ($value.attempts -in @(1, 8) -and $watch.ElapsedMilliseconds -lt 20000) {
                try {
                    $snapshot = $NativeOwner.BootSnapshot(); $value.snapshots.Add($snapshot)
                    if ($snapshot.failureCode -eq 'boot-owned-vm-mismatch') { $value.failure = @{ code = 'boot-owned-vm-mismatch' }; $value.mandatoryFailure = $true; break }
                    if ($snapshot.failureCode -eq 'boot-owned-vm-not-running') {
                        $value.stoppedOnOwnedNonrunning = $snapshot.vmIdentityMatched -eq $true -and $snapshot.enabledState -is [uint16] -and $snapshot.enabledState -ne 2 -and !$NativeOwner.PendingUnknown
                        $value.mandatoryFailure = !$value.stoppedOnOwnedNonrunning
                        $value.failure = @{ code = 'boot-owned-vm-not-running' }; break
                    }
                }
                catch { $value.snapshots.Add(@{ failureCode = (Get-CloudGuestFailureDetails $_.Exception).code; imageBase64 = $null }) }
            }
            Start-Sleep -Milliseconds 1000
        }
    }
    finally { $NativeOwner.CloseBootWindow(); $value.closedBeforeCredentialSession = $true; $value.elapsedMilliseconds = $watch.ElapsedMilliseconds; $watch.Stop() }
    return $value
}

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
                    $ownedDisk = Get-Item -LiteralPath (Join-Path $VmRoot 'guest.vhdx') -Force
                    if ($ownedDisk.PSIsContainer -or ($ownedDisk.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'owned-guest-disk-layout-unexpected' }
                    $diskSamples.Add(@{ seconds = [int]$watch.Elapsed.TotalSeconds; freeBytes = $free; ownedVhdFileBytes = [long]$ownedDisk.Length }); $lastDisk = $watch.Elapsed.TotalSeconds
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
            $bootstrapHash = (Get-FileHash -LiteralPath (Join-Path $TransferRoot 'cloud-guest-bootstrap.ps1') -Algorithm SHA256).Hash.ToLowerInvariant()
            $result = Invoke-Command -Session $session -ArgumentList $TaskPassword, $Id, $bootstrapHash -ScriptBlock (Get-CloudGuestBootstrapInvocation)
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
