Set-StrictMode -Version Latest
$script:ProtectedInstallParent = 'C:\ProgramData\AEGIS'
$script:ProtectedInstallRoot = 'C:\ProgramData\AEGIS\ProtectedSession'
$script:ProtectedInstallLeaves = @('aegis-owner.exe', 'aegis-session.exe', 'aegis-main.exe', 'owner-policy.json', 'enrollment.json', 'operator.credential', 'main-registration.json', 'inventory.json')

function Initialize-ProtectedInstallNative {
    if ($null -eq ('ProtectedInstallFile' -as [type])) {
        Add-Type -Path @((Join-Path $PSScriptRoot 'ProtectedInstallFiles.cs'), (Join-Path $PSScriptRoot 'ProtectedInstallService.cs'))
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
function New-ProtectedInstallDirectory([string]$Path, [string]$OperatorSid, [bool]$Private = $false) {
    if (Test-Path -LiteralPath $Path) { throw 'protected-new-directory-required' }
    $held = [ProtectedInstallFile]::CreateDirectory($Path, (New-ProtectedInstallAcl $true $OperatorSid $Private).GetSecurityDescriptorBinaryForm())
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
        if ($rows.Count -ne 1 -or $rows[0].sha256 -cnotmatch '^[a-f0-9]{64}$' -or $rows[0].bytes -lt 1 -or $rows[0].bytes -gt 4MB) { throw 'protected-input-manifest-refused' }
        $held = [ProtectedInstallFile]::new((Join-Path $SourceRoot $name), $false, $false)
        try {
            $bytes = $held.Read(4MB)
            if ($bytes.Length -ne $rows[0].bytes -or $held.Hash(4MB) -cne $rows[0].sha256) { throw 'protected-input-digest-refused' }
            $inputs[$name] = $bytes
        } finally { $held.Dispose() }
    }
    return $inputs
}
function New-ProtectedInstallStage($Context, [uint32]$Revision, [string]$Epoch) {
    $path = Join-Path $script:ProtectedInstallParent ('Staging-' + [guid]::NewGuid().ToString('N'))
    $root = New-ProtectedInstallDirectory $path $Context.operatorSid
    $stage = @{ root = $root; path = $path; rows = @(); revision = $Revision; epoch = $Epoch; published = $false }
    try {
        foreach ($name in @('aegis-owner.exe', 'aegis-session.exe', 'aegis-main.exe')) { Write-ProtectedInstallFile (Join-Path $path $name) $Context.inputs[$name] $Context.operatorSid }
        $map = @{}; foreach ($row in $Context.manifest.files) { $map[$row.name] = $row }
        $policy = [ordered]@{ schemaVersion = 1; installId = $Context.installId; revision = $Revision; epoch = $Epoch; rootVolumeSerial = $root.Volume; rootFileId = $root.FileId;
            ownerImageSize = $map['aegis-owner.exe'].bytes; ownerImageSha256 = $map['aegis-owner.exe'].sha256; supervisorImageSize = $map['aegis-session.exe'].bytes; supervisorImageSha256 = $map['aegis-session.exe'].sha256;
            mainImageSize = $map['aegis-main.exe'].bytes; mainImageSha256 = $map['aegis-main.exe'].sha256; operatorSid = $Context.operatorSid; operatorAccount = $Context.operatorAccount;
            selectionId = $Context.selectionId; selectionEpoch = $Context.selectionEpoch; status = 'active' }
        $enrollment = [ordered]@{ schemaVersion = 1; installId = $Context.installId; revision = $Revision; epoch = $Epoch; rootVolumeSerial = $root.Volume; rootFileId = $root.FileId; supervisorSha256 = $map['aegis-session.exe'].sha256; status = 'active' }
        $inventory = [ordered]@{ schemaVersion = 1; installId = $Context.installId; revision = $Revision; epoch = $Epoch; selections = @([ordered]@{ id = $Context.selectionId; epoch = $Context.selectionEpoch; operation = 'inspect-owned' }) }
        $utf8 = [Text.UTF8Encoding]::new($false)
        Write-ProtectedInstallFile (Join-Path $path 'owner-policy.json') $utf8.GetBytes(($policy | ConvertTo-Json -Compress)) $Context.operatorSid
        Write-ProtectedInstallFile (Join-Path $path 'enrollment.json') $utf8.GetBytes(($enrollment | ConvertTo-Json -Compress)) $Context.operatorSid
        Write-ProtectedInstallFile (Join-Path $path 'inventory.json') $utf8.GetBytes(($inventory | ConvertTo-Json -Compress -Depth 5)) $Context.operatorSid
        Write-ProtectedInstallFile (Join-Path $path 'operator.credential') $Context.credential $Context.operatorSid $true
        $stage.rows = @(Get-ChildItem -LiteralPath $path -Force | ForEach-Object { Read-ProtectedInstallSnapshot $_.FullName })
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
    if ($files.Count -ne $Stage.rows.Count -or $files.Count -gt 8) { throw 'protected-stage-unknown-child' }
    foreach ($row in $Stage.rows) { Assert-ProtectedInstallSnapshot $row }
}
function Move-ProtectedInstallStage($Stage, [string]$Destination) {
    Assert-ProtectedInstallStage $Stage
    if (Test-Path -LiteralPath $Destination) { throw 'protected-publish-destination-exists' }
    $Stage.root.Rename($Destination); $Stage.path = $Destination
    foreach ($row in $Stage.rows) { $row.path = Join-Path $Destination ([IO.Path]::GetFileName($row.path)) }
    Assert-ProtectedInstallStage $Stage
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
