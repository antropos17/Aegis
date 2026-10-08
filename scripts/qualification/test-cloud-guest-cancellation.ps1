param([string]$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')), [switch]$PureOnly)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-media.ps1')
. (Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-claude-phase.ps1')
. (Join-Path $PSScriptRoot 'cloud-guest-cancellation.ps1')
# Reuse only the established source-backed fixture setup preceding its first check.
$firstSource = [IO.File]::ReadAllText((Join-Path $ProjectRoot 'scripts/qualification/test-cloud-guest-claude-first-phase.ps1'))
$marker = '$positive = Assert-CloudGuestClaudeFirstPhase $first'
if ($firstSource.Split(@($marker), [StringSplitOptions]::None).Count -ne 2) { throw 'cancellation-gate-fixture-refused' }
$setup = $firstSource.Substring(0, $firstSource.IndexOf($marker)).Replace(". (Join-Path `$PSScriptRoot 'cloud-guest-claude-phase.ps1')", '')
. ([scriptblock]::Create($setup))
$claudeNative = @{ sid = $native.sid; exitCode = [uint32]0; claudeReceiverExitCode = 0;
    claudeReceiverStopMilliseconds = 10000L; claudeReceiverStopSubmittedMilliseconds = 10001L; claudeReceiverExitMilliseconds = 10100L }
foreach ($key in @('passed', 'heldIdentityBeforeRelease', 'runtimeCallerAuthenticated', 'runtimeInitializedBeforeProject', 'taskReleased',
    'exitCodeObserved', 'jobClosureConfirmed', 'privateDesktopHandlesClosedAfterJobClosure', 'claudeReceiverExitObserved',
    'claudeReceiverStoppedAfterJobClosure', 'claudeReceiverResultWritten', 'claudeReceiverOutsideTaskJob')) { $claudeNative[$key] = $true }
foreach ($key in @('claudeReceiverForced', 'claudeReceiverDisposalUnknown', 'claudeReceiverExpiredBeforeStop', 'elevated', 'administratorEnabled')) { $claudeNative[$key] = $false }
$witness = @{ verificationKind = 'separate-post-claude-fixed-standard-user-process'; sid = $native.sid; trustedTestProcessObservation = 'observed-separate-post-claude-fixed-test';
    failureStage = $null; exitCode = 0; pid = 2; birthFileTime = 3L; initialJobMembers = 1; tokenRequestedAccess = 8 }
foreach ($key in @('passed', 'heldIdentityBeforeRelease', 'runtimeResumed', 'runtimeCallerAuthenticated', 'runtimeInitializedBeforeProject', 'taskReleased',
    'privateDesktopCreated', 'privateDesktopParentRestored', 'privateDesktopHandlesClosedAfterJobClosure', 'exitCodeObserved', 'naturalExitObservedBeforeJobTermination',
    'jobClosureConfirmed', 'witnessInputPinsVerified', 'witnessEditedBytesVerified', 'witnessInputsHeldThroughConfirmedClosure', 'witnessInputHandlesClosed')) { $witness[$key] = $true }
foreach ($key in @('originalClaudeToolProcessObserved', 'witnessInputDisposalUnknown', 'elevated', 'administratorEnabled', 'administratorGroupPresent', 'acceptancePassed', 'e6Qualified', 'launchAllowed')) { $witness[$key] = $false }
$claude = @{ passed = $true; secondPhaseObservationKnown = $true; acceptancePassed = $false;
    guestResult = @{ passed = $true; identity = $claudeNative; witness = $witness; task = @{ passed = $true }; receiver = @{ passed = $true } } }
$positive = Assert-CloudGuestCancellationPreviousClosures $first $claude
if (!$positive.priorJobsClosed -or !$positive.priorReceiversExited -or !$positive.priorWitnessClosed) { throw 'cancellation-positive-refused' }
$count = 1
foreach ($entry in @(@('jobClosureConfirmed', $false), @('jobClosureConfirmed', 'true'), @('claudeReceiverExitObserved', $false),
    @('claudeReceiverStopMilliseconds', 42500L), @('claudeReceiverStopSubmittedMilliseconds', 43500L), @('claudeReceiverExitMilliseconds', 45000L),
    @('claudeReceiverForced', $true), @('claudeReceiverExpiredBeforeStop', $true), @('sid', 'S-1-5-18'), @('exitCode', 137))) {
    $old = $claudeNative[$entry[0]]; $claudeNative[$entry[0]] = $entry[1]
    try { $refused = $false; try { Assert-CloudGuestCancellationPreviousClosures $first $claude | Out-Null } catch { $refused = $true }; if (!$refused) { throw 'cancellation-mutation-not-refused' }; $count++ }
    finally { $claudeNative[$entry[0]] = $old }
}
foreach ($entry in @($first.guestResult, $claude, $claude.guestResult.task, $claude.guestResult.receiver, $witness)) {
    $entry.passed = $false
    try { $refused = $false; try { Assert-CloudGuestCancellationPreviousClosures $first $claude | Out-Null } catch { $refused = $true }; if (!$refused) { throw 'cancellation-prior-failure-lost' }; $count++ }
    finally { $entry.passed = $true }
}
Write-Output ('pure-cancellation-ordering-controls:' + $count)
$before = @{ case = 'before-project-release'; sid = $native.sid; elevated = $false; administratorGroupPresent = $false; administratorEnabled = $false;
    e2Qualified = $false; e3Qualified = $false; launchAllowed = $false;
    pid = 8; birthFileTime = 9L; taskReleased = $false; cancellationReceiverStarted = $false; naturalCompletion = $false; exitCode = 137; failureStage = $null }
$after = $before.Clone(); $after.case = 'after-release-live-descendant'; $after.taskReleased = $true
$after.descendantIdentityVerified = $true; $after.descendantExitObserved = $true
$after.descendantPid = 10; $after.descendantBirthFileTime = 11L
foreach ($entry in @($before, $after)) {
    foreach ($key in @('passed', 'heldIdentityBeforeRelease', 'runtimeCallerAuthenticated', 'runtimeInitializedBeforeProject', 'cancellationRequested',
        'cancellationHeldRootAlive', 'cleanupJobTerminationAccepted', 'exitCodeObserved', 'jobClosureConfirmed', 'privateDesktopHandlesClosedAfterJobClosure')) { $entry[$key] = $true }
}
$value = @{ schemaVersion = 1; kind = 'fixed-cloud-cancellation'; passed = $true; payloadAbsentBeforeRelease = $true;
    payloadObservedAfterRelease = $true; newReceiversStarted = $false; failureStage = $null; before = $before; after = $after;
    e2Qualified = $false; e3Qualified = $false; launchAllowed = $false }
if (!(Test-CloudGuestCancellationResult $value $native.sid)) { throw 'cancellation-result-positive-refused' }
$resultCount = 1
foreach ($entry in @(@('after', 'descendantExitObserved', $false), @('after', 'descendantIdentityVerified', $false),
    @('before', 'taskReleased', $true), @('after', 'taskReleased', $false), @('before', 'sid', 'S-1-5-18'),
    @('after', 'naturalCompletion', $true), @('after', 'exitCode', 0), @('after', 'jobClosureConfirmed', $false),
    @('before', 'runtimeCallerAuthenticated', 'true'), @('after', 'cleanupJobTerminationAccepted', $false),
    @('after', 'descendantPid', 0), @('after', 'descendantPid', '10'), @('after', 'descendantPid', 4294967296L),
    @('after', 'descendantPid', 8), @('after', 'descendantBirthFileTime', 0L), @('after', 'descendantBirthFileTime', '11'),
    @('before', 'pid', 4294967296L), @('after', 'administratorEnabled', $true), @('after', 'launchAllowed', $true))) {
    $selected = $value[$entry[0]]; $old = $selected[$entry[1]]; $selected[$entry[1]] = $entry[2]
    try { if (Test-CloudGuestCancellationResult $value $native.sid) { throw 'cancellation-result-mutation-accepted' }; $resultCount++ }
    finally { $selected[$entry[1]] = $old }
}
foreach ($key in @('descendantPid', 'descendantBirthFileTime')) {
    $old = $after[$key]; $after.Remove($key)
    try { if (Test-CloudGuestCancellationResult $value $native.sid) { throw 'cancellation-missing-identity-accepted' }; $resultCount++ }
    finally { $after[$key] = $old }
}
Write-Output ('pure-cancellation-result-controls:' + $resultCount)
# Execute the actual final controller expression with closed synthetic facts.
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-lab.ps1'), [ref]$null, [ref]$null)
$assignments = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$report.passed' }, $true))
if ($assignments.Count -ne 1) { throw 'cancellation-controller-seam-refused' }
$report = @{ cancellationControlsComplete = $true; hostCanariesUnchangedAfterCancellation = $true; failure = $null; cleanupFailure = $null;
    offObserved = $true; removedObserved = $true; hostCanariesUnchangedAfterTask = $true; hostCanariesUnchangedAfterRemoval = $true }
if (!(Invoke-Command -ScriptBlock ([scriptblock]::Create($assignments[0].Right.Extent.Text)))) { throw 'cancellation-controller-positive-refused' }
foreach ($key in @('cancellationControlsComplete', 'hostCanariesUnchangedAfterCancellation')) {
    $report[$key] = $false
    if (Invoke-Command -ScriptBlock ([scriptblock]::Create($assignments[0].Right.Extent.Text))) { throw 'cancellation-controller-refusal-lost' }
    $report[$key] = $true
}
Write-Output 'pure-cancellation-final-controller-controls:3'
# Exercise the actual guest ACL construction in memory; applying an ACL is not
# needed to detect string SIDs being interpreted as account names on Windows.
$bootstrap = [IO.File]::ReadAllText((Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-cancellation-bootstrap.ps1'))
$aclStart = '$acl = [Security.AccessControl.DirectorySecurity]::new()'
$aclEnd = '$stage = ''loader'';'
if ($bootstrap.Split(@($aclStart), [StringSplitOptions]::None).Count -ne 2 -or
    $bootstrap.Split(@($aclEnd), [StringSplitOptions]::None).Count -ne 2) { throw 'cancellation-acl-seam-refused' }
$aclSource = $bootstrap.Substring($bootstrap.IndexOf($aclStart), $bootstrap.IndexOf($aclEnd) - $bootstrap.IndexOf($aclStart))
$aclAst = [Management.Automation.Language.Parser]::ParseInput($aclSource, [ref]$null, [ref]$null)
$applyAcl = @($aclAst.FindAll({ param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -ceq 'Set-Acl' }, $true))
if ($applyAcl.Count -ne 1) { throw 'cancellation-acl-application-seam-refused' }
$aclSource = $aclSource.Remove($applyAcl[0].Extent.StartOffset, $applyAcl[0].Extent.EndOffset - $applyAcl[0].Extent.StartOffset)
$account = @{ SID = [Security.Principal.SecurityIdentifier]::new('S-1-5-21-1-2-3-1001') }
$actualAcl = & ([scriptblock]::Create($aclSource + '; $acl'))
$rules = @($actualAcl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))
if (!$actualAcl.AreAccessRulesProtected -or !$actualAcl.AreAccessRulesCanonical -or $rules.Count -ne 3 -or
    $actualAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne 'S-1-5-32-544' -or
    (@($rules | ForEach-Object { $_.IdentityReference.Value } | Sort-Object) -join ',') -cne 'S-1-5-18,S-1-5-21-1-2-3-1001,S-1-5-32-544') { throw 'cancellation-acl-boundary-refused' }
foreach ($rule in $rules) {
    $rights = if ($rule.IdentityReference.Value -ceq $account.SID.Value) {
        [Security.AccessControl.FileSystemRights]::Modify -bor [Security.AccessControl.FileSystemRights]::Synchronize
    } else { [Security.AccessControl.FileSystemRights]::FullControl }
    if ($rule.FileSystemRights -ne $rights -or $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
        $rule.IsInherited -or $rule.InheritanceFlags -ne [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' -or
        $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None) { throw 'cancellation-acl-rights-refused' }
}
Write-Output 'pure-cancellation-native-acl-controls:4'
function Read-CloudCancellationFixtureDiagnostics([string]$Path) {
    if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    $entry = Get-Item -LiteralPath $Path -Force
    if ($entry.Length -gt 4096 -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return }
    $phases = 'Initialize|Pure|ForcedFailure|JobCreate|JobConfigure|ProcessCreate|JobAssign|StartupSignal|InventoryCapture|RuntimeAttach|RuntimeReady|RuntimeSeal|InventoryValidate|BeforeAckCheck|ReleaseAck|DescendantObserve|PayloadCheck|Cancellation|RootExit|DescendantExit|JobClosure|StderrCheck|Success'
    $pattern = '^(?:pure-cancellation-controls:[0-9]{1,2}|native-(?:before-ack-no-payload|after-ack-live-held-descendant):passed|native-observation:after=(?:True|False);release=(?:True|False);payload=(?:True|False)|cancellation-fixture-phase:(?:pure|control|before-ack|after-ack):(?:' + $phases + '))$'
    foreach ($line in [IO.File]::ReadAllLines($Path)) {
        if ($line.Length -le 128 -and $line -cmatch $pattern) { Write-Output $line }
    }
}
if ($PureOnly) { return }
$base = [IO.Path]::GetFullPath($env:TEMP)
$ancestor = Get-Item -LiteralPath $base -Force
while ($null -ne $ancestor) { if ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'cancellation-temp-refused' }; $ancestor = $ancestor.Parent }
$fixture = Join-Path $base ('aegis-cancellation-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$exe = Join-Path $fixture 'CancellationFixture.exe'
$sources = Join-Path $ProjectRoot 'scripts/qualification'
$fixtureSources = Join-Path $ProjectRoot 'tests/fixtures/native-cloud-guest-cancellation'
try {
    foreach ($leaf in @('cloud-cancellation-runtime.cjs', 'cloud-cancellation-child.cjs')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $leaf) -Destination $fixture }
    Copy-Item -LiteralPath (Join-Path $fixtureSources 'cancellation-client.cjs') -Destination $fixture
    $task = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'cloud-cancellation-task.cjs'))
    # Literal path substitutions affect this disposable test copy only.
    $task = $task.Replace('C:\\AegisLab\\work\\cancellation\\released.txt', (Join-Path $fixture 'released.txt').Replace('\', '\\'))
    $task = $task.Replace('C:\\ProgramData\\AegisCloudLab\\trusted\\cloud-cancellation-child.cjs', (Join-Path $fixture 'cloud-cancellation-child.cjs').Replace('\', '\\'))
    [IO.File]::WriteAllText((Join-Path $fixture 'cloud-cancellation-task.cjs'), $task, [Text.UTF8Encoding]::new($false))
    $arguments = @('/nologo', '/warnaserror+', '/target:exe', ('/out:"' + $exe + '"'))
    foreach ($leaf in @('CloudGuestProcess', 'CloudGuestDesktop', 'CloudGuestNetwork', 'CloudGuestClaudeReceiver', 'CloudGuestRuntimeGate')) { $arguments += ('"' + (Join-Path $sources ($leaf + '.cs')) + '"') }
    foreach ($leaf in @('CallerAdmission', 'CallerRegistration', 'CallerIdentity', 'CallerNative', 'GuestJobNative', 'GuestJobInventory')) { $arguments += ('"' + (Join-Path $ProjectRoot ('sidecar/session/' + $leaf + '.cs')) + '"') }
    $arguments += ('"' + (Join-Path $fixtureSources 'CancellationFixture.cs') + '"')
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    $code = Invoke-CloudGuestNativeProcess $compiler $arguments (Join-Path $fixture 'compile.txt') (Join-Path $fixture 'compile.error') 10000
    if ($code -ne 0 -or (Get-Item -LiteralPath $exe).Length -gt 80KB) { throw 'cancellation-native-compile-refused' }
    Write-Output ('cancellation-composite-bytes:' + (Get-Item -LiteralPath $exe).Length)
    $node = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $nativePath = Join-Path $fixture 'native.txt'
    try {
        $code = Invoke-CloudGuestNativeProcess $exe @(('"' + $node + '"'), ('"' + $fixture + '"')) $nativePath (Join-Path $fixture 'native.error') 15000
        $actual = [IO.File]::ReadAllText($nativePath)
        if ($code -ne 0 -or (Get-Item -LiteralPath (Join-Path $fixture 'native.error')).Length -ne 0 -or
            !$actual.Contains('pure-cancellation-controls:27') -or !$actual.Contains('native-before-ack-no-payload:passed') -or
            !$actual.Contains('native-after-ack-live-held-descendant:passed')) { throw 'cancellation-native-controls-refused' }
    } finally {
        # Retain only fixed fixture observations, also when the bounded process helper throws.
        Read-CloudCancellationFixtureDiagnostics $nativePath
    }
    $forcedPath = Join-Path $fixture 'forced.txt'
    try {
        $code = Invoke-CloudGuestNativeProcess $exe @(('"' + $node + '"'), ('"' + $fixture + '"'), '--force-diagnostic-failure') $forcedPath (Join-Path $fixture 'forced.error') 2000
        $diagnostics = @(Read-CloudCancellationFixtureDiagnostics $forcedPath)
        if ($code -ne 1 -or $diagnostics.Count -ne 1 -or $diagnostics[0] -cne 'cancellation-fixture-phase:control:ForcedFailure' -or
            [IO.File]::ReadAllText((Join-Path $fixture 'forced.error')).Trim() -cne 'cancellation-native-controls-refused') {
            throw 'cancellation-fixture-diagnostic-control-refused'
        }
        # Unknown phase and error text must never enter the maintained log.
        [IO.File]::AppendAllText($forcedPath, "unpublished-fixture-error-text
cancellation-fixture-phase:control:Unknown
")
        if (@(Read-CloudCancellationFixtureDiagnostics $forcedPath).Count -ne 1) { throw 'cancellation-fixture-diagnostic-filter-refused' }
        Write-Output 'cancellation-fixture-diagnostic-controls:2'
    } finally {
        Read-CloudCancellationFixtureDiagnostics $forcedPath
    }
} finally {
    # Fixed direct children only; no recursive deletion or traversal.
    foreach ($file in @(Get-ChildItem -LiteralPath $fixture -File -Force)) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 80KB -or
            !$file.FullName.StartsWith($fixture + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'cancellation-cleanup-refused' }
        Remove-Item -LiteralPath $file.FullName -Force
    }
    Remove-Item -LiteralPath $fixture
}
