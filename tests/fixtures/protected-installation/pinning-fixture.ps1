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
        if ($exception.Message -ceq 'protected-file-native-refused' -and $exception.Data['protectedOperation'] -cin @('protected-file-open-leaf', 'protected-file-create-directory')) {
            return @{ operation = $exception.Data['protectedOperation']; nativeWin32 = $exception.Data['protectedNativeWin32']; code = 'protected-file-native-refused' }
        }
        $exception = $exception.InnerException
    }
    return @{ operation = $null; nativeWin32 = $null; code = 'unclassified' }
}

$owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = [Security.AccessControl.DirectorySecurity]::new()
$acl.SetAccessRuleProtection($true, $false)
$acl.SetOwner($owner)
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($owner, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit', [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
$createdPath = Join-Path $scratchPath 'owned'
$held = $null; $leaf = $null
$report = [ordered]@{ schemaVersion = 2; snapshotSucceeded = $false; sameIdentity = $false; readPinError = -1; maintainedEnrollmentMatches = $false; foreignDeleteError = -1; foreignWriteError = -1; leafOpenFailure = $null; existingDirectoryFailure = $null; directoryCleanup = $false }
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
    $held.Delete()
    $held = $null
    $report.directoryCleanup = !(Test-Path -LiteralPath $createdPath)
} finally {
    if ($null -ne $leaf) { $leaf.Dispose() }
    if ($null -ne $held) { $held.Dispose() }
}
$report | ConvertTo-Json -Compress
