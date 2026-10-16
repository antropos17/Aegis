Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'protected-journal.ps1')
$script:ProtectedInstallParent = 'C:\ProgramData\AEGIS'
$script:ProtectedInstallRoot = 'C:\ProgramData\AEGIS\ProtectedSession'
$script:ProtectedInstallLeaves = @('aegis-owner.exe', 'aegis-session.exe', 'aegis-main.exe', 'owner-policy.json', 'enrollment.json', 'operator.credential', 'main-registration.json', 'inventory.json', 'registered-vm.json', 'registered-operation.json', 'fixed-fixture.json', 'registered-journal.json')

function Initialize-ProtectedInstallNative {
    if ($null -eq ('ProtectedInstallFile' -as [type])) {
        Add-Type -Path @((Join-Path $PSScriptRoot 'ProtectedInstallFiles.cs'), (Join-Path $PSScriptRoot 'ProtectedInstallService.cs'), (Join-Path $PSScriptRoot 'ProtectedInstallDisk.cs'))
    }
}
function New-ProtectedInstallAcl([bool]$Directory, [string]$OperatorSid, [bool]$Private = $false) {
    $acl = if ($Directory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
    $inherit = if ($Directory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
    foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), [Security.AccessControl.FileSystemRights]::FullControl, $inherit, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
    }
    if (!$Private) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($OperatorSid), [Security.AccessControl.FileSystemRights]::ReadAndExecute, $inherit, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
    }
    return $acl
}
function New-ProtectedInstallDirectory([string]$Path, [string]$OperatorSid, [bool]$Private = $false, [bool]$HighIntegrity = $false) {
    if (Test-Path -LiteralPath $Path) { throw 'protected-new-directory-required' }
    $acl = New-ProtectedInstallAcl $true $OperatorSid $Private
    $descriptor = $acl.GetSecurityDescriptorBinaryForm()
    if ($HighIntegrity) {
        $raw = [Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]'Owner,Access') + 'S:(ML;OICI;NW;;;HI)')
        $descriptor = New-Object byte[] $raw.BinaryLength; $raw.GetBinaryForm($descriptor, 0)
    }
    $held = [ProtectedInstallFile]::CreateDirectory($Path, $descriptor)
    if (!$held.Protected($false)) { $held.Dispose(); throw 'protected-new-directory-acl-refused' }
    return $held
}
function Write-ProtectedInstallFile([string]$Path, [byte[]]$Bytes, [string]$OperatorSid, [bool]$Private = $false) {
    if ($Bytes.Length -lt 1 -or $Bytes.Length -gt 4MB) { throw 'protected-file-budget-refused' }
    $file = [IO.FileStream]::new($Path, [IO.FileMode]::CreateNew, [Security.AccessControl.FileSystemRights]::Write, [IO.FileShare]::None, 65536, [IO.FileOptions]::WriteThrough, (New-ProtectedInstallAcl $false $OperatorSid $Private))
    try { $file.Write($Bytes, 0, $Bytes.Length); $file.Flush($true) } finally { $file.Dispose() }
}
function Read-ProtectedInstallSnapshot([string]$Path, [bool]$Directory = $false, [bool]$RequireProtection = $true) {
    $held = [ProtectedInstallFile]::new($Path, $Directory, $false)
    try {
        if ($RequireProtection -and !$held.Protected($false)) { throw 'protected-observation-refused' }
        return @{ path = $held.PathName; volume = $held.Volume; fileId = $held.FileId; sddl = $held.Sddl; directory = $Directory; requireProtection = $RequireProtection;
            sha256 = if ($Directory) { $null } else { $held.Hash(4MB) }; bytes = if ($Directory) { 0 } else { $held.Read(4MB).Length } }
    } finally { $held.Dispose() }
}
function Assert-ProtectedInstallSnapshot($Expected) {
    $observed = Read-ProtectedInstallSnapshot $Expected.path $Expected.directory $Expected.requireProtection
    foreach ($key in @('path', 'volume', 'fileId', 'sddl', 'directory', 'requireProtection', 'sha256', 'bytes')) {
        if ($observed[$key] -cne $Expected[$key]) { throw 'protected-owned-file-association-refused' }
    }
}
function Read-ProtectedInstallInputs([string]$SourceRoot, $Manifest) {
    if ($Manifest.schemaVersion -ne 1 -or @($Manifest.files).Count -ne 3) { throw 'protected-input-manifest-refused' }
    $names = @('aegis-owner.exe', 'aegis-session.exe', 'aegis-main.exe'); $inputs = @{}
    foreach ($name in $names) {
        $rows = @($Manifest.files | Where-Object { $_.name -ceq $name })
        if ($rows.Count -ne 1 -or $rows[0].sha256 -cnotmatch '\A[a-f0-9]{64}\z' -or $rows[0].bytes -lt 1 -or $rows[0].bytes -gt 4MB) { throw 'protected-input-manifest-refused' }
        $held = [ProtectedInstallFile]::new((Join-Path $SourceRoot $name), $false, $false)
        try {
            $bytes = $held.Read(4MB)
            if ($bytes.Length -ne $rows[0].bytes -or $held.Hash(4MB) -cne $rows[0].sha256) { throw 'protected-input-digest-refused' }
            $inputs[$name] = $bytes
        } finally { $held.Dispose() }
    }
    return $inputs
}
function Read-ProtectedInstallVmBinding([string]$VmId, [byte[]]$VerifiedImage, $ExpectedBinding = $null) {
    if ($VmId -ceq '') { return $null }
    if ($VmId -cnotmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' -or $VmId -ceq [guid]::Empty.ToString('D')) { throw 'protected-vm-binding-refused' }
    try {
        $legacy = $false
        if ($null -ne $ExpectedBinding) {
            if ($ExpectedBinding -isnot [hashtable]) { throw 'protected-vm-binding-refused' }
            $legacy = !$ExpectedBinding.ContainsKey('configurationProfile') -and !$ExpectedBinding.ContainsKey('configurationSha256')
            if ($legacy -and ($ExpectedBinding.Count -ne 4 -or
                @($ExpectedBinding.Keys | Where-Object { $_ -cnotin @('vmId', 'identitySha256', 'storageSha256', 'storageProtection') }).Count -ne 0 -or
                $ExpectedBinding.vmId -cne $VmId -or $ExpectedBinding.storageProtection -cne 'private-vm' -or
                $ExpectedBinding.identitySha256 -isnot [string] -or $ExpectedBinding.identitySha256 -cnotmatch '\A[a-f0-9]{64}\z' -or
                $ExpectedBinding.storageSha256 -isnot [string] -or $ExpectedBinding.storageSha256 -cnotmatch '\A[a-f0-9]{64}\z')) { throw 'protected-vm-binding-refused' }
        }
        $assembly = [Reflection.Assembly]::Load($VerifiedImage)
        $type = $assembly.GetType('Aegis.ProtectedSession.InstalledVmRegistration', $true)
        $observer = if ($legacy) { 'ObserveProtectedStorageForInstaller' } else { 'ObserveProtectedConfigurationForInstaller' }
        $method = $type.GetMethod($observer, [Reflection.BindingFlags]'Public,Static')
        $arguments = [object[]]::new(1); $arguments[0] = [guid]::ParseExact($VmId, 'D')
        $hash = $method.Invoke($null, $arguments)
        $format = if ($legacy) { '\A[a-f0-9]{64}\n[a-f0-9]{64}\z' } else { '\A[a-f0-9]{64}\n[a-f0-9]{64}\naegis-offline-fixed-v1\n[a-f0-9]{64}\z' }
        if ($hash -isnot [string] -or $hash -cnotmatch $format) { throw 'protected-vm-binding-refused' }
        $parts = $hash.Split([char]10)
        $binding = @{ vmId = $VmId; identitySha256 = $parts[0]; storageSha256 = $parts[1]; storageProtection = 'private-vm' }
        if (!$legacy) { $binding.configurationProfile = $parts[2]; $binding.configurationSha256 = $parts[3] }
        return $binding
    } catch {
        $failure = [InvalidOperationException]::new('protected-vm-binding-refused')
        $cause = $_.Exception
        for ($depth = 0; $null -ne $cause -and $depth -lt 8; $depth++) {
            if ($cause.Data.Contains('protectedStorageCheckpoint') -and $cause.Data['protectedStorageCheckpoint'] -is [int] -and
                $cause.Data['protectedStorageCheckpoint'] -ge 0 -and $cause.Data['protectedStorageCheckpoint'] -le 24) {
                $failure.Data['protectedStorageCheckpoint'] = $cause.Data['protectedStorageCheckpoint']
            }
            $cause = $cause.InnerException
        }
        throw $failure
    }
}
function New-ProtectedInstallVmRecord($Policy, [byte[]]$PolicyBytes, $Binding) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $digest = [BitConverter]::ToString($hash.ComputeHash($PolicyBytes)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
    $record = [ordered]@{ schemaVersion = 1; installId = $Policy.installId; revision = $Policy.revision; epoch = $Policy.epoch; policySha256 = $digest; selectionId = $Policy.selectionId; selectionEpoch = $Policy.selectionEpoch }
    if ($null -eq $Binding) { $record.status = 'unconfigured' }
    else {
        $record.vmId = $Binding.vmId; $record.identitySha256 = $Binding.identitySha256
        if ($Binding.ContainsKey('storageSha256')) { $record.schemaVersion = 2; $record.storageSha256 = $Binding.storageSha256 }
        if ($Binding.ContainsKey('storageProtection')) {
            if ($Binding.storageProtection -cne 'private-vm' -or !$Binding.ContainsKey('storageSha256')) { throw 'protected-vm-binding-refused' }
            $record.schemaVersion = 3; $record.storageProtection = 'private-vm'
        }
        if ($Binding.ContainsKey('configurationProfile') -or $Binding.ContainsKey('configurationSha256')) {
            if (!$Binding.ContainsKey('configurationProfile') -or !$Binding.ContainsKey('configurationSha256') -or
                $Binding.configurationProfile -cne 'aegis-offline-fixed-v1' -or $Binding.configurationSha256 -isnot [string] -or
                $Binding.configurationSha256 -cnotmatch '\A[a-f0-9]{64}\z' -or $record.schemaVersion -ne 3) { throw 'protected-vm-binding-refused' }
            $record.schemaVersion = 4; $record.configurationProfile = $Binding.configurationProfile; $record.configurationSha256 = $Binding.configurationSha256
        }
        $record.status = 'active'
    }
    return ,([Text.UTF8Encoding]::new($false)).GetBytes(($record | ConvertTo-Json -Compress))
}
function New-ProtectedInstallStage($Context, [uint32]$Revision, [string]$Epoch) {
    $path = Join-Path $script:ProtectedInstallParent ('Staging-' + [guid]::NewGuid().ToString('N'))
    $root = New-ProtectedInstallDirectory $path $Context.operatorSid
    $stage = @{ root = $root; parent = $Context.parent; path = $path; rows = @(); revision = $Revision; epoch = $Epoch; published = $false; journal = $null; context = $Context }
    try {
        $journal = New-ProtectedInstallJournal $Context $stage
        foreach ($name in @('aegis-owner.exe', 'aegis-session.exe', 'aegis-main.exe')) { Write-ProtectedInstallFile (Join-Path $path $name) $Context.inputs[$name] $Context.operatorSid }
        $map = @{}; foreach ($row in $Context.manifest.files) { $map[$row.name] = $row }
        $policy = [ordered]@{ schemaVersion = 1; installId = $Context.installId; revision = $Revision; epoch = $Epoch; rootVolumeSerial = $root.Volume; rootFileId = $root.FileId;
            ownerImageSize = $map['aegis-owner.exe'].bytes; ownerImageSha256 = $map['aegis-owner.exe'].sha256; supervisorImageSize = $map['aegis-session.exe'].bytes; supervisorImageSha256 = $map['aegis-session.exe'].sha256;
            mainImageSize = $map['aegis-main.exe'].bytes; mainImageSha256 = $map['aegis-main.exe'].sha256; operatorSid = $Context.operatorSid; operatorAccount = $Context.operatorAccount;
            selectionId = $Context.selectionId; selectionEpoch = $Context.selectionEpoch; status = 'active' }
        $enrollment = [ordered]@{ schemaVersion = 1; installId = $Context.installId; revision = $Revision; epoch = $Epoch; rootVolumeSerial = $root.Volume; rootFileId = $root.FileId; supervisorSha256 = $map['aegis-session.exe'].sha256; status = 'active' }
        $inventory = [ordered]@{ schemaVersion = 1; installId = $Context.installId; revision = $Revision; epoch = $Epoch; selections = @([ordered]@{ id = $Context.selectionId; epoch = $Context.selectionEpoch; operation = 'inspect-owned' }) }
        $utf8 = [Text.UTF8Encoding]::new($false)
        $policyBytes = $utf8.GetBytes(($policy | ConvertTo-Json -Compress))
        # Serialize inventory once: these exact bytes are staged and pinned by the
        # fixed built-in inspection manifest. The binary input manifest is unchanged.
        $inventoryBytes = $utf8.GetBytes(($inventory | ConvertTo-Json -Compress -Depth 5))
        $hash = [Security.Cryptography.SHA256]::Create()
        try {
            $inventoryHash = [BitConverter]::ToString($hash.ComputeHash($inventoryBytes)).Replace('-', '').ToLowerInvariant()
            $policyHash = [BitConverter]::ToString($hash.ComputeHash($policyBytes)).Replace('-', '').ToLowerInvariant()
            $fixture = [ordered]@{ schemaVersion = 1; fixtureId = 'installed-inventory-inspection-v1'; scope = 'retained-inventory-inspection';
                selectionId = $Context.selectionId; selectionEpoch = $Context.selectionEpoch; inventoryBytes = $inventoryBytes.Length; inventorySha256 = $inventoryHash;
                mainImageBytes = $map['aegis-main.exe'].bytes; mainImageSha256 = $map['aegis-main.exe'].sha256;
                supervisorImageBytes = $map['aegis-session.exe'].bytes; supervisorImageSha256 = $map['aegis-session.exe'].sha256 }
            $fixtureBytes = $utf8.GetBytes(($fixture | ConvertTo-Json -Compress))
            $fixtureHash = [BitConverter]::ToString($hash.ComputeHash($fixtureBytes)).Replace('-', '').ToLowerInvariant()
            $operation = [ordered]@{ schemaVersion = 1; installId = $Context.installId; revision = $Revision; epoch = $Epoch; policySha256 = $policyHash;
                operatorSid = $Context.operatorSid; selectionId = $Context.selectionId; selectionEpoch = $Context.selectionEpoch; fixtureId = 'installed-inventory-inspection-v1';
                fixtureManifestBytes = $fixtureBytes.Length; fixtureManifestSha256 = $fixtureHash; operations = @('inspect-owned'); status = 'active' }
            $operationBytes = $utf8.GetBytes(($operation | ConvertTo-Json -Compress -Depth 5))
        } finally { $hash.Dispose() }
        foreach ($bytes in @($inventoryBytes, $fixtureBytes, $operationBytes)) {
            if ($bytes.Length -lt 1 -or $bytes.Length -gt 4096) { throw 'protected-operation-record-budget-refused' }
        }
        Write-ProtectedInstallFile (Join-Path $path 'owner-policy.json') $policyBytes $Context.operatorSid
        $binding = if ($Context.ContainsKey('vmBinding')) { $Context.vmBinding } else { $null }
        Write-ProtectedInstallFile (Join-Path $path 'registered-vm.json') (New-ProtectedInstallVmRecord $policy $policyBytes $binding) $Context.operatorSid
        Write-ProtectedInstallFile (Join-Path $path 'enrollment.json') $utf8.GetBytes(($enrollment | ConvertTo-Json -Compress)) $Context.operatorSid
        Write-ProtectedInstallFile (Join-Path $path 'inventory.json') $inventoryBytes $Context.operatorSid
        Write-ProtectedInstallFile (Join-Path $path 'fixed-fixture.json') $fixtureBytes $Context.operatorSid
        Write-ProtectedInstallFile (Join-Path $path 'registered-operation.json') $operationBytes $Context.operatorSid
        Write-ProtectedInstallFile (Join-Path $path 'registered-journal.json') (New-ProtectedInstallJournalRecord $policy $policyHash $journal) $Context.operatorSid
        Write-ProtectedInstallFile (Join-Path $path 'operator.credential') $Context.credential $Context.operatorSid $true
        $stage.rows = @(Get-ChildItem -LiteralPath $path -Force | ForEach-Object { Read-ProtectedInstallSnapshot $_.FullName })
        Release-ProtectedInstallJournal $journal
        return $stage
    } catch {
        # The root was created by this call and remains held; no pathname adoption.
        $stage.rows = @(Get-ChildItem -LiteralPath $path -Force | ForEach-Object { Read-ProtectedInstallSnapshot $_.FullName })
        Remove-ProtectedInstallStage $stage $false
        throw
    }
}
function Assert-ProtectedInstallStage($Stage) {
    $Stage.root.Recheck()
    if (!$Stage.root.Protected($false)) { throw 'protected-stage-acl-refused' }
    $files = @(Get-ChildItem -LiteralPath $Stage.root.PathName -Force)
    if ($files.Count -ne $Stage.rows.Count -or $files.Count -gt $script:ProtectedInstallLeaves.Count) { throw 'protected-stage-unknown-child' }
    foreach ($row in $Stage.rows) { Assert-ProtectedInstallSnapshot $row }
}
function Move-ProtectedInstallStage($Stage, [string]$Destination) {
    Assert-ProtectedInstallStage $Stage
    if (Test-Path -LiteralPath $Destination) { throw 'protected-publish-destination-exists' }
    $Stage.root.Rename($Destination, $Stage.parent); $Stage.path = $Destination
    try {
        foreach ($row in $Stage.rows) { $row.path = Join-Path $Destination ([IO.Path]::GetFileName($row.path)) }
        Assert-ProtectedInstallStage $Stage
    } catch {
        $failure = [IO.InvalidDataException]::new('protected-file-handoff-cleanup-unknown', $_.Exception)
        $failure.Data['protectedCleanupUnknown'] = $true
        throw $failure
    }
}
function Update-ProtectedInstallRuntimeRows($Stage) {
    $rows = @($Stage.rows); $files = @(Get-ChildItem -LiteralPath $Stage.root.PathName -Force)
    foreach ($file in $files) {
        if ($file.Name -cnotin $script:ProtectedInstallLeaves -or $file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'protected-runtime-unknown-child' }
        if (@($rows | Where-Object { $_.path -ceq $file.FullName }).Count -eq 0) {
            if ($file.Name -cne 'main-registration.json') { throw 'protected-runtime-unassociated-leaf' }
            $rows += Read-ProtectedInstallSnapshot $file.FullName
        }
    }
    $Stage.rows = $rows; Assert-ProtectedInstallStage $Stage
}
function Remove-ProtectedInstallStage($Stage, [bool]$Published) {
    Assert-ProtectedInstallStage $Stage
    if ($Stage.ContainsKey('journal') -and $null -ne $Stage.journal) { Remove-ProtectedInstallJournal $Stage.context $Stage.journal; $Stage.journal = $null }
    $held = [Collections.Generic.List[object]]::new()
    try {
        foreach ($row in $Stage.rows) {
            $file = [ProtectedInstallFile]::new($row.path, $false, $true); $held.Add($file)
            if ($file.FileId -cne $row.fileId -or $file.Volume -cne $row.volume -or $file.Sddl -cne $row.sddl -or $file.Hash(4MB) -cne $row.sha256) { throw 'protected-delete-association-refused' }
        }
        foreach ($file in $held) { $file.Delete() }
        if (@(Get-ChildItem -LiteralPath $Stage.root.PathName -Force).Count -ne 0) { throw 'protected-delete-unknown-child' }
        $Stage.root.Delete()
    } finally { foreach ($file in $held) { $file.Dispose() } }
}
