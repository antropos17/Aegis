Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'protected-installation.ps1')
. (Join-Path $PSScriptRoot 'protected-guest-agent.ps1')

# This API requires the original elevated provisioner association. No GUID,
# existing installation, arbitrary runspace or ordinary caller grants authority.
function Initialize-ProtectedGuestNative {
    Assert-ProtectedInstallAdministrator
    if ($null -eq ('ProtectedGuestVm' -as [type])) {
        $project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
        Add-Type -ReferencedAssemblies System.Management -Path @((Join-Path $PSScriptRoot 'ProtectedGuestVm.cs'),
            (Join-Path $project 'sidecar/session/OwnedVmLifecycle.cs'), (Join-Path $project 'sidecar/session/VmManagementNative.cs'))
    }
}
function Set-ProtectedGuestDisk($Context, $Request) {
    Assert-ProtectedInstallation $Context
    $owned = $Context.vmProvision
    if ($null -eq $owned -or $owned.ContainsKey('guest') -or $owned.ContainsKey('hydrated') -or $Request -isnot [hashtable] -or $Request.Count -ne 3 -or
        @($Request.Keys | Where-Object { $_ -cnotin @('path', 'bytes', 'sha256') }).Count -ne 0 -or $Request.path -isnot [string] -or
        $Request.bytes -isnot [long] -or $Request.bytes -lt 1MB -or $Request.bytes -gt 64GB -or $Request.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'protected-guest-disk-request-refused' }
    $source = [ProtectedInstallFile]::new($Request.path, $false, $false)
    try {
        if ($source.HashImage($Request.bytes) -cne $Request.sha256) { throw 'protected-guest-disk-digest-refused' }
        $owned.unknown = $true; $owned.hydrated = $true
        Write-ProtectedVmJournal $owned 'pending-hydrate.json' @{ schemaVersion = 1; vmId = $owned.vmId; bytes = $Request.bytes; sha256 = $Request.sha256 }
        $prior = $owned.disk; $live = [ProtectedInstallFile]::OpenLiveDisk($prior.PathName)
        if ($live.FileId -cne $prior.FileId -or $live.Volume -cne $prior.Volume -or $live.Sddl -cne $prior.Sddl) { $live.Dispose(); throw 'protected-guest-disk-handoff-refused' }
        $owned.disk = $live; $prior.Dispose()
        $live.HydrateDisk($source, $Request.bytes, $Request.sha256)
        $next = [ProtectedInstallFile]::new($live.PathName, $false, $false)
        if ($next.FileId -cne $live.FileId -or $next.Volume -cne $live.Volume -or $next.Sddl -cne $live.Sddl) { $next.Dispose(); throw 'protected-guest-disk-handoff-refused' }
        $owned.disk = $next; $live.Dispose()
        Invoke-ProtectedVmEffect $owned 'bootdisk'; $owned.unknown = $true
        $owned.binding = Read-ProtectedInstallVmBinding $owned.vmId $owned.verifier; $Context.vmBinding = $owned.binding
        Write-ProtectedVmJournal $owned 'settled-hydrate.json' @{ schemaVersion = 1; vmId = $owned.vmId; bytes = $Request.bytes; sha256 = $Request.sha256 }
        $owned.rows = Read-ProtectedVmTree $owned $true; $owned.unknown = $false
        Update-ProtectedInstallation $Context $Context.stage.root.PathName $Context.manifest | Out-Null
    } catch { $owned.unknown = $true; throw }
    finally { $source.Dispose() }
}
function Assert-ProtectedGuestConfiguration($Owned, [string]$State) {
    # No mutation, automatic repair, name-based adoption or host networking.
    $vm = Get-VM -Id ([guid]$Owned.vmId) -ErrorAction Stop
    $location = [IO.Path]::GetFullPath($vm.ConfigurationLocation).TrimEnd('\')
    $expected = Join-Path $Owned.root.PathName 'Machine'
    $disks = @(Get-VMHardDiskDrive -VM $vm); $dvd = @(Get-VMDvdDrive -VM $vm)
    if ($vm.Id.ToString('D') -cne $Owned.vmId -or $vm.Name -cne $Owned.name -or $vm.State.ToString() -cne $State -or
        ($location -cne $expected -and !$location.StartsWith($expected + '\', [StringComparison]::OrdinalIgnoreCase)) -or
        $vm.Generation -ne 2 -or $vm.DynamicMemoryEnabled -or $vm.MemoryStartup -ne 4GB -or $vm.ProcessorCount -ne 2 -or
        $vm.AutomaticStartAction.ToString() -cne 'Nothing' -or $vm.AutomaticStopAction.ToString() -cne 'TurnOff' -or
        $vm.AutomaticCheckpointsEnabled -or $vm.CheckpointType.ToString() -cne 'Disabled' -or
        @(Get-VMSnapshot -VM $vm).Count -ne 0 -or @(Get-VMNetworkAdapter -VM $vm).Count -ne 0 -or
        $disks.Count -ne 1 -or $disks[0].Path -cne $Owned.disk.PathName -or $disks[0].ControllerType.ToString() -cne 'SCSI' -or
        $disks[0].ControllerNumber -ne 0 -or $disks[0].ControllerLocation -ne 0 -or $dvd.Count -ne 1 -or $dvd[0].Path -cne $Owned.image.PathName -or
        (Get-VMFirmware -VM $vm).SecureBoot.ToString() -cne 'On') { throw 'protected-guest-configuration-refused' }
    foreach ($role in @('root', 'images', 'disks', 'image', 'disk')) { $Owned[$role].Recheck(); $Owned[$role].RequireHighIntegrity() }
    Read-ProtectedVmTree $Owned | Out-Null
}
function Start-ProtectedGuest($Context) {
    Initialize-ProtectedGuestNative; Assert-ProtectedInstallation $Context
    $owned = $Context.vmProvision
    if ($null -eq $owned -or !$owned.ContainsKey('hydrated') -or $owned.ContainsKey('guest')) { throw 'protected-guest-start-refused' }
    Assert-ProtectedGuestConfiguration $owned 'Off'
    $owned.guest = @{ consumed = $true; owner = $null; state = 'pending'; agentConsumed = $false; checkpoint = 1 }
    $owned.unknown = $true
    Write-ProtectedVmJournal $owned 'pending-start.json' @{ schemaVersion = 1; vmId = $owned.vmId; identitySha256 = $owned.binding.identitySha256 }
    $owned.guest.owner = [ProtectedGuestVm]::new($owned.vmId, $owned.binding.identitySha256)
    $owned.guest.checkpoint = 2
    $prior = $owned.disk; $live = [ProtectedInstallFile]::OpenLiveDisk($prior.PathName)
    if ($live.FileId -cne $prior.FileId -or $live.Volume -cne $prior.Volume -or $live.Sddl -cne $prior.Sddl) { $live.Dispose(); throw 'protected-guest-disk-handoff-refused' }
    $owned.disk = $live; $prior.Dispose()
    $owned.guest.checkpoint = 3
    if (!$owned.guest.owner.Start() -or $owned.guest.owner.PendingUnknown) { throw 'protected-guest-start-settlement-unknown' }
    $owned.guest.checkpoint = 4
    Assert-ProtectedGuestConfiguration $owned 'Running'
    $owned.guest.checkpoint = 5
    Write-ProtectedVmJournal $owned 'settled-start.json' @{ schemaVersion = 1; vmId = $owned.vmId; running = $true }
    $owned.guest.state = 'running'; $owned.unknown = $false
}
function Stop-ProtectedGuest($Context) {
    Assert-ProtectedInstallAdministrator; $owned = $Context.vmProvision
    if ($null -eq $owned -or !$owned.ContainsKey('guest') -or $owned.unknown -or $owned.guest.state -cne 'running') { throw 'protected-guest-stop-refused' }
    Assert-ProtectedGuestConfiguration $owned 'Running'
    $owned.unknown = $true; $owned.guest.state = 'stopping'
    Write-ProtectedVmJournal $owned 'pending-stop.json' @{ schemaVersion = 1; vmId = $owned.vmId }
    if (!$owned.guest.owner.Stop() -or $owned.guest.owner.PendingUnknown -or !$owned.guest.owner.ObserveOff()) { throw 'protected-guest-stop-settlement-unknown' }
    Assert-ProtectedGuestConfiguration $owned 'Off'
    $prior = $owned.disk; $offline = [ProtectedInstallFile]::new($prior.PathName, $false, $false)
    if ($offline.FileId -cne $prior.FileId -or $offline.Volume -cne $prior.Volume -or $offline.Sddl -cne $prior.Sddl) { $offline.Dispose(); throw 'protected-guest-disk-handoff-refused' }
    $owned.disk = $offline; $prior.Dispose()
    $owned.binding = Read-ProtectedInstallVmBinding $owned.vmId $owned.verifier; $Context.vmBinding = $owned.binding
    Write-ProtectedVmJournal $owned 'settled-stop.json' @{ schemaVersion = 1; vmId = $owned.vmId; off = $true }
    $owned.rows = Read-ProtectedVmTree $owned; $owned.guest.owner.Dispose(); $owned.guest.state = 'closed'; $owned.unknown = $false
    Update-ProtectedInstallation $Context $Context.stage.root.PathName $Context.manifest | Out-Null
}
