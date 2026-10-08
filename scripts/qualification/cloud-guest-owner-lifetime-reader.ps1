Set-StrictMode -Version Latest

# Validate native observations from this fixed executable; guest bytes grant no authority.
function Test-CloudGuestOwnerLifetimeCase($Value, [string]$ExpectedSid, [bool]$Recovery, [switch]$RequireStandardPrincipal) {
    if ($null -eq $Value -or $Value -isnot [Collections.IDictionary]) { return $false }
    foreach ($key in @('case', 'sid', 'failureStage')) { if (!$Value.ContainsKey($key)) { return $false } }
    if (!$Value.ContainsKey('standardPrincipalVerified') -or $Value.standardPrincipalVerified -isnot [bool] -or
        ($RequireStandardPrincipal -and !$Value.standardPrincipalVerified)) { return $false }
    $kind = if ($Recovery) { 'owner-controlled-exit-controller-recovery' } else { 'owner-controlled-exit-kill-on-close' }
    if ($Value.case -cne $kind -or $Value.sid -cne $ExpectedSid -or $null -ne $Value.failureStage) { return $false }
    foreach ($key in @('passed', 'ownerAliveBeforeOwnerExit', 'ownerExitObserved', 'heldIdentitiesVerifiedBeforeOwnerExit',
        'liveClosureRefused', 'rootExitObserved', 'descendantExitObserved', 'heldCensusExitObserved',
        'rootImageMatched', 'descendantImageMatched', 'principalsMatched', 'censusPrincipalsMatched')) {
        if (!$Value.ContainsKey($key) -or $Value[$key] -isnot [bool] -or !$Value[$key]) { return $false }
    }
    foreach ($key in @('launchAllowed', 'e2Qualified', 'e3Qualified', 'e6Qualified', 'acceptancePassed', 'fullE33Accepted')) {
        if (!$Value.ContainsKey($key) -or $Value[$key] -isnot [bool] -or $Value[$key]) { return $false }
    }
    foreach ($key in @('rootPid', 'descendantPid', 'rootBirthFileTime', 'descendantBirthFileTime',
        'rootExitCode', 'descendantExitCode', 'preExitCensus', 'ownerExitCode', 'initialInventoryCount')) {
        if (!$Value.ContainsKey($key) -or ($Value[$key] -isnot [int] -and $Value[$key] -isnot [long] -and $Value[$key] -isnot [uint32])) { return $false }
    }
    if ($Value.preExitCensus -lt 2 -or $Value.preExitCensus -gt 4 -or $Value.preExitCensus -ne $Value.initialInventoryCount -or
        $Value.ownerExitCode -ne 143 -or $Value.rootPid -le 0 -or
        $Value.rootPid -gt [uint32]::MaxValue -or $Value.descendantPid -le 0 -or $Value.descendantPid -gt [uint32]::MaxValue -or
        $Value.rootPid -eq $Value.descendantPid -or $Value.rootBirthFileTime -le 0 -or $Value.descendantBirthFileTime -le 0 -or
        $Value.rootExitCode -lt 0 -or $Value.rootExitCode -gt [uint32]::MaxValue -or $Value.rootExitCode -eq 259 -or
        $Value.descendantExitCode -lt 0 -or $Value.descendantExitCode -gt [uint32]::MaxValue -or $Value.descendantExitCode -eq 259) { return $false }
    foreach ($key in @('jobClosureConfirmed', 'cleanupJobTerminationAccepted', 'witnessJobHandlesReleasedBeforeOwnerExit', 'postExitJobObservation')) {
        if (!$Value.ContainsKey($key)) { return $false }
    }
    if ($Recovery) {
        if (!$Value.ContainsKey('processesAliveAfterOwnerExit') -or $Value.processesAliveAfterOwnerExit -isnot [bool] -or !$Value.processesAliveAfterOwnerExit) { return $false }
        return $Value.jobClosureConfirmed -is [bool] -and $Value.jobClosureConfirmed -and
            $Value.cleanupJobTerminationAccepted -is [bool] -and $Value.cleanupJobTerminationAccepted -and
            $Value.witnessJobHandlesReleasedBeforeOwnerExit -is [bool] -and !$Value.witnessJobHandlesReleasedBeforeOwnerExit -and
            $Value.postExitJobObservation -ceq 'confirmed-empty' -and $Value.rootExitCode -eq 137 -and $Value.descendantExitCode -eq 137
    }
    return $null -eq $Value.jobClosureConfirmed -and $Value.cleanupJobTerminationAccepted -is [bool] -and !$Value.cleanupJobTerminationAccepted -and
        $Value.witnessJobHandlesReleasedBeforeOwnerExit -is [bool] -and $Value.witnessJobHandlesReleasedBeforeOwnerExit -and
        $Value.postExitJobObservation -ceq 'handle-released-not-observed'
}

