function Assert-CloudGuestCancellationPreviousClosures($FirstPhase, $ClaudePhase) {
    try {
        $first = Assert-CloudGuestClaudeFirstPhase $FirstPhase
        if ($ClaudePhase.passed -isnot [bool] -or !$ClaudePhase.passed -or $ClaudePhase.secondPhaseObservationKnown -isnot [bool] -or
            !$ClaudePhase.secondPhaseObservationKnown -or $ClaudePhase.acceptancePassed -isnot [bool] -or $ClaudePhase.acceptancePassed) { throw 'refused' }
        $guest = $ClaudePhase.guestResult; $native = $guest.identity
        foreach ($name in @('passed', 'heldIdentityBeforeRelease', 'runtimeCallerAuthenticated', 'runtimeInitializedBeforeProject', 'taskReleased',
            'exitCodeObserved', 'jobClosureConfirmed', 'privateDesktopHandlesClosedAfterJobClosure', 'claudeReceiverExitObserved',
            'claudeReceiverStoppedAfterJobClosure', 'claudeReceiverResultWritten', 'claudeReceiverOutsideTaskJob')) {
            if ($native.$name -isnot [bool] -or !$native.$name) { throw 'refused' }
        }
        foreach ($name in @('claudeReceiverForced', 'claudeReceiverDisposalUnknown', 'claudeReceiverExpiredBeforeStop', 'elevated', 'administratorEnabled')) {
            if ($native.$name -isnot [bool] -or $native.$name) { throw 'refused' }
        }
        if ($native.sid -cne $first.sameSidForSecondPhase -or $native.exitCode -isnot [uint32] -and $native.exitCode -isnot [int] -or
            $native.exitCode -ne 0 -or $native.claudeReceiverExitCode -isnot [int] -or $native.claudeReceiverExitCode -ne 0) { throw 'refused' }
        foreach ($entry in @(@('claudeReceiverStopMilliseconds', 42499), @('claudeReceiverStopSubmittedMilliseconds', 43499), @('claudeReceiverExitMilliseconds', 44999))) {
            $value = $native.($entry[0])
            if (($value -isnot [long] -and $value -isnot [int]) -or $value -lt 0 -or $value -gt $entry[1]) { throw 'refused' }
        }
        if ($native.claudeReceiverStopSubmittedMilliseconds -lt $native.claudeReceiverStopMilliseconds -or
            $native.claudeReceiverExitMilliseconds -lt $native.claudeReceiverStopSubmittedMilliseconds -or
            !(Test-CloudGuestClaudeWitnessReceipt $guest.witness $first.sameSidForSecondPhase)) { throw 'refused' }
        foreach ($aggregate in @($guest, $guest.task, $guest.receiver)) {
            if ($aggregate.passed -isnot [bool] -or !$aggregate.passed) { throw 'refused' }
        }
        return @{ sid = $first.sameSidForSecondPhase; priorJobsClosed = $true; priorReceiversExited = $true; priorWitnessClosed = $true }
    } catch { throw 'cancellation-prior-closure-refused' }
}

