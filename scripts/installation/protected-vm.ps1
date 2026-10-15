Set-StrictMode -Version Latest

function Open-ProtectedVmImage($Request) {
    if ($Request -isnot [hashtable] -or $Request.Count -ne 3 -or @($Request.Keys | Where-Object { $_ -cnotin @('path', 'bytes', 'sha256') }).Count -ne 0 -or
        $Request.path -isnot [string] -or $Request.bytes -isnot [long] -or $Request.bytes -le 0 -or $Request.bytes -gt 16GB -or
        $Request.sha256 -isnot [string] -or $Request.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'protected-vm-image-request-refused' }
    $image = [ProtectedInstallFile]::new($Request.path, $false, $false)
    try {
        if ($image.HashImage($Request.bytes) -cne $Request.sha256) { throw 'protected-vm-image-digest-refused' }
        return $image
    } catch { $image.Dispose(); throw }
}
function Write-ProtectedVmJournal($Owned, [string]$Name, $Record) {
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Record | ConvertTo-Json -Depth 5 -Compress))
    Write-ProtectedInstallFile (Join-Path $Owned.root.PathName $Name) $bytes '' $true
}
function New-ProtectedVmDisk($Owned) {
    Assert-ProtectedInstallAdministrator
    $acl = New-ProtectedInstallAcl $false '' $true
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($Owned.vmSid), [Security.AccessControl.FileSystemRights]::ReadAndExecute -bor [Security.AccessControl.FileSystemRights]::Write, [Security.AccessControl.AccessControlType]::Allow))
    $raw = [Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]'Owner,Access') + 'S:(ML;;NW;;;HI)')
    $descriptor = New-Object byte[] $raw.BinaryLength; $raw.GetBinaryForm($descriptor, 0)
    [ProtectedInstallDisk]::Create((Join-Path $Owned.disks.PathName 'system.vhdx'), $descriptor)
    $Owned.disks.Recheck()
}
function Invoke-ProtectedVmEffect($Owned, [string]$Action) {
    $Owned.unknown = $true
    Write-ProtectedVmJournal $Owned ('pending-' + $Action + '.json') @{ schemaVersion = 1; operation = $Action; installId = $Owned.installId; vmId = $Owned.vmId; name = $Owned.name }
    if ($Action -ceq 'disk') {
        New-ProtectedVmDisk $Owned
        $value = Invoke-ProtectedVmProvider $Owned 'observe'
    } else { $value = Invoke-ProtectedVmProvider $Owned $Action }
    if ($Action -ceq 'create') {
        if ($value.vmId -cnotmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' -or $value.vmId -ceq [guid]::Empty.ToString('D')) { throw 'protected-vm-create-identity-unknown' }
        $Owned.vmId = $value.vmId
    }
    if ($Action -ceq 'remove') {
        if ($value.absent -isnot [bool] -or !$value.absent) { throw 'protected-vm-removal-unknown' }
    } elseif ($value.vmId -cne $Owned.vmId -or $value.name -cne $Owned.name -or $value.off -isnot [bool] -or !$value.off) { throw 'protected-vm-effect-result-unknown' }
    Write-ProtectedVmJournal $Owned ('settled-' + $Action + '.json') @{ schemaVersion = 1; operation = $Action; vmId = $Owned.vmId; off = ($Action -cne 'remove'); absent = ($Action -ceq 'remove') }
    $Owned.unknown = $false
}
function Read-ProtectedVmTree($Owned, [bool]$SealConfiguration = $false) {
    $Owned.root.Recheck(); $rows = @(); $queue = [Collections.Generic.Queue[string]]::new(); $queue.Enqueue($Owned.root.PathName)
    while ($queue.Count -ne 0) {
        $parent = $queue.Dequeue()
        foreach ($item in @(Get-ChildItem -LiteralPath $parent -Force)) {
            if ($rows.Count -ge 128 -or $item.FullName.Length -gt $Owned.root.PathName.Length + 512 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'protected-vm-tree-budget-refused' }
            $held = [ProtectedInstallFile]::OpenMetadata($item.FullName, $item.PSIsContainer)
            try {
                $held.RequireHighIntegrity()
                $sd = [Security.AccessControl.RawSecurityDescriptor]::new($held.Sddl)
                if ($sd.Owner.Value -cnotin @('S-1-5-18', 'S-1-5-32-544') -or $null -eq $sd.DiscretionaryAcl) { throw 'protected-vm-tree-acl-refused' }
                if ($SealConfiguration -and ($item.FullName -ceq (Join-Path $Owned.root.PathName 'Machine') -or $item.FullName.StartsWith((Join-Path $Owned.root.PathName 'Machine\'), [StringComparison]::OrdinalIgnoreCase))) {
                    # The new high-integrity namespace predates VM creation; no
                    # ordinary caller could have created or opened these files
                    # for mutation. Seal only this provider-created subtree.
                    $volume = $held.Volume; $id = $held.FileId
                    $acl = New-ProtectedInstallAcl $item.PSIsContainer '' $true
                    $inherit = if ($item.PSIsContainer) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
                    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($Owned.vmSid), [Security.AccessControl.FileSystemRights]::ReadAndExecute, $inherit, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
                    if ($item.PSIsContainer) { [IO.Directory]::SetAccessControl($held.PathName, $acl) } else { [IO.File]::SetAccessControl($held.PathName, $acl) }
                    $held.RecheckIdentity(); $held.Dispose()
                    $held = [ProtectedInstallFile]::OpenMetadata($item.FullName, $item.PSIsContainer)
                    if ($held.FileId -cne $id -or $held.Volume -cne $volume) { throw 'protected-vm-tree-changed' }
                    $held.RequireHighIntegrity(); $sd = [Security.AccessControl.RawSecurityDescriptor]::new($held.Sddl)
                }
                foreach ($ace in $sd.DiscretionaryAcl) {
                    if (([int]$ace.AceFlags -band [int][Security.AccessControl.AceFlags]::InheritOnly) -ne 0) { continue }
                    if ($ace -isnot [Security.AccessControl.CommonAce] -or $ace.IsCallback -or $ace.AceQualifier -ne [Security.AccessControl.AceQualifier]::AccessAllowed -or
                        $ace.SecurityIdentifier.Value -cnotin @('S-1-5-18', 'S-1-5-32-544', $Owned.vmSid)) { throw 'protected-vm-tree-acl-refused' }
                }
                $rows += @{ path = $held.PathName; volume = $held.Volume; fileId = $held.FileId; sddl = $held.Sddl; directory = $item.PSIsContainer }
                if ($item.PSIsContainer) { $queue.Enqueue($item.FullName) }
            } finally { $held.Dispose() }
        }
    }
    return ,$rows
}
function Assert-ProtectedVmTree($Owned, [bool]$Subset = $false) {
    $actual = Read-ProtectedVmTree $Owned
    if (!$Subset -and $actual.Count -ne $Owned.rows.Count) { throw 'protected-vm-tree-changed' }
    foreach ($row in $actual) {
        $prior = @($Owned.rows | Where-Object { $_.path -ceq $row.path })
        if ($prior.Count -ne 1) { throw 'protected-vm-unowned-child' }
        foreach ($key in @('volume', 'fileId', 'sddl', 'directory')) { if ($prior[0][$key] -cne $row[$key]) { throw 'protected-vm-tree-changed' } }
    }
}
function Seal-ProtectedVmDirectory($Owned, [string]$Role) {
    # Hyper-V's attachment cmdlets may grant the VM directory control for future
    # checkpoints. Reduce only our freshly created, still-pinned exact directory.
    $prior = $Owned[$Role]; $prior.RecheckIdentity()
    $prior.RequireHighIntegrity()
    $current = [ProtectedInstallFile]::new($prior.PathName, $true, $false)
    try {
        if ($current.FileId -cne $prior.FileId -or $current.Volume -cne $prior.Volume) { throw 'protected-vm-directory-handoff-refused' }
        $sd = [Security.AccessControl.RawSecurityDescriptor]::new($current.Sddl)
        if ($sd.Owner.Value -cnotin @('S-1-5-18', 'S-1-5-32-544') -or $null -eq $sd.DiscretionaryAcl) { throw 'protected-vm-tree-acl-refused' }
        # VMMS can rewrite the storage directory ACL even through WMI. Both
        # original media files must already deny write/delete sharing, and the
        # directory must still be our exact pinned identity. No preexisting or
        # later discovered file can acquire ownership through this sealing step.
        $Owned.image.RequireHighIntegrity(); $Owned.disk.RequireHighIntegrity()
        foreach ($pair in @(@{ root = $Owned.images; file = $Owned.image }, @{ root = $Owned.disks; file = $Owned.disk })) {
            $children = @(Get-ChildItem -LiteralPath $pair.root.PathName -Force)
            if ($children.Count -ne 1 -or $children[0].FullName -cne $pair.file.PathName) { throw 'protected-vm-unowned-child' }
        }
        $acl = New-ProtectedInstallAcl $true '' $true
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($Owned.vmSid), [Security.AccessControl.FileSystemRights]::ReadAndExecute, [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit', [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
        [IO.Directory]::SetAccessControl($prior.PathName, $acl)
        $prior.RecheckIdentity()
    } finally { $current.Dispose() }
    $prior.Dispose()
    $next = [ProtectedInstallFile]::new($prior.PathName, $true, $false)
    try {
        if ($next.FileId -cne $prior.FileId -or $next.Volume -cne $prior.Volume -or !$next.Protected($true)) { throw 'protected-vm-directory-handoff-refused' }
        $Owned[$Role] = $next.PinForProvider()
    } catch { $next.Dispose(); throw }
}
function New-ProtectedInstallVm($Context, $Request, $SourceImage) {
    Assert-ProtectedInstallAdministrator
    $owned = @{ root = $null; images = $null; disks = $null; image = $null; disk = $null; vmId = ''; vmSid = ''; unknown = $true;
        name = 'aegis-protected-' + [guid]::NewGuid().ToString('N'); installId = $Context.installId; rows = @(); binding = $null; verifier = $Context.inputs['aegis-session.exe'].Clone(); checkpoint = 1 }
    $Context.vmProvision = $owned
    $owned.root = New-ProtectedInstallDirectory (Join-Path $Context.parent.PathName 'Vm') '' $true $true
    $owned.root.RequireHighIntegrity()
    $owned.root = $owned.root.PinForProvider()
    $owned.images = New-ProtectedInstallDirectory (Join-Path $owned.root.PathName 'Images') '' $true $true
    $owned.images.RequireHighIntegrity()
    $owned.images = $owned.images.PinForProvider()
    $owned.disks = New-ProtectedInstallDirectory (Join-Path $owned.root.PathName 'Disks') '' $true $true
    $owned.disks.RequireHighIntegrity()
    $owned.disks = $owned.disks.PinForProvider()
    $owned.checkpoint = 2
    Write-ProtectedVmJournal $owned 'intent.json' @{ schemaVersion = 1; installId = $owned.installId; name = $owned.name; imageBytes = $Request.bytes; imageSha256 = $Request.sha256; diskBytes = 64GB; guestStartAuthorized = $false }
    Invoke-ProtectedVmEffect $owned 'create'
    $owned.checkpoint = 3
    $owned.vmSid = ([Security.Principal.NTAccount]::new('NT VIRTUAL MACHINE', $owned.vmId)).Translate([Security.Principal.SecurityIdentifier]).Value
    if ($owned.vmSid -cnotmatch '^S-1-5-83-[0-9-]+$' -or $owned.vmSid -ceq 'S-1-5-83-0') { throw 'protected-vm-principal-refused' }
    # Only these new private assets receive this freshly returned VM principal.
    $acl = New-ProtectedInstallAcl $false '' $true
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($owned.vmSid), [Security.AccessControl.FileSystemRights]::ReadAndExecute, [Security.AccessControl.AccessControlType]::Allow))
    $raw = [Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]'Owner,Access') + 'S:(ML;;NW;;;HI)')
    $imageDescriptor = New-Object byte[] $raw.BinaryLength; $raw.GetBinaryForm($imageDescriptor, 0)
    $imagePath = Join-Path $owned.images.PathName 'boot.iso'
    $owned.unknown = $true
    $SourceImage.CopyImage($imagePath, $Request.bytes, $Request.sha256, $imageDescriptor)
    $owned.image = [ProtectedInstallFile]::new($imagePath, $false, $false)
    $owned.image.RequireHighIntegrity()
    $imageVolume = $owned.image.Volume; $imageId = $owned.image.FileId
    $owned.checkpoint = 4
    Invoke-ProtectedVmEffect $owned 'disk'
    $diskPath = Join-Path $owned.disks.PathName 'system.vhdx'
    $before = [ProtectedInstallFile]::new($diskPath, $false, $false)
    $before.RequireHighIntegrity()
    $owned.checkpoint = 5
    try {
        $volume = $before.Volume; $fileId = $before.FileId; $before.Recheck()
        $diskAcl = New-ProtectedInstallAcl $false '' $true
        $diskAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($owned.vmSid), [Security.AccessControl.FileSystemRights]::ReadAndExecute -bor [Security.AccessControl.FileSystemRights]::Write, [Security.AccessControl.AccessControlType]::Allow))
        if ($before.Sddl -cne $diskAcl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]'Owner,Access')) { throw 'protected-vm-new-disk-acl-refused' }
        $owned.disk = $before
    } finally { if ($null -eq $owned.disk) { $before.Dispose() } }
    $owned.checkpoint = 6
    Invoke-ProtectedVmEffect $owned 'configure'
    $owned.unknown = $true
    foreach ($role in @('root', 'images', 'disks')) { Seal-ProtectedVmDirectory $owned $role }
    # Keep the originally captured leaf IDs; attachment ACL changes grant no
    # permission to adopt a replaced file or a caller-selected existing asset.
    foreach ($row in @(@{ path = $diskPath; volume = $volume; id = $fileId; acl = $diskAcl }, @{ path = $imagePath; volume = $imageVolume; id = $imageId; acl = $acl })) {
        $held = [ProtectedInstallFile]::new($row.path, $false, $false)
        try {
            if ($held.Volume -cne $row.volume -or $held.FileId -cne $row.id) { throw 'protected-vm-asset-handoff-refused' }
            $sd = [Security.AccessControl.RawSecurityDescriptor]::new($held.Sddl)
            if ($sd.Owner.Value -cnotin @('S-1-5-18', 'S-1-5-32-544') -or $null -eq $sd.DiscretionaryAcl) { throw 'protected-vm-tree-acl-refused' }
            $finalAcl = [Security.AccessControl.FileSecurity]::new()
            $finalAcl.SetSecurityDescriptorSddlForm($row.acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]'Owner,Access'))
            [IO.File]::SetAccessControl($row.path, $finalAcl); $held.RecheckIdentity(); $held.RequireHighIntegrity()
        } finally { $held.Dispose() }
    }
    foreach ($role in @('image', 'disk')) {
        $prior = $owned[$role]; $prior.RecheckIdentity()
        $next = [ProtectedInstallFile]::new($prior.PathName, $false, $false)
        if ($next.FileId -cne $prior.FileId -or $next.Volume -cne $prior.Volume) { $next.Dispose(); throw 'protected-vm-asset-handoff-refused' }
        $owned[$role] = $next; $prior.Dispose()
    }
    $owned.checkpoint = 7
    if ($owned.disk.Volume -cne $volume -or $owned.disk.FileId -cne $fileId -or $owned.image.Volume -cne $imageVolume -or $owned.image.FileId -cne $imageId -or $owned.image.HashImage($Request.bytes) -cne $Request.sha256) { throw 'protected-vm-asset-handoff-refused' }
    $owned.binding = Read-ProtectedInstallVmBinding $owned.vmId $Context.inputs['aegis-session.exe']
    $owned.checkpoint = 8
    $owned.rows = Read-ProtectedVmTree $owned $true
    $owned.checkpoint = 9
    Write-ProtectedVmJournal $owned 'ready.json' @{ schemaVersion = 1; installId = $owned.installId; binding = $owned.binding; imageBytes = $Request.bytes; imageSha256 = $Request.sha256; resources = $owned.rows; guestStartAuthorized = $false }
    $owned.rows = Read-ProtectedVmTree $owned
    $owned.unknown = $false; $Context.vmBinding = $owned.binding
    $owned.checkpoint = 10
}
function Assert-ProtectedInstallVm($Context) {
    if (!$Context.ContainsKey('vmProvision') -or $null -eq $Context.vmProvision) { return }
    Assert-ProtectedInstallAdministrator
    $owned = $Context.vmProvision
    if ($owned.unknown) { throw 'protected-vm-settlement-unknown' }
    $owned.root.Recheck(); $owned.images.Recheck(); $owned.disks.Recheck(); $owned.image.Recheck(); $owned.disk.Recheck()
    Assert-ProtectedVmTree $owned
    $observed = Invoke-ProtectedVmProvider $owned 'observe'
    if ($observed.vmId -cne $owned.vmId -or !$observed.off -or $observed.name -cne $owned.name) { throw 'protected-vm-state-refused' }
    $binding = Read-ProtectedInstallVmBinding $owned.vmId $owned.verifier
    foreach ($key in @('vmId', 'identitySha256', 'storageSha256', 'storageProtection')) { if ($binding[$key] -cne $owned.binding[$key]) { throw 'protected-vm-binding-changed' } }
}
function Remove-ProtectedInstallVm($Context) {
    if (!$Context.ContainsKey('vmProvision') -or $null -eq $Context.vmProvision) { return }
    Assert-ProtectedInstallVm $Context
    $owned = $Context.vmProvision
    Invoke-ProtectedVmEffect $owned 'remove'
    # Removal adds two owned journal leaves. No arbitrary remaining tree is adopted.
    foreach ($name in @('pending-remove.json', 'settled-remove.json')) {
        $held = [ProtectedInstallFile]::new((Join-Path $owned.root.PathName $name), $false, $false)
        try { $owned.rows += @{ path = $held.PathName; volume = $held.Volume; fileId = $held.FileId; sddl = $held.Sddl; directory = $false } } finally { $held.Dispose() }
    }
    $remaining = Read-ProtectedVmTree $owned
    # VMMS may remove its VM ACEs while deleting the registered VM. Only after
    # exact absence is confirmed may that private ACL change be accepted. Every
    # remaining item must still have its original captured identity and a high,
    # host/this-VM-only descriptor (enforced by Read-ProtectedVmTree).
    foreach ($row in $remaining) {
        $prior = @($owned.rows | Where-Object { $_.path -ceq $row.path })
        if ($prior.Count -ne 1) { throw 'protected-vm-unowned-child' }
        foreach ($key in @('volume', 'fileId', 'directory')) { if ($prior[0][$key] -cne $row[$key]) { throw 'protected-vm-tree-changed' } }
    }
    $owned.image.Dispose(); $owned.disk.Dispose(); $owned.images.Dispose(); $owned.disks.Dispose()
    $pins = [Collections.Generic.List[object]]::new()
    try {
        foreach ($row in @($remaining | Sort-Object { $_.path.Length } -Descending)) {
            $prior = @($owned.rows | Where-Object { $_.path -ceq $row.path })
            if ($prior.Count -ne 1) { throw 'protected-vm-unowned-child' }
            $held = [ProtectedInstallFile]::new($row.path, $row.directory, $true); $pins.Add($held)
            if ($held.Volume -cne $prior[0].volume -or $held.FileId -cne $prior[0].fileId -or $held.Sddl -cne $row.sddl -or $held.Directory -cne $prior[0].directory) { throw 'protected-vm-delete-identity-refused' }
            $held.RequireHighIntegrity()
        }
        # Validate the complete finite set against creation-time identities before
        # deleting its first leaf. A later unexpected child can only block removal.
        foreach ($held in $pins) { $held.Delete() }
    } finally { foreach ($held in $pins) { $held.Dispose() } }
    if (@(Get-ChildItem -LiteralPath $owned.root.PathName -Force).Count -ne 0) { throw 'protected-vm-delete-unknown-child' }
    $owned.root.DeleteAfterProvider(); [Array]::Clear($owned.verifier, 0, $owned.verifier.Length); $Context.vmProvision = $null
}
