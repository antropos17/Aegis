param(
    [string]$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')),
    [string]$WorkRoot = (Join-Path ([IO.Path]::GetFullPath($env:TEMP)) 'aegis-owner-lifetime')
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $WorkRoot)) { New-Item -ItemType Directory -Path $WorkRoot | Out-Null }
. (Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-media.ps1')
. (Join-Path $PSScriptRoot 'cloud-guest-owner-lifetime-build.ps1')
. (Join-Path $PSScriptRoot 'cloud-guest-owner-lifetime.ps1')
. (Join-Path $PSScriptRoot 'cloud-guest-owner-lifetime-test.ps1')
$base = [IO.Path]::GetFullPath($WorkRoot); $ancestor = Get-Item -LiteralPath $base -Force
while ($null -ne $ancestor) { if ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'owner-lifetime-temp-reparse-refused' }; $ancestor = $ancestor.Parent }
$drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($base))
if ($drive.AvailableFreeSpace -lt 512MB) { throw 'owner-lifetime-disk-headroom-refused' }
$fixture = Join-Path $base ('nested-owner-lifetime-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$previousTemp = $env:TEMP; $previousTmp = $env:TMP; $env:TEMP = $fixture; $env:TMP = $fixture
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$sourcePins = @{}
foreach ($file in @(Get-ChildItem -LiteralPath $PSScriptRoot -File | Where-Object Extension -in @('.cs', '.cjs', '.ps1'))) {
    $sourcePins[$file.FullName] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
}
try {
    $build = Build-CloudGuestOwnerLifetime $ProjectRoot $PSScriptRoot $fixture
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'owner-lifetime-fixed-task.cjs') -Destination $fixture
    Copy-Item -LiteralPath (Join-Path $ProjectRoot 'tests/fixtures/native-cloud-guest-owner-lifetime/owner-lifetime-local-client.cjs') -Destination $fixture
    $escaped = $fixture.Replace('\', '\\')
    $runtime = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'cloud-owner-lifetime-runtime.cjs'))
    $runtime = $runtime.Replace('C:\\ProgramData\\AegisCloudLab\\trusted', $escaped)
    [IO.File]::WriteAllText((Join-Path $fixture 'cloud-owner-lifetime-runtime.cjs'), $runtime, [Text.UTF8Encoding]::new($false))
    $task = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'cloud-owner-lifetime-task.cjs'))
    # Local path and same-principal mode substitutions only; admission/Job operations are real.
    $task = $task.Replace('C:\\ProgramData\\AegisCloudLab\\trusted', $escaped)
    $task = $task.Replace('C:\\AegisLab\\scratch', $escaped).Replace('C:\\AegisLab\\work\\owner-lifetime-result.jsonl', $escaped + '\\owner-lifetime-result.jsonl')
    $argumentsPattern = [Regex]::Escape("['--guest-all', trusted + '\\node.exe', trusted, sid]").Replace('\ ', '\s*')
    if ([Regex]::Matches($task, $argumentsPattern).Count -ne 1) { throw 'owner-lifetime-local-arguments-seam-refused' }
    $task = [Regex]::Replace($task, $argumentsPattern, "['--all', process.execPath, trusted]")
    if ($task.Contains("'--guest-all'") -or $task.Contains('C:\\ProgramData') -or $runtime.Contains('C:\\ProgramData')) { throw 'owner-lifetime-local-substitution-refused' }
    [IO.File]::WriteAllText((Join-Path $fixture 'cloud-owner-lifetime-task.cjs'), $task, [Text.UTF8Encoding]::new($false))
    $exe = Join-Path $fixture 'OwnedLifetimeOuterFixture.exe'
    $arguments = @('/nologo', '/warnaserror+', '/target:exe', '/reference:System.Web.Extensions.dll', ('/out:"' + $exe + '"'))
    $nativeInputs = @((Join-Path $ProjectRoot 'scripts/qualification/CloudGuestRuntimeGate.cs'), (Join-Path $ProjectRoot 'tests/fixtures/native-cloud-guest-owner-lifetime/OwnedLifetimeOuterFixture.cs'))
    foreach ($leaf in @('CallerAdmission', 'CallerRegistration', 'CallerIdentity', 'CallerNative', 'GuestJobNative', 'GuestJobInventory')) { $nativeInputs += (Join-Path $ProjectRoot ('sidecar/session/' + $leaf + '.cs')) }
    foreach ($source in $nativeInputs) { $arguments += ('"' + $source + '"'); $sourcePins[$source] = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash }
    $code = Invoke-CloudGuestNativeProcess $compiler $arguments (Join-Path $fixture 'outer-compile.txt') (Join-Path $fixture 'outer-compile.error') 10000
    if ($code -ne 0 -or (Get-Item -LiteralPath $exe).Length -gt 64KB) {
        Get-Content -LiteralPath (Join-Path $fixture 'outer-compile.txt') -TotalCount 15
        throw 'owner-lifetime-outer-compile-refused'
    }
    $output = Join-Path $fixture 'outer.json'; $errorOutput = Join-Path $fixture 'outer.error'
    $code = Invoke-CloudGuestNativeProcess $exe @(('"' + $node + '"'), ('"' + $fixture + '"')) $output $errorOutput 22000
    $identity = ConvertFrom-CloudGuestOwnerLifetimeTestJson ([IO.File]::ReadAllText($output))
    if ($code -ne 0 -or (Get-Item -LiteralPath $errorOutput).Length -ne 0 -or !$identity.passed) { throw 'owner-lifetime-native-nested-refused' }
    $resultPath = Join-Path $fixture 'owner-lifetime-result.jsonl'
    $controls = Read-CloudGuestOwnerLifetimeAfterClosure $identity $resultPath $sid
    Write-Output 'native-admitted-nested-owner-lifetime-cases:2'
    # Run the actual closure-first reader against the native receipt in inbox Windows PowerShell 5.1.
    $inboxScript = Join-Path $fixture 'inbox-closure-reader.ps1'
    @'