function Test-CloudGuestCancellationResult($Value, [string]$ExpectedSid) {
    try {
        if ($Value.schemaVersion -isnot [int] -or $Value.schemaVersion -ne 1 -or $Value.passed -isnot [bool] -or !$Value.passed -or $Value.kind -cne 'fixed-cloud-cancellation' -or
            $Value.payloadAbsentBeforeRelease -isnot [bool] -or !$Value.payloadAbsentBeforeRelease -or
            $Value.payloadObservedAfterRelease -isnot [bool] -or !$Value.payloadObservedAfterRelease -or
            $Value.newReceiversStarted -isnot [bool] -or $Value.newReceiversStarted -or $null -ne $Value.failureStage) { return $false }
        foreach ($i in 0..1) {
            $case = if ($i -eq 0) { $Value.before } else { $Value.after }
            $label = if ($i -eq 0) { 'before-project-release' } else { 'after-release-live-descendant' }
            if ($case.case -cne $label -or $case.sid -cne $ExpectedSid -or $case.elevated -isnot [bool] -or $case.elevated -or
                $case.administratorGroupPresent -isnot [bool] -or $case.administratorGroupPresent -or
                $case.administratorEnabled -isnot [bool] -or $case.administratorEnabled) { return $false }
            foreach ($name in @('e2Qualified', 'e3Qualified', 'launchAllowed')) {
                if ($case.$name -isnot [bool] -or $case.$name -or $Value.$name -isnot [bool] -or $Value.$name) { return $false }
            }
            foreach ($name in @('pid', 'birthFileTime')) {
                $number = $case.$name
                if (($number -isnot [uint32] -and $number -isnot [int] -and $number -isnot [long]) -or $number -le 0 -or
                    ($name -ceq 'pid' -and $number -gt 4294967295)) { return $false }
            }
            foreach ($name in @('passed', 'heldIdentityBeforeRelease', 'runtimeCallerAuthenticated', 'runtimeInitializedBeforeProject',
                'cancellationRequested', 'cancellationHeldRootAlive', 'cleanupJobTerminationAccepted', 'exitCodeObserved', 'jobClosureConfirmed', 'privateDesktopHandlesClosedAfterJobClosure')) {
                if ($case.$name -isnot [bool] -or !$case.$name) { return $false }
            }
            if ($case.taskReleased -isnot [bool] -or $case.taskReleased -ne ($i -eq 1) -or
                $case.cancellationReceiverStarted -isnot [bool] -or $case.cancellationReceiverStarted -or
                $case.naturalCompletion -isnot [bool] -or $case.naturalCompletion -or $null -ne $case.failureStage -or
                ($case.exitCode -isnot [uint32] -and $case.exitCode -isnot [int]) -or $case.exitCode -ne 137) { return $false }
            if ($i -eq 1 -and ($case.descendantIdentityVerified -isnot [bool] -or !$case.descendantIdentityVerified -or
                $case.descendantExitObserved -isnot [bool] -or !$case.descendantExitObserved)) { return $false }
            if ($i -eq 1) {
                foreach ($name in @('descendantPid', 'descendantBirthFileTime')) {
                    $number = $case.$name
                    if (($number -isnot [uint32] -and $number -isnot [int] -and $number -isnot [long]) -or $number -le 0 -or
                        ($name -ceq 'descendantPid' -and $number -gt 4294967295)) { return $false }
                }
                if ($case.descendantPid -eq $case.pid) { return $false }
            }
        }
        return $true
    } catch { return $false }
}

function Invoke-CloudGuestCancellationPhase([string]$Id, [string]$Name, [string]$VmRoot, [pscredential]$Credential,
    [string]$TaskPassword, [string]$TransferRoot, $FirstPhase, $ClaudePhase) {
    Assert-CloudGuestRunner
    $gate = Assert-CloudGuestCancellationPreviousClosures $FirstPhase $ClaudePhase
    Get-CloudHostRouteSnapshot $Id $Name $VmRoot | Out-Null
    $file = Get-Item -LiteralPath (Join-Path $TransferRoot 'cloud-guest-cancellation-bootstrap.ps1') -Force
    if ($file.PSIsContainer -or $file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 64KB) { throw 'cancellation-fixed-source-refused' }
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $text = (Get-CloudGuestCancellationInvocation).ToString()
    $job = Start-Job -ArgumentList $Id, $Credential, $TaskPassword, $hash, $gate.sid, $text -ScriptBlock {
        param($Id, $Credential, $Password, $Hash, $Sid, $Text)
        $ErrorActionPreference = 'Stop'; $session = $null
        try {
            $session = New-PSSession -VMId ([guid]$Id) -Credential $Credential -ErrorAction Stop
            Invoke-Command -Session $session -ArgumentList $Password, $Id, $Hash, $Sid -ScriptBlock ([scriptblock]::Create($Text))
        } finally { if ($null -ne $session) { Remove-PSSession -Session $session -ErrorAction SilentlyContinue } }
    }
    $result = $null
    try {
        if ($null -eq (Wait-Job -Job $job -Timeout 30)) { throw 'cancellation-observation-unknown' }
        $values = @(Receive-Job -Job $job -ErrorAction Stop)
        if ($job.State -ne 'Completed' -or $values.Count -ne 1) { throw 'cancellation-observation-unknown' }
        $result = $values[0]
        $passed = Test-CloudGuestCancellationResult $result $gate.sid
        return @{ passed = [bool]$passed; controls = $result; ordering = $gate; e2Qualified = $false; e3Qualified = $false; launchAllowed = $false }
    } catch { return @{ passed = $false; controls = $result; ordering = $gate; failure = 'cancellation-unavailable-or-refused'; e2Qualified = $false; e3Qualified = $false; launchAllowed = $false } }
    finally { if ($job.State -in @('Running', 'NotStarted')) { Stop-Job -Job $job -ErrorAction SilentlyContinue }; Remove-Job -Job $job -Force -ErrorAction SilentlyContinue }
}

