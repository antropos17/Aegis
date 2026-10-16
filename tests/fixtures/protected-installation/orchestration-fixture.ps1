param([ValidateSet('clean-partial', 'unknown-partial', 'clean-refusal', 'native-refusal', 'upgrade-reference', 'upgrade-handoff-unknown', 'upgrade-retention-matrix', 'noisy-upgrade', 'null-upgrade', 'noisy-stage', 'membership-users-query', 'membership-users-add', 'membership-account-verify', 'membership-administrators-query', 'membership-users-verify', 'membership-existing', 'membership-add', 'membership-command-missing', 'membership-binding', 'membership-win32', 'membership-helper-lookup', 'host-script-scope', 'host-script-child', 'gui-stage-hook', 'gui-lifecycle', 'gui-clean-failure', 'gui-unknown-failure', 'gui-invalid-options')][string]$Mode)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($Mode -ceq 'upgrade-retention-matrix') {
    . (Join-Path $PSScriptRoot '../../../scripts/installation/protected-install-transaction.ps1')
    function New-RetentionSentinel([string]$Label) {
        $root = [pscustomobject]@{ Label = $Label; Deleted = $false }
        return @{ root = $root; gui = @{ bundle = [pscustomobject]@{ Root = $root; Removed = $false } } }
    }
    function Invoke-RetentionCase([string]$Case) {
        # Only callback resource leaves are modeled. The maintained transaction
        # performs output validation, retention, compensation and slot clearing.
        $old = New-RetentionSentinel 'old'; $issued = New-RetentionSentinel 'issued'; $partial = New-RetentionSentinel 'partial'
        $association = @{ stage = $old; failedStage = $null; service = [pscustomobject]@{ Original = $true } }
        $retentionState = @{ events = [Collections.Generic.List[string]]::new(); beforeStop = $false; removedExact = $false }
        if ($Case -ceq 'preexisting') { $association.failedStage = $partial }
        $ops = @{}
        foreach ($step in @('validate', 'stage', 'stop', 'saveOld', 'publish', 'verify', 'commit', 'unpublish', 'restore', 'restart', 'remove')) {
            $ops[$step] = {
                param($Selected, $Second)
                $retentionState.events.Add($step)
                if ($step -ceq 'validate' -and ![object]::ReferenceEquals($Selected, $association)) { throw 'fixture-foreign-association' }
                if ($step -ceq 'stage') {
                    if ($Case -ceq 'construction-throw') { $association.failedStage = $partial; throw 'fixture-construction-failed' }
                    if ($Case -ceq 'null-output') { return $null }
                    if ($Case -ceq 'callback-slot-conflict') { $association.failedStage = $partial }
                    if ($Case -ceq 'noisy-output') { 'unowned-output' }
                    if ($Case -ceq 'multiple-output') { $issued; $partial; return }
                    return $issued
                }
                if ($step -ceq 'stop') { $retentionState.beforeStop = [object]::ReferenceEquals($association.failedStage, $issued) }
                if ($step -ceq 'publish' -or $step -ceq 'verify' -or $step -ceq 'unpublish' -or $step -ceq 'remove') {
                    if (![object]::ReferenceEquals($Selected, $issued)) { throw 'fixture-foreign-stage' }
                }
                if ($step -ceq 'verify' -and ($Case -ceq 'compensation-success' -or $Case -ceq 'remove-slot-replaced' -or $Case -clike 'rollback-*')) { throw 'fixture-verification-failed' }
                if ($step -ceq 'commit') {
                    if (![object]::ReferenceEquals($Selected, $association) -or ![object]::ReferenceEquals($Second, $issued)) { throw 'fixture-foreign-commit' }
                    if ($Case -cne 'commit-no-transfer') { $association.stage = $issued }
                    if ($Case -ceq 'unknown-commit') { throw 'fixture-commit-unsettled' }
                }
                if ($Case -ceq ('unknown-' + $step)) {
                    $failure = [IO.InvalidDataException]::new('protected-file-handoff-cleanup-unknown')
                    $failure.Data['protectedCleanupUnknown'] = $true; throw $failure
                }
                if ($Case -ceq ('rollback-' + $step)) { throw 'fixture-compensation-unsettled' }
                if ($step -ceq 'remove') {
                    $issued.root.Deleted = $true; $issued.gui.bundle.Removed = $true; $retentionState.removedExact = $true
                    if ($Case -ceq 'remove-slot-replaced') { $association.failedStage = $partial }
                }
            }.GetNewClosure()
        }
        $refused = $false; $returned = $null
        try { $returned = Invoke-ProtectedUpgradeTransaction $ops $association } catch { $refused = $true }
        $retained = $association.failedStage
        @{ case = $Case; refused = $refused; returnedExact = [object]::ReferenceEquals($returned, $issued);
            slotEmpty = $null -eq $retained; issuedExact = [object]::ReferenceEquals($retained, $issued);
            issuedRootExact = ($null -ne $retained -and [object]::ReferenceEquals($retained.root, $issued.root));
            issuedBundleExact = ($null -ne $retained -and [object]::ReferenceEquals($retained.gui.bundle, $issued.gui.bundle));
            partialExact = [object]::ReferenceEquals($retained, $partial); beforeStopExact = $retentionState.beforeStop;
            oldStillCurrent = [object]::ReferenceEquals($association.stage, $old); issuedCurrent = [object]::ReferenceEquals($association.stage, $issued);
            removedExact = $retentionState.removedExact; events = $retentionState.events.ToArray() }
    }
    $rows = foreach ($case in @('preexisting', 'construction-throw', 'callback-slot-conflict', 'null-output', 'noisy-output', 'multiple-output',
        'commit-success', 'compensation-success', 'commit-no-transfer', 'remove-slot-replaced', 'unknown-stop', 'unknown-saveOld',
        'unknown-publish', 'unknown-verify', 'unknown-commit', 'rollback-unpublish', 'rollback-restore', 'rollback-restart', 'rollback-remove')) {
        Invoke-RetentionCase $case
    }
    @{ rows = @($rows); modeledCallbackResources = $true; nativeEffects = 0 } | ConvertTo-Json -Depth 5 -Compress
    return
}
if ($Mode -ceq 'gui-stage-hook') {
    . (Join-Path $PSScriptRoot '../../../scripts/installation/protected-install-files.ps1')
    # The production stage serializer executes; only filesystem/native GUI ownership leaves are modeled.
    $script:GuiHookFiles = @{}; $script:GuiHookStages = 0; $script:GuiHookCopies = 0; $script:GuiHookDirectorySnapshots = 0
    function New-ProtectedInstallDirectory {
        param($Path, $OperatorSid)
        $root = [pscustomobject]@{ PathName = $Path; Volume = ('1' * 16); FileId = ('2' * 32) }
        $root | Add-Member ScriptMethod Recheck { }
        $root | Add-Member ScriptMethod Protected { param($ancestor); return $true }
        $script:GuiHookStages++; return $root
    }
    function Write-ProtectedInstallFile {
        param($Path, [byte[]]$Bytes, $OperatorSid, $Private)
        $script:GuiHookFiles[$Path] = @{ bytes = [byte[]]$Bytes.Clone(); directory = $false }
    }
    function Get-ChildItem {
        param($LiteralPath, [switch]$Force)
        foreach ($path in $script:GuiHookFiles.Keys) {
            if ([IO.Path]::GetDirectoryName($path) -ceq $LiteralPath) {
                [pscustomobject]@{ FullName = $path; Name = [IO.Path]::GetFileName($path); PSIsContainer = $script:GuiHookFiles[$path].directory; Attributes = [IO.FileAttributes]::Normal }
            }
        }
    }
    function Read-ProtectedInstallSnapshot {
        param($Path)
        if ($script:GuiHookFiles[$Path].directory) { $script:GuiHookDirectorySnapshots++; throw 'fixture-gui-generic-snapshot-refused' }
        return @{ path = $Path; bytes = $script:GuiHookFiles[$Path].bytes.Length }
    }
    function New-ProtectedInstallJournal {
        param($Context, $Stage)
        return @{ generation = ('a' * 32); leaf = 'operations-' + $Context.installId + '-' + $Stage.epoch + '-' + $Stage.revision + '.jsonl';
            directory = @{ volume = ('1' * 16); fileId = ('2' * 32); securitySha256 = ('3' * 64) };
            file = @{ volume = ('1' * 16); fileId = ('4' * 32); securitySha256 = ('5' * 64) } }
    }
    function Release-ProtectedInstallJournal { param($Journal) }
    function New-ProtectedGuiStage {
        param($Context, $Stage, [byte[]]$PolicyBytes)
        if ($null -eq $Context.guiInput) { return $null }
        $policy = [Text.Encoding]::UTF8.GetString($PolicyBytes) | ConvertFrom-Json
        if ($policy.rootFileId -cne $Stage.root.FileId -or $policy.epoch -cne $Stage.epoch -or
            ![object]::ReferenceEquals($Context.guiInput.principal, $Context.guiPrincipal)) { throw 'fixture-gui-original-tuple-refused' }
        $script:GuiHookCopies++
        $script:GuiHookFiles[(Join-Path $Stage.path 'GuiBundle')] = @{ bytes = [byte[]]@(); directory = $true }
        return @{ bundle = [pscustomobject]@{ root = $Stage.root }; principal = $Context.guiPrincipal; recordBytes = [Text.Encoding]::UTF8.GetBytes('{"scope":"fixture-gui-candidate"}') }
    }
    $blob = [byte[]]@(1); $manifest = @(); $inputs = @{}
    foreach ($name in @('aegis-owner.exe','aegis-session.exe','aegis-main.exe')) { $inputs[$name] = $blob; $manifest += @{ name = $name; bytes = 1; sha256 = ('a' * 64) } }
    $context = @{ installId = ('a' * 32); selectionId = ('b' * 32); selectionEpoch = ('c' * 32); operatorSid = 'S-1-5-21-1';
        operatorAccount = 'FixtureOnly'; parent = @{}; credential = $blob; inputs = $inputs; manifest = @{ files = $manifest }; guiInput = $null; guiPrincipal = $null }
    $headless = New-ProtectedInstallStage $context 1 ('d' * 32)
    $principal = [pscustomobject]@{ original = $true }; $context.guiPrincipal = $principal
    $context.guiInput = @{ source = [pscustomobject]@{ original = $true }; principal = $principal }
    $withGui = New-ProtectedInstallStage $context 1 ('d' * 32)
    $sameInventory = [Convert]::ToBase64String($script:GuiHookFiles[(Join-Path $headless.path 'inventory.json')].bytes) -ceq
        [Convert]::ToBase64String($script:GuiHookFiles[(Join-Path $withGui.path 'inventory.json')].bytes)
    $sameFixture = [Convert]::ToBase64String($script:GuiHookFiles[(Join-Path $headless.path 'fixed-fixture.json')].bytes) -ceq
        [Convert]::ToBase64String($script:GuiHookFiles[(Join-Path $withGui.path 'fixed-fixture.json')].bytes)
    @{ guiStaged = ($script:GuiHookCopies -eq 1 -and $withGui.ContainsKey('gui') -and $null -ne $withGui.gui);
        candidateWritten = $script:GuiHookFiles.ContainsKey((Join-Path $withGui.path 'registered-gui-candidate.json'));
        originalInventoryPreserved = $sameInventory; originalFixedFixturePreserved = $sameFixture;
        genericDirectorySnapshots = $script:GuiHookDirectorySnapshots; headlessRows = $headless.rows.Count; guiRows = $withGui.rows.Count } | ConvertTo-Json -Compress
    return
}
if ($Mode -ceq 'host-script-scope') { & $PSCommandPath 'host-script-child'; return }
# No native APIs: these finite resource objects exist only in this child process.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
public sealed class ProtectedInstallFile : IDisposable {
    public string PathName; public string Volume = "00000001"; public string FileId = "0000000000000001";
    public ProtectedInstallFile(string path, bool directory, bool write) { PathName = path; }
    public bool Protected(bool ancestor) { return true; }
    public void Recheck() { }
    public void Dispose() { }
    public bool Deleted;
    public void Delete() { Deleted = true; }
}
public sealed class ProtectedInstallService {
    public const string Name = "AegisProtectedSessionOwner";
    public const string Image = "\"C:\\ProgramData\\AEGIS\\ProtectedSession\\aegis-owner.exe\"";
    public static bool Created;
    public static bool CreateSucceeds;
    public static bool Absent() { return !Created; }
    public static bool CleanupUnknown;
    public uint[] Status() { return new uint[] { 1, 0 }; }
    public void WaitExited() { }
    public static int StopCalls;
    public void Stop() { StopCalls++; }
    public void Recheck() { }
    public void Delete() { Created = false; }
    public static ProtectedInstallService Create() {
        if (CreateSucceeds) { Created = true; return new ProtectedInstallService(); }
        var failure = new InvalidDataException("protected-service-create-refused");
        failure.Data["protectedOperation"] = "service-create";
        failure.Data["protectedNativeWin32"] = 5;
        if (CleanupUnknown) failure.Data["protectedCleanupUnknown"] = true;
        throw failure;
    }
}
'@
if ($Mode -cin @('host-script-child', 'gui-lifecycle', 'gui-clean-failure', 'gui-unknown-failure', 'gui-invalid-options')) {
    # The workflow calls the lab as a child script from its step script. Load
    # maintained functions here in that child script's scope, never globally.
    . (Join-Path $PSScriptRoot '../../../scripts/installation/protected-installation.ps1')
    $global:FixtureHost = @{ account = $null; exists = $false; member = $false; addedReferenceExact = $false; removedSidExact = $false; namedAccountQueries = 0;
        files = [Collections.Generic.List[object]]::new(); stages = [Collections.Generic.List[object]]::new() }
    $script:FixtureGui = @{ captures = 0; sourceCloses = 0; principalCloses = 0; bundles = [Collections.Generic.List[object]]::new();
        removed = [Collections.Generic.List[int]]::new(); events = [Collections.Generic.List[string]]::new() }
    function Open-ProtectedGuiCandidate {
        param($SourceRoot, [byte[]]$ManifestBytes)
        if ($SourceRoot -cne 'C:\fixture\original-gui' -or $ManifestBytes.Length -ne 1) { throw 'fixture-gui-input-refused' }
        $script:FixtureGui.captures++; $script:FixtureGui.events.Add('capture')
        $source = [pscustomobject]@{ Disposed = $false }
        $source | Add-Member ScriptMethod Dispose { if ($this.Disposed) { throw 'fixture-double-source-close' }; $this.Disposed = $true; $script:FixtureGui.sourceCloses++; $script:FixtureGui.events.Add('source-close') }
        $principal = [pscustomobject]@{ Disposed = $false }
        $principal | Add-Member ScriptMethod CheckCurrent { if ($this.Disposed) { throw 'fixture-original-principal-closed' } }
        $principal | Add-Member ScriptMethod Dispose { if ($this.Disposed) { throw 'fixture-double-principal-close' }; $this.Disposed = $true; $script:FixtureGui.principalCloses++; $script:FixtureGui.events.Add('principal-close') }
        return @{ source = $source; principal = $principal; ownsSource = $true; ownsPrincipal = $true }
    }
    # Only OS leaves are global fakes, matching globally imported cmdlets. All
    # maintained account/association/cleanup helpers remain child-script functions.
    function global:ConvertTo-SecureString { param($String, [switch]$AsPlainText, [switch]$Force); return 'fixture-only-secure-value' }
    function global:Get-LocalUser {
        param($Name, $ErrorAction)
        if ($null -ne $Name) { $global:FixtureHost.namedAccountQueries++; if ($Name -cne 'AegisOp012345abcdef') { throw 'fixture-account-name-refused' } }
        if ($global:FixtureHost.exists) { return $global:FixtureHost.account }
    }
    function global:New-LocalUser {
        param($Name, $Password, [switch]$AccountNeverExpires, [switch]$PasswordNeverExpires, [switch]$UserMayNotChangePassword)
        $global:FixtureHost.account = [pscustomobject]@{ Name = $Name; SID = [pscustomobject]@{ Value = 'S-1-5-21-100-200-300-1001' } }
        $global:FixtureHost.exists = $true; return $global:FixtureHost.account
    }
    function global:Get-LocalGroupMember {
        param($SID)
        if ($SID -ceq 'S-1-5-32-545' -and $global:FixtureHost.member -and $global:FixtureHost.exists) { return $global:FixtureHost.account }
        if ($SID -cnotin @('S-1-5-32-544', 'S-1-5-32-545')) { throw 'fixture-group-association-refused' }
    }
    function global:Add-LocalGroupMember {
        param($SID, $Member)
        if ($SID -cne 'S-1-5-32-545' -or ![object]::ReferenceEquals($Member, $global:FixtureHost.account)) { throw 'fixture-membership-association-refused' }
        $global:FixtureHost.addedReferenceExact = $true; $global:FixtureHost.member = $true
    }
    function global:Remove-LocalUser {
        param($SID)
        if (!$global:FixtureHost.exists -or $SID.Value -cne $global:FixtureHost.account.SID.Value) { throw 'fixture-account-removal-association-refused' }
        $global:FixtureHost.removedSidExact = $true; $global:FixtureHost.exists = $false
    }
    function global:Get-ChildItem {
        param($LiteralPath, [switch]$Force)
        foreach ($file in $global:FixtureHost.files) {
            if (!$file.Deleted -and [IO.Path]::GetDirectoryName($file.PathName) -ceq $LiteralPath) { [pscustomobject]@{ FullName = $file.PathName; Name = [IO.Path]::GetFileName($file.PathName); Length = 0 } }
        }
    }
    function global:Test-Path {
        param($LiteralPath)
        return @($global:FixtureHost.files | Where-Object { !$_.Deleted -and $_.PathName -ceq $LiteralPath }).Count -ne 0
    }
    function Assert-ProtectedInstallAdministrator { }
    function Initialize-ProtectedInstallNative { }
    function Read-ProtectedInstallInputs { param($SourceRoot, $Manifest); return @{ fixture = [byte[]]@(1,2,3) } }
    function New-ProtectedInstallDirectory {
        param($Path, $OperatorSid, $Private)
        if ($OperatorSid -cne $global:FixtureHost.account.SID.Value) { throw 'fixture-directory-sid-refused' }
        $held = [ProtectedInstallFile]::new($Path, $true, $true); $held.FileId = ($global:FixtureHost.files.Count + 1).ToString('x16'); $global:FixtureHost.files.Add($held); return $held
    }
    function Set-ProtectedInstallCredential { param($Context); $Context.credential = [byte[]]@(4,5,6) }
    # Administrative journal ownership is modeled here; real native file controls have their own fixture.
    function New-ProtectedInstallJournalDirectory {
        param($Context)
        $Context.journalDirectory = New-ProtectedInstallDirectory (Join-Path $Context.parent.PathName 'OperationJournal') $Context.operatorSid $true
        $Context.journalFiles = @(); $Context.journalEvidence = @()
    }
    function Assert-ProtectedInstallJournals { param($Context); if ($Context.journalDirectory.Deleted -or $Context.journalFiles.Count -ne 0) { throw 'fixture-journal-association-refused' } }
    function Remove-ProtectedInstallJournalDirectory { param($Context); Assert-ProtectedInstallJournals $Context; $Context.journalDirectory.Delete(); $Context.journalDirectory = $null }
    function New-ProtectedInstallStage {
        param($Context, $Revision, $Epoch)
        $held = New-ProtectedInstallDirectory (Join-Path $script:ProtectedInstallParent ('Staging-' + $Epoch)) $Context.operatorSid
        $stage = @{ root = $held; parent = $Context.parent; path = $held.PathName; revision = $Revision; epoch = $Epoch; published = $false; rows = @(); gui = $null; context = $Context }
        if ($null -ne $Context.guiInput) {
            $input = $Context.guiInput; $input.principal.CheckCurrent()
            if ($input.source.Disposed -or ![object]::ReferenceEquals($input.principal, $Context.guiPrincipal)) { throw 'fixture-original-gui-input-lost' }
            $index = $script:FixtureGui.bundles.Count
            if ($index -gt 0 -and (![object]::ReferenceEquals($input.source, $Context.stage.gui.bundle) -or $input.source.Removed)) { throw 'fixture-upgrade-source-recaptured' }
            $bundle = [pscustomobject]@{ Index = $index; Root = $held; Parent = $Context.parent; Source = $input.source; Disposed = $false; Removed = $false }
            $bundle | Add-Member ScriptMethod CheckCurrent { param($root); if ($this.Disposed -or $this.Removed -or ![object]::ReferenceEquals($this.Root, $root)) { throw 'fixture-original-bundle-refused' } }
            $bundle | Add-Member ScriptMethod RenameStage { param($root, $parent, $destination); $this.CheckCurrent($root); if (![object]::ReferenceEquals($parent, $this.Parent)) { throw 'fixture-original-parent-refused' }; $root.PathName = $destination; $script:FixtureGui.events.Add('move-' + $this.Index) }
            $bundle | Add-Member ScriptMethod Remove { param($root); $this.CheckCurrent($root); $this.Removed = $true; $script:FixtureGui.removed.Add($this.Index); $script:FixtureGui.events.Add('remove-' + $this.Index) }
            $bundle | Add-Member ScriptMethod Dispose { if (!$this.Removed -or $this.Disposed) { throw 'fixture-unowned-bundle-close' }; $this.Disposed = $true; $script:FixtureGui.events.Add('close-' + $this.Index) }
            $script:FixtureGui.events.Add('stage-' + $index); $script:FixtureGui.bundles.Add($bundle)
            $stage.gui = @{ bundle = $bundle; principal = $input.principal }
        }
        $global:FixtureHost.stages.Add($stage); return $stage
    }
    function Assert-ProtectedInstallStage {
        param($Stage)
        if (@($global:FixtureHost.stages | Where-Object { [object]::ReferenceEquals($_, $Stage) }).Count -ne 1 -or $Stage.root.Deleted -or $Stage.path -cne $Stage.root.PathName) { throw 'fixture-stage-reference-refused' }
        Assert-ProtectedGuiStage $Stage
    }
    function Update-ProtectedInstallRuntimeRows { param($Stage); Assert-ProtectedInstallStage $Stage }
    function Move-ProtectedInstallStage {
        param($Stage, $Destination)
        Assert-ProtectedInstallStage $Stage
        if ($null -ne $Stage.gui) { Move-ProtectedGuiStageBinding $Stage $Destination } else { $Stage.root.PathName = $Destination }
        $Stage.path = $Destination
    }
    function Remove-ProtectedInstallStage { param($Stage, $Published); if ($Stage.context.cleanupUnknown) { throw 'protected-owned-cleanup-unknown' }; Assert-ProtectedInstallStage $Stage; Remove-ProtectedGuiStage $Stage; $Stage.root.Delete() }
    [ProtectedInstallService]::CreateSucceeds = $true
    if ($Mode -ceq 'gui-invalid-options') {
        $invalid = @('wrong-type', @{ sourceRoot = 'C:\fixture\original-gui' }, @{ sourceRoot = ''; manifest = [byte[]]@(1) },
            @{ sourceRoot = 42; manifest = [byte[]]@(1) }, @{ sourceRoot = 'C:\fixture\original-gui'; manifest = 'bytes' },
            @{ sourceRoot = 'C:\fixture\original-gui'; manifest = [byte[]]@() }, @{ sourceRoot = 'C:\fixture\original-gui'; manifest = (New-Object byte[] 524289) },
            @{ sourceRoot = 'C:\fixture\original-gui'; manifest = [byte[]]@(1); extra = $true }, @{ SourceRoot = 'C:\fixture\original-gui'; manifest = [byte[]]@(1) })
        $refused = 0; $noEffects = $true
        foreach ($option in $invalid) {
            $journal = @{}
            try { New-ProtectedInstallation 'C:\fixture\input' @{} 'AegisOp012345abcdef' 'fixture-credential-length-32-bytes' -Journal $journal -GuiBundle $option | Out-Null }
            catch { if ($_.Exception.Message -ceq 'protected-gui-input-refused') { $refused++ } }
            if ($journal.accountCreationAttempted -or $journal.cleanup.state -cne 'confirmed-no-effects') { $noEffects = $false }
        }
        @{ refused = $refused; noEffects = $noEffects; captures = $script:FixtureGui.captures; roots = $global:FixtureHost.files.Count } | ConvertTo-Json -Compress
        return
    }
    if ($Mode -cin @('gui-clean-failure', 'gui-unknown-failure')) {
        $unknown = $Mode -ceq 'gui-unknown-failure'
        if ($unknown) { [ProtectedInstallService]::CreateSucceeds = $false; [ProtectedInstallService]::CleanupUnknown = $true }
        $journal = @{}; $refused = $false
        try { New-ProtectedInstallation 'C:\fixture\input' @{} 'AegisOp012345abcdef' 'fixture-credential-length-32-bytes' -FailAfterPublish (!$unknown) -Journal $journal -GuiBundle @{ sourceRoot = 'C:\fixture\original-gui'; manifest = [byte[]]@(1) } | Out-Null }
        catch { $refused = $true }
        @{ refused = $refused; cleanup = $journal.cleanup.state; sourceCloses = $script:FixtureGui.sourceCloses; principalCloses = $script:FixtureGui.principalCloses;
            bundleRemoved = $script:FixtureGui.bundles[0].Removed; bundleDisposed = $script:FixtureGui.bundles[0].Disposed;
            originalRetained = ($unknown -and [object]::ReferenceEquals($journal.association.stage.gui.bundle, $script:FixtureGui.bundles[0]) -and $journal.association.cleanupUnknown);
            events = @($script:FixtureGui.events.ToArray()) } | ConvertTo-Json -Depth 4 -Compress
        return
    }
    $journal = @{}; $result = @{ installed = $false; originalExact = $false; firstUpgradeExact = $false; secondUpgradeExact = $false; rollbackExact = $false; uninstalled = $false; failure = $null }
    try {
        $guiOption = if ($Mode -ceq 'gui-lifecycle') { @{ sourceRoot = 'C:\fixture\original-gui'; manifest = [byte[]]@(1) } } else { $null }
        $association = New-ProtectedInstallation 'C:\fixture\input' @{} 'AegisOp012345abcdef' 'fixture-credential-length-32-bytes' -Journal $journal -GuiBundle $guiOption
        $result.installed = $true; $result.originalExact = [object]::ReferenceEquals($association.stage, $global:FixtureHost.stages[0])
        if ($Mode -ceq 'gui-lifecycle') {
            $association.cleanupUnknown = $true; $blocked = $false
            try { Remove-ProtectedInstallation $association } catch { $blocked = $_.Exception.Message -ceq 'protected-owned-cleanup-unknown' }
            $result.unknownPreserved = $blocked -and !$script:FixtureGui.bundles[0].Removed -and $script:FixtureGui.principalCloses -eq 0 -and [ProtectedInstallService]::StopCalls -eq 0
            # Only this modeled administrative fixture represents verified original closure.
            $association.cleanupUnknown = $false
        }
        $first = Update-ProtectedInstallation $association 'C:\fixture\input' @{}
        $result.firstUpgradeExact = [object]::ReferenceEquals($association.stage, $first) -and [object]::ReferenceEquals($first, $global:FixtureHost.stages[1])
        $second = Update-ProtectedInstallation $association 'C:\fixture\input' @{}
        $result.secondUpgradeExact = [object]::ReferenceEquals($association.stage, $second) -and [object]::ReferenceEquals($second, $global:FixtureHost.stages[2])
        $fault = $false
        try { Update-ProtectedInstallation $association 'C:\fixture\input' @{} $true | Out-Null } catch { if ($_.Exception.Message -cne 'protected-qualified-upgrade-fault') { throw }; $fault = $true }
        $result.rollbackExact = $fault -and [object]::ReferenceEquals($association.stage, $second) -and $null -eq $association.rollback -and !$association.cleanupUnknown
        Remove-ProtectedInstallation $association
        $result.uninstalled = [ProtectedInstallService]::Absent() -and !$global:FixtureHost.exists -and @($global:FixtureHost.files | Where-Object { !$_.Deleted }).Count -eq 0
    } catch { $result.failure = $journal.failure; if ($null -eq $result.failure) { $result.failure = Get-ProtectedInstallFailure $_ 'qualification' } }
    $result.accountVerified = $global:FixtureHost.namedAccountQueries -gt 0; $result.memberAdditionComplete = $global:FixtureHost.member
    $result.addedReferenceExact = $global:FixtureHost.addedReferenceExact; $result.removedSidExact = $global:FixtureHost.removedSidExact
    $result.cleanup = $journal.cleanup
    if ($Mode -ceq 'gui-lifecycle') {
        $result.captures = $script:FixtureGui.captures; $result.sourceCloses = $script:FixtureGui.sourceCloses; $result.principalCloses = $script:FixtureGui.principalCloses
        $result.removed = @($script:FixtureGui.removed.ToArray()); $result.events = @($script:FixtureGui.events.ToArray())
        $result.allBundlesClosed = @($script:FixtureGui.bundles | Where-Object { !$_.Removed -or !$_.Disposed }).Count -eq 0
    }
    $result | ConvertTo-Json -Depth 6 -Compress
    return
}
if ($Mode -ceq 'membership-helper-lookup') {
    function Invoke-CallbackLookupFixture {
        # Deliberately load maintained helpers in this callback's local scope.
        # Imported LocalAccounts cmdlets are global in production; only those
        # leaf effects are global fakes here. Account/diagnostic helpers stay local.
        . (Join-Path $PSScriptRoot '../../../scripts/installation/protected-installation.ps1')
        $global:FixtureLookup = @{ exists = $false; member = $false; account = $null; addedReferenceExact = $false; removedSidExact = $false }
        function Assert-ProtectedInstallAdministrator { }
        function Initialize-ProtectedInstallNative { }
        function Read-ProtectedInstallInputs { param($SourceRoot, $Manifest); return @{ fixture = [byte[]]@(1,2,3) } }
        function Test-Path { param($LiteralPath); return $false }
        function New-ProtectedInstallDirectory { throw 'fixture-unexpected-parent-creation' }
        function global:ConvertTo-SecureString { param($String, [switch]$AsPlainText, [switch]$Force); return 'fixture-only-secure-value' }
        function global:Get-LocalUser {
            param($Name, $ErrorAction)
            if ($global:FixtureLookup.exists) { return $global:FixtureLookup.account }
        }
        function global:New-LocalUser {
            param($Name, $Password, [switch]$AccountNeverExpires, [switch]$PasswordNeverExpires, [switch]$UserMayNotChangePassword)
            $global:FixtureLookup.exists = $true
            $global:FixtureLookup.account = [pscustomobject]@{ Name = $Name; SID = [pscustomobject]@{ Value = 'S-1-5-21-100-200-300-1001' } }
            return $global:FixtureLookup.account
        }
        function global:Get-LocalGroupMember {
            param($SID)
            if ($SID -ceq 'S-1-5-32-545' -and $global:FixtureLookup.member) { return $global:FixtureLookup.account }
        }
        function global:Add-LocalGroupMember {
            param($SID, $Member)
            if ($SID -cne 'S-1-5-32-545' -or ![object]::ReferenceEquals($Member, $global:FixtureLookup.account)) { throw 'fixture-membership-association-refused' }
            $global:FixtureLookup.addedReferenceExact = $true; $global:FixtureLookup.member = $true
        }
        function global:Remove-LocalUser {
            param($SID)
            if (!$global:FixtureLookup.exists -or $SID.Value -cne $global:FixtureLookup.account.SID.Value) { throw 'fixture-account-removal-association-refused' }
            $global:FixtureLookup.removedSidExact = $true; $global:FixtureLookup.exists = $false
        }
        $journal = @{}; $refused = $false; $helperCommandMissing = $false
        try { New-ProtectedInstallation 'C:\fixture\input' @{} 'AegisOp012345abcdef' 'fixture-credential-length-32-bytes' $false $journal | Out-Null }
        catch {
            $refused = $true
            $helperCommandMissing = $_.Exception -is [Management.Automation.CommandNotFoundException] -and $_.Exception.CommandName -cin @('Assert-ProtectedInstallAccount', 'Set-ProtectedInstallFailure')
        }
        @{ refused = $refused; helperCommandMissing = $helperCommandMissing; failure = $journal.failure; cleanup = $journal.cleanup; createdRoots = $journal.createdRoots;
            service = $journal.service; memberAdditionComplete = $global:FixtureLookup.member; addedReferenceExact = $global:FixtureLookup.addedReferenceExact;
            removedSidExact = $global:FixtureLookup.removedSidExact; exactAccountAbsent = !$global:FixtureLookup.exists } | ConvertTo-Json -Depth 6 -Compress
    }
    Invoke-CallbackLookupFixture
    return
}
. (Join-Path $PSScriptRoot '../../../scripts/installation/protected-installation.ps1')
$script:FixtureProductionAssert = (Get-Command Assert-ProtectedInstallation).ScriptBlock
$script:FixtureProductionAccount = (Get-Command Assert-ProtectedInstallAccount).ScriptBlock
$script:FixtureProductionAncillary = (Get-Command Remove-ProtectedInstallAncillary).ScriptBlock
function Invoke-NestedFixture {
    $global:FixtureEvents = [Collections.Generic.List[string]]::new()
    $global:FixtureState = @{ account = $null; parent = $null; receipts = $null; stage = $null; root = $null; stageRemoved = $false; ancillaryRemoved = $false; stages = [Collections.Generic.List[object]]::new();
        issuedUpgradeStage = $null; issuedUpgradeRoot = $null; issuedUpgradeGuiBundle = $null }
    $global:FixtureMembership = @{ enabled = $Mode -clike 'membership-*'; accountExists = $false; memberExists = $Mode -ceq 'membership-existing'; accountObject = $null;
        usersCalls = 0; injected = $false; addCalls = 0; addedReferenceExact = $false; removedSidExact = $false; verified = $false }
    function script:Assert-ProtectedInstallAdministrator { }
    function script:Initialize-ProtectedInstallNative { }
    function script:Read-ProtectedInstallInputs { param($SourceRoot, $Manifest); return @{ fixture = [byte[]]@(1,2,3) } }
    function script:Test-Path { param($LiteralPath); return $false }
    function script:Join-Path { param([string]$Path, [string]$ChildPath); return $Path.TrimEnd('/','\') + '\' + $ChildPath.TrimStart('/','\') }
    function script:Get-LocalUser {
        param($Name, $ErrorAction)
        if (!$global:FixtureMembership.enabled -or !$global:FixtureMembership.accountExists) { return @() }
        if ($null -ne $Name -and $Mode -ceq 'membership-account-verify' -and !$global:FixtureMembership.injected) { $global:FixtureMembership.injected = $true; throw 'unsafe arbitrary account verification text' }
        return $global:FixtureMembership.accountObject
    }
    function script:ConvertTo-SecureString { param($String, [switch]$AsPlainText, [switch]$Force); return 'fixture-only-secure-value' }
    function script:New-LocalUser {
        param($Name, $Password, [switch]$AccountNeverExpires, [switch]$PasswordNeverExpires, [switch]$UserMayNotChangePassword)
        $global:FixtureEvents.Add('account-create')
        if ($Mode -ceq 'clean-refusal') { throw 'unsafe arbitrary fixture password text must never appear' }
        $account = [pscustomobject]@{ Name = $Name; SID = [pscustomobject]@{ Value = 'S-1-5-21-100-200-300-1001' } }
        if ($global:FixtureMembership.enabled) { $global:FixtureMembership.accountExists = $true; $global:FixtureMembership.accountObject = $account }
        return $account
    }
    function script:Get-LocalGroupMember {
        param($SID)
        if (!$global:FixtureMembership.enabled) { return @([pscustomobject]@{ SID = [pscustomobject]@{ Value = 'S-1-5-21-100-200-300-1001' } }) }
        if ($SID -ceq 'S-1-5-32-545') {
            $global:FixtureMembership.usersCalls++
            if (!$global:FixtureMembership.injected -and (($global:FixtureMembership.usersCalls -eq 1 -and $Mode -cin @('membership-users-query', 'membership-command-missing', 'membership-binding', 'membership-win32')) -or ($global:FixtureMembership.usersCalls -eq 2 -and $Mode -ceq 'membership-users-verify'))) {
                $global:FixtureMembership.injected = $true
                if ($Mode -ceq 'membership-command-missing') { throw [Management.Automation.CommandNotFoundException]::new('unsafe arbitrary missing command text') }
                if ($Mode -ceq 'membership-binding') { throw [Management.Automation.ParameterBindingException]::new('unsafe arbitrary parameter text') }
                if ($Mode -ceq 'membership-win32') { throw [ComponentModel.Win32Exception]::new(5, 'unsafe arbitrary native text') }
                throw 'unsafe arbitrary users query text'
            }
            if ($global:FixtureMembership.memberExists) { return $global:FixtureMembership.accountObject }
            return @()
        }
        if ($SID -ceq 'S-1-5-32-544') {
            if ($Mode -ceq 'membership-administrators-query' -and !$global:FixtureMembership.injected) { $global:FixtureMembership.injected = $true; throw 'unsafe arbitrary administrators query text' }
            return @()
        }
        throw 'fixture-group-association-refused'
    }
    function script:Add-LocalGroupMember {
        param($SID, $Member)
        if (!$global:FixtureMembership.enabled -or $SID -cne 'S-1-5-32-545' -or ![object]::ReferenceEquals($Member, $global:FixtureMembership.accountObject)) { throw 'fixture-membership-association-refused' }
        $global:FixtureMembership.addCalls++; $global:FixtureMembership.addedReferenceExact = $true
        if ($Mode -ceq 'membership-users-add' -and !$global:FixtureMembership.injected) { $global:FixtureMembership.injected = $true; throw 'unsafe arbitrary add member text' }
        $global:FixtureMembership.memberExists = $true
    }
    function script:Remove-LocalUser {
        param($SID)
        if (!$global:FixtureMembership.enabled -or !$global:FixtureMembership.accountExists -or $SID.Value -cne $global:FixtureMembership.accountObject.SID.Value) { throw 'fixture-account-removal-association-refused' }
        $global:FixtureMembership.removedSidExact = $true; $global:FixtureMembership.accountExists = $false
    }
    function script:Assert-ProtectedInstallAccount {
        param($Context, [bool]$RequireUsers = $true, $Journal)
        if ($global:FixtureMembership.enabled) { & $script:FixtureProductionAccount $Context $RequireUsers $Journal; return }
        $global:FixtureState.account = $Context
    }
    function script:Set-ProtectedInstallCredential { param($Context); $Context.credential = [byte[]]@(4,5,6) }
    function script:New-ProtectedInstallJournalDirectory {
        param($Context)
        $Context.journalDirectory = [ProtectedInstallFile]::new('C:\fixture\OperationJournal', $true, $true)
        $Context.journalFiles = @(); $Context.journalEvidence = @()
    }
    function script:New-ProtectedInstallDirectory {
        param($Path, $OperatorSid, $Private)
        # Membership success stops before any file effect; cleanup uses the real
        # account verifier/remover with finite leaf fakes and the exact created SID.
        if ($global:FixtureMembership.enabled) { $global:FixtureMembership.verified = $true; throw 'unsafe intentional stop after membership verification' }
        $held = [ProtectedInstallFile]::new($Path, $true, $true)
        if ($null -eq $global:FixtureState.parent) { $global:FixtureState.parent = $held } else { $global:FixtureState.receipts = $held }
        return $held
    }
    function script:New-ProtectedInstallStage {
        param($Context, $Revision, $Epoch)
        $held = [ProtectedInstallFile]::new('C:\fixture\stage', $true, $true)
        $stage = @{ root = $held; path = $held.PathName; revision = $Revision; epoch = $Epoch; published = $false }
        if ($Mode -ceq 'upgrade-handoff-unknown' -and $Revision -gt 1) {
            # Capture the exact object at issuance; the global list/count is not
            # the administrative owner whose retention this control requires.
            $bundle = [pscustomobject]@{ Root = $held; Original = $true }
            $stage.gui = @{ bundle = $bundle }
            $global:FixtureState.issuedUpgradeStage = $stage
            $global:FixtureState.issuedUpgradeRoot = $held
            $global:FixtureState.issuedUpgradeGuiBundle = $bundle
        }
        $global:FixtureState.stage = $stage; $global:FixtureState.root = $held
        $global:FixtureState.stages.Add($stage)
        if ($Mode -ceq 'null-upgrade' -and $Revision -gt 1) { return $null }
        if ($Mode -ceq 'noisy-stage' -or ($Mode -ceq 'noisy-upgrade' -and $Revision -gt 1)) { 'unowned-extra-output' }
        return $stage
    }
    function script:Move-ProtectedInstallStage {
        param($Stage, $Destination)
        if (@($global:FixtureState.stages | Where-Object { [object]::ReferenceEquals($_, $Stage) }).Count -ne 1) { throw 'fixture-stage-reference-refused' }
        $Stage.path = $Destination; $global:FixtureEvents.Add('publish')
        if ($Mode -ceq 'upgrade-handoff-unknown') {
            # The original owned handle already moved; the native postcheck is
            # uncertain. Do not model a pre-effect refusal or allow recovery.
            $Stage.root.PathName = $Destination
            $failure = [IO.InvalidDataException]::new('protected-file-handoff-cleanup-unknown')
            $failure.Data['protectedCleanupUnknown'] = $true
            throw $failure
        }
    }
    function script:Assert-ProtectedInstallation {
        param($Association)
        # Preserve the maintained terminal-state guard for the retry regression.
        if ($Association.cleanupUnknown) { & $script:FixtureProductionAssert $Association; return }
        if ($Association.stage -isnot [hashtable]) { throw 'fixture-context-stage-type-refused' }
    }
    function script:Assert-ProtectedInstallStage { param($Stage); if ($Stage -isnot [hashtable]) { throw 'fixture-stage-type-refused' } }
    function script:Remove-ProtectedInstallStage {
        param($Stage, $Published)
        if (@($global:FixtureState.stages | Where-Object { [object]::ReferenceEquals($_, $Stage) }).Count -ne 1) { throw 'fixture-stage-reference-refused' }
        $global:FixtureEvents.Add('remove-stage')
        if ($Mode -ceq 'unknown-partial') { throw 'unsafe cleanup exception text must never appear' }
        $global:FixtureState.stageRemoved = $true
    }
    function script:Remove-ProtectedInstallAncillary {
        param($Context)
        if ($global:FixtureMembership.enabled) { & $script:FixtureProductionAncillary $Context; $global:FixtureState.ancillaryRemoved = $true; return }
        if ($null -ne $global:FixtureState.account -and ![object]::ReferenceEquals($global:FixtureState.account, $Context)) { throw 'fixture-context-reference-refused' }
        if ($null -ne $global:FixtureState.parent -and ![object]::ReferenceEquals($global:FixtureState.parent, $Context.parent)) { throw 'fixture-parent-reference-refused' }
        $global:FixtureEvents.Add('remove-ancillary'); $global:FixtureState.ancillaryRemoved = $true
        $Context.operatorSid = $null; $Context.parent = $null; $Context.receipts = $null; $Context.password = $null
    }
    if ($Mode -cin @('upgrade-reference', 'upgrade-handoff-unknown', 'noisy-upgrade', 'null-upgrade')) {
        $original = New-ProtectedInstallStage @{} 1 'original'
        $association = @{ stage = $original; service = [ProtectedInstallService]::new(); manifest = @{}; inputs = @{}; cleanupUnknown = $false; rollback = $null }
        if ($Mode -ceq 'upgrade-handoff-unknown') {
            $firstFailure = $null; $retryGuarded = $false; $uninstallGuarded = $false
            try { Update-ProtectedInstallation $association 'C:\fixture\input' @{} | Out-Null }
            catch { $firstFailure = if ($_.Exception.Message -ceq 'protected-upgrade-handoff-cleanup-unknown') { $_.Exception.Message } else { 'unclassified' } }
            $eventsAfterFailure = $global:FixtureEvents.ToArray()
            try { Update-ProtectedInstallation $association 'C:\fixture\input' @{} | Out-Null }
            catch { $retryGuarded = $_.Exception.Message -ceq 'protected-owned-cleanup-unknown' }
            try { Remove-ProtectedInstallation $association }
            catch { $uninstallGuarded = $_.Exception.Message -ceq 'protected-owned-cleanup-unknown' }
            @{ firstFailure = $firstFailure; retryGuarded = $retryGuarded; uninstallGuarded = $uninstallGuarded; cleanupUnknown = $association.cleanupUnknown;
                originalExact = [object]::ReferenceEquals($association.stage, $original); postEffectPathRecorded = $original.path -ceq $original.root.PathName;
                failedStageExact = ($association.ContainsKey('failedStage') -and [object]::ReferenceEquals($association.failedStage, $global:FixtureState.issuedUpgradeStage));
                failedRootExact = ($association.ContainsKey('failedStage') -and $null -ne $association.failedStage -and [object]::ReferenceEquals($association.failedStage.root, $global:FixtureState.issuedUpgradeRoot));
                failedGuiBundleExact = ($association.ContainsKey('failedStage') -and $null -ne $association.failedStage -and [object]::ReferenceEquals($association.failedStage.gui.bundle, $global:FixtureState.issuedUpgradeGuiBundle));
                stageCount = $global:FixtureState.stages.Count; stopCalls = [ProtectedInstallService]::StopCalls; eventsAfterFailure = $eventsAfterFailure;
                eventsAfterReuse = $global:FixtureEvents.ToArray(); stageRemoved = $global:FixtureState.stageRemoved; ancillaryRemoved = $global:FixtureState.ancillaryRemoved } | ConvertTo-Json -Compress
            return
        }
        if ($Mode -cin @('noisy-upgrade', 'null-upgrade')) {
            $firstRefused = $false; $retryRefused = $false
            try { Update-ProtectedInstallation $association 'C:\fixture\input' @{} | Out-Null } catch { $firstRefused = $true }
            try { Update-ProtectedInstallation $association 'C:\fixture\input' @{} | Out-Null } catch { $retryRefused = $true }
            @{ firstRefused = $firstRefused; retryRefused = $retryRefused; cleanupUnknown = $association.cleanupUnknown;
                originalExact = [object]::ReferenceEquals($association.stage, $original); stageCount = $global:FixtureState.stages.Count;
                stopCalls = [ProtectedInstallService]::StopCalls; events = $global:FixtureEvents.ToArray() } | ConvertTo-Json -Compress
            return
        }
        $first = Update-ProtectedInstallation $association 'C:\fixture\input' @{}
        $firstExact = [object]::ReferenceEquals($association.stage, $first) -and [object]::ReferenceEquals($global:FixtureState.stage, $first)
        $second = Update-ProtectedInstallation $association 'C:\fixture\input' @{}
        $secondExact = [object]::ReferenceEquals($association.stage, $second) -and [object]::ReferenceEquals($global:FixtureState.stage, $second)
        $rollbackRefused = $false
        try { Update-ProtectedInstallation $association 'C:\fixture\input' @{} $true | Out-Null } catch { $rollbackRefused = $true }
        @{ firstExact = $firstExact; secondExact = $secondExact; rollbackRefused = $rollbackRefused; rollbackExact = [object]::ReferenceEquals($association.stage, $second); cleanupUnknown = $association.cleanupUnknown; stageType = $association.stage.GetType().Name; path = $association.stage.path } | ConvertTo-Json -Compress
        return
    }
    $journal = @{}; $refused = $false
    try { New-ProtectedInstallation 'C:\fixture\input' @{} 'AegisOp012345abcdef' 'fixture-credential-length-32-bytes' ($Mode -cne 'native-refusal') $journal | Out-Null }
    catch { $refused = $true }
    $safe = @{ refused = $refused; events = $global:FixtureEvents.ToArray(); stageRemoved = $global:FixtureState.stageRemoved; ancillaryRemoved = $global:FixtureState.ancillaryRemoved;
        cleanup = $journal['cleanup']; failure = $journal['failure']; createdSid = $journal['createdSid']; createdRoots = $journal['createdRoots'] }
    if ($global:FixtureMembership.enabled) {
        $safe.membership = @{ verified = $global:FixtureMembership.verified; addCalls = $global:FixtureMembership.addCalls;
            addedReferenceExact = $global:FixtureMembership.addedReferenceExact; removedSidExact = $global:FixtureMembership.removedSidExact; exactAccountAbsent = !$global:FixtureMembership.accountExists }
        $safe.service = $journal.service
    }
    $safe | ConvertTo-Json -Depth 8 -Compress
}
Invoke-NestedFixture
