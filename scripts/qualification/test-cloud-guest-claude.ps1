param([string]$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')), [switch]$PureOnly)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'cloud-guest-claude-phase.ps1')
& (Join-Path $PSScriptRoot 'test-cloud-guest-claude-first-phase.ps1')
$base = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
$parent = Get-Item -LiteralPath $base -Force
while ($null -ne $parent) { if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'claude-controls-reparse-refused' }; $parent = $parent.Parent }
$fixture = Join-Path $base ('aegis-claude-controls-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    # Extract the actual parser only; fixed-path replacements are test-only AST fixtures.
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'cloud-guest-claude-bootstrap.ps1'), [ref]$null, [ref]$null)
    $rightsFn = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Test-CloudGuestClaudeTaskReadRights' }, $true)
    . ([scriptblock]::Create($rightsFn.Extent.Text))
    $rule = [Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-21-1-2-3-1001'), 'ReadAndExecute', 'Allow')
    if (!(Test-CloudGuestClaudeTaskReadRights $rule.FileSystemRights) -or
        (Test-CloudGuestClaudeTaskReadRights ([Security.AccessControl.FileSystemRights]::Modify)) -or
        (Test-CloudGuestClaudeTaskReadRights ([Security.AccessControl.FileSystemRights]::FullControl))) { throw 'claude-read-only-rights-control-failed' }
    $fn = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Read-CloudGuestClaudeResult' }, $true)
    $source = $fn.Extent.Text.Replace('C:\AegisLab\work\claude-result.json', (Join-Path $fixture 'task.json')).Replace('C:\ProgramData\AegisCloudLab\admin\claude-receiver-result.json', (Join-Path $fixture 'receiver.json'))
    . ([scriptblock]::Create($source))
    $identity = @{}
    foreach ($name in @('passed', 'heldIdentityBeforeRelease', 'runtimeCallerAuthenticated', 'runtimeInitializedBeforeProject', 'taskReleased', 'exitCodeObserved', 'jobClosureConfirmed', 'privateDesktopHandlesClosedAfterJobClosure', 'claudeReceiverOutsideTaskJob', 'claudeReceiverAdministratorEnabled', 'claudeReceiverSameOwnerSid', 'claudeReceiverStartedAfterRuntimeReady', 'claudeReceiverStoppedAfterJobClosure', 'claudeReceiverExitObserved', 'claudeReceiverResultWritten')) { $identity[$name] = $true }
    foreach ($name in @('claudeReceiverForced', 'claudeReceiverDisposalUnknown', 'claudeReceiverExpiredBeforeStop', 'elevated', 'administratorEnabled')) { $identity[$name] = $false }
    $identity.exitCode = 0; $identity.claudeReceiverExitCode = 0; $identity.claudeReceiverStopMilliseconds = 10000; $identity.claudeReceiverStopSubmittedMilliseconds = 10001; $identity.claudeReceiverExitMilliseconds = 10100
    $task = @{ schemaVersion = 1; task = 'fixed-claude-read-edit-test'; passed = $true; stage = 'complete'; failure = $null; version = '2.1.292'; cliSha256 = 'eb95bb65955f8b1702e800815f9a2c0388a5de0f196c354c7ee1dd5cb9a2ba23'; cliExitCode = 0; cliExitObserved = $true; deadlineExpired = $false; outputLimit = $false; stdoutBytes = 123; stderrBytes = 0; clientResultValid = $true; taskObservedReadEditTestPassed = $true; taskObservedEditedBytesMatch = $true; taskObservedTestExitCode = 0; trustedTestProcessObservation = 'unknown'; acceptancePassed = $false; clientMilliseconds = 100; elapsedMilliseconds = 200 }
    $receiver = @{ schemaVersion = 1; kind = 'claude-receiver'; passed = $true; closed = $true; stopObserved = $true; expired = $false; requests = 4; completedResponses = 4; toolResults = @($true, $true, $true); steps = @('read', 'edit', 'test', 'finish'); connectionCount = 1; connectionClosed = 1; clientEofCount = 1; forcedClosed = 0; elapsedMilliseconds = 100; failure = $null }
    function WriteFixtures { foreach ($item in @(@('task.json', $task), @('receiver.json', $receiver))) { [IO.File]::WriteAllText((Join-Path $fixture $item[0]), ($item[1] | ConvertTo-Json -Compress -Depth 5), [Text.UTF8Encoding]::new($false)) } }
    WriteFixtures; $result = Read-CloudGuestClaudeResult $identity
    if (!$result.passed -or $result.acceptancePassed -or $result.e6Qualified -or $result.trustedTestProcessObservation -cne 'unknown') { throw 'claude-positive-controls-refused' }
    $count = 4
    foreach ($change in @(@('identity', 'jobClosureConfirmed', $false), @('identity', 'passed', $false), @('identity', 'exitCode', 7), @('identity', 'claudeReceiverForced', $true), @('identity', 'claudeReceiverStopMilliseconds', 42500), @('identity', 'claudeReceiverExitMilliseconds', 45000), @('task', 'acceptancePassed', $true), @('task', 'trustedTestProcessObservation', 'confirmed'), @('task', 'passed', $false), @('task', 'cliExitObserved', $false), @('task', 'cliExitCode', 7), @('task', 'taskObservedTestExitCode', 7), @('task', 'failure', 'secret-text'), @('receiver', 'expired', $true), @('receiver', 'requests', 3), @('receiver', 'clientEofCount', 0), @('receiver', 'forcedClosed', 1), @('receiver', 'closed', 'true'))) {
        $selected = if ($change[0] -ceq 'identity') { $identity } elseif ($change[0] -ceq 'task') { $task } else { $receiver }
        $original = $selected[$change[1]]; $selected[$change[1]] = $change[2]
        try { WriteFixtures; if ((Read-CloudGuestClaudeResult $identity).passed) { throw 'claude-negative-control-accepted' }; $count++ }
        finally { $selected[$change[1]] = $original }
    }
    $identity.taskReleased = $false; Remove-Item -LiteralPath (Join-Path $fixture 'task.json'); Remove-Item -LiteralPath (Join-Path $fixture 'receiver.json')
    $result = Read-CloudGuestClaudeResult $identity
    if ($result.passed -or $result.taskStatus -cne 'not-run' -or $null -ne $result.task) { throw 'claude-not-run-control-failed' }; $count++
    @{ scope = 'pure-actual-parser-and-identity-closure-models'; cases = $count; passed = $count; nativeEffects = $false; guestClientExecuted = $false } | ConvertTo-Json -Compress
    if (!$PureOnly) {
        . (Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-media.ps1')
        $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'; $exe = Join-Path $fixture 'ClaudeFixture.exe'
        $arguments = @('/nologo', '/target:exe', '/platform:x64', '/warnaserror+', ('/out:"' + $exe + '"'))
        foreach ($leaf in @('CloudGuestProcess.cs', 'CloudGuestClaudeReceiver.cs', 'CloudGuestClaudeReceiverFixture.cs')) { $arguments += ('"' + (Join-Path $PSScriptRoot $leaf) + '"') }
        foreach ($leaf in @('CloudGuestDesktop.cs', 'CloudGuestNetwork.cs', 'CloudGuestRuntimeGate.cs')) { $arguments += ('"' + (Join-Path $ProjectRoot ('scripts/qualification/' + $leaf)) + '"') }
        foreach ($leaf in @('GuestJobNative', 'GuestJobInventory', 'CallerAdmission', 'CallerRegistration', 'CallerIdentity', 'CallerNative')) { $arguments += ('"' + (Join-Path $ProjectRoot ('sidecar/session/' + $leaf + '.cs')) + '"') }
        $exitCode = Invoke-CloudGuestNativeProcess $compiler $arguments (Join-Path $fixture 'compile.txt') (Join-Path $fixture 'compile.error') 10000
        if ($exitCode -ne 0) { throw 'claude-pure-native-compile-failed' }
        $exitCode = Invoke-CloudGuestNativeProcess $exe @() (Join-Path $fixture 'native.txt') (Join-Path $fixture 'native.error') 5000
        $text = [IO.File]::ReadAllText((Join-Path $fixture 'native.txt'))
        if ($exitCode -ne 0 -or $text.Trim() -cne 'claude-native-pure-controls:30' -or (Get-Item -LiteralPath (Join-Path $fixture 'native.error')).Length -ne 0) { throw 'claude-pure-native-controls-failed' }
        $text.Trim()
    }
} finally {
    # Preserve exact closed fixture files until review; finite <1MiB, no automatic deletion retry.
    Write-Host ('claude-controls-owned-fixture ' + $fixture)
}

& (Join-Path $PSScriptRoot 'test-cloud-guest-claude-public.ps1') -ProjectRoot $ProjectRoot
