Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'cloud-guest-owner-lifetime-reader.ps1')

function Assert-CloudGuestOwnerLifetimePreviousClosures($FirstPhase, $ClaudePhase, $CancellationPhase, $StdioPhase) {
    $gate = Assert-CloudGuestStdioPreviousClosures $FirstPhase $ClaudePhase $CancellationPhase
    if ($StdioPhase.passed -isnot [bool] -or !$StdioPhase.passed -or !(Test-CloudGuestStdioResult $StdioPhase.controls $gate.sid)) { throw 'owner-lifetime-prior-closure-refused' }
    return $gate
}

function Test-CloudGuestOwnerLifetimeResult($Value, [string]$ExpectedSid) {
    try {
        if ($Value.schemaVersion -isnot [int] -or $Value.schemaVersion -ne 1 -or $Value.kind -cne 'fixed-cloud-owner-lifetime' -or
            $Value.passed -isnot [bool] -or !$Value.passed -or $null -ne $Value.failureStage -or
            $Value.newReceiversStarted -isnot [bool] -or $Value.newReceiversStarted -or
            $Value.inputPinsVerified -isnot [bool] -or !$Value.inputPinsVerified -or
            $Value.inputsHeldThroughClosure -isnot [bool] -or !$Value.inputsHeldThroughClosure) { return $false }
        foreach ($flag in @('e2Qualified', 'e3Qualified', 'e6Qualified', 'acceptancePassed', 'launchAllowed', 'fullE33Accepted')) {
            if ($Value.$flag -isnot [bool] -or $Value.$flag) { return $false }
        }
        $native = $Value.native
        Assert-CloudGuestOwnerLifetimeOuterClosure $native $ExpectedSid
        foreach ($flag in @('privateDesktopCreated', 'privateDesktopParentRestored', 'privateDesktopHandlesClosedAfterJobClosure', 'ownerNodeVersionPassed')) {
            if ($native.$flag -isnot [bool] -or !$native.$flag) { return $false }
        }
        foreach ($flag in @('administratorGroupPresent', 'administratorEnabled', 'elevated', 'acceptancePassed', 'e6Qualified', 'launchAllowed')) {
            if ($native.$flag -isnot [bool] -or $native.$flag) { return $false }
        }
        if ($native.verificationKind -cne 'fixed-owner-lifetime-runtime' -or $native.tokenRequestedAccess -isnot [int] -or $native.tokenRequestedAccess -ne 8) { return $false }
        $controls = $Value.controls
        if ($controls.schemaVersion -isnot [int] -or $controls.schemaVersion -ne 1 -or $controls.kind -cne 'fixed-controlled-owner-exit' -or
            $controls.passed -isnot [bool] -or !$controls.passed -or $controls.cases.Count -ne 2) { return $false }
        foreach ($flag in @('e2Qualified', 'e3Qualified', 'e6Qualified', 'acceptancePassed', 'launchAllowed', 'fullE33Accepted')) {
            if ($controls.$flag -isnot [bool] -or $controls.$flag) { return $false }
        }
        return (Test-CloudGuestOwnerLifetimeCase $controls.cases[0] $ExpectedSid $true -RequireStandardPrincipal) -and
            (Test-CloudGuestOwnerLifetimeCase $controls.cases[1] $ExpectedSid $false -RequireStandardPrincipal)
    } catch { return $false }
}

