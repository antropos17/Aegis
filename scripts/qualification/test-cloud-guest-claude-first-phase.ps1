Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'cloud-guest-claude-phase.ps1')
$native = @{ passed = $true; heldIdentityBeforeRelease = $true; runtimeCallerAuthenticated = $true; runtimeInitializedBeforeProject = $true;
    taskReleased = $true; exitCodeObserved = $true; jobClosureConfirmed = $true; privateDesktopHandlesClosedAfterJobClosure = $true;
    networkReceiverExitObserved = $true; networkReceiverResultWritten = $true; networkReceiverStoppedAfterJobClosure = $true;
    elevated = $false; administratorEnabled = $false; networkReceiverForced = $false; networkReceiverDisposalUnknown = $false;
    networkReceiverExpiredBeforeStop = $false; exitCode = 0; networkReceiverExitCode = 0; networkReceiverStopMilliseconds = 10000;
    networkReceiverStopSubmittedMilliseconds = 10001; networkReceiverExitMilliseconds = 10100; sid = 'S-1-5-21-1-2-3-1001';
    runtimeResumed = $true; networkReceiverOutsideTaskJob = $true; networkReceiverAdministratorEnabled = $true;
    networkReceiverSameOwnerSid = $true; networkReceiverStartedAfterHeldAdmission = $true; networkReceiverStartedAfterRuntimeReady = $true;
    pid = 1234; birthFileTime = 123456789L; networkReceiverPid = 5678; networkReceiverBirthFileTime = 123456799L }
$owner = @{ heldProcess = $true; birthObserved = $true; imagePinned = $true; exitObserved = $true; closed = $true;
    stopAfterJobClosure = $true; forced = $false; exitCode = 0; stopMilliseconds = 30000; exitMilliseconds = 30100 }
$receiver = @{ positivePassed = $true; socketsClosed = $true; stoppedOnRequest = $true; expired = $false; stopMilliseconds = 29900; closedMilliseconds = 30000 }
$calibration = @{ closed = $true; receiverError = $false; accepted = 4; rejected = 0; openConnections = 0;
    scope = 'loopback-calibration'; schemaVersion = 1; nonceDigest = ('a' * 64) }
$first = @{ guestResult = @{ passed = $true; identity = $native; networkControls = @{ passed = $true; receiver = $calibration }; gitControls = @{ passed = $true } };
    hostRoutes = @{ passed = $true; owner = $owner; receiver = $receiver } }
$positive = Assert-CloudGuestClaudeFirstPhase $first
if (!$positive.firstPhaseClosed -or $positive.secondPhaseStarted -or $positive.launchAllowed) { throw 'positive-control-refused' }
$passed = 1
foreach ($entry in @(@('native', 'jobClosureConfirmed', $false), @('native', 'jobClosureConfirmed', 'true'),
    @('native', 'exitCodeObserved', $false), @('native', 'exitCode', 1), @('native', 'exitCode', '0'),
    @('native', 'privateDesktopHandlesClosedAfterJobClosure', $false), @('native', 'runtimeCallerAuthenticated', $false),
    @('native', 'networkReceiverExpiredBeforeStop', $true), @('native', 'networkReceiverForced', $true),
    @('native', 'networkReceiverDisposalUnknown', $true), @('native', 'networkReceiverStopMilliseconds', 17500),
    @('native', 'networkReceiverStopSubmittedMilliseconds', 17500), @('native', 'networkReceiverExitMilliseconds', 18000),
    @('native', 'networkReceiverExitMilliseconds', 9999), @('native', 'sid', 'S-1-5-18'),
    @('owner', 'exitObserved', $false), @('owner', 'exitCode', 7), @('owner', 'forced', $true),
    @('owner', 'stopAfterJobClosure', $false), @('owner', 'stopMilliseconds', 110000), @('owner', 'exitMilliseconds', 115000),
    @('receiver', 'socketsClosed', $false), @('receiver', 'stoppedOnRequest', $false), @('receiver', 'expired', $true))) {
    $selected = if ($entry[0] -eq 'native') { $native } elseif ($entry[0] -eq 'owner') { $owner } else { $receiver }
    $original = $selected[$entry[1]]; $selected[$entry[1]] = $entry[2]
    try {
        $refused = $false
        try { Assert-CloudGuestClaudeFirstPhase $first | Out-Null } catch { $refused = $_.Exception.Message -ceq 'claude-first-phase-not-closed' }
        if (!$refused) { throw 'mutation-control-not-refused' }; $passed++
    }
    finally { $selected[$entry[1]] = $original }
}
foreach ($selected in @($first.guestResult, $first.guestResult.networkControls, $first.guestResult.gitControls, $first.hostRoutes)) {
    $selected.passed = $false
    # Valid independent closure still refuses a failed first corpus. Aggregate
    # truth remains insufficient when any native mutation above invalidates closure.
    try { $refused = $false; try { Assert-CloudGuestClaudeFirstPhase $first | Out-Null } catch { $refused = $true }; if (!$refused) { throw 'prior-corpus-refusal-lost' }; $passed++ }
    finally { $selected.passed = $true }
}
foreach ($entry in @(@('closed', $false), @('receiverError', $true), @('accepted', 3), @('openConnections', 1), @('scope', 'project-claimed'))) {
    $original = $calibration[$entry[0]]; $calibration[$entry[0]] = $entry[1]
    try { $refused = $false; try { Assert-CloudGuestClaudeFirstPhase $first | Out-Null } catch { $refused = $true }; if (!$refused) { throw 'independent-receiver-refusal-lost' }; $passed++ }
    finally { $calibration[$entry[0]] = $original }
}
@{ passed = $passed; total = 34; scope = 'synthetic-pure-first-phase-closure-gate'; nativeOrGuestEffects = $false } | ConvertTo-Json -Compress
