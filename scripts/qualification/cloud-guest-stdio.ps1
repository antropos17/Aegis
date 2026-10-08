function Assert-CloudGuestStdioPreviousClosures($FirstPhase, $ClaudePhase, $CancellationPhase) {
    $ordering = Assert-CloudGuestCancellationPreviousClosures $FirstPhase $ClaudePhase
    if ($CancellationPhase.passed -isnot [bool] -or !$CancellationPhase.passed -or
        !(Test-CloudGuestCancellationResult $CancellationPhase.controls $ordering.sid)) { throw 'stdio-prior-closure-refused' }
    return $ordering
}
function Test-CloudGuestStdioResult($Value, [string]$ExpectedSid) {
    try {
        if ($Value.schemaVersion -isnot [int] -or $Value.schemaVersion -ne 1 -or $Value.kind -cne 'fixed-cloud-stdio' -or
            $Value.passed -isnot [bool] -or !$Value.passed -or $Value.inputsHeldThroughClosure -isnot [bool] -or !$Value.inputsHeldThroughClosure -or
            $Value.newReceiversStarted -isnot [bool] -or $Value.newReceiversStarted -or $null -ne $Value.failureStage -or $Value.cases.Count -ne 5) { return $false }
        foreach ($flag in @('e2Qualified', 'launchAllowed')) { if ($Value.$flag -isnot [bool] -or $Value.$flag) { return $false } }
        foreach ($at in 0..4) {
            $native = $Value.cases[$at]; $kind = $at + 1
            foreach ($field in @('passed', 'runtimeResumed', 'runtimeCallerAuthenticated', 'runtimeInitializedBeforeProject', 'taskReleased',
                'heldIdentityBeforeRelease', 'jobAssignedBeforeAdmission', 'privateDesktopCreated', 'privateDesktopParentRestored',
                'privateDesktopHandlesClosedAfterJobClosure', 'exitCodeObserved', 'jobClosureConfirmed', 'stdioHelperIdentityVerified',
                'stdioRetainedMembersExitObserved', 'stdioPassed', 'ownerNodeVersionPassed')) {
                if ($native.$field -isnot [bool] -or !$native.$field) { return $false }
            }
            foreach ($field in @('administratorGroupPresent', 'administratorEnabled', 'elevated', 'e2Qualified', 'launchAllowed')) {
                if ($native.$field -isnot [bool] -or $native.$field) { return $false }
            }
            if ($native.sid -cne $ExpectedSid -or $native.failureStage -ne $null -or $native.stdioCase -isnot [int] -or $native.stdioCase -ne $kind -or
                $native.tokenRequestedAccess -isnot [int] -or $native.tokenRequestedAccess -ne 8 -or
                ($native.exitCode -isnot [int] -and $native.exitCode -isnot [uint32]) -or $native.stdioHelperPid -eq $native.pid) { return $false }
            foreach ($field in @('pid', 'birthFileTime', 'stdioHelperPid', 'stdioHelperBirthFileTime')) {
                $number = $native.$field
                if (($number -isnot [int] -and $number -isnot [long] -and $number -isnot [uint32]) -or $number -le 0 -or
                    ($field -cin @('pid','stdioHelperPid') -and $number -gt 4294967295)) { return $false }
            }
            foreach ($field in @('stdioInputBytes', 'stdioOutputBytes', 'stdioErrorBytes')) {
                $number = $native.$field
                if ($number -isnot [int] -or $number -lt 0 -or $number -gt 65536) { return $false }
            }
            foreach ($field in @('stdioInputEof', 'stdioOutputEof', 'stdioErrorEof', 'stdioBytesMatched')) { if ($native.$field -isnot [bool]) { return $false } }
            if ($kind -le 2) {
                if ($native.stdioOutcome -cne 'Complete' -or !$native.stdioBytesMatched -or !$native.stdioInputEof -or !$native.stdioOutputEof -or !$native.stdioErrorEof -or
                    $native.stdioNaturalRootExitObserved -isnot [bool] -or !$native.stdioNaturalRootExitObserved -or $native.exitCode -ne 0 -or $native.stdioInputBytes -ne 8192 -or
                    $native.stdioOutputBytes -ne $(if ($kind -eq 1) { 8192 } else { 56192 }) -or $native.stdioErrorBytes -ne $(if ($kind -eq 1) { 8192 } else { 48000 })) { return $false }
            } else {
                if ($native.stdioRootLiveBeforeTermination -isnot [bool] -or !$native.stdioRootLiveBeforeTermination -or $native.exitCode -ne 137 -or $native.stdioBytesMatched) { return $false }
                if ($kind -le 4 -and ($native.stdioOutcome -cne 'OutputLimit' -or $native.stdioOutputBytes -gt $(if ($kind -eq 3) { 1024 } else { 65536 }) -or
                    $native.stdioErrorBytes -gt $(if ($kind -eq 4) { 1024 } else { 65536 }))) { return $false }
                if ($kind -eq 5 -and ($native.stdioOutcome -cne 'Cancelled' -or $native.stdioCancellationHeldPayloadAlive -isnot [bool] -or !$native.stdioCancellationHeldPayloadAlive)) { return $false }
            }
        }
        return $true
    } catch { return $false }
}
function Invoke-CloudGuestStdioPhase([string]$Id, [string]$Name, [string]$VmRoot, [pscredential]$Credential,
    [string]$TaskPassword, [string]$TransferRoot, $FirstPhase, $ClaudePhase, $CancellationPhase) {
    Assert-CloudGuestRunner
    $gate = Assert-CloudGuestStdioPreviousClosures $FirstPhase $ClaudePhase $CancellationPhase
    Get-CloudHostRouteSnapshot $Id $Name $VmRoot | Out-Null
    $file = Get-Item -LiteralPath (Join-Path $TransferRoot 'cloud-guest-stdio-bootstrap.ps1') -Force
    if ($file.PSIsContainer -or $file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -lt 1 -or $file.Length -gt 64KB) { throw 'stdio-fixed-source-refused' }
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $text = (Get-CloudGuestStdioInvocation).ToString()
    $job = Start-Job -ArgumentList $Id, $Credential, $TaskPassword, $hash, $gate.sid, $text -ScriptBlock {
        param($Id, $Credential, $Password, $Hash, $Sid, $Text)
        $ErrorActionPreference = 'Stop'; $session = $null
        try { $session = New-PSSession -VMId ([guid]$Id) -Credential $Credential -ErrorAction Stop; Invoke-Command -Session $session -ArgumentList $Password, $Id, $Hash, $Sid -ScriptBlock ([scriptblock]::Create($Text)) }
        finally { if ($null -ne $session) { Remove-PSSession -Session $session -ErrorAction SilentlyContinue } }
    }
    $result = $null
    try {
        if ($null -eq (Wait-Job -Job $job -Timeout 60)) { throw 'stdio-observation-unknown' }
        $values = @(Receive-Job -Job $job -ErrorAction Stop)
        if ($job.State -ne 'Completed' -or $values.Count -ne 1) { throw 'stdio-observation-unknown' }
        $result = $values[0]; $passed = Test-CloudGuestStdioResult $result $gate.sid
        return @{ passed = [bool]$passed; controls = $result; ordering = $gate; e2Qualified = $false; launchAllowed = $false }
    } catch { return @{ passed = $false; controls = $result; ordering = $gate; failure = 'stdio-unavailable-or-refused'; e2Qualified = $false; launchAllowed = $false } }
    finally { if ($job.State -in @('Running', 'NotStarted')) { Stop-Job -Job $job -ErrorAction SilentlyContinue }; Remove-Job -Job $job -Force -ErrorAction SilentlyContinue }
}
function Get-CloudGuestStdioInvocation {
    return {
        param($Password, $VmId, $ExpectedHash, $ExpectedSid)
        $ErrorActionPreference = 'Stop'; $stage = 'fixed-source'
        try {
            if ($ExecutionContext.SessionState.LanguageMode -cne 'FullLanguage' -or $VmId -cnotmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' -or
                $ExpectedHash -cnotmatch '^[a-f0-9]{64}$' -or $ExpectedSid -cnotmatch '^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$') { throw 'stdio-fixed-source-refused' }
            $path = 'C:\ProgramData\AegisCloudLab\trusted\cloud-guest-stdio-bootstrap.ps1'
            $file = Get-Item -LiteralPath $path -Force
            if ($file.PSIsContainer -or $file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -lt 1 -or $file.Length -gt 64KB) { throw 'stdio-fixed-source-refused' }
            $held = [IO.File]::Open($path, 'Open', 'Read', 'Read')
            try {
                if ($held.Length -ne $file.Length) { throw 'stdio-fixed-source-refused' }
                $bytes = New-Object byte[] ([int]$held.Length); $offset = 0
                while ($offset -lt $bytes.Length) { $read = $held.Read($bytes, $offset, $bytes.Length - $offset); if ($read -le 0) { throw 'stdio-fixed-source-refused' }; $offset += $read }
                if ($held.ReadByte() -ne -1) { throw 'stdio-fixed-source-refused' }
                $sha = [Security.Cryptography.SHA256]::Create()
                try { $actual = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
                if ($actual -cne $ExpectedHash) { throw 'stdio-fixed-source-refused' }
                $entry = [scriptblock]::Create([Text.UTF8Encoding]::new($false, $true).GetString($bytes))
                $env:AEGIS_CLOUD_GUEST_LAB = 'trusted-bootstrap-v1'; $env:AEGIS_CLOUD_GUEST_VM_ID = $VmId
                $env:GITHUB_ACTIONS = 'true'; $env:RUNNER_ENVIRONMENT = 'github-hosted'; $env:RUNNER_OS = 'Windows'
                $stage = 'fixed-invocation'; $value = & $entry -TaskPassword $Password -ExpectedSid $ExpectedSid
                if ($value -isnot [hashtable] -or $value.kind -cne 'fixed-cloud-stdio') { throw 'stdio-fixed-source-refused' }
                return $value
            } finally { $held.Dispose() }
        } catch { return @{ schemaVersion = 1; kind = 'fixed-cloud-stdio'; passed = $false; cases = @(); failureStage = $stage; e2Qualified = $false; launchAllowed = $false } }
    }
}