function Invoke-CloudGuestOwnerLifetimePhase([string]$Id, [string]$Name, [string]$VmRoot, [pscredential]$Credential,
    [string]$TaskPassword, [string]$TransferRoot, $FirstPhase, $ClaudePhase, $CancellationPhase, $StdioPhase) {
    Assert-CloudGuestRunner
    $gate = Assert-CloudGuestOwnerLifetimePreviousClosures $FirstPhase $ClaudePhase $CancellationPhase $StdioPhase
    Get-CloudHostRouteSnapshot $Id $Name $VmRoot | Out-Null
    $file = Get-Item -LiteralPath (Join-Path $TransferRoot 'cloud-guest-owner-lifetime-bootstrap.ps1') -Force
    if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -lt 1 -or $file.Length -gt 64KB) { throw 'owner-lifetime-fixed-source-refused' }
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $text = (Get-CloudGuestOwnerLifetimeInvocation).ToString()
    $job = Start-Job -ArgumentList $Id, $Credential, $TaskPassword, $hash, $gate.sid, $text -ScriptBlock {
        param($Id, $Credential, $Password, $Hash, $Sid, $Text)
        $ErrorActionPreference = 'Stop'; $session = $null
        try { $session = New-PSSession -VMId ([guid]$Id) -Credential $Credential -ErrorAction Stop; Invoke-Command -Session $session -ArgumentList $Password, $Id, $Hash, $Sid -ScriptBlock ([scriptblock]::Create($Text)) }
        finally { if ($null -ne $session) { Remove-PSSession -Session $session -ErrorAction SilentlyContinue } }
    }
    $result = $null
    try {
        if ($null -eq (Wait-Job -Job $job -Timeout 60)) { throw 'owner-lifetime-observation-unknown' }
        $values = @(Receive-Job -Job $job -ErrorAction Stop)
        if ($job.State -ne 'Completed' -or $values.Count -ne 1) { throw 'owner-lifetime-observation-unknown' }
        $result = $values[0]; $passed = Test-CloudGuestOwnerLifetimeResult $result $gate.sid
        return @{ passed = [bool]$passed; controls = $result; ordering = $gate; e2Qualified = $false; e3Qualified = $false;
            e6Qualified = $false; acceptancePassed = $false; launchAllowed = $false; fullE33Accepted = $false }
    } catch { return @{ passed = $false; controls = $result; ordering = $gate; failure = 'owner-lifetime-unavailable-or-refused';
        e2Qualified = $false; e3Qualified = $false; e6Qualified = $false; acceptancePassed = $false; launchAllowed = $false; fullE33Accepted = $false } }
    finally { if ($job.State -in @('Running', 'NotStarted')) { Stop-Job -Job $job -ErrorAction SilentlyContinue }; Remove-Job -Job $job -Force -ErrorAction SilentlyContinue }
}

function Get-CloudGuestOwnerLifetimeInvocation {
    return {
        param($Password, $VmId, $ExpectedHash, $ExpectedSid)
        $ErrorActionPreference = 'Stop'; $stage = 'fixed-source'
        try {
            if ($ExecutionContext.SessionState.LanguageMode -cne 'FullLanguage' -or $VmId -cnotmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' -or
                $ExpectedHash -cnotmatch '^[a-f0-9]{64}$' -or $ExpectedSid -cnotmatch '^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$') { throw 'owner-lifetime-fixed-source-refused' }
            $path = 'C:\ProgramData\AegisCloudLab\trusted\cloud-guest-owner-lifetime-bootstrap.ps1'
            $file = Get-Item -LiteralPath $path -Force
            if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -lt 1 -or $file.Length -gt 64KB) { throw 'owner-lifetime-fixed-source-refused' }
            $held = [IO.File]::Open($path, 'Open', 'Read', 'Read')
            try {
                if ($held.Length -ne $file.Length) { throw 'owner-lifetime-fixed-source-refused' }
                $bytes = New-Object byte[] ([int]$held.Length); $offset = 0
                while ($offset -lt $bytes.Length) { $read = $held.Read($bytes, $offset, $bytes.Length - $offset); if ($read -le 0) { throw 'owner-lifetime-fixed-source-refused' }; $offset += $read }
                if ($held.ReadByte() -ne -1) { throw 'owner-lifetime-fixed-source-refused' }
                $sha = [Security.Cryptography.SHA256]::Create()
                try { $actual = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
                if ($actual -cne $ExpectedHash) { throw 'owner-lifetime-fixed-source-refused' }
                $entry = [scriptblock]::Create([Text.UTF8Encoding]::new($false, $true).GetString($bytes))
                $env:AEGIS_CLOUD_GUEST_LAB = 'trusted-bootstrap-v1'; $env:AEGIS_CLOUD_GUEST_VM_ID = $VmId
                $env:GITHUB_ACTIONS = 'true'; $env:RUNNER_ENVIRONMENT = 'github-hosted'; $env:RUNNER_OS = 'Windows'
                $stage = 'fixed-invocation'; $value = & $entry -TaskPassword $Password -ExpectedSid $ExpectedSid
                if ($value -isnot [hashtable] -or $value.kind -cne 'fixed-cloud-owner-lifetime') { throw 'owner-lifetime-fixed-source-refused' }
                return $value
            } finally { $held.Dispose() }
        } catch { return @{ schemaVersion = 1; kind = 'fixed-cloud-owner-lifetime'; passed = $false; native = $null; controls = $null;
            failureStage = $stage; e2Qualified = $false; e3Qualified = $false; e6Qualified = $false; acceptancePassed = $false; launchAllowed = $false; fullE33Accepted = $false } }
    }
}
