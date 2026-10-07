Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
. (Join-Path $PSScriptRoot 'cloud-guest-media.ps1')
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$savedTemp = $env:TEMP; $savedTmp = $env:TMP
$temporary = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
$parent = Get-Item -LiteralPath $temporary -Force
while ($null -ne $parent) { if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'diagnostics-fixture-reparse-refused' }; $parent = $parent.Parent }
$fixture = Join-Path $temporary ('aegis-guest-diagnostics-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$env:TEMP = $fixture; $env:TMP = $fixture
try {
$dll = Join-Path $fixture 'diagnostics-controls.dll'
$compileArgs = @('/nologo', '/target:library', '/platform:x64', '/warnaserror+', ('/out:"' + $dll + '"'),
    ('"' + (Join-Path $PSScriptRoot 'CloudGuestProcess.cs') + '"'), ('"' + (Join-Path $project 'sidecar/session/GuestJobNative.cs') + '"'),
    ('"' + (Join-Path $project 'sidecar/session/GuestJobInventory.cs') + '"'))
$compileExit = Invoke-CloudGuestNativeProcess $compiler $compileArgs (Join-Path $fixture 'compile.stdout') (Join-Path $fixture 'compile.stderr') 10000
if ($compileExit -ne 0 -or (Get-Item -LiteralPath $dll).Length -gt 1MB) { throw 'focused-native-compile-failed' }
[void][Reflection.Assembly]::Load([IO.File]::ReadAllBytes($dll))
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'cloud-guest-bootstrap.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'bootstrap-parser-failed' }
foreach ($name in @('Read-CloudGuestTaskDiagnostics', 'Merge-CloudGuestTaskDiagnostics')) {
    $definition = $ast.FindAll({ param($item) $item -is [Management.Automation.Language.FunctionDefinitionAst] }, $false) | Where-Object Name -eq $name
    if (@($definition).Count -ne 1) { throw 'helper-definition-missing' }
    . ([scriptblock]::Create($definition.Extent.Text))
}
$script:checks = 0
function Check([bool]$Value, [string]$Code) { if (!$Value) { throw $Code }; $script:checks++ }
$process = [Diagnostics.Process]::new()
$process.StartInfo.FileName = (Get-Command node.exe -ErrorAction Stop).Source; $process.StartInfo.Arguments = '-e "process.exit(7)"'
$process.StartInfo.UseShellExecute = $false; $process.StartInfo.CreateNoWindow = $true; $process.StartInfo.WindowStyle = 'Hidden'
try {
    Check ($process.Start()) 'actual-child-start-failed'
    [void]$process.Handle
    $pidValue = [uint32]$process.Id; $birth = $process.StartTime.ToFileTimeUtc()
    Check ($process.WaitForExit(5000)) 'actual-child-wait-failed'
    $actualExit = [uint32]$process.ExitCode; Check ($actualExit -eq 7) 'actual-child-exit-failed'
} finally { if (!$process.HasExited) { $process.Kill(); [void]$process.WaitForExit(1000) }; $process.Dispose() }
$complete = [CloudGuestProcess].GetMethod('CompleteReceipt', [Reflection.BindingFlags]'NonPublic,Static')
function NativeReceipt([uint32]$Exit, [bool]$Observed, [bool]$Closure, [string]$Failure, $HResult) {
    $receipt = [Collections.Generic.Dictionary[string,object]]::new()
    $receipt['pid'] = $pidValue; $receipt['birthFileTime'] = $birth
    $receipt['sid'] = 'S-1-5-21-1-2-3-1001'; $receipt['initialJobMembers'] = 1
    $receipt['heldIdentityBeforeRelease'] = $true; $receipt['atomicJobAtCreation'] = $false
    $receipt['taskReleased'] = $true; $receipt['elevated'] = $false; $receipt['administratorEnabled'] = $false
    $failureValue = if ($Failure -eq '') { $null } else { $Failure }
    $hResultValue = if ($null -eq $HResult) { $null } else { [int]$HResult }
    try { return $complete.Invoke($null, @($receipt, $Exit, $Observed, $Closure, $failureValue, $hResultValue)) }
    catch {
        $script:lastNativeFailure = $_.Exception
        $captured = [CloudGuestProcess]::FailureReceipt($_.Exception)
        Check ($null -ne $captured) 'typed-failure-receipt-lost'
        return $captured
    }
}
$nonzero = NativeReceipt $actualExit $true $true $null $null
Check (!$nonzero.passed -and $nonzero.exitCode -eq 7 -and $nonzero.exitCodeObserved -and $nonzero.jobClosureConfirmed -and
    $nonzero.pid -eq $pidValue -and $nonzero.birthFileTime -eq $birth -and $nonzero.failureStage -eq 'task-exit') 'nonzero-observations-lost'
$copy = [CloudGuestProcess]::FailureReceipt($lastNativeFailure); $copy['exitCode'] = [uint32]0
Check (([CloudGuestProcess]::FailureReceipt($lastNativeFailure)).exitCode -eq 7) 'failure-receipt-copy-mutated-owner'
$unknownClosure = NativeReceipt 0 $true $false $null $null
Check (!$unknownClosure.passed -and !$unknownClosure.jobClosureConfirmed -and $unknownClosure.failureStage -eq 'guest-job-closure') 'unknown-closure-accepted'
$missingExit = NativeReceipt 0 $false $true $null $null
Check (!$missingExit.passed -and !$missingExit.exitCodeObserved) 'missing-exit-accepted'
$nativeFailed = NativeReceipt 0 $true $true 'held-token-admin' -123
Check (!$nativeFailed.passed -and $nativeFailed.failureStage -eq 'held-token-admin' -and $nativeFailed.failureHResult -eq -123) 'native-failure-accepted'
$successful = NativeReceipt 0 $true $true $null $null
Check ($successful.passed) 'successful-model-refused'
Check ($null -eq [CloudGuestProcess]::FailureReceipt([Exception]::new('SECRET_SENTINEL'))) 'dynamic-exception-exposed'

$protected = @('admin-dummy-read', 'setup-profile-dummy-read', 'trusted-bootstrap-write', 'trusted-runtime-write') | ForEach-Object { @{ label = $_; denied = $true; code = 'EACCES' } }
$hostProbes = @()
foreach ($canary in 1..2) {
    foreach ($action in @('read', 'write', 'delete')) { $hostProbes += @{ route = 'direct'; action = $action; outcome = 'absent-in-guest-namespace'; code = 'ENOENT' } }
    foreach ($action in @('read', 'write', 'delete')) { $hostProbes += @{ route = 'shell'; action = $action; exitCode = 1; processFailed = $false } }
    $hostProbes += @{ route = 'descendant'; action = 'read-write-delete'; exitCode = 0; processFailed = $false }
}
$claimedSuccess = @{ schemaVersion = 1; task = 'fixed-read-edit-test'; passed = $true; stage = 'completed'; failure = $null;
    readEditTestPassed = $true; shellAndDescendantPositive = $true; protectedProbes = @($protected); hostPathProbes = @($hostProbes) }
$resultPath = Join-Path $fixture 'claimed-success.json'
[IO.File]::WriteAllText($resultPath, ($claimedSuccess | ConvertTo-Json -Depth 8))
$parsed = Read-CloudGuestTaskDiagnostics $resultPath
Check ($parsed.status -eq 'verified' -and $parsed.task.passed) 'valid-result-parser-refused'
Check ((Merge-CloudGuestTaskDiagnostics $successful $parsed $true).task.passed) 'valid-success-model-refused'
Check (!(Merge-CloudGuestTaskDiagnostics $successful (Read-CloudGuestTaskDiagnostics $resultPath) $false).task.passed) 'changed-canary-accepted'
foreach ($corpusMode in @('duplicate-labels', 'omitted-label', 'duplicate-host-cases', 'omitted-host-case', 'inconsistent-denial')) {
    $changed = $claimedSuccess | ConvertTo-Json -Depth 8 | ConvertFrom-Json
    if ($corpusMode -eq 'duplicate-labels') { foreach($probe in $changed.protectedProbes) { $probe.label = 'admin-dummy-read' } }
    elseif ($corpusMode -eq 'omitted-label') { $changed.protectedProbes = @($changed.protectedProbes | Select-Object -First 3) }
    elseif ($corpusMode -eq 'duplicate-host-cases') { $changed.hostPathProbes = @(1..14 | ForEach-Object { @{route='direct';action='read';outcome='absent-in-guest-namespace';code='ENOENT'} }) }
    elseif ($corpusMode -eq 'omitted-host-case') { $changed.hostPathProbes = @($changed.hostPathProbes | Select-Object -First 13) }
    else { $changed.protectedProbes[0].code = 'ENOENT' }
    [IO.File]::WriteAllText($resultPath, ($changed | ConvertTo-Json -Depth 8))
    $refusedCorpus = Read-CloudGuestTaskDiagnostics $resultPath
    Check ($refusedCorpus.status -eq 'guest-task-result-malformed' -and !(Merge-CloudGuestTaskDiagnostics $successful $refusedCorpus $true).task.passed) 'incomplete-corpus-accepted'
}
[IO.File]::WriteAllText($resultPath, ($claimedSuccess | ConvertTo-Json -Depth 8))
foreach ($identity in @($nonzero, $unknownClosure, $missingExit, $nativeFailed)) {
    $fresh = Read-CloudGuestTaskDiagnostics $resultPath
    $merged = Merge-CloudGuestTaskDiagnostics $identity $fresh $true
    Check (!$merged.passed -and !$merged.task.passed -and $merged.identity.pid -eq $pidValue) 'child-json-overrode-native-refusal'
}
$missing = Read-CloudGuestTaskDiagnostics (Join-Path $fixture 'never-created-result.json')
Check ($missing.status -eq 'guest-task-result-missing' -and !(Merge-CloudGuestTaskDiagnostics $successful $missing $true).task.passed) 'missing-result-accepted'
[IO.File]::WriteAllText($resultPath, '{"passed":true,"secret":"SECRET_SENTINEL"}')
$malformed = Read-CloudGuestTaskDiagnostics $resultPath
Check ($malformed.status -eq 'guest-task-result-malformed' -and !(Merge-CloudGuestTaskDiagnostics $successful $malformed $true).task.passed) 'malformed-result-accepted'
Check (!(($malformed | ConvertTo-Json -Depth 8).Contains('SECRET_SENTINEL'))) 'child-text-exposed'
[IO.File]::WriteAllText($resultPath, '{')
Check ((Read-CloudGuestTaskDiagnostics $resultPath).status -eq 'guest-task-result-malformed') 'malformed-json-accepted'
[IO.File]::WriteAllText($resultPath, (' ' * 16385))
Check ((Read-CloudGuestTaskDiagnostics $resultPath).status -eq 'guest-task-result-malformed') 'oversized-result-accepted'
$failureFixture = @{schemaVersion=1;task='fixed-read-edit-test';passed=$false;stage='unit-test';failure=@{stage='unit-test';childExitCode=7};readEditTestPassed=$false;shellAndDescendantPositive=$false;hostPathProbes=@();protectedProbes=@()}
[IO.File]::WriteAllText((Join-Path $fixture 'unit-test-result.json'), ($failureFixture | ConvertTo-Json -Depth 5))
$taskFailure = Read-CloudGuestTaskDiagnostics (Join-Path $fixture 'unit-test-result.json')
Check ($taskFailure.status -eq 'verified' -and $taskFailure.task.stage -eq 'unit-test' -and $taskFailure.task.failure.childExitCode -eq 7) 'task-failure-stage-lost'
$mergedFailure = Merge-CloudGuestTaskDiagnostics $nonzero $taskFailure $true
Check (!$mergedFailure.task.passed -and $mergedFailure.task.stage -eq 'unit-test' -and $mergedFailure.identity.exitCode -eq 7) 'merged-failure-observation-lost'
$summary = @{ schemaVersion = 1; passed = $true; checks = $checks; actualChildExitCode = $actualExit;
    nativeCompiledWarningsAsErrors = $true; actualNativeRunOrJobClosure = $false; identityModel = 'disposable-fixture';
    powerShell = $PSVersionTable.PSVersion.ToString(); secretsPublished = $false; launchAllowed = $false }
$summary | ConvertTo-Json -Depth 5

} finally {
    $env:TEMP = $savedTemp; $env:TMP = $savedTmp
    foreach ($file in @(Get-ChildItem -LiteralPath $fixture -File -Force)) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 64KB -or !$file.FullName.StartsWith($fixture + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'diagnostics-fixture-cleanup-refused' }
        Remove-Item -LiteralPath $file.FullName -Force
    }
    Remove-Item -LiteralPath $fixture
}
