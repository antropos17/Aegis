param([string]$Project, [string]$Assembly, [string]$Source, [string]$Manifest, [string]$Scratch,
    [ValidateSet('clone-rollback', 'retention-publish-unknown')][string]$Mode = 'clone-rollback')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Reflection.Assembly]::LoadFrom($Assembly) | Out-Null
. (Join-Path $Project 'scripts/installation/protected-installation.ps1')
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
    if ($Mode -ceq 'retention-publish-unknown') {
        $script:ProtectedInstallRoot = $published
        $context.stage = $old; $context.rollback = $null
        $script:GuiRetention = @{ issued = $null; root = $null; bundle = $null; record = $null; rootId = $null; bundleId = $null; inputs = $inputs;
            moves = 0; stops = 0; stages = 0 }
        $service = [pscustomobject]@{ Original = $true }
        $service | Add-Member ScriptMethod Status { return @(1, 0) }
        $service | Add-Member ScriptMethod WaitExited { }
        $service | Add-Member ScriptMethod Recheck { }
        $service | Add-Member ScriptMethod Stop { $script:GuiRetention.stops++ }
        $context.service = $service
        # Only administrative/principal/descriptor authority and input delivery
        # are modeled. Every stage/bundle operation below calls the real helper.
        function Assert-ProtectedInstallAdministrator { }
        $script:OriginalAssertInstallation = (Get-Command Assert-ProtectedInstallation).ScriptBlock
        function Assert-ProtectedInstallation($Association) {
            if ($Association.cleanupUnknown) { & $script:OriginalAssertInstallation $Association; return }
            Need ([object]::ReferenceEquals($Association, $context))
            $Association.parent.Recheck(); Assert-ProtectedInstallStage $Association.stage
        }
        function Read-ProtectedInstallInputs($SourceRoot, $Manifest) {
            $copy = @{}; foreach ($entry in $script:GuiRetention.inputs.GetEnumerator()) { $copy[$entry.Key] = [byte[]]$entry.Value.Clone() }; return $copy
        }
        $script:OriginalNewStage = (Get-Command New-ProtectedInstallStage).ScriptBlock
        function New-ProtectedInstallStage($Context, $Revision, $Epoch) {
            $stage = & $script:OriginalNewStage $Context $Revision $Epoch
            $script:GuiRetention.stages++
            $script:GuiRetention.issued = $stage; $script:GuiRetention.root = $stage.root; $script:GuiRetention.bundle = $stage.gui.bundle
            $script:GuiRetention.record = [byte[]]$stage.gui.recordBytes.Clone()
            $script:GuiRetention.rootId = $stage.root.FileId; $script:GuiRetention.bundleId = $stage.gui.bundle.FileId
            return $stage
        }
        $script:OriginalMoveStage = (Get-Command Move-ProtectedInstallStage).ScriptBlock
        function Move-ProtectedInstallStage($Stage, $Destination) {
            & $script:OriginalMoveStage $Stage $Destination
            $script:GuiRetention.moves++
            if ([object]::ReferenceEquals($Stage, $script:GuiRetention.issued)) {
                # The real encapsulated native rename completed. Model loss of
                # administrative handoff confirmation, without native recovery.
                $failure = [IO.InvalidDataException]::new('protected-file-handoff-cleanup-unknown')
                $failure.Data['protectedCleanupUnknown'] = $true; throw $failure
            }
        }
        $refused = $false
        try { Update-ProtectedInstallation $context 'fixture-inputs-never-opened' $context.manifest | Out-Null }
        catch { $refused = $_.Exception.Message -ceq 'protected-upgrade-handoff-cleanup-unknown' }
        $next = $script:GuiRetention.issued
        Need ($refused -and $null -ne $next -and $context.cleanupUnknown)
        $exactStage = [object]::ReferenceEquals($context.failedStage, $next)
        $exactRoot = [object]::ReferenceEquals($context.failedStage.root, $script:GuiRetention.root)
        $exactBundle = [object]::ReferenceEquals($context.failedStage.gui.bundle, $script:GuiRetention.bundle)
        Need ($exactStage -and $exactRoot -and $exactBundle -and [object]::ReferenceEquals($context.stage, $old) -and [object]::ReferenceEquals($context.rollback, $old))
        # Exercise the actual retained originals before explicit fixture teardown;
        # reachability counts, collection timing and reopening by path prove none of this.
        $context.failedStage.root.Recheck(); $context.failedStage.gui.bundle.CheckCurrent($context.failedStage.root)
        $old.root.Recheck(); $old.gui.bundle.CheckCurrent($old.root); $principal.CheckCurrent()
        Need ($context.failedStage.root.FileId -ceq $script:GuiRetention.rootId -and $context.failedStage.gui.bundle.FileId -ceq $script:GuiRetention.bundleId)
        $recordsPreserved = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $next.path 'registered-gui-candidate.json'))) -ceq [Convert]::ToBase64String($script:GuiRetention.record)
        foreach ($stage in @($old, $next)) { foreach ($row in $stage.rows) { Assert-ProtectedInstallSnapshot $row } }
        $before = @($script:GuiRetention.stages, $script:GuiRetention.moves, $script:GuiRetention.stops)
        $retryGuarded = $false; $uninstallGuarded = $false
        try { Update-ProtectedInstallation $context 'fixture-inputs-never-opened' $context.manifest | Out-Null }
        catch { $retryGuarded = $_.Exception.Message -ceq 'protected-owned-cleanup-unknown' }
        try { Remove-ProtectedInstallation $context } catch { $uninstallGuarded = $_.Exception.Message -ceq 'protected-owned-cleanup-unknown' }
        $noFollowup = $before[0] -eq $script:GuiRetention.stages -and $before[1] -eq $script:GuiRetention.moves -and $before[2] -eq $script:GuiRetention.stops
        Need ($recordsPreserved -and $retryGuarded -and $uninstallGuarded -and $noFollowup)
        @{ passed = $true; actualFullStage = $true; retainedStageExact = $exactStage; retainedRootExact = $exactRoot; retainedBundleExact = $exactBundle;
            retainedPinsCurrent = $true; originalFileIdsPreserved = $true; candidateBytesPreserved = $recordsPreserved; oldAndRollbackExact = $true;
            retryGuarded = $retryGuarded; uninstallGuarded = $uninstallGuarded; noFollowupEffects = $noFollowup;
            staged = $script:GuiRetention.stages; nativeMoves = $script:GuiRetention.moves; modeledServiceStops = $script:GuiRetention.stops;
            modeledAdministrativeHandoffUncertainty = $true; modeledPrincipalProtectionAndJournalMetadata = $true; guiEnrollment = $false } | ConvertTo-Json -Compress
        return
    }
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
