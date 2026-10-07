# External qualification adapter. Pure prerequisites run before any second-phase effect.
function Assert-CloudGuestClaudeFirstPhase($FirstPhase) {
    function Need($Value) { if (!$Value) { throw 'claude-first-phase-not-closed' } }
    function ExactBool($Value, [bool]$Expected) { return $Value -is [bool] -and $Value -eq $Expected }
    function Number($Value, [long]$Maximum) {
        return ($Value -is [int] -or $Value -is [long] -or $Value -is [uint32]) -and $Value -ge 0 -and $Value -le $Maximum
    }
    try {
        # The caller retains this admin-produced native/receiver observation. Project
        # JSON booleans cannot authorize the second Job or establish receiver closure.
        $first = $FirstPhase.guestResult.identity
        foreach ($name in @('passed', 'heldIdentityBeforeRelease', 'runtimeCallerAuthenticated', 'runtimeInitializedBeforeProject',
            'taskReleased', 'exitCodeObserved', 'jobClosureConfirmed', 'privateDesktopHandlesClosedAfterJobClosure',
            'networkReceiverExitObserved', 'networkReceiverResultWritten', 'networkReceiverStoppedAfterJobClosure')) {
            Need (ExactBool $first.$name $true)
        }
        foreach ($name in @('elevated', 'administratorEnabled', 'networkReceiverForced', 'networkReceiverDisposalUnknown', 'networkReceiverExpiredBeforeStop')) {
            Need (ExactBool $first.$name $false)
        }
        Need ((Number $first.exitCode 0) -and (Number $first.networkReceiverExitCode 0))
        Need ((Number $first.networkReceiverStopMilliseconds 17499) -and (Number $first.networkReceiverStopSubmittedMilliseconds 17499) -and
            (Number $first.networkReceiverExitMilliseconds 17999) -and $first.networkReceiverStopSubmittedMilliseconds -ge $first.networkReceiverStopMilliseconds -and
            $first.networkReceiverExitMilliseconds -ge $first.networkReceiverStopSubmittedMilliseconds)
        foreach ($name in @('runtimeResumed', 'networkReceiverOutsideTaskJob', 'networkReceiverAdministratorEnabled',
            'networkReceiverSameOwnerSid', 'networkReceiverStartedAfterHeldAdmission', 'networkReceiverStartedAfterRuntimeReady')) {
            Need (ExactBool $first.$name $true)
        }
        Need ((Number $first.pid 4294967295) -and $first.pid -gt 0 -and (Number $first.birthFileTime ([long]::MaxValue)) -and $first.birthFileTime -gt 0)
        Need ((Number $first.networkReceiverPid 4294967295) -and $first.networkReceiverPid -gt 0 -and
            (Number $first.networkReceiverBirthFileTime ([long]::MaxValue)) -and $first.networkReceiverBirthFileTime -gt 0)
        $calibration = $FirstPhase.guestResult.networkControls.receiver
        Need ((ExactBool $calibration.closed $true) -and (ExactBool $calibration.receiverError $false))
        Need ((Number $calibration.accepted 4) -and $calibration.accepted -eq 4 -and
            (Number $calibration.rejected 0) -and (Number $calibration.openConnections 0))
        Need ($calibration.scope -ceq 'loopback-calibration' -and (Number $calibration.schemaVersion 1) -and $calibration.schemaVersion -eq 1 -and
            $calibration.nonceDigest -is [string] -and $calibration.nonceDigest -cmatch '^[a-f0-9]{64}$')
        $owner = $FirstPhase.hostRoutes.owner; $receiver = $FirstPhase.hostRoutes.receiver
        foreach ($name in @('heldProcess', 'birthObserved', 'imagePinned', 'exitObserved', 'closed', 'stopAfterJobClosure')) { Need (ExactBool $owner.$name $true) }
        Need ((ExactBool $owner.forced $false) -and (Number $owner.exitCode 0))
        Need ((Number $owner.stopMilliseconds 109999) -and (Number $owner.exitMilliseconds 114999) -and $owner.exitMilliseconds -ge $owner.stopMilliseconds)
        foreach ($name in @('positivePassed', 'socketsClosed', 'stoppedOnRequest')) { Need (ExactBool $receiver.$name $true) }
        Need (ExactBool $receiver.expired $false)
        Need ((Number $receiver.stopMilliseconds 109999) -and (Number $receiver.closedMilliseconds 114999) -and
            $receiver.closedMilliseconds -ge $receiver.stopMilliseconds)
        Need ($first.sid -is [string] -and $first.sid -cmatch '^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$')
        # Additional corpus refusals cannot replace any native/independent authority above.
        foreach ($aggregate in @($FirstPhase.guestResult, $FirstPhase.guestResult.networkControls,
            $FirstPhase.guestResult.gitControls, $FirstPhase.hostRoutes)) { Need (ExactBool $aggregate.passed $true) }
        return @{ firstPhaseClosed = $true; sameSidForSecondPhase = $first.sid; firstRootPid = $first.pid;
            firstRootBirthFileTime = $first.birthFileTime; oldReceiversAlreadyExited = $true;
            secondPhaseStarted = $false; e6Qualified = $false; launchAllowed = $false }
    }
    catch { throw 'claude-first-phase-not-closed' }
}