param($Reader, $Outer, $Result, $Sid)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. $Reader
$native = [IO.File]::ReadAllText($Outer) | ConvertFrom-Json
$controls = Read-CloudGuestOwnerLifetimeAfterClosure $native $Result $Sid
if (!$controls.passed -or $controls.cases.Count -ne 2) { throw 'inbox-owner-lifetime-reader-positive-refused' }
$native.jobClosureConfirmed = $false
$refused = $false
try { Read-CloudGuestOwnerLifetimeAfterClosure $native ($Result + '.absent') $Sid | Out-Null }
catch { $refused = $_.Exception.Message -ceq 'owner-lifetime-outer-closure-unconfirmed' }
if (!$refused) { throw 'inbox-owner-lifetime-pre-read-closure-refusal-lost' }
$native.jobClosureConfirmed = $true
$refused = $false
try { Read-CloudGuestOwnerLifetimeAfterClosure $native $Result $Sid -RequireStandardPrincipal | Out-Null }
catch { $refused = $true }
if (!$refused) { throw 'inbox-owner-lifetime-local-standard-claim-accepted' }
Write-Output 'inbox-owner-lifetime-closure-reader-controls:3'
'@ | Set-Content -LiteralPath $inboxScript -Encoding ascii
    $inbox = Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
    $reader = Join-Path $PSScriptRoot 'cloud-guest-owner-lifetime-reader.ps1'
    $inboxOut = Join-Path $fixture 'inbox-closure-reader.stdout'; $inboxErr = Join-Path $fixture 'inbox-closure-reader.stderr'
    $inboxCode = Invoke-CloudGuestNativeProcess $inbox @('-NoProfile', '-NonInteractive', '-File', ('"' + $inboxScript + '"'),
        ('"' + $reader + '"'), ('"' + $output + '"'), ('"' + $resultPath + '"'), $sid) $inboxOut $inboxErr 10000
    if ($inboxCode -ne 0 -or (Get-Item -LiteralPath $inboxErr).Length -ne 0 -or
        [IO.File]::ReadAllText($inboxOut).Trim() -cne 'inbox-owner-lifetime-closure-reader-controls:3') {
        Get-Content -LiteralPath $inboxErr -TotalCount 8; throw 'owner-lifetime-inbox-reader-refused'
    }
    Write-Output 'inbox-owner-lifetime-closure-reader-controls:3'
    $closureControls = 0
    foreach ($pair in @(@('jobClosureConfirmed', $false), @('jobClosureConfirmed', 'true'), @('exitCodeObserved', $false),
        @('taskReleased', $false), @('runtimeCallerAuthenticated', $false), @('exitCode', 137), @('birthFileTime', 0), @('sid', 'S-1-5-18'))) {
        $old = $identity[$pair[0]]; $identity[$pair[0]] = $pair[1]
        try {
            $refused = $false
            try { Read-CloudGuestOwnerLifetimeAfterClosure $identity (Join-Path $fixture 'unwritten-result.jsonl') $sid | Out-Null }
            catch { $refused = $_.Exception.Message -ceq 'owner-lifetime-outer-closure-unconfirmed' }
            if (!$refused) { throw 'owner-lifetime-pre-read-closure-refusal-lost' }; $closureControls++
        } finally { $identity[$pair[0]] = $old }
    }
    Write-Output ('pure-owner-lifetime-before-read-closure-controls:' + $closureControls)
    $validLines = [IO.File]::ReadAllLines($resultPath); $bad = Join-Path $fixture 'malformed.jsonl'; $malformed = 0
    $first = ConvertFrom-CloudGuestOwnerLifetimeTestJson $validLines[0]
    foreach ($text in @('{', $validLines[0], ($validLines[1] + "`n" + $validLines[0]), ('x' * 16385),
        (($validLines -join "`n") -replace '"passed":true', '"passed":"true"'),
        (($validLines -join "`n") -replace '"jobClosureConfirmed":true', '"jobClosureConfirmed":"unknown"'),
        (($validLines -join "`n") -replace '"launchAllowed":false', '"launchAllowed":true'))) {
        [IO.File]::WriteAllText($bad, $text, [Text.UTF8Encoding]::new($false))
        $refused = $false
        try { Read-CloudGuestOwnerLifetimeAfterClosure $identity $bad $sid | Out-Null } catch { $refused = $true }
        if (!$refused) { throw 'owner-lifetime-malformed-reader-accepted' }; $malformed++
    }
    Write-Output ('reader-malformed-owner-lifetime-controls:' + $malformed)
    # Shape-only standard-user/private-desktop facts are synthetic; native evidence remains unchanged.
    $syntheticNative = $identity.Clone()
    foreach ($flag in @('privateDesktopCreated', 'privateDesktopParentRestored', 'privateDesktopHandlesClosedAfterJobClosure', 'ownerNodeVersionPassed')) { $syntheticNative[$flag] = $true }
    foreach ($flag in @('administratorGroupPresent', 'administratorEnabled', 'elevated', 'acceptancePassed', 'e6Qualified', 'launchAllowed')) { $syntheticNative[$flag] = $false }
    $syntheticNative.verificationKind = 'fixed-owner-lifetime-runtime'; $syntheticNative.tokenRequestedAccess = 8
    $syntheticControls = @{ schemaVersion = 1; kind = 'fixed-controlled-owner-exit'; passed = $true; cases = @() }
    foreach ($flag in @('e2Qualified', 'e3Qualified', 'e6Qualified', 'acceptancePassed', 'launchAllowed', 'fullE33Accepted')) { $syntheticControls[$flag] = $false }
    foreach ($line in $validLines) { $record = ConvertFrom-CloudGuestOwnerLifetimeTestJson $line; $record.standardPrincipalVerified = $true; $syntheticControls.cases += $record }
    $phase = @{ schemaVersion = 1; kind = 'fixed-cloud-owner-lifetime'; passed = $true; failureStage = $null; newReceiversStarted = $false;
        inputPinsVerified = $true; inputsHeldThroughClosure = $true; native = $syntheticNative; controls = $syntheticControls }
    foreach ($flag in @('e2Qualified', 'e3Qualified', 'e6Qualified', 'acceptancePassed', 'launchAllowed', 'fullE33Accepted')) { $phase[$flag] = $false }
    if (!(Test-CloudGuestOwnerLifetimeResult $phase $sid)) { throw 'owner-lifetime-synthetic-phase-positive-refused' }
    $roundtrip = [Management.Automation.PSSerializer]::Deserialize([Management.Automation.PSSerializer]::Serialize($phase, 12))
    if (!(Test-CloudGuestOwnerLifetimeResult $roundtrip $sid)) { throw 'owner-lifetime-remoting-shape-refused' }
    $phaseControls = 2
    foreach ($pair in @(@('inputsHeldThroughClosure', $false), @('inputPinsVerified', $false), @('newReceiversStarted', $true),
        @('e2Qualified', $true), @('launchAllowed', $true), @('fullE33Accepted', $true))) {
        $old = $phase[$pair[0]]; $phase[$pair[0]] = $pair[1]
        try { if (Test-CloudGuestOwnerLifetimeResult $phase $sid) { throw 'owner-lifetime-phase-mutation-accepted' }; $phaseControls++ }
        finally { $phase[$pair[0]] = $old }
    }
    $syntheticControls.cases[0].standardPrincipalVerified = $false
    if (Test-CloudGuestOwnerLifetimeResult $phase $sid) { throw 'owner-lifetime-standard-token-refusal-lost' }; $phaseControls++
    Write-Output ('synthetic-owner-lifetime-host-phase-controls:' + $phaseControls)
    foreach ($source in $sourcePins.Keys) { if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -cne $sourcePins[$source]) { throw 'owner-lifetime-integration-source-changed' } }
    $receipt = @{ evidence = 'native-local-admission-and-nested-jobs'; actualHead = (& git -C $ProjectRoot rev-parse HEAD).Trim(); observedAtUtc = [DateTime]::UtcNow.ToString('o');
        standardUserGuestObserved = $false; privateDesktopGuestObserved = $false; outer = $identity; controls = $controls; sourceHashes = $sourcePins;
        build = $build; retainedFixture = $fixture; closureControls = $closureControls; malformedReaderControls = $malformed; syntheticHostPhaseControls = $phaseControls;
        inboxClosureReaderControls = 3;
        outerExeBytes = (Get-Item -LiteralPath $exe).Length; outerExeSha256 = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash;
        launchAllowed = $false; fullE33Accepted = $false }
    $receipt | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $WorkRoot 'integration-evidence.json') -Encoding utf8
} finally {
    $env:TEMP = $previousTemp; $env:TMP = $previousTmp
    $files = @(Get-ChildItem -LiteralPath $fixture -Force)
    if (($files | Measure-Object Length -Sum).Sum -gt 16MB) { throw 'owner-lifetime-fixture-output-budget-exceeded' }
    foreach ($file in $files) { if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'owner-lifetime-fixture-retention-refused' } }
    Write-Output ('retained-owner-lifetime-fixture-bytes:' + ($files | Measure-Object Length -Sum).Sum)
    Write-Output ('owner-lifetime-disk-free-after:' + $drive.AvailableFreeSpace)
}
