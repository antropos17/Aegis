param([ValidateSet('clean-partial', 'unknown-partial', 'clean-refusal', 'native-refusal', 'upgrade-reference', 'noisy-upgrade', 'null-upgrade', 'noisy-stage', 'phase-clean', 'phase-unknown', 'membership-users-query', 'membership-users-add', 'membership-account-verify', 'membership-administrators-query', 'membership-users-verify', 'membership-existing', 'membership-add', 'membership-command-missing', 'membership-binding', 'membership-win32', 'membership-helper-lookup')][string]$Mode)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
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
}
public sealed class ProtectedInstallService {
    public const string Name = "AegisProtectedSessionOwner";
    public const string Image = "\"C:\\ProgramData\\AEGIS\\ProtectedSession\\aegis-owner.exe\"";
    public static bool Absent() { return true; }
    public static bool CleanupUnknown;
    public uint[] Status() { return new uint[] { 1, 0 }; }
    public void WaitExited() { }
    public static int StopCalls;
    public void Stop() { StopCalls++; }
    public void Recheck() { }
    public static ProtectedInstallService Create() {
        var failure = new InvalidDataException("protected-service-create-refused");
        failure.Data["protectedOperation"] = "service-create";
        failure.Data["protectedNativeWin32"] = 5;
        if (CleanupUnknown) failure.Data["protectedCleanupUnknown"] = true;
        throw failure;
    }
}
'@
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
    if ($Mode -cin @('upgrade-reference', 'noisy-upgrade', 'null-upgrade')) {
        $original = New-ProtectedInstallStage @{} 1 'original'
        $association = @{ stage = $original; service = [ProtectedInstallService]::new(); manifest = @{}; inputs = @{}; cleanupUnknown = $false; rollback = $null }
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
