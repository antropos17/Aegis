param([Parameter(Mandatory = $true)][string]$OutputRoot)
Set-StrictMode -Version Latest; $ErrorActionPreference = 'Stop'
# Actual effects run only on the fresh disposable hosted runner, under PS 5.1.
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    $OutputRoot -cne (Join-Path $env:RUNNER_TEMP ('aegis-cloud-hyperv-' + $env:GITHUB_RUN_ID + '-' + $env:GITHUB_RUN_ATTEMPT))) { throw 'protected-vm-controls-scope-refused' }
. (Join-Path $PSScriptRoot 'cloud-guest-media.ps1')
. (Join-Path $PSScriptRoot 'installed-owner-build.ps1')
. (Join-Path $PSScriptRoot 'installed-owner-phase.ps1')
$report = @{ schemaVersion = 1; scope = 'fresh-off-vm-provisioning'; sourceSha = $env:EXPECTED_SOURCE_SHA;
    passed = $false; failure = $null; cleanupFailure = $null; build = $null; fresh = $null; upgradePreserved = $false;
    imageWriteBlocked = $false; diskWriteBlocked = $false; imageDigestRefusal = $false; unknownChildRefusal = $false;
    rollbackPreserved = $false; partialCleanup = $false; removed = $false; launchAllowed = $false; guestStarted = $false }