# Inbox Windows PowerShell-compatible receipt reader. The caller separately binds
# exact transferred sources, selected standard-user SID, process exit and VM epoch.
function Read-CloudGuestOwnerLifetimeBoundedUtf8([IO.FileStream]$Stream, [int]$MaximumBytes) {
    if ($MaximumBytes -lt 1 -or $MaximumBytes -gt 64KB -or !$Stream.CanRead) { throw 'fixed-owner-lifetime-receipt-refused' }
    $bytes = New-Object byte[] ($MaximumBytes + 1); $count = 0
    while ($count -lt $bytes.Length) {
        $read = $Stream.Read($bytes, $count, $bytes.Length - $count)
        if ($read -eq 0) { break }; $count += $read
    }
    if ($count -gt $MaximumBytes) { throw 'fixed-owner-lifetime-receipt-refused' }
    $text = [Text.UTF8Encoding]::new($false, $true).GetString($bytes, 0, $count)
    if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) { return $text.Substring(1) }
    return $text
}

function Read-CloudGuestOwnerLifetimeReceipt([string]$Path, [string]$ExpectedSid, [switch]$RequireStandardPrincipal) {
    $file = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -gt 16KB) { throw 'fixed-owner-lifetime-receipt-refused' }
    $held = [IO.File]::Open($file.FullName, 'Open', 'Read', 'Read')
    try { $text = Read-CloudGuestOwnerLifetimeBoundedUtf8 $held 16KB } finally { $held.Dispose() }
    $lines = [Collections.Generic.List[string]]::new(); $textReader = [IO.StringReader]::new($text)
    try {
        while ($null -ne ($line = $textReader.ReadLine())) {
            $lines.Add($line)
            if ($lines.Count -gt 2) { throw 'fixed-owner-lifetime-receipt-refused' }
        }
    } finally { $textReader.Dispose() }
    if ($lines.Count -ne 2) { throw 'fixed-owner-lifetime-receipt-refused' }
    if ($PSVersionTable.PSEdition -ceq 'Core') {
        $records = @($lines | ForEach-Object { ConvertFrom-Json -InputObject $_ -AsHashtable -ErrorAction Stop })
    } else {
        Add-Type -AssemblyName System.Web.Extensions
        $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
        $records = @($serializer.DeserializeObject($lines[0]), $serializer.DeserializeObject($lines[1]))
    }
    if (!(Test-CloudGuestOwnerLifetimeCase $records[0] $ExpectedSid $true -RequireStandardPrincipal:$RequireStandardPrincipal) -or
        !(Test-CloudGuestOwnerLifetimeCase $records[1] $ExpectedSid $false -RequireStandardPrincipal:$RequireStandardPrincipal)) { throw 'fixed-owner-lifetime-receipt-refused' }
    return @{ schemaVersion = 1; kind = 'fixed-controlled-owner-exit'; passed = $true; cases = $records;
        launchAllowed = $false; e2Qualified = $false; e3Qualified = $false; e6Qualified = $false; acceptancePassed = $false; fullE33Accepted = $false }
}

function Assert-CloudGuestOwnerLifetimeOuterClosure($Identity, [string]$ExpectedSid) {
    foreach ($key in @('passed', 'heldIdentityBeforeRelease', 'runtimeResumed', 'runtimeCallerAuthenticated',
        'runtimeInitializedBeforeProject', 'taskReleased', 'exitCodeObserved', 'jobClosureConfirmed')) {
        if ($Identity.$key -isnot [bool] -or !$Identity.$key) { throw 'owner-lifetime-outer-closure-unconfirmed' }
    }
    if ($Identity.sid -cne $ExpectedSid -or $null -ne $Identity.failureStage -or
        ($Identity.exitCode -isnot [int] -and $Identity.exitCode -isnot [long] -and $Identity.exitCode -isnot [uint32]) -or $Identity.exitCode -ne 0) { throw 'owner-lifetime-outer-closure-unconfirmed' }
    foreach ($key in @('pid', 'birthFileTime')) {
        $value = $Identity.$key
        if (($value -isnot [int] -and $value -isnot [long] -and $value -isnot [uint32]) -or $value -le 0 -or
            ($key -ceq 'pid' -and $value -gt [uint32]::MaxValue)) { throw 'owner-lifetime-outer-closure-unconfirmed' }
    }
}

function Read-CloudGuestOwnerLifetimeAfterClosure($Identity, [string]$Path, [string]$ExpectedSid, [switch]$RequireStandardPrincipal) {
    Assert-CloudGuestOwnerLifetimeOuterClosure $Identity $ExpectedSid
    return Read-CloudGuestOwnerLifetimeReceipt $Path $ExpectedSid -RequireStandardPrincipal:$RequireStandardPrincipal
}
