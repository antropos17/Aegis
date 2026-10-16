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
function Assert-ProtectedGuestHeadroom($Owned, [long]$AdditionalBytes = 0) {
    $drive = [IO.Path]::GetPathRoot($Owned.root.PathName).Substring(0, 1)
    # Reserve fixed guest RAM backing plus a separate4GiB host floor. Neither
    # source hashing nor an unknown partial copy may consume that reserve.
    if ([long](Get-PSDrive -Name $drive).Free -lt ($AdditionalBytes + 8GB)) { throw 'protected-guest-host-headroom-refused' }
}
function Assert-ProtectedGuestTree($Owned, $Rows) {
    $machine = Join-Path $Owned.root.PathName 'Machine\'
    $journals = @('pending-hydrate.json', 'settled-hydrate.json', 'pending-bootdisk.json', 'settled-bootdisk.json',
        'pending-start.json', 'settled-start.json', 'pending-agent.json', 'settled-agent.json', 'pending-stop.json', 'settled-stop.json')
    foreach ($row in $Rows) {
        $prior = @($Owned.rows | Where-Object { $_.path -ceq $row.path })
        $configuration = !$row.directory -and $row.path.StartsWith($machine, [StringComparison]::OrdinalIgnoreCase) -and
            [IO.Path]::GetFileName($row.path) -imatch ('^' + [regex]::Escape($Owned.vmId) + '\.(vmcx|vmgs|vmrs)$')
        if ($prior.Count -eq 1) {
            if ($prior[0].volume -cne $row.volume -or $prior[0].directory -cne $row.directory -or
                (!$configuration -and ($prior[0].fileId -cne $row.fileId -or $prior[0].sddl -cne $row.sddl))) { throw 'protected-vm-tree-changed' }
        } elseif (!$configuration -and ($row.directory -or [IO.Path]::GetDirectoryName($row.path) -ine $Owned.root.PathName -or
            [IO.Path]::GetFileName($row.path) -cnotin $journals)) { throw 'protected-vm-unowned-child' }
    }
    foreach ($prior in $Owned.rows) {
        if (@($Rows | Where-Object { $_.path -ceq $prior.path }).Count -ne 1) { throw 'protected-vm-tree-changed' }
    }
}
function Set-ProtectedGuestDisk($Context, $Request) {
    Assert-ProtectedInstallation $Context
    $owned = $Context.vmProvision
    if ($null -eq $owned -or $owned.ContainsKey('guest') -or $owned.ContainsKey('hydrated') -or $Request -isnot [hashtable] -or $Request.Count -ne 3 -or
        @($Request.Keys | Where-Object { $_ -cnotin @('path', 'bytes', 'sha256') }).Count -ne 0 -or $Request.path -isnot [string] -or
        $Request.bytes -isnot [long] -or $Request.bytes -lt 1MB -or $Request.bytes -gt 64GB -or $Request.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'protected-guest-disk-request-refused' }
    Assert-ProtectedGuestHeadroom $owned $Request.bytes
    $source = [ProtectedInstallFile]::new($Request.path, $false, $false)
    try {
        if ($source.HashImage($Request.bytes) -cne $Request.sha256) { throw 'protected-guest-disk-digest-refused' }
        $owned.unknown = $true; $owned.hydrated = $true
        Write-ProtectedVmJournal $owned 'pending-hydrate.json' @{ schemaVersion = 1; vmId = $owned.vmId; bytes = $Request.bytes; sha256 = $Request.sha256 }
        $prior = $owned.disk; $live = [ProtectedInstallFile]::OpenWritableDisk($prior.PathName)
        if ($live.FileId -cne $prior.FileId -or $live.Volume -cne $prior.Volume -or $live.Sddl -cne $prior.Sddl) { $live.Dispose(); throw 'protected-guest-disk-handoff-refused' }
        $owned.disk = $live; $prior.Dispose()
        $live.HydrateDisk($source, $Request.bytes, $Request.sha256)
        $next = [ProtectedInstallFile]::new($live.PathName, $false, $false)
        if ($next.FileId -cne $live.FileId -or $next.Volume -cne $live.Volume -or $next.Sddl -cne $live.Sddl) { $next.Dispose(); throw 'protected-guest-disk-handoff-refused' }
        $owned.disk = $next; $live.Dispose()
        Invoke-ProtectedVmEffect $owned 'bootdisk'; $owned.unknown = $true
        $owned.binding = Read-ProtectedInstallVmBinding $owned.vmId $owned.verifier; $Context.vmBinding = $owned.binding
        Write-ProtectedVmJournal $owned 'settled-hydrate.json' @{ schemaVersion = 1; vmId = $owned.vmId; bytes = $Request.bytes; sha256 = $Request.sha256 }
        $nextRows = Read-ProtectedVmTree $owned $true; Assert-ProtectedGuestTree $owned $nextRows
        $owned.rows = $nextRows; $owned.unknown = $false
        Update-ProtectedInstallation $Context $Context.stage.root.PathName $Context.manifest | Out-Null
    } catch { $owned.unknown = $true; throw }
    finally { $source.Dispose() }
}
function Assert-ProtectedGuestConfiguration($Owned, [string]$State) {
    # No mutation, automatic repair, name-based adoption or host networking.
    $Owned.configurationCheckpoint = 1
    $vm = Get-VM -Id ([guid]$Owned.vmId) -ErrorAction Stop
    $location = [IO.Path]::GetFullPath($vm.ConfigurationLocation).TrimEnd('\')
    $expected = Join-Path $Owned.root.PathName 'Machine'
    $disks = @(Get-VMHardDiskDrive -VM $vm); $dvd = @(Get-VMDvdDrive -VM $vm)
    $checks = [ordered]@{
        vmId = ($vm.Id.ToString('D') -ceq $Owned.vmId); name = ($vm.Name -ceq $Owned.name); state = ($vm.State.ToString() -ceq $State)
        location = ($location -ieq $expected -or $location.StartsWith($expected + '\', [StringComparison]::OrdinalIgnoreCase))
        generation = ($vm.Generation -eq 2); fixedMemory = (!$vm.DynamicMemoryEnabled); memory = ($vm.MemoryStartup -eq 4GB); processors = ($vm.ProcessorCount -eq 2)
        autoStart = ($vm.AutomaticStartAction.ToString() -ceq 'Nothing'); autoStop = ($vm.AutomaticStopAction.ToString() -ceq 'TurnOff')
        autoCheckpoints = (!$vm.AutomaticCheckpointsEnabled); checkpointType = ($vm.CheckpointType.ToString() -ceq 'Disabled')
        snapshots = (@(Get-VMSnapshot -VM $vm).Count -eq 0); networking = (@(Get-VMNetworkAdapter -VM $vm).Count -eq 0)
        diskCount = ($disks.Count -eq 1); dvdCount = ($dvd.Count -eq 1); secureBoot = ((Get-VMFirmware -VM $vm).SecureBoot.ToString() -ceq 'On')
    }
    if ($disks.Count -eq 1) {
        $checks.diskPath = ($disks[0].Path -ieq $Owned.disk.PathName); $checks.diskController = ($disks[0].ControllerType.ToString() -ceq 'SCSI')
        $checks.diskSlot = ($disks[0].ControllerNumber -eq 0 -and $disks[0].ControllerLocation -eq 0)
    }
    if ($dvd.Count -eq 1) { $checks.dvdPath = ($dvd[0].Path -ieq $Owned.image.PathName) }
    $Owned.configurationRefusals = @($checks.Keys | Where-Object { !$checks[$_] })
    $Owned.observedState = $(if ($vm.State.ToString() -cin @('Off', 'Running', 'Starting', 'Stopping', 'RunningCritical', 'OffCritical', 'Paused', 'Saved', 'Saving', 'Pausing')) { $vm.State.ToString() } else { 'other' })
    if ($Owned.configurationRefusals.Count -ne 0) { throw 'protected-guest-configuration-refused' }
    $Owned.configurationCheckpoint = 2
    foreach ($role in @('root', 'images', 'disks', 'image', 'disk')) { $Owned.configurationCheckpoint++; $Owned[$role].Recheck(); $Owned[$role].RequireHighIntegrity() }
    $Owned.configurationCheckpoint = 8
    $rows = Read-ProtectedVmTree $Owned; Assert-ProtectedGuestTree $Owned $rows
    $Owned.configurationCheckpoint = 9
}
function Start-ProtectedGuest($Context) {
    Initialize-ProtectedGuestNative; Assert-ProtectedInstallation $Context
    $owned = $Context.vmProvision
    if ($null -eq $owned -or !$owned.ContainsKey('hydrated') -or $owned.ContainsKey('guest')) { throw 'protected-guest-start-refused' }
    Assert-ProtectedGuestHeadroom $owned
    Assert-ProtectedGuestConfiguration $owned 'Off'
    $owned.guest = @{ consumed = $true; owner = $null; state = 'pending'; agentConsumed = $false; checkpoint = 1 }
    $owned.unknown = $true
    Write-ProtectedVmJournal $owned 'pending-start.json' @{ schemaVersion = 1; vmId = $owned.vmId; identitySha256 = $owned.binding.identitySha256 }
    $owned.guest.owner = [ProtectedGuestVm]::new($owned.vmId, $owned.binding.identitySha256)
    $owned.guest.checkpoint = 2
    # VMMS requires exclusive data access while running. The live metadata pin
    # observes original identity; private High-integrity file/ancestor ACLs deny
    # ordinary mutation. Restore the offline data pin only after confirmed Off.
    $prior = $owned.disk; $live = [ProtectedInstallFile]::OpenMetadata($prior.PathName, $false)
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
    $nextRows = Read-ProtectedVmTree $owned; Assert-ProtectedGuestTree $owned $nextRows
    $owned.rows = $nextRows; $owned.guest.owner.Dispose(); $owned.guest.state = 'closed'; $owned.unknown = $false
    Update-ProtectedInstallation $Context $Context.stage.root.PathName $Context.manifest | Out-Null
}
