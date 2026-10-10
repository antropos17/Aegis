param([ValidateSet('clean-partial', 'unknown-partial', 'clean-refusal', 'native-refusal', 'upgrade-reference', 'noisy-upgrade', 'null-upgrade', 'noisy-stage', 'phase-clean', 'phase-unknown')][string]$Mode)
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
. (Join-Path $PSScriptRoot '../../../scripts/qualification/installed-owner-phase.ps1')
$script:FixtureProductionAssert = (Get-Command Assert-ProtectedInstallation).ScriptBlock
function Invoke-NestedFixture {
    $global:FixtureEvents = [Collections.Generic.List[string]]::new()
    $global:FixtureState = @{ account = $null; parent = $null; receipts = $null; stage = $null; root = $null; stageRemoved = $false; ancillaryRemoved = $false; stages = [Collections.Generic.List[object]]::new() }
    function script:Assert-ProtectedInstallAdministrator { }
    function script:Initialize-ProtectedInstallNative { }
    function script:Read-ProtectedInstallInputs { param($SourceRoot, $Manifest); return @{ fixture = [byte[]]@(1,2,3) } }
    function script:Test-Path { param($LiteralPath); return $false }
    function script:Join-Path { param([string]$Path, [string]$ChildPath); return $Path.TrimEnd('/','\') + '\' + $ChildPath.TrimStart('/','\') }
    function script:Get-LocalUser { return @() }
    function script:ConvertTo-SecureString { param($String, [switch]$AsPlainText, [switch]$Force); return 'fixture-only-secure-value' }
    function script:New-LocalUser {
        param($Name, $Password, [switch]$AccountNeverExpires, [switch]$PasswordNeverExpires, [switch]$UserMayNotChangePassword)
        $global:FixtureEvents.Add('account-create')
        if ($Mode -ceq 'clean-refusal') { throw 'unsafe arbitrary fixture password text must never appear' }
        return [pscustomobject]@{ SID = [pscustomobject]@{ Value = 'S-1-5-21-100-200-300-1001' } }
    }
    function script:Get-LocalGroupMember { param($SID); return @([pscustomobject]@{ SID = [pscustomobject]@{ Value = 'S-1-5-21-100-200-300-1001' } }) }
    function script:Assert-ProtectedInstallAccount { param($Context, $RequireUsers); $global:FixtureState.account = $Context }
    function script:Set-ProtectedInstallCredential { param($Context); $Context.credential = [byte[]]@(4,5,6) }
    function script:New-ProtectedInstallDirectory {
        param($Path, $OperatorSid, $Private)
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
    $safe | ConvertTo-Json -Depth 8 -Compress
}
Invoke-NestedFixture