$association = $null; $journal = @{}; $stage = 'preflight'; $id = $null
try {
    Assert-ProtectedInstallAdministrator; Initialize-ProtectedInstallNative
    $project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
    $native = Join-Path $OutputRoot 'provision-native'; New-Item -ItemType Directory -Path $native | Out-Null
    $payloadRoot = Join-Path $OutputRoot 'provision-payload'
    $stage = 'build'; $report.build = Build-InstalledOwnerPayload $project $payloadRoot $native $env:EXPECTED_SOURCE_SHA
    $payload = Test-InstalledOwnerPayload $payloadRoot $env:EXPECTED_SOURCE_SHA
    $manifest = Get-InstalledOwnerBinaryManifest $payload $false
    # Valid nonbootable media permits firmware startup. Plain text renamed to
    # .iso is refused by VMMS with ERROR_FILE_CORRUPT before firmware executes.
    Add-Type -ReferencedAssemblies System.Net.Http -Path (Join-Path $PSScriptRoot 'CloudGuestMetadata.cs')
    $source = Join-Path $OutputRoot 'provision-source.iso'
    New-CloudGuestAnswerIso (Join-Path $OutputRoot 'provision-iso-content') $source '<AEGISFixture />' | Out-Null
    $request = @{ path = $source; bytes = [long](Get-Item -LiteralPath $source).Length; sha256 = (Get-FileHash -LiteralPath $source).Hash.ToLowerInvariant() }
    $account = 'AegisOp' + [guid]::NewGuid().ToString('N').Substring(0, 12); $password = 'Ae!9-' + [guid]::NewGuid().ToString('N')
    $stage = 'bad-image'; $bad = $request.Clone(); $bad.sha256 = '0' * 64
    try { New-ProtectedInstallation (Join-Path $payloadRoot 'binaries') $manifest $account $password $false @{} '' $bad | Out-Null }
    catch { $report.imageDigestRefusal = !(Test-Path -LiteralPath $script:ProtectedInstallParent) -and [ProtectedInstallService]::Absent() -and @(Get-LocalUser | Where-Object Name -CEQ $account).Count -eq 0 }
    if (!$report.imageDigestRefusal) { throw 'protected-vm-bad-image-control-refused' }
    $stage = 'create-install'; $association = New-ProtectedInstallation (Join-Path $payloadRoot 'binaries') $manifest $account $password $false $journal '' $request
    $owned = $association.vmProvision; $id = $owned.vmId
    $report.fresh = @{ vmId = $id; identitySha256 = $association.vmBinding.identitySha256; storageSha256 = $association.vmBinding.storageSha256;
        storageProtection = $association.vmBinding.storageProtection; imageSha256 = $request.sha256; fileCount = $owned.rows.Count; off = $true; privateNamespace = $owned.root.Protected($false); highIntegrity = $true }
    $stage = 'offline-holds'
    foreach ($kind in @('image', 'disk')) {
        $blocked = $false
        try { $stream = [IO.File]::Open($owned[$kind].PathName, 'Open', 'Write', 'ReadWrite'); $stream.Dispose() } catch { $blocked = $true }
        $report[$kind + 'WriteBlocked'] = $blocked
    }
    $stage = 'unknown-child'; $foreign = Join-Path $owned.root.PathName 'foreign-control.txt'
    [IO.File]::WriteAllText($foreign, 'retain')
    try { Assert-ProtectedInstallVm $association } catch { $report.unknownChildRefusal = (Test-Path -LiteralPath $foreign) -and $null -ne (Get-VM -Id ([guid]$id)) }
    Remove-Item -LiteralPath $foreign
    $stage = 'rollback'; $binding = $association.vmBinding.Clone(); $rootId = $owned.root.FileId; $fault = $false
    try { Update-ProtectedInstallation $association (Join-Path $payloadRoot 'binaries') $manifest $true | Out-Null }
    catch { $fault = $_.Exception.Message -like '*protected-qualified-upgrade-fault*' }
    Assert-ProtectedInstallation $association
    $report.rollbackPreserved = $fault -and $association.vmProvision.root.FileId -ceq $rootId -and $association.vmBinding.storageSha256 -ceq $binding.storageSha256
    $stage = 'upgrade'
    Update-ProtectedInstallation $association (Join-Path $payloadRoot 'binaries') $manifest | Out-Null
    Assert-ProtectedInstallation $association
    $report.upgradePreserved = $association.vmBinding.vmId -ceq $id -and $association.vmProvision.root.FileId -ceq $rootId -and $association.vmBinding.storageSha256 -ceq $binding.storageSha256
    $stage = 'live-disk-control'
    . (Join-Path $PSScriptRoot '../installation/protected-guest.ps1')
    $sourceDisk = Join-Path $OutputRoot 'provision-boot-control.vhdx'
    $sourceBytes = [long](Get-Item -LiteralPath $owned.disk.PathName).Length
    $sourceDigest = $owned.disk.HashImage($sourceBytes)
    $raw = [Security.AccessControl.RawSecurityDescriptor]::new('O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)S:(ML;;NW;;;HI)')
    $descriptor = New-Object byte[] $raw.BinaryLength; $raw.GetBinaryForm($descriptor, 0)
    $owned.disk.CopyImage($sourceDisk, $sourceBytes, $sourceDigest, $descriptor)
    $diskRequest = @{ path = $sourceDisk; bytes = $sourceBytes; sha256 = $sourceDigest }
    Set-ProtectedGuestDisk $association $diskRequest
    $originalDiskId = $owned.disk.FileId
    $stage = 'live-start'; Start-ProtectedGuest $association
    $replay = $false
    try { Start-ProtectedGuest $association } catch { $replay = $true }
    $stage = 'live-stop'; Stop-ProtectedGuest $association
    $report['liveLifecycle'] = @{ passed = $replay -and $owned.disk.FileId -ceq $originalDiskId -and $owned.guest.state -ceq 'closed';
        replayRefused = $replay; originalDiskIdRetained = ($owned.disk.FileId -ceq $originalDiskId); offConfirmed = ($owned.guest.state -ceq 'closed'); guestOsBooted = $false }
    if (!$report.liveLifecycle.passed) { throw 'protected-vm-live-control-failed' }
    $stage = 'uninstall'; Remove-ProtectedInstallation $association; $association = $null
    $rows = @(Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_ComputerSystem -Filter "Name='$id'" -OperationTimeoutSec 5)
    $report.removed = $rows.Count -eq 0 -and !(Test-Path -LiteralPath $script:ProtectedInstallParent) -and [ProtectedInstallService]::Absent() -and @(Get-LocalUser | Where-Object Name -CEQ $account).Count -eq 0
    $stage = 'partial-install'; $journal = @{}; $partialAccount = 'AegisOp' + [guid]::NewGuid().ToString('N').Substring(0, 12); $fault = $false
    try { New-ProtectedInstallation (Join-Path $payloadRoot 'binaries') $manifest $partialAccount $password $true $journal '' $request | Out-Null }
    catch { $fault = $_.Exception.Message -like '*protected-qualified-partial-fault*' }
    $partialId = $journal.association.vmBinding.vmId
    $report.partialCleanup = $fault -and $journal.cleanup.state -ceq 'confirmed' -and
        @(Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_ComputerSystem -Filter "Name='$partialId'" -OperationTimeoutSec 5).Count -eq 0 -and
        !(Test-Path -LiteralPath $script:ProtectedInstallParent) -and [ProtectedInstallService]::Absent() -and @(Get-LocalUser | Where-Object Name -CEQ $partialAccount).Count -eq 0
    $report.passed = $report.removed -and $report.partialCleanup -and $report.rollbackPreserved -and $report.upgradePreserved -and $report.imageWriteBlocked -and $report.diskWriteBlocked -and $report.unknownChildRefusal -and $report.fresh.privateNamespace
    if (!$report.passed) { throw 'protected-vm-controls-incomplete' }
} catch {
    $report.failure = Get-ProtectedInstallFailure $_ 'qualification'; $report.failure.stage = $stage
    if ($journal.ContainsKey('failure') -and $null -ne $journal.failure) { $report.failure.installation = $journal.failure }
    if ($journal.ContainsKey('association') -and $journal.association.ContainsKey('vmProvision') -and $null -ne $journal.association.vmProvision) {
        $owned = $journal.association.vmProvision
        $report.failure.provision = @{ checkpoint = $owned.checkpoint; unknown = $owned.unknown; vmIdReturned = ($owned.vmId -cne '') }
        if ($owned.ContainsKey('guest')) {
            $report.failure.provision.guestCheckpoint = $owned.guest.checkpoint
            if ($null -ne $owned.guest.owner) {
                $report.failure.provision.lifecycle = @{ returnCode = $owned.guest.owner.ReturnCode; jobState = $owned.guest.owner.JobState; jobError = $owned.guest.owner.JobError; hResult = $owned.guest.owner.FailureHResult; errorCodes = $owned.guest.owner.ErrorCodes }
            }
        }
        $report.failure.provision.directories = @()
        foreach ($role in @('root', 'images', 'disks')) {
            if ($null -ne $owned[$role]) {
                try {
                    $current = [ProtectedInstallFile]::new($owned[$role].PathName, $true, $false)
                    try { $report.failure.provision.directories += @{ role = $role; sameId = ($current.FileId -ceq $owned[$role].FileId -and $current.Volume -ceq $owned[$role].Volume); protectedAncestor = $current.Protected($true); sddl = $current.Sddl } } finally { $current.Dispose() }
                } catch { $report.failure.provision.directories += @{ role = $role; observed = $false } }
            }
        }
        $cause = $_.Exception
        $rows = @()
        for ($depth = 0; $null -ne $cause -and $depth -lt 8; $depth++) {
            $rows += @{ type = $cause.GetType().Name; hResult = $cause.HResult }
            $cause = $cause.InnerException
        }
        $report.failure.types = $rows
    }
} finally {
    if ($null -eq $association -and $journal.ContainsKey('association')) { $association = $journal.association }
    if ($null -ne $association -and $null -ne $association.parent) {
        try {
            if ($association.cleanupUnknown -or ($association.ContainsKey('vmProvision') -and $association.vmProvision.unknown)) { throw 'protected-vm-owned-state-retained' }
            if ($null -ne $association.service -and $null -ne $association.stage) { Remove-ProtectedInstallation $association }
            else { throw 'protected-vm-owned-state-retained' }
        } catch { $report.cleanupFailure = Get-ProtectedInstallFailure $_ 'qualification' }
    }
    $text = $report | ConvertTo-Json -Depth 16 -Compress
    if ([Text.Encoding]::UTF8.GetByteCount($text) -gt 192KB) { throw 'protected-vm-controls-receipt-budget' }
    [IO.File]::WriteAllText((Join-Path $OutputRoot 'provision.json'), $text)
}
if (!$report.passed -or $null -ne $report.failure -or $null -ne $report.cleanupFailure) { exit 1 }
