param(
    [string]$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')),
    [string]$WorkRoot = (Join-Path ([IO.Path]::GetFullPath($env:TEMP)) 'aegis-owner-lifetime')
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $WorkRoot)) { New-Item -ItemType Directory -Path $WorkRoot | Out-Null }
. (Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-media.ps1')
. (Join-Path $PSScriptRoot 'cloud-guest-owner-lifetime-reader.ps1')
. (Join-Path $PSScriptRoot 'cloud-guest-owner-lifetime-test.ps1')
$WorkRoot = [IO.Path]::GetFullPath($WorkRoot)
$ancestor = Get-Item -LiteralPath $WorkRoot -Force
while ($null -ne $ancestor) {
    if ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'owner-lifetime-temp-reparse-refused' }
    $ancestor = $ancestor.Parent
}
$drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($WorkRoot))
if ($drive.AvailableFreeSpace -lt 512MB) { throw 'owner-lifetime-disk-headroom-refused' }
$fixture = Join-Path $WorkRoot ('owner-lifetime-' + [guid]::NewGuid().ToString('N'))
$sources = @(
    (Join-Path $PSScriptRoot 'CloudGuestOwnerLifetime.cs'),
    (Join-Path $ProjectRoot 'sidecar/session/GuestJobNative.cs'),
    (Join-Path $ProjectRoot 'sidecar/session/GuestJobInventory.cs')
)
$bindings = $sources + @((Join-Path $PSScriptRoot 'cloud-guest-owner-lifetime-test.ps1'), (Join-Path $PSScriptRoot 'owner-lifetime-fixed-task.cjs'), (Join-Path $PSScriptRoot 'cloud-guest-owner-lifetime-reader.ps1'),
    (Join-Path $PSScriptRoot 'test-cloud-guest-owner-lifetime-local.ps1'), (Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-media.ps1'))
$pins = @{}; foreach ($source in $bindings) { $pins[$source] = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash }
$exe = Join-Path $fixture 'CloudGuestOwnerLifetime.exe'
New-Item -ItemType Directory -Path $fixture | Out-Null
$previousTemp = $env:TEMP; $previousTmp = $env:TMP
$env:TEMP = $fixture; $env:TMP = $fixture
try {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'owner-lifetime-fixed-task.cjs') -Destination $fixture
    $arguments = @('/nologo', '/warnaserror+', '/target:exe', '/reference:System.Web.Extensions.dll', ('/out:"' + $exe + '"'))
    foreach ($source in $sources) { $arguments += ('"' + $source + '"') }
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    $code = Invoke-CloudGuestNativeProcess $compiler $arguments (Join-Path $fixture 'compile.txt') (Join-Path $fixture 'compile.error') 10000
    if ($code -ne 0 -or (Get-Item -LiteralPath $exe).Length -gt 64KB) {
        Get-Content -LiteralPath (Join-Path $fixture 'compile.txt') -TotalCount 30
        throw 'owner-lifetime-compile-refused'
    }
    $node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $output = Join-Path $fixture 'native.txt'; $errorOutput = Join-Path $fixture 'native.error'
    $code = Invoke-CloudGuestNativeProcess $exe @('--all', ('"' + $node + '"'), ('"' + $fixture + '"')) $output $errorOutput 14000
    $records = @([IO.File]::ReadAllLines($output) | ForEach-Object { ConvertFrom-CloudGuestOwnerLifetimeTestJson $_ })
    if ($code -ne 0 -or (Get-Item -LiteralPath $errorOutput).Length -ne 0 -or $records.Count -ne 2 -or
        !(Test-CloudGuestOwnerLifetimeCase $records[0] $sid $true) -or !(Test-CloudGuestOwnerLifetimeCase $records[1] $sid $false)) {
        Get-Content -LiteralPath $output -TotalCount 8
        Get-Content -LiteralPath $errorOutput -TotalCount 8
        throw 'owner-lifetime-native-controls-refused'
    }
    Write-Output 'native-owner-controlled-exit-controller-recovery:passed'
    Write-Output 'native-owner-controlled-exit-kill-on-close-held-exits:passed'
    $reader = Join-Path $fixture 'reader.ps1'
    $readerSource = @'
param([string]$Validator, [string]$OutputPath, [string]$ExpectedSid)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. $Validator
$receipt = Read-CloudGuestOwnerLifetimeReceipt $OutputPath $ExpectedSid
if (!$receipt.passed -or $receipt.cases.Count -ne 2 -or $receipt.launchAllowed -or $receipt.fullE33Accepted) { throw 'inbox-reader-positive-refused' }
$refused = $false
try { Read-CloudGuestOwnerLifetimeReceipt $OutputPath $ExpectedSid -RequireStandardPrincipal | Out-Null } catch { $refused = $true }
if (!$refused) { throw 'inbox-reader-local-token-claim-accepted' }
Write-Output 'inbox-owner-lifetime-receipt-controls:2'
'@
    [IO.File]::WriteAllText($reader, $readerSource, [Text.UTF8Encoding]::new($false))
    $inbox = Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
    $readerOut = Join-Path $fixture 'reader.txt'; $readerErr = Join-Path $fixture 'reader.error'
    $readerArgs = @('-NoProfile', '-NonInteractive', '-File', ('"' + $reader + '"'),
        ('"' + (Join-Path $PSScriptRoot 'cloud-guest-owner-lifetime-reader.ps1') + '"'), ('"' + $output + '"'), $sid)
    $code = Invoke-CloudGuestNativeProcess $inbox $readerArgs $readerOut $readerErr 10000
    if ($code -ne 0 -or (Get-Item -LiteralPath $readerErr).Length -ne 0 -or
        [IO.File]::ReadAllText($readerOut).Trim() -cne 'inbox-owner-lifetime-receipt-controls:2') {
        Get-Content -LiteralPath $readerErr -TotalCount 15
        throw 'inbox-owner-lifetime-reader-controls-refused'
    }
    Write-Output 'inbox-owner-lifetime-receipt-controls:2'
    $pure = 0
    foreach ($record in $records) {
        $recovery = $record.case -ceq 'owner-controlled-exit-controller-recovery'
        foreach ($pair in @(@('passed', $false), @('ownerExitObserved', $false), @('ownerAliveBeforeOwnerExit', $false),
            @('heldIdentitiesVerifiedBeforeOwnerExit', $false), @('liveClosureRefused', $false), @('rootExitObserved', $false),
            @('descendantExitObserved', 'true'), @('heldCensusExitObserved', $false), @('rootImageMatched', $false),
            @('initialInventoryCount', 1), @('rootPid', '1'), @('rootBirthFileTime', 0), @('descendantPid', $record.rootPid),
            @('rootExitCode', 259), @('descendantExitCode', 259), @('ownerExitCode', 0), @('launchAllowed', $true),
            @('fullE33Accepted', $true), @('jobClosureConfirmed', 'unknown'), @('witnessJobHandlesReleasedBeforeOwnerExit', $recovery),
            @('postExitJobObservation', 'unknown'))) {
            $old = $record[$pair[0]]; $record[$pair[0]] = $pair[1]
            try { if (Test-CloudGuestOwnerLifetimeCase $record $sid $recovery) { throw 'owner-lifetime-oracle-mutation-accepted' }; $pure++ }
            finally { $record[$pair[0]] = $old }
        }
        foreach ($key in @('case', 'sid', 'failureStage', 'descendantExitObserved', 'rootBirthFileTime', 'heldCensusExitObserved')) {
            $old = $record[$key]; $record.Remove($key)
            try { if (Test-CloudGuestOwnerLifetimeCase $record $sid $recovery) { throw 'owner-lifetime-missing-observation-accepted' }; $pure++ }
            finally { $record[$key] = $old }
        }
    }
    Write-Output ('pure-owner-lifetime-oracle-controls:' + $pure)
    if (Test-CloudGuestOwnerLifetimeCase $records[0] $sid $true -RequireStandardPrincipal) { throw 'local-standard-principal-claim-accepted' }
    $negativeRecords = @()
    foreach ($mode in @('--missing-recovery', '--missing-kill-on-close')) {
        $leaf = $mode.Substring(2); $out = Join-Path $fixture ($leaf + '.txt'); $err = Join-Path $fixture ($leaf + '.error')
        $code = Invoke-CloudGuestNativeProcess $exe @($mode, ('"' + $node + '"'), ('"' + $fixture + '"')) $out $err 10000
        $failure = ConvertFrom-CloudGuestOwnerLifetimeTestJson ([IO.File]::ReadAllText($out))
        if ($code -ne 1 -or $failure.passed -isnot [bool] -or $failure.passed -or !$failure.Contains('ownerExitObserved') -or
            $failure.ownerExitObserved -isnot [bool] -or !$failure.ownerExitObserved -or
            $failure.failureStage -cne 'held-process-exits' -or
            [IO.File]::ReadAllText($err).Trim() -cne 'fixed-owner-lifetime-refused:held-process-exits') {
            Get-Content -LiteralPath $out -TotalCount 8
            throw 'owner-lifetime-native-regression-not-refused'
        }
        $negativeRecords += $failure
        Write-Output ('native-regression-' + $leaf + ':refused')
    }
    foreach ($source in $bindings) {
        if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -cne $pins[$source]) { throw 'owner-lifetime-source-changed-during-run' }
    }
    $receipt = @{ schemaVersion = 1; evidence = 'native-same-principal-local-windows-controlled-owner-exit'; records = $records;
        nativeRegressionControls = 2; nativeRegressionReceipts = $negativeRecords; inboxReaderControls = 2;
        pureMutationControls = $pure; launchAllowed = $false; fullE33Accepted = $false; sourceHashes = $pins }
    $receipt.observedAtUtc = [DateTime]::UtcNow.ToString('o')
    $receipt.actualHead = (& git -C $ProjectRoot rev-parse HEAD).Trim()
    $receipt.nodeSha256 = (Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash
    $receipt.fixtureExeSha256 = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
    $receipt.fixtureExeBytes = (Get-Item -LiteralPath $exe).Length
    $receipt.retainedFixtureDirectory = $fixture
    $receipt.osVersion = [Environment]::OSVersion.Version.ToString()
    $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $WorkRoot 'native-evidence.json') -Encoding utf8
} finally {
    $env:TEMP = $previousTemp; $env:TMP = $previousTmp
    $children = @(Get-ChildItem -LiteralPath $fixture -Force)
    if (($children | Measure-Object -Property Length -Sum).Sum -gt 16MB) { throw 'owner-lifetime-output-total-budget-exceeded' }
    foreach ($file in $children) {
        if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
            !$file.FullName.StartsWith($fixture + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'owner-lifetime-cleanup-path-refused' }
    }
    # Preserve this bounded closed fixture for rehashable executable evidence.
    Write-Output 'owner-lifetime-fixture-retained-for-review'
    Write-Output ('owner-lifetime-disk-free-after:' + $drive.AvailableFreeSpace)
}