function Get-CloudGuestCancellationInvocation {
    return {
        param($Password, $VmId, $ExpectedHash, $ExpectedSid)
        $ErrorActionPreference = 'Stop'
        $phase = 'fixed-source-validation'
        try {
            if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage' -or
                $VmId -cnotmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' -or
                $ExpectedHash -cnotmatch '^[a-f0-9]{64}$' -or $ExpectedSid -cnotmatch '^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$') { throw 'cancellation-fixed-source-refused' }
            $fixedPath = 'C:\ProgramData\AegisCloudLab\trusted\cloud-guest-cancellation-bootstrap.ps1'
            $file = Get-Item -LiteralPath $fixedPath -Force
            if ($file.PSIsContainer -or $file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -lt 1 -or $file.Length -gt 64KB) { throw 'cancellation-fixed-source-refused' }
            $stream = [IO.File]::Open($fixedPath, 'Open', 'Read', 'Read')
            try {
                if ($stream.Length -ne $file.Length) { throw 'cancellation-fixed-source-refused' }
                $bytes = New-Object byte[] ([int]$stream.Length); $offset = 0
                while ($offset -lt $bytes.Length) { $count = $stream.Read($bytes, $offset, $bytes.Length - $offset); if ($count -le 0) { throw 'cancellation-fixed-source-refused' }; $offset += $count }
                if ($stream.ReadByte() -ne -1) { throw 'cancellation-fixed-source-refused' }
            } finally { $stream.Dispose() }
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $actual = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
            if ($actual -cne $ExpectedHash) { throw 'cancellation-fixed-source-refused' }
            $phase = 'fixed-source-parse'; $entry = [scriptblock]::Create([Text.UTF8Encoding]::new($false, $true).GetString($bytes))
            $env:AEGIS_CLOUD_GUEST_LAB = 'trusted-bootstrap-v1'; $env:AEGIS_CLOUD_GUEST_VM_ID = $VmId
            $env:GITHUB_ACTIONS = 'true'; $env:RUNNER_ENVIRONMENT = 'github-hosted'; $env:RUNNER_OS = 'Windows'
            $phase = 'fixed-source-invocation'; $value = & $entry -TaskPassword $Password -ExpectedSid $ExpectedSid
            if ($value -isnot [hashtable] -or $value.passed -isnot [bool] -or $value.kind -cne 'fixed-cloud-cancellation') { throw 'cancellation-fixed-result-refused' }
            return $value
        } catch {
            return @{ schemaVersion = 1; passed = $false; identity = $null; task = $null; receiver = $null;
                failureStage = $phase; failureHResult = [int]$_.Exception.HResult; acceptancePassed = $false;
                trustedTestProcessObservation = 'unknown'; e6Qualified = $false; launchAllowed = $false }
        }
    }
}

