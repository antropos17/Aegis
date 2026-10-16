param([string]$Project, [string]$Scratch)
$ErrorActionPreference = 'Stop'
. (Join-Path $Project 'scripts/installation/protected-install-files.ps1')
Add-Type -Path (Join-Path $Project 'scripts/installation/ProtectedInstallFiles.cs')
# Only descriptor trust is modeled. Real native creation handles, IDs, bytes, stage schema and retirement execute.
function New-ProtectedInstallAcl([bool]$Directory, [string]$OperatorSid, [bool]$Private = $false) {
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = if ($Directory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
    $acl.SetAccessRuleProtection($true, $false); $acl.SetOwner($sid)
    $inherit = if ($Directory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::FullControl, $inherit,
        [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
    return $acl
}
function Wrap-Directory($Native) {
    $value = [pscustomobject]@{ Native = $Native; PathName = $Native.PathName; Volume = $Native.Volume; FileId = $Native.FileId; Sddl = $Native.Sddl }
    $value | Add-Member ScriptMethod Recheck { $this.Native.Recheck() }
    $value | Add-Member ScriptMethod Protected { param($ancestor); return $true }
    $value | Add-Member ScriptMethod Delete { $this.Native.Delete() }
    $value | Add-Member ScriptMethod Dispose { $this.Native.Dispose() }
    return $value
}
function New-ProtectedInstallDirectory([string]$Path, [string]$OperatorSid, [bool]$Private = $false) {
    return Wrap-Directory ([ProtectedInstallFile]::CreateDirectory($Path, (New-ProtectedInstallAcl $true $OperatorSid $Private).GetSecurityDescriptorBinaryForm()))
}
function Assert-ProtectedJournalProtection($Held) { }
$script:ReadSnapshot = (Get-Command Read-ProtectedInstallSnapshot).ScriptBlock
function Read-ProtectedInstallSnapshot([string]$Path, [bool]$Directory = $false, [bool]$RequireProtection = $true) {
    return (& $script:ReadSnapshot $Path $Directory $false)
}
$script:ProtectedInstallParent = $Scratch
$parent = Wrap-Directory ([ProtectedInstallFile]::new($Scratch, $true, $false))
$blob = [byte[]]@(1); $hash = [Security.Cryptography.SHA256]::Create()
try { $digest = [BitConverter]::ToString($hash.ComputeHash($blob)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
$inputs = @{}; $files = @()
foreach ($name in @('aegis-owner.exe', 'aegis-session.exe', 'aegis-main.exe')) { $inputs[$name] = $blob; $files += @{ name = $name; bytes = 1; sha256 = $digest } }
$context = @{ installId = ('a' * 32); selectionId = ('c' * 32); selectionEpoch = ('d' * 32); operatorSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
    operatorAccount = 'FixtureOnly'; credential = $blob; parent = $parent; inputs = $inputs; manifest = @{ files = $files }; vmBinding = $null; cleanupUnknown = $false }
$stages = @()
try {
    New-ProtectedInstallJournalDirectory $context
    $first = New-ProtectedInstallStage $context 1 ('1' * 32); $stages += $first
    if ($first.rows.Count -ne 11 -or $context.journalFiles.Count -ne 1) { throw 'fixture-stage-journal-required' }
    $second = New-ProtectedInstallStage $context 2 ('2' * 32); $stages += $second
    Assert-ProtectedInstallStage $first; Assert-ProtectedInstallStage $second; Assert-ProtectedInstallJournals $context
    if ($context.journalFiles.Count -ne 2) { throw 'fixture-two-originals-required' }
    $originalBytes = [Text.Encoding]::UTF8.GetBytes("retained original journal observation`n")
    [IO.File]::WriteAllBytes($first.journal.path, $originalBytes)
    # Model the original administrative latch set BEFORE the supported owner start route.
    # Neither a stopped service nor the ability to read this file clears that latch.
    $context.cleanupUnknown = $true; $collectionRefused = $false; $retirementRefused = $false
    try { Collect-ProtectedInstallJournal $context $first.journal | Out-Null }
    catch { $collectionRefused = $_.Exception.Message -ceq 'protected-journal-collection-refused' }
    try { Remove-ProtectedInstallJournal $context $first.journal }
    catch { $retirementRefused = $_.Exception.Message -ceq 'protected-journal-collection-refused' }
    $preserved = [ProtectedInstallFile]::new($first.journal.path, $false, $false)
    try {
        if (!$collectionRefused -or !$retirementRefused -or $preserved.FileId -cne $first.journal.file.fileId -or
            $preserved.Volume -cne $first.journal.file.volume -or
            [Convert]::ToBase64String($preserved.ReadJournal(2101248)) -cne [Convert]::ToBase64String($originalBytes) -or
            $context.journalFiles.Count -ne 2 -or $context.journalEvidence.Count -ne 0 -or $first.journal.removed) { throw 'fixture-unknown-closure-mutated-original' }
    } finally { $preserved.Dispose() }
    # Model only the authenticated exact original owner/Job closure validation in Invoke-InstalledOwnerAttempt.
    $context.cleanupUnknown = $false
    Remove-ProtectedInstallStage $first $false
    if ([Convert]::ToBase64String($context.journalEvidence[0].bytes) -cne [Convert]::ToBase64String($originalBytes)) { throw 'fixture-original-evidence-not-preserved' }
    if ($context.journalFiles.Count -ne 1 -or ![object]::ReferenceEquals($context.journalFiles[0], $second.journal)) { throw 'fixture-commit-original-refused' }
    $rollback = New-ProtectedInstallStage $context 3 ('3' * 32); $stages += $rollback
    Remove-ProtectedInstallStage $rollback $false
    if ($context.journalFiles.Count -ne 1 -or ![object]::ReferenceEquals($context.journalFiles[0], $second.journal)) { throw 'fixture-rollback-original-refused' }
    Remove-ProtectedInstallStage $second $false
    Remove-ProtectedInstallJournalDirectory $context
    if ($context.journalEvidence.Count -ne 3 -or $null -ne $context.journalDirectory -or @(Get-ChildItem -LiteralPath $Scratch -Force).Count) { throw 'fixture-journal-cleanup-refused' }
    @{ passed = $true; stageLeaves = 11; twoOriginals = $true; rollbackOriginalPreserved = $true; closedEvidence = 3; directoryRemoved = $true;
        unknownClosureRefused = $true; originalIdentityAndBytesPreserved = $true; modeledProtection = $true; serviceOperations = 0 } | ConvertTo-Json -Compress
} finally {
    foreach ($stage in $stages) { $stage.root.Dispose() }
    if ($context.ContainsKey('journalDirectory') -and $null -ne $context.journalDirectory) { $context.journalDirectory.Dispose() }
    $parent.Dispose()
}
