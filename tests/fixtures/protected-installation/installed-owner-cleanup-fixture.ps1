# Direct Windows PowerShell 5.1 regression: real attempt and uninstall orchestration,
# disposable receipts and synthetic held resources; no services/accounts are touched.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../../scripts/qualification/installed-owner-phase.ps1')
Add-Type 'public static class ProtectedInstallService { public static bool Absent() { return true; } }'
$scratch = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path ('out/owner-cleanup-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch | Out-Null
$script:ProtectedInstallParent = Join-Path $scratch 'absent-install-parent'

# Keep the production terminal-latch and ancillary receipt validation. Replace
# native resource boundaries with finite held fixtures and record exact mutations.
function Assert-ProtectedInstallAdministrator {}
function Assert-ProtectedInstallation($Association) {
    if ($Association.cleanupUnknown) { throw 'protected-owned-cleanup-unknown' }
}
function Update-ProtectedInstallRuntimeRows($Stage) {}
function Read-ProtectedInstallSnapshot($Path) { return @{ path = $Path } }
function Assert-ProtectedInstallSnapshot($Row) {}
function Remove-ProtectedInstallStage($Stage, $Published) {
    if (!$Published -or $Stage -ne $script:selectedStage) { throw 'fixture-stage-selection-refused' }
    $script:events.Add('root')
}
function Remove-ProtectedInstallAncillary($Association) {
    Assert-ProtectedInstallAncillary $Association
    $script:events.Add('account')
}

$rows = @()
$fixtureDirectories = @()
try {
    foreach ($mode in @('behavior', 'readiness', 'closure', 'jobs', 'exit', 'owner', 'epoch', 'image', 'schema', 'stale-receipt', 'counter', 'unknown-receipt')) {
        $receiptRoot = Join-Path $scratch $mode
        New-Item -ItemType Directory -Path $receiptRoot | Out-Null
        $fixtureDirectories += $receiptRoot
        $script:events = [Collections.Generic.List[string]]::new()
        $hash = 'a' * 64
        $native = @{ schemaVersion = 1; scope = 'installed-owner-inspection'; cleanupConfirmed = $true; ownedJobsEmpty = $true;
            ownerSid = 'S-1-5-18'; ownerAuthentication = '0000000000000012'; ownerSession = 0; ownerBirth = '000000000000002a';
            installId = 'b' * 32; epoch = 'c' * 32; revision = 1; ownerImageSha256 = $hash; supervisorImageSha256 = $hash; mainImageSha256 = $hash;
            inspected = $false; inspectionCount = 0; launchAllowed = $false; completeE1 = $false;
            operatorSid = 'S-1-5-21-1-2-3-1001'; operatorAuthentication = '0000000000000034'; supervisorPid = 100; mainPid = 101;
            nativeProducerReady = $true; bootstrapWriteCompleted = $true; bootstrapEofClosed = $true; supervisorReleased = $true; mainReleased = $false; supervisorExitCode = 2 }
        if ($mode -eq 'closure') { $native.cleanupConfirmed = $false }
        if ($mode -eq 'jobs') { $native.ownedJobsEmpty = $false }
        if ($mode -eq 'owner') { $native.ownerAuthentication = '0000000000000099' }
        if ($mode -eq 'epoch') { $native.epoch = 'd' * 32 }
        if ($mode -eq 'image') { $native.mainImageSha256 = 'd' * 64 }
        if ($mode -eq 'schema') { $native.schemaVersion = 2 }
        if ($mode -eq 'readiness') { $native.inspected = $true; $native.inspectionCount = 1; $native.nativeProducerReady = $false }
        $observed = @{ exactProcessExited = ($mode -ne 'exit'); authentication = '0000000000000012'; session = 0; birthFileTime = [long]42 }
        $service = [pscustomobject]@{ ObservedOwner = $observed; Native = $native; Mode = $mode; Paths = $null; Events = $script:events }
        $service | Add-Member ScriptMethod Start {
            $this.Native | ConvertTo-Json -Compress | Set-Content -LiteralPath $this.Paths.result -Encoding ASCII
            if ($this.Mode -eq 'stale-receipt') { [IO.File]::SetCreationTimeUtc($this.Paths.result, [DateTime]::UtcNow.AddMinutes(-5)) }
            if ($this.Mode -in @('readiness', 'counter')) { [IO.File]::WriteAllText($this.Paths.count, $(if ($this.Mode -eq 'counter') { '2' } else { '1' })) }
        }
        $service | Add-Member ScriptMethod Status { return @(1, 0) }
        $service | Add-Member ScriptMethod WaitExited {}
        $service | Add-Member ScriptMethod Stop { $this.Events.Add('stop') }
        $service | Add-Member ScriptMethod Delete { $this.Events.Add('service') }
        $receipts = [pscustomobject]@{ PathName = $receiptRoot }
        $receipts | Add-Member ScriptMethod Recheck {}
        $script:selectedStage = @{ epoch = 'c' * 32; revision = 1 }
        $association = @{ cleanupUnknown = $false; attemptedReceiptPaths = @(); receiptRows = @(); service = $service; receipts = $receipts; control = $null; rollback = $null;
            stage = $script:selectedStage; installId = 'b' * 32; operatorSid = $native.operatorSid;
            manifest = @{ files = @(@{ name = 'aegis-owner.exe'; sha256 = $hash }, @{ name = 'aegis-session.exe'; sha256 = $hash }, @{ name = 'aegis-main.exe'; sha256 = $hash }) } }
        $service.Paths = Get-InstalledOwnerReceiptPaths $association
        $failure = $null
        try { Invoke-InstalledOwnerAttempt $association $true | Out-Null } catch { $failure = $_.Exception.Message }
        if ($null -eq $failure) { throw ('fixture-positive-should-fail-' + $mode) }
        $proven = $mode -in @('behavior', 'readiness', 'unknown-receipt')
        if ($association.cleanupUnknown -eq $proven -or $association.attemptDiagnostic.cleanupUnknown -eq $proven) { throw ('fixture-cleanup-latch-' + $mode) }
        if ($mode -eq 'unknown-receipt') { [IO.File]::WriteAllText((Join-Path $receiptRoot 'foreign.json'), '{}') }
        $uninstallFailure = $null
        try { Remove-ProtectedInstallation $association } catch { $uninstallFailure = $_.Exception.Message }
        $mayRemove = $mode -in @('behavior', 'readiness')
        if ($mayRemove) {
            if ($null -ne $uninstallFailure -or (@($script:events) -join ',') -cne 'stop,service,root,account' -or $null -ne $association.service -or $null -ne $association.stage) { throw ('fixture-exact-uninstall-' + $mode) }
        } elseif ($null -eq $uninstallFailure -or $script:events.Count -ne 0) { throw ('fixture-uninstall-must-block-' + $mode) }
        $rows += @{ mode = $mode; passed = $true; attemptFailure = $failure; uninstallFailure = $uninstallFailure; mutations = @($script:events) }
    }
    @{ passed = $true; powershell = $PSVersionTable.PSVersion.ToString(); cases = $rows } | ConvertTo-Json -Depth 5 -Compress
} finally {
    # Only this newly-created bounded fixture directory on the project data drive.
    foreach ($directory in $fixtureDirectories) {
        $item = Get-Item -LiteralPath $directory
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
        foreach ($file in Get-ChildItem -LiteralPath $directory -File) {
            if (!($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { Remove-Item -LiteralPath $file.FullName -Force }
        }
        Remove-Item -LiteralPath $directory -Force
    }
    Remove-Item -LiteralPath $scratch -Force
}