function Get-CloudGuestClaudeBootstrapInvocation {
    return {
        param($Password, $VmId, $ExpectedHash, $ExpectedSid)
        $ErrorActionPreference = 'Stop'
        $phase = 'fixed-source-validation'
        try {
            if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage' -or
                $VmId -cnotmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' -or
                $ExpectedHash -cnotmatch '^[a-f0-9]{64}$' -or $ExpectedSid -cnotmatch '^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$') { throw 'claude-fixed-source-refused' }
            $fixedPath = 'C:\ProgramData\AegisCloudLab\trusted\cloud-guest-claude-bootstrap.ps1'
            $file = Get-Item -LiteralPath $fixedPath -Force
            if ($file.PSIsContainer -or $file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -lt 1 -or $file.Length -gt 64KB) { throw 'claude-fixed-source-refused' }
            $stream = [IO.File]::Open($fixedPath, 'Open', 'Read', 'Read')
            try {
                if ($stream.Length -ne $file.Length) { throw 'claude-fixed-source-refused' }
                $bytes = New-Object byte[] ([int]$stream.Length); $offset = 0
                while ($offset -lt $bytes.Length) { $count = $stream.Read($bytes, $offset, $bytes.Length - $offset); if ($count -le 0) { throw 'claude-fixed-source-refused' }; $offset += $count }
                if ($stream.ReadByte() -ne -1) { throw 'claude-fixed-source-refused' }
            } finally { $stream.Dispose() }
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $actual = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
            if ($actual -cne $ExpectedHash) { throw 'claude-fixed-source-refused' }
            $phase = 'fixed-source-parse'; $entry = [scriptblock]::Create([Text.UTF8Encoding]::new($false, $true).GetString($bytes))
            $env:AEGIS_CLOUD_GUEST_LAB = 'trusted-bootstrap-v1'; $env:AEGIS_CLOUD_GUEST_VM_ID = $VmId
            $env:GITHUB_ACTIONS = 'true'; $env:RUNNER_ENVIRONMENT = 'github-hosted'; $env:RUNNER_OS = 'Windows'
            $phase = 'fixed-source-invocation'; $value = & $entry -TaskPassword $Password -ExpectedSid $ExpectedSid
            if ($value -isnot [hashtable] -or $value.passed -isnot [bool] -or $value.acceptancePassed -isnot [bool] -or
                $value.acceptancePassed -or $value.trustedTestProcessObservation -cne 'unknown') { throw 'claude-fixed-result-refused' }
            return $value
        } catch {
            return @{ schemaVersion = 1; passed = $false; identity = $null; task = $null; receiver = $null;
                failureStage = $phase; failureHResult = [int]$_.Exception.HResult; acceptancePassed = $false;
                trustedTestProcessObservation = 'unknown'; e6Qualified = $false; launchAllowed = $false }
        }
    }
}

function Invoke-CloudGuestClaudePhase([string]$Id, [string]$Name, [string]$VmRoot, [pscredential]$Credential,
    [string]$TaskPassword, [string]$TransferRoot, $FirstPhase) {
    Assert-CloudGuestRunner
    $gate = Assert-CloudGuestClaudeFirstPhase $FirstPhase
    # Read-only exact VM identity/config/no-NIC observation; no new receiver/network exposure.
    Get-CloudHostRouteSnapshot $Id $Name $VmRoot | Out-Null
    $sourceFile = Get-Item -LiteralPath (Join-Path $TransferRoot 'cloud-guest-claude-bootstrap.ps1') -Force
    if ($sourceFile.Attributes -band [IO.FileAttributes]::ReparsePoint -or $sourceFile.Length -gt 64KB) { throw 'claude-fixed-source-refused' }
    $expectedHash = (Get-FileHash -LiteralPath $sourceFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $entryText = (Get-CloudGuestClaudeBootstrapInvocation).ToString()
    $job = Start-Job -ArgumentList $Id, $Credential, $TaskPassword, $expectedHash, $gate.sameSidForSecondPhase, $entryText -ScriptBlock {
        param($Id, $Credential, $TaskPassword, $ExpectedHash, $ExpectedSid, $EntryText)
        $ErrorActionPreference = 'Stop'; $session = $null
        try {
            $session = New-PSSession -VMId ([guid]$Id) -Credential $Credential -ErrorAction Stop
            return (Invoke-Command -Session $session -ArgumentList $TaskPassword, $Id, $ExpectedHash, $ExpectedSid -ScriptBlock ([scriptblock]::Create($EntryText)))
        } finally { if ($null -ne $session) { Remove-PSSession -Session $session -ErrorAction SilentlyContinue } }
    }
    try {
        if ($null -eq (Wait-Job -Job $job -Timeout 90)) { throw 'claude-second-phase-observation-unknown' }
        $values = @(Receive-Job -Job $job -ErrorAction Stop)
        if ($job.State -ne 'Completed' -or $values.Count -ne 1) { throw 'claude-second-phase-observation-unknown' }
        $result = $values[0]
        if ($result.passed -isnot [bool] -or $result.acceptancePassed -isnot [bool] -or $result.acceptancePassed -or
            $result.trustedTestProcessObservation -cne 'unknown') { throw 'claude-second-phase-observation-unknown' }
        # A refused native attempt can precede SID observation. Preserve that
        # authoritative failure rather than losing it to StrictMode property access.
        if ($result.passed -and ($null -eq $result.identity -or $result.identity.sid -cne $gate.sameSidForSecondPhase)) { throw 'claude-second-phase-identity-refused' }
        return @{ gate = $gate; guestResult = $result; passed = $result.passed; acceptancePassed = $false;
            e6Qualified = $false; launchAllowed = $false; secondPhaseObservationKnown = $true }
    } catch {
        return @{ gate = $gate; guestResult = $null; passed = $false; acceptancePassed = $false; e6Qualified = $false;
            launchAllowed = $false; secondPhaseObservationKnown = $false; failure = 'claude-second-phase-unavailable-or-refused'; failureHResult = [int]$_.Exception.HResult }
    } finally { if ($job.State -in @('Running', 'NotStarted')) { Stop-Job -Job $job -ErrorAction SilentlyContinue }; Remove-Job -Job $job -Force -ErrorAction SilentlyContinue }
}
