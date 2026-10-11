param([Parameter(Mandatory)][string]$Scratch)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$scratchPath = [IO.Path]::GetFullPath($Scratch)
if ($scratchPath -cne $Scratch -or $scratchPath -notmatch '^[A-Za-z]:\\' -or !(Test-Path -LiteralPath $scratchPath -PathType Container)) { throw 'pinning-scratch-refused' }
if (@(Get-ChildItem -LiteralPath $scratchPath -Force).Count -ne 0) { throw 'pinning-empty-scratch-required' }
Add-Type -Path @((Join-Path $project 'scripts/installation/ProtectedInstallFiles.cs'), (Join-Path $project 'sidecar/session/EnrollmentNative.cs'), (Join-Path $PSScriptRoot 'ProtectedInstallPinningProbe.cs'))
. (Join-Path $project 'scripts/installation/protected-install-files.ps1')

function Read-NativeFailure($Failure) {
    $exception = $Failure.Exception
    for ($depth = 0; $depth -lt 8 -and $null -ne $exception; $depth++) {
        if ($exception.Message -ceq 'protected-file-native-refused' -and $exception.Data['protectedOperation'] -cin @('protected-file-open-leaf', 'protected-file-create-directory', 'protected-file-rename-directory')) {
            $safe = @{ operation = $exception.Data['protectedOperation']; nativeWin32 = $exception.Data['protectedNativeWin32']; code = 'protected-file-native-refused' }
            if ($exception.Data.Contains('protectedNativeNtStatus') -and $exception.Data['protectedNativeNtStatus'] -is [int]) { $safe.nativeNtStatus = $exception.Data['protectedNativeNtStatus'] }
            return $safe
        }
        $exception = $exception.InnerException
    }
    return @{ operation = $null; nativeWin32 = $null; code = 'unclassified' }
}

# This disposable native I/O fixture uses its process SID ACL. Production's
# SYSTEM/Administrators protection policy stays unchanged; only that policy
# predicate is omitted here, while all held identities/security/content remain checked.
function Assert-ProtectedInstallStage($Stage) {
    $Stage.root.Recheck(); $Stage.parent.Recheck()
    $files = @(Get-ChildItem -LiteralPath $Stage.root.PathName -Force)
    if ($files.Count -ne $Stage.rows.Count) { throw 'pinning-stage-children-refused' }
    foreach ($row in $Stage.rows) { Assert-ProtectedInstallSnapshot $row }
}
function New-FixtureStage($Parent, [string]$Name, $Acl) {
    $path = Join-Path $Parent.PathName $Name
    $root = [ProtectedInstallFile]::CreateDirectory($path, $Acl.GetSecurityDescriptorBinaryForm())
    $stage = @{ root = $root; parent = $Parent; path = $path; rows = @() }
    $leafPath = Join-Path $path 'owned.bin'
    [IO.File]::WriteAllBytes($leafPath, [byte[]]@(1, 2, 3))
    $stage.rows = @(Read-ProtectedInstallSnapshot $leafPath $false $false)
    return $stage
}
function Move-FixtureStage($Stage, [string]$Destination) {
    $root = $Stage.root; $parent = $Stage.parent
    $before = Read-ProtectedInstallSnapshot $root.PathName $true $false
    $leafBefore = $Stage.rows[0].Clone()
    Move-ProtectedInstallStage $Stage $Destination
    $after = Read-ProtectedInstallSnapshot $root.PathName $true $false
    foreach ($key in @('volume', 'fileId', 'sddl')) { if ($before[$key] -cne $after[$key]) { throw 'pinning-moved-root-tuple-refused' } }
    foreach ($key in @('volume', 'fileId', 'sddl', 'sha256', 'bytes')) { if ($leafBefore[$key] -cne $Stage.rows[0][$key]) { throw 'pinning-moved-leaf-tuple-refused' } }
    if (![object]::ReferenceEquals($Stage.root, $root) -or ![object]::ReferenceEquals($Stage.parent, $parent)) { throw 'pinning-moved-reference-refused' }
}

$owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = [Security.AccessControl.DirectorySecurity]::new()
$acl.SetAccessRuleProtection($true, $false)
$acl.SetOwner($owner)
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($owner, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit', [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
$createdPath = Join-Path $scratchPath 'owned'
$held = $null; $leaf = $null; $receipts = $null; $stages = [Collections.Generic.List[object]]::new()
$report = [ordered]@{ schemaVersion = 3; snapshotSucceeded = $false; sameIdentity = $false; readPinError = -1; maintainedEnrollmentMatches = $false; foreignDeleteError = -1; foreignWriteError = -1; leafOpenFailure = $null; existingDirectoryFailure = $null; directoryCleanup = $false;
    renameFlow = @{ succeeded = $false; failure = $null; existingDestinationFailure = $null; parentDeleteError = -1; stageDeleteError = -1; siblingSameIdentity = $false; moves = 0 } }
try {
    $held = [ProtectedInstallFile]::CreateDirectory($createdPath, $acl.GetSecurityDescriptorBinaryForm())
    $report.readPinError = [ProtectedInstallPinningProbe]::ReadPinError($createdPath)
    $report.maintainedEnrollmentMatches = [ProtectedInstallPinningProbe]::MaintainedEnrollmentMatches($createdPath, $held.Volume, $held.FileId)
    $report.foreignDeleteError = [ProtectedInstallPinningProbe]::DeletePinError($createdPath)
    $report.foreignWriteError = [ProtectedInstallPinningProbe]::WritePinError($createdPath)
    $row = Read-ProtectedInstallSnapshot $createdPath $true $false
    Assert-ProtectedInstallSnapshot $row
    $held.Recheck()
    $report.snapshotSucceeded = $row.directory -and $row.bytes -eq 0 -and $null -eq $row.sha256
    $report.sameIdentity = $row.fileId -ceq $held.FileId -and $row.volume -ceq $held.Volume -and $row.sddl -ceq $held.Sddl -and $row.path -ceq $held.PathName
    try { $null = [ProtectedInstallFile]::CreateDirectory($createdPath, $acl.GetSecurityDescriptorBinaryForm()) } catch { $report.existingDirectoryFailure = Read-NativeFailure $_ }
    $leafPath = Join-Path $createdPath 'owned.txt'
    [IO.File]::WriteAllBytes($leafPath, [byte[]]@(1, 2, 3))
    $leaf = [ProtectedInstallFile]::new($leafPath, $false, $true)
    try { $null = [ProtectedInstallFile]::new($leafPath, $false, $false) } catch { $report.leafOpenFailure = Read-NativeFailure $_ }
    $leaf.Recheck(); $leaf.Delete(); $leaf = $null
    $receipts = [ProtectedInstallFile]::CreateDirectory((Join-Path $createdPath 'Receipts'), $acl.GetSecurityDescriptorBinaryForm())
    $receiptsBefore = Read-ProtectedInstallSnapshot $receipts.PathName $true $false
    try {
        $original = New-FixtureStage $held 'Staging-original' $acl; $stages.Add($original)
        $destination = Join-Path $createdPath 'ProtectedSession'; $rollback = Join-Path $createdPath 'Rollback'
        Move-FixtureStage $original $destination; $report.renameFlow.moves++
        # Call the actual native boundary past the pathname precheck to model
        # an already-existing sibling; neither held source nor destination moves.
        try { $original.root.Rename($receipts.PathName, $held) } catch { $report.renameFlow.existingDestinationFailure = Read-NativeFailure $_ }
        Assert-ProtectedInstallStage $original; Assert-ProtectedInstallSnapshot $receiptsBefore
        $report.renameFlow.parentDeleteError = [ProtectedInstallPinningProbe]::DeletePinError($held.PathName)
        $report.renameFlow.stageDeleteError = [ProtectedInstallPinningProbe]::DeletePinError($original.root.PathName)
        $next = New-FixtureStage $held 'Staging-next' $acl; $stages.Add($next)
        Move-FixtureStage $original $rollback; $report.renameFlow.moves++
        Move-FixtureStage $next $destination; $report.renameFlow.moves++
        Move-FixtureStage $next (Join-Path $createdPath 'Staging-next'); $report.renameFlow.moves++
        Move-FixtureStage $original $destination; $report.renameFlow.moves++
        Remove-ProtectedInstallStage $next $false
        $upgrade = New-FixtureStage $held 'Staging-upgrade' $acl; $stages.Add($upgrade)
        Move-FixtureStage $original $rollback; $report.renameFlow.moves++
        Move-FixtureStage $upgrade $destination; $report.renameFlow.moves++
        Remove-ProtectedInstallStage $original $true; Remove-ProtectedInstallStage $upgrade $true
        Assert-ProtectedInstallSnapshot $receiptsBefore; $receipts.Recheck(); $held.Recheck()
        $report.renameFlow.siblingSameIdentity = $true; $report.renameFlow.succeeded = $true
    } catch { $report.renameFlow.failure = Read-NativeFailure $_ }
    foreach ($stage in $stages) { if (Test-Path -LiteralPath $stage.root.PathName) { Remove-ProtectedInstallStage $stage $false } }
    $receipts.Delete(); $receipts = $null
    $held.Delete()
    $held = $null
    $report.directoryCleanup = !(Test-Path -LiteralPath $createdPath)
} finally {
    if ($null -ne $leaf) { $leaf.Dispose() }
    foreach ($stage in $stages) { $stage.root.Dispose() }
    if ($null -ne $receipts) { $receipts.Dispose() }
    if ($null -ne $held) { $held.Dispose() }
}
$report | ConvertTo-Json -Compress
