param([ValidateSet('clean-partial', 'unknown-partial', 'clean-refusal', 'native-refusal', 'upgrade-reference', 'upgrade-handoff-unknown', 'noisy-upgrade', 'null-upgrade', 'noisy-stage', 'phase-clean', 'phase-unknown', 'membership-users-query', 'membership-users-add', 'membership-account-verify', 'membership-administrators-query', 'membership-users-verify', 'membership-existing', 'membership-add', 'membership-command-missing', 'membership-binding', 'membership-win32', 'membership-helper-lookup', 'host-script-scope', 'host-script-child', 'attempt-status', 'attempt-native', 'attempt-missing-result', 'attempt-scope-array', 'attempt-dictionary', 'attempt-failure-frame')][string]$Mode, [string]$FailureFrameReceipt)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
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
if ($Mode -ceq 'host-script-child') {
    # The workflow calls the lab as a child script from its step script. Load
    # maintained functions here in that child script's scope, never globally.
    . (Join-Path $PSScriptRoot '../../../scripts/qualification/installed-owner-phase.ps1')
    $global:FixtureHost = @{ account = $null; exists = $false; member = $false; addedReferenceExact = $false; removedSidExact = $false; namedAccountQueries = 0;
        files = [Collections.Generic.List[object]]::new(); stages = [Collections.Generic.List[object]]::new() }
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
    function New-ProtectedInstallStage {
        param($Context, $Revision, $Epoch)
        $held = New-ProtectedInstallDirectory (Join-Path $script:ProtectedInstallParent ('Staging-' + $Epoch)) $Context.operatorSid
        $stage = @{ root = $held; path = $held.PathName; revision = $Revision; epoch = $Epoch; published = $false; rows = @() }
        $global:FixtureHost.stages.Add($stage); return $stage
    }
    function Assert-ProtectedInstallStage {
        param($Stage)
        if (@($global:FixtureHost.stages | Where-Object { [object]::ReferenceEquals($_, $Stage) }).Count -ne 1 -or $Stage.root.Deleted -or $Stage.path -cne $Stage.root.PathName) { throw 'fixture-stage-reference-refused' }
    }
    function Update-ProtectedInstallRuntimeRows { param($Stage); Assert-ProtectedInstallStage $Stage }
    function Move-ProtectedInstallStage {
        param($Stage, $Destination)
        Assert-ProtectedInstallStage $Stage; $Stage.path = $Destination; $Stage.root.PathName = $Destination
    }
    function Remove-ProtectedInstallStage { param($Stage, $Published); Assert-ProtectedInstallStage $Stage; $Stage.root.Delete() }
    [ProtectedInstallService]::CreateSucceeds = $true
    $journal = @{}; $result = @{ installed = $false; originalExact = $false; firstUpgradeExact = $false; secondUpgradeExact = $false; rollbackExact = $false; uninstalled = $false; failure = $null }
    try {
        $association = New-ProtectedInstallation 'C:\fixture\input' @{} 'AegisOp012345abcdef' 'fixture-credential-length-32-bytes' $false $journal
        $result.installed = $true; $result.originalExact = [object]::ReferenceEquals($association.stage, $global:FixtureHost.stages[0])
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
    $result | ConvertTo-Json -Depth 6 -Compress
    return
}
if ($Mode -ceq 'membership-helper-lookup') {
    function Invoke-CallbackLookupFixture {
        # Deliberately load maintained helpers in this callback's local scope.
        # Imported LocalAccounts cmdlets are global in production; only those
        # leaf effects are global fakes here. Account/diagnostic helpers stay local.
        . (Join-Path $PSScriptRoot '../../../scripts/qualification/installed-owner-phase.ps1')
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
. (Join-Path $PSScriptRoot '../../../scripts/qualification/installed-owner-phase.ps1')
if ($Mode -ceq 'attempt-dictionary') {
    # Match the maintained SCM association's real Dictionary<string,object> type.
    # Every attempt has a fresh fake service/association and its own receipt;
    # only the maintained attempt's existing closure checks may clear its latch.
    if (![IO.Path]::IsPathRooted($env:TEMP)) { throw 'fixture-temp-scope-refused' }
    $script:DictionaryScratch = [IO.Path]::Combine($env:TEMP, 'attempt-' + [guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($script:DictionaryScratch) | Out-Null
    $script:DictionaryReceipts = [Collections.Generic.List[string]]::new()
    function Assert-ProtectedInstallation { param($Association); if ($Association.cleanupUnknown) { throw 'protected-owned-cleanup-unknown' } }
    function Test-Path { param($LiteralPath); if ([IO.Path]::GetDirectoryName($LiteralPath) -cne $script:DictionaryScratch) { throw 'fixture-receipt-path-refused' }; return [IO.File]::Exists($LiteralPath) }
    function Read-ProtectedInstallSnapshot { param($Path, $Directory); return @{ volume = '00000001'; fileId = '0000000000000001' } }
    function Update-ProtectedInstallRuntimeRows { param($Stage) }
    function Invoke-DictionaryAttemptFixture([ValidateSet('success', 'status', 'report')][string]$Scenario) {
        $service = [pscustomobject]@{ ObservedOwner = $null; statusCalls = 0; stopCalls = 0; deleteCalls = 0; scenario = $Scenario; resultPath = $null; native = $null }
        $service | Add-Member ScriptMethod Start {
            $this.ObservedOwner = [Collections.Generic.Dictionary[string,object]]::new()
            $fields = @{ pid = [uint32]10; birthFileTime = [long]1; sid = 'S-1-5-18'; authentication = '0000000000000001'; session = [uint32]0;
                exactProcessExited = $false; image = 'private-image'; unexpected = 'unsafe arbitrary observation' }
            foreach ($field in $fields.Keys) { $this.ObservedOwner.Add($field, $fields[$field]) }
            $script:DictionaryReceipts.Add($this.resultPath)
            [IO.File]::WriteAllText($this.resultPath, ($this.native | ConvertTo-Json -Depth 5))
        }
        $service | Add-Member ScriptMethod Status {
            $this.statusCalls++
            if ($this.scenario -ceq 'status' -and $this.statusCalls -eq 2) { throw [Management.Automation.CommandNotFoundException]::new('unsafe arbitrary command and credential text') }
            if ($this.statusCalls -eq 1) { return [uint32[]]@(4, 10) }; return [uint32[]]@(1, 0)
        }
        $service | Add-Member ScriptMethod WaitExited { $this.ObservedOwner['exactProcessExited'] = $true }
        $service | Add-Member ScriptMethod Stop { $this.stopCalls++ }
        $service | Add-Member ScriptMethod Delete { $this.deleteCalls++ }
        $service | Add-Member ScriptMethod Configuration {
            if ($this.scenario -ceq 'report') { throw [Management.Automation.ParameterBindingException]::new('unsafe arbitrary report and credential text') }
            return @{ serviceType = 16 }
        }
        $service | Add-Member ScriptMethod Security { return 'fixture-service-security' }
        $epoch = $(if ($Scenario -ceq 'success') { 'b' } elseif ($Scenario -ceq 'status') { 'c' } else { 'd' }) * 32
        $association = @{ cleanupUnknown = $false; service = $service; operatorSid = 'S-1-5-21-1-2-3-1001'; installId = 'a' * 32;
            stage = @{ epoch = $epoch; revision = 1; root = @{ PathName = 'private-root' }; rows = @() }; receipts = @{ PathName = $script:DictionaryScratch };
            attemptedReceiptPaths = @(); receiptRows = @(); manifest = @{ files = @('aegis-owner.exe', 'aegis-session.exe', 'aegis-main.exe' | ForEach-Object { @{ name = $_; sha256 = 'a' * 64 } }) } }
        $service.resultPath = (Get-InstalledOwnerReceiptPaths $association).result
        $service.native = @{ schemaVersion = 1; scope = 'installed-owner-inspection'; phase = 'await-completion'; supervisorStage = 0;
            cleanupConfirmed = $true; ownedJobsEmpty = $true; nativeProducerReady = $true; bootstrapWriteCompleted = $true; bootstrapEofClosed = $true;
            supervisorReleased = $true; mainReleased = $false; supervisorExitCode = 2; supervisorPid = 11; mainPid = 12;
            inspected = $false; inspectionCount = 0; launchAllowed = $false; completeE1 = $false;
            ownerSid = 'S-1-5-18'; ownerAuthentication = '0000000000000001'; ownerSession = 0; ownerBirth = '0000000000000001'; installId = 'a' * 32; epoch = $epoch; revision = 1;
            ownerImageSha256 = 'a' * 64; supervisorImageSha256 = 'a' * 64; mainImageSha256 = 'a' * 64 }
        $attempt = $null; $failure = $null
        try { $attempt = Invoke-InstalledOwnerAttempt $association $false }
        catch { $failure = Get-ProtectedInstallFailure $_ $association.attemptDiagnostic.checkpoint }
        return @{ passed = $null -ne $attempt -and $attempt.passed; cleanupUnknown = $association.cleanupUnknown;
            ownerIsGenericDictionary = $service.ObservedOwner -is [Collections.Generic.Dictionary[string,object]];
            ownerReferenceExact = $null -ne $attempt -and [object]::ReferenceEquals($attempt.independentlyObservedOwner, $service.ObservedOwner);
            checkpoint = $association.attemptDiagnostic.checkpoint; diagnostic = $association.attemptDiagnostic; thrownFailure = $failure;
            stopCalls = $service.stopCalls; deleteCalls = $service.deleteCalls }
    }
    try { $result = @{ success = Invoke-DictionaryAttemptFixture 'success'; status = Invoke-DictionaryAttemptFixture 'status'; report = Invoke-DictionaryAttemptFixture 'report' } }
    finally {
        foreach ($receipt in $script:DictionaryReceipts) { if ([IO.File]::Exists($receipt)) { [IO.File]::Delete($receipt) } }
        [IO.Directory]::Delete($script:DictionaryScratch, $false)
    }
    $result | ConvertTo-Json -Depth 10 -Compress
    return
}
if ($Mode -cin @('attempt-status', 'attempt-native', 'attempt-missing-result', 'attempt-scope-array', 'attempt-failure-frame')) {
    # Run the maintained qualification wrapper and attempt in this child script.
    # Only OS/resource leaves are faked; native receipt mode writes one bounded
    # modeled JSON file in this process's X: TEMP and removes that exact file.
    $script:AttemptScratch = $null
    if ($Mode -cne 'attempt-status') {
        if (![IO.Path]::IsPathRooted($env:TEMP)) { throw 'fixture-temp-scope-refused' }
        $script:AttemptScratch = [IO.Path]::Combine($env:TEMP, 'attempt-' + [guid]::NewGuid().ToString('N')); [IO.Directory]::CreateDirectory($script:AttemptScratch) | Out-Null
    }
    $script:AttemptService = [pscustomobject]@{ ObservedOwner = $null; statusCalls = 0; stopCalls = 0; deleteCalls = 0; mode = $Mode; resultPath = $null; native = $null }
    $script:AttemptService | Add-Member ScriptMethod Start {
        $this.ObservedOwner = @{ pid = [uint32]10; birthFileTime = [long]1; sid = 'S-1-5-18'; authentication = '0000000000000001'; session = [uint32]0; exactProcessExited = $false; image = 'private-image'; unexpected = 'unsafe arbitrary observation' }
        if ($null -ne $this.native) { [IO.File]::WriteAllText($this.resultPath, ($this.native | ConvertTo-Json -Depth 5)) }
    }
    $script:AttemptService | Add-Member ScriptMethod Status {
        $this.statusCalls++
        if ($this.mode -ceq 'attempt-status' -and $this.statusCalls -eq 2) { throw [Management.Automation.CommandNotFoundException]::new('unsafe arbitrary command and credential text') }
        if ($this.mode -ceq 'attempt-status' -and $this.statusCalls -eq 1) { return [uint32[]]@(4, 10) }; return [uint32[]]@(1, 0)
    }
    $script:AttemptService | Add-Member ScriptMethod WaitExited { if ($null -ne $this.ObservedOwner) { $this.ObservedOwner.exactProcessExited = $true } }
    $script:AttemptService | Add-Member ScriptMethod Stop { $this.stopCalls++ }
    $script:AttemptService | Add-Member ScriptMethod Delete { $this.deleteCalls++ }
    $script:AttemptAssociation = @{ cleanupUnknown = $false; service = $script:AttemptService; operatorSid = 'S-1-5-21-1-2-3-1001';
        installId = 'a' * 32; stage = @{ epoch = 'b' * 32; revision = 1 }; receipts = @{ PathName = 'C:\fixture\private-result' }; attemptedReceiptPaths = @(); receiptRows = @(); rollback = $null }
    if ($null -ne $script:AttemptScratch) {
        $script:AttemptAssociation.receipts.PathName = $script:AttemptScratch
        $script:AttemptService.resultPath = (Get-InstalledOwnerReceiptPaths $script:AttemptAssociation).result
        $script:AttemptService.native = @{ schemaVersion = 1; scope = 'installed-owner-inspection'; phase = 'await-result'; supervisorStage = 3;
            cleanupConfirmed = $false; ownedJobsEmpty = $false; nativeProducerReady = $true; bootstrapWriteCompleted = $true; bootstrapEofClosed = $true;
            supervisorReleased = $true; mainReleased = $false; supervisorExitCode = 2; inspected = $false; inspectionCount = 0; launchAllowed = $false; completeE1 = $false;
            ownerSid = 'S-1-5-18'; ownerAuthentication = '0000000000000001'; ownerSession = 0; ownerBirth = '0000000000000001'; installId = 'a' * 32; epoch = 'b' * 32; revision = 1;
            inspection = 'unsafe arbitrary receipt content'; path = 'private-result'; password = 'fixture-credential' }
        if ($Mode -ceq 'attempt-missing-result') { $script:AttemptService.native = $null }
        if ($Mode -ceq 'attempt-scope-array') {
            $script:AttemptService.native.scope = @('installed-owner-inspection', 'unsafe arbitrary scope content')
            $script:AttemptService.native.phase = @('await-result', 'unsafe arbitrary phase content')
        }
        if ($Mode -ceq 'attempt-failure-frame') {
            # Consume the actual native private-pipe parser's observed row. The
            # legacy parser reports zero; the fixture never manufactures eight.
            $full = [IO.Path]::GetFullPath($FailureFrameReceipt)
            $prefix = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
            $file = Get-Item -LiteralPath $full -Force
            if (!$full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or $file.Length -gt 16KB -or
                ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'fixture-failure-frame-receipt-refused' }
            $script:FailureFrame = [IO.File]::ReadAllText($full) | ConvertFrom-Json
            if ($script:FailureFrame.parsed.accepted -isnot [bool] -or !$script:FailureFrame.parsed.accepted -or
                $script:FailureFrame.parsed.stage -ne 2 -or $script:FailureFrame.parsed.substage -lt 0 -or $script:FailureFrame.parsed.substage -gt 13) { throw 'fixture-failure-frame-row-refused' }
            $script:AttemptService.native.supervisorStage = $script:FailureFrame.parsed.stage
            $script:AttemptService.native.supervisorSubstage = $script:FailureFrame.parsed.substage
        }
    }
    function Assert-ProtectedInstallAdministrator { }
    function Initialize-ProtectedInstallNative { }
    function Assert-ProtectedInstallation { param($Association); if ($Association.cleanupUnknown) { throw 'protected-owned-cleanup-unknown' } }
    function Get-CimInstance { param($ClassName, $OperationTimeoutSec); return @{ Caption = 'Windows fixture'; BuildNumber = '26000'; Version = '10.0'; OSArchitecture = '64-bit' } }
    function Test-InstalledOwnerPayload { param($PayloadRoot, $SourceSha); return @{ files = @() } }
    function Get-InstalledOwnerBinaryManifest { param($Payload, $Baseline); return @{} }
    function Test-Path { param($LiteralPath); if ($null -ne $script:AttemptScratch -and [IO.Path]::GetDirectoryName($LiteralPath) -ceq $script:AttemptScratch) { return [IO.File]::Exists($LiteralPath) }; return $false }
    function Join-Path { param([string]$Path, [string]$ChildPath); return $Path.TrimEnd('/','\') + '\' + $ChildPath.TrimStart('/','\') }
    function Get-ChildItem { param($LiteralPath, [switch]$Force); return @() }
    function New-Item { param($ItemType, $Path) }
    function Copy-Item { param($LiteralPath, $Destination) }
    function Read-ProtectedInstallSnapshot { param($Path, $Directory); return @{ path = $Path; volume = '00000001'; fileId = '0000000000000001' } }
    function Update-ProtectedInstallRuntimeRows { param($Stage) }
    function New-ProtectedInstallation {
        param($SourceRoot, $Manifest, $Account, $Password, $FailAfterPublish, $Journal)
        $Journal.operation = 'verify'; $Journal.failure = $null; $Journal.createdSid = $script:AttemptAssociation.operatorSid
        $Journal.createdRoots = @(); $Journal.service = @{ creationAttempted = $true; created = $true }; $Journal.published = $true; $Journal.cleanup = @{ state = 'pending' }
        return $script:AttemptAssociation
    }
    $env:GITHUB_ACTIONS = 'true'; $env:RUNNER_ENVIRONMENT = 'github-hosted'; $env:GITHUB_RUN_ID = 'fixture'; $env:GITHUB_RUN_ATTEMPT = '1'
    try { $report = Invoke-InstalledOwnerQualification 'C:\fixture\payload' 'D:\aegis-cloud-guest-fixture-1\installed-owner-control' ('a' * 40) 'fresh-host' }
    finally {
        if ($null -ne $script:AttemptScratch) {
            if ([IO.File]::Exists($script:AttemptService.resultPath)) { [IO.File]::Delete($script:AttemptService.resultPath) }
            [IO.Directory]::Delete($script:AttemptScratch, $false)
        }
    }
    $report.fixture = @{ cleanupUnknown = $script:AttemptAssociation.cleanupUnknown; stopCalls = $script:AttemptService.stopCalls; deleteCalls = $script:AttemptService.deleteCalls }
    if ($Mode -ceq 'attempt-failure-frame' -or $Mode -ceq 'attempt-native') {
        $rows = [Collections.Generic.List[object]]::new()
        foreach ($number in 0..13) { $rows.Add(@{ expected = $true; value = $number; observation = Get-InstalledOwnerAttemptObservation @{ supervisorStage = 2; supervisorSubstage = $number } 'native' }) }
        foreach ($value in @(-1, 14, '8', 8.5, $true, @('8', 'unsafe substage content'), $null, @(8), @('8'), @($true))) {
            $rows.Add(@{ expected = $false; observation = Get-InstalledOwnerAttemptObservation @{ supervisorStage = 2; supervisorSubstage = $value } 'native' })
        }
        foreach ($stage in @(0, 1, 3, '2', 2.5, @('2', 'unsafe stage content'), @(2))) {
            $rows.Add(@{ expected = $false; observation = Get-InstalledOwnerAttemptObservation @{ supervisorStage = $stage; supervisorSubstage = 8 } 'native' })
        }
        $rows.Add(@{ expected = $false; observation = Get-InstalledOwnerAttemptObservation @{ supervisorStage = 2 } 'native' })
        $rows.Add(@{ expected = $false; observation = Get-InstalledOwnerAttemptObservation @{ supervisorStage = 3; supervisorSubstage = 0 } 'native' })
        $report.fixture.projectionRows = $rows.ToArray()
    }
    if ($Mode -ceq 'attempt-failure-frame') { $report.fixture.genuinelyParsed = $script:FailureFrame.parsed }
    $report | ConvertTo-Json -Depth 20 -Compress
    return
}
$script:FixtureProductionAssert = (Get-Command Assert-ProtectedInstallation).ScriptBlock
$script:FixtureProductionAccount = (Get-Command Assert-ProtectedInstallAccount).ScriptBlock
$script:FixtureProductionAncillary = (Get-Command Remove-ProtectedInstallAncillary).ScriptBlock
function Invoke-NestedFixture {
    $global:FixtureEvents = [Collections.Generic.List[string]]::new()
    $global:FixtureState = @{ account = $null; parent = $null; receipts = $null; stage = $null; root = $null; stageRemoved = $false; ancillaryRemoved = $false; stages = [Collections.Generic.List[object]]::new() }
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
    if ($Mode -cin @('phase-clean', 'phase-unknown')) {
        function script:Get-CimInstance { param($ClassName, $OperationTimeoutSec); return [pscustomobject]@{ Caption = 'Windows fixture'; BuildNumber = '26000'; Version = '10.0'; OSArchitecture = '64-bit' } }
        function script:Test-InstalledOwnerPayload { param($PayloadRoot, $SourceSha); return @{ files = @() } }
        function script:Get-InstalledOwnerBinaryManifest { param($Payload, $Baseline); $global:FixtureEvents.Add('manifest'); return @{} }
        function script:New-Item { param($ItemType, $Path); $global:FixtureEvents.Add('new-item') }
        function script:Copy-Item { param($LiteralPath, $Destination); $global:FixtureEvents.Add('copy-item') }
        $env:GITHUB_ACTIONS = 'true'; $env:RUNNER_ENVIRONMENT = 'github-hosted'; $env:GITHUB_RUN_ID = 'fixture'; $env:GITHUB_RUN_ATTEMPT = '1'
        [ProtectedInstallService]::CleanupUnknown = $Mode -ceq 'phase-unknown'
        $report = Invoke-InstalledOwnerQualification 'C:\fixture\payload' 'D:\aegis-cloud-guest-fixture-1\installed-owner-control' ('a' * 40) 'fresh-host'
        $report.fixtureEvents = $global:FixtureEvents.ToArray()
        $report | ConvertTo-Json -Depth 20 -Compress
        return
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
