param([string]$Project, [string]$Assembly, [string]$Source, [string]$Manifest, [string]$Scratch)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Reflection.Assembly]::LoadFrom($Assembly) | Out-Null
. (Join-Path $Project 'scripts/installation/protected-install-files.ps1')
# Real production stage/GUI serializers, original handles, copies, IDs, hashes,
# rename and deletion. Only ACL/principal authority and journal metadata are modeled.
[ProtectedGuiBundleFiles]::ModelProtectionForTest()
function Need([bool]$Condition) { if (!$Condition) { throw 'gui-stage-composition-refused' } }
function New-ProtectedInstallAcl([bool]$Directory, [string]$OperatorSid, [bool]$Private = $false) {
    $acl = if ($Directory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true, $false)
    $inherit = if ($Directory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::FullControl,
        $inherit, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
    return $acl
}
function New-ProtectedInstallDirectory([string]$Path, [string]$OperatorSid) {
    $held = [ProtectedInstallFile]::CreateDirectory($Path, (New-ProtectedInstallAcl $true $OperatorSid).GetSecurityDescriptorBinaryForm())
    $held | Add-Member ScriptMethod Protected { param($ancestor); return $true } -Force
    return $held
}
$script:Snapshot = (Get-Command Read-ProtectedInstallSnapshot).ScriptBlock
function Read-ProtectedInstallSnapshot([string]$Path, [bool]$Directory = $false, [bool]$RequireProtection = $true) {
    return (& $script:Snapshot $Path $Directory $false)
}
function New-ProtectedInstallJournal($Context, $Stage) {
    # Metadata provider only: no journal file is provisioned or retired here.
    return @{ generation = ('f' * 32); leaf = 'operations-' + $Context.installId + '-' + $Stage.epoch + '-' + $Stage.revision + '.jsonl';
        directory = @{ volume = ('1' * 16); fileId = ('2' * 32); securitySha256 = ('3' * 64) };
        file = @{ volume = ('1' * 16); fileId = ('4' * 32); securitySha256 = ('5' * 64) } }
}
function Release-ProtectedInstallJournal($Journal) { }
$script:ProtectedInstallParent = [IO.Path]::GetFullPath($Scratch).TrimEnd('\')
Need ((Test-Path -LiteralPath $script:ProtectedInstallParent -PathType Container) -and @(Get-ChildItem -LiteralPath $script:ProtectedInstallParent -Force).Count -eq 0)
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$parent = [ProtectedInstallFile]::new($script:ProtectedInstallParent, $true, $false)
$principal = [ProtectedGuiIdentity]::CreateForTest($sid, 1)
$sourceOwner = [ProtectedGuiBundleFiles]::Capture($Source, [IO.File]::ReadAllBytes($Manifest))
$inputs = @{}; $files = @(); $hash = [Security.Cryptography.SHA256]::Create()
try {
    foreach ($name in @('aegis-owner.exe', 'aegis-session.exe', 'aegis-main.exe')) {
        $bytes = [Text.Encoding]::UTF8.GetBytes('fixture inspection image; never executed')
        $inputs[$name] = $bytes
        $files += @{ name = $name; bytes = $bytes.Length; sha256 = [BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() }
    }
} finally { $hash.Dispose() }
$context = @{ installId = ('a' * 32); operatorSid = $sid; operatorAccount = 'FixtureOnly'; selectionId = ('c' * 32); selectionEpoch = ('d' * 32);
    inputs = $inputs; manifest = @{ files = $files }; credential = [byte[]]@(1); parent = $parent; cleanupUnknown = $false; failedStage = $null;
    guiPrincipal = $principal; guiInput = @{ source = $sourceOwner; principal = $principal; ownsSource = $true; ownsPrincipal = $false } }
$old = $null; $next = $null; $oldId = $null
try {
    $old = New-ProtectedInstallStage $context 1 ('1' * 32)
    Need ($old.rows.Count -eq 12 -and $null -ne $old.gui)
    Assert-ProtectedInstallStage $old; Update-ProtectedInstallRuntimeRows $old
    $oldId = $old.gui.bundle.FileId
    $record = [IO.File]::ReadAllBytes((Join-Path $old.path 'registered-gui-candidate.json'))
    Need ([Convert]::ToBase64String($record) -ceq [Convert]::ToBase64String($old.gui.recordBytes))
    $baseline = @{}; foreach ($row in $old.rows) { $baseline[[IO.Path]::GetFileName($row.path)] = $row.sha256 }
    Close-ProtectedGuiCandidate $context.guiInput; $context.guiInput = $null
    $externalClosed = $false; try { $sourceOwner.CheckCurrent() } catch { $externalClosed = $true }; Need $externalClosed
    $published = Join-Path $Scratch 'published'
    Move-ProtectedInstallStage $old $published
    $context.guiInput = @{ source = $old.gui.bundle; principal = $principal; ownsSource = $false; ownsPrincipal = $false }
    $next = New-ProtectedInstallStage $context 2 ('2' * 32)
    Close-ProtectedGuiCandidate $context.guiInput; $context.guiInput = $null
    Need ($next.rows.Count -eq 12 -and $next.gui.bundle.FileId -cne $oldId -and [object]::ReferenceEquals($next.gui.principal, $principal))
    $newId = $next.gui.bundle.FileId
    Move-ProtectedInstallStage $old (Join-Path $Scratch 'rollback')
    Move-ProtectedInstallStage $next $published
    # Model a failed publication verification. Use the real fixed transitions
    # to restore old originals, and retire only the new original stage.
    Move-ProtectedInstallStage $next (Join-Path $Scratch 'failed-next')
    Move-ProtectedInstallStage $old $published
    Remove-ProtectedInstallStage $next $false
    Need ($null -eq $next.gui -and !(Test-Path -LiteralPath $next.path) -and $old.gui.bundle.FileId -ceq $oldId)
    foreach ($row in $old.rows) { Need ($row.sha256 -ceq $baseline[[IO.Path]::GetFileName($row.path)]); Assert-ProtectedInstallSnapshot $row }
    $principal.CheckCurrent(); $old.gui.bundle.CheckCurrent($old.root)
    $context.cleanupUnknown = $true; $blocked = $false
    try { Remove-ProtectedInstallStage $old $true } catch { $blocked = $_.Exception.Message -ceq 'protected-owned-cleanup-unknown' }
    Need ($blocked -and $old.gui.bundle.FileId -ceq $oldId -and [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $old.path 'registered-gui-candidate.json'))) -ceq [Convert]::ToBase64String($record))
    # Explicitly modeled existing administrative verified-closure receipt. No
    # native bundle uncertainty/refused state was triggered or reset above.
    $context.cleanupUnknown = $false
    Remove-ProtectedInstallStage $old $true
    Need ($null -eq $old.gui -and !(Test-Path -LiteralPath $old.path) -and @(Get-ChildItem -LiteralPath $Scratch -Force).Count -eq 0)
    @{ passed = $true; actualFullStage = $true; ordinaryRows = 12; externalSourceClosed = $externalClosed;
        cloneFromOriginal = ($oldId -cne $newId); rollbackOriginalsPreserved = $true; unknownRetirementRefused = $blocked;
        modeledVerifiedClosure = $true; modeledPrincipalProtectionAndJournalMetadata = $true; guiEnrollment = $false } | ConvertTo-Json -Compress
} finally {
    foreach ($stage in @($next, $old)) {
        if ($null -ne $stage) { if ($null -ne $stage.gui) { $stage.gui.bundle.Dispose() }; $stage.root.Dispose() }
    }
    $sourceOwner.Dispose(); $principal.Dispose(); $parent.Dispose()
}
