param([Parameter(Mandatory = $true)][string]$TaskPassword, [Parameter(Mandatory = $true)][string]$ExpectedSid)

# Second fixed lab phase. Writable project test code is never executed by this administrator.
function Test-CloudGuestClaudeTaskReadRights([Security.AccessControl.FileSystemRights]$Rights) {
    # Allow rules constructed by Framework add Synchronize to ReadAndExecute.
    $expected = [Security.AccessControl.FileSystemRights]::ReadAndExecute -bor [Security.AccessControl.FileSystemRights]::Synchronize
    return [long]$Rights -eq [long]$expected
}
function Read-CloudGuestClaudeResult($Identity) {
    $result = @{ passed = $false; task = $null; receiver = $null; taskStatus = 'not-run'; receiverStatus = 'unavailable';
        acceptancePassed = $false; trustedTestProcessObservation = 'unknown'; e6Qualified = $false; launchAllowed = $false }
    function Need($Value) { if (!$Value) { throw 'claude-result-refused' } }
    function Boolean($Value, [bool]$Expected) { return $Value -is [bool] -and $Value -eq $Expected }
    function Number($Value, [long]$Maximum) { return ($Value -is [int] -or $Value -is [long] -or $Value -is [uint32]) -and $Value -ge 0 -and $Value -le $Maximum }
    function Fields($Value, [string]$Names) { return (@($Value.PSObject.Properties.Name | Sort-Object) -join ',') -ceq (@($Names -split ',' | Sort-Object) -join ',') }
    function ReadFixed([string]$Path) {
        $file = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
        Need (!$file.PSIsContainer -and !($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -and $file.Length -ge 2 -and $file.Length -le 8192)
        $held = [IO.File]::Open($file.FullName, 'Open', 'Read', 'Read')
        try {
            $buffer = New-Object byte[] 8193; $count = 0
            while ($count -lt $buffer.Length) { $read = $held.Read($buffer, $count, $buffer.Length - $count); if ($read -eq 0) { break }; $count += $read }
            Need ($count -eq $file.Length -and $count -le 8192)
            return ([Text.UTF8Encoding]::new($false, $true).GetString($buffer, 0, $count) | ConvertFrom-Json)
        } finally { $held.Dispose() }
    }
    try {
        Need ($null -ne $Identity -and (Boolean $Identity.taskReleased $true))
        $result.taskStatus = 'unavailable-closure-unknown'
        Need (Boolean $Identity.jobClosureConfirmed $true)
        $result.taskStatus = 'unavailable-or-refused'
        $task = ReadFixed 'C:\AegisLab\work\claude-result.json'
        Need (Fields $task 'acceptancePassed,cliExitCode,cliExitObserved,cliSha256,clientMilliseconds,clientResultValid,deadlineExpired,elapsedMilliseconds,failure,outputLimit,passed,schemaVersion,stage,stderrBytes,stdoutBytes,task,taskObservedEditedBytesMatch,taskObservedReadEditTestPassed,taskObservedTestExitCode,trustedTestProcessObservation,version')
        Need ((Number $task.schemaVersion 1) -and $task.schemaVersion -eq 1 -and $task.task -ceq 'fixed-claude-read-edit-test' -and
            $task.version -ceq '2.1.292' -and $task.stage -cin @('prepare', 'client', 'result', 'verify', 'complete') -and
            $task.trustedTestProcessObservation -ceq 'unknown' -and (Boolean $task.acceptancePassed $false))
        foreach ($name in @('passed', 'cliExitObserved', 'deadlineExpired', 'outputLimit', 'clientResultValid', 'taskObservedEditedBytesMatch', 'taskObservedReadEditTestPassed')) { Need ($task.$name -is [bool]) }
        Need ($null -eq $task.cliSha256 -or $task.cliSha256 -ceq 'eb95bb65955f8b1702e800815f9a2c0388a5de0f196c354c7ee1dd5cb9a2ba23')
        Need ($null -eq $task.failure -or $task.failure -cin @('prepare-refused', 'binary-refused', 'binary-changed', 'endpoint-refused', 'client-failed', 'client-timeout', 'client-output-limit', 'scratch-limit', 'result-refused', 'edit-refused', 'test-refused', 'phase-deadline'))
        foreach ($name in @('cliExitCode', 'taskObservedTestExitCode')) { Need ($null -eq $task.$name -or (Number $task.$name 4294967295)) }
        Need ((Number $task.stdoutBytes 65536) -and (Number $task.stderrBytes 4096) -and (Number $task.elapsedMilliseconds 60000) -and
            ($null -eq $task.clientMilliseconds -or (Number $task.clientMilliseconds 60000)))
        $result.task = $task; $result.taskStatus = 'task-observed-only'
        foreach ($name in @('passed', 'heldIdentityBeforeRelease', 'runtimeCallerAuthenticated', 'runtimeInitializedBeforeProject',
            'taskReleased', 'exitCodeObserved', 'jobClosureConfirmed', 'privateDesktopHandlesClosedAfterJobClosure',
            'claudeReceiverOutsideTaskJob', 'claudeReceiverAdministratorEnabled', 'claudeReceiverSameOwnerSid',
            'claudeReceiverStartedAfterRuntimeReady', 'claudeReceiverStoppedAfterJobClosure', 'claudeReceiverExitObserved', 'claudeReceiverResultWritten')) { Need (Boolean $Identity.$name $true) }
        foreach ($name in @('claudeReceiverForced', 'claudeReceiverDisposalUnknown', 'claudeReceiverExpiredBeforeStop', 'elevated', 'administratorEnabled')) { Need (Boolean $Identity.$name $false) }
        Need ((Number $Identity.exitCode 0) -and (Number $Identity.claudeReceiverExitCode 0))
        Need ((Number $Identity.claudeReceiverStopMilliseconds 42499) -and (Number $Identity.claudeReceiverStopSubmittedMilliseconds 43499) -and
            (Number $Identity.claudeReceiverExitMilliseconds 44999) -and $Identity.claudeReceiverStopSubmittedMilliseconds -ge $Identity.claudeReceiverStopMilliseconds -and
            $Identity.claudeReceiverExitMilliseconds -ge $Identity.claudeReceiverStopSubmittedMilliseconds)
        $receiver = ReadFixed 'C:\ProgramData\AegisCloudLab\admin\claude-receiver-result.json'
        Need (Fields $receiver 'clientEofCount,closed,completedResponses,connectionClosed,connectionCount,elapsedMilliseconds,expired,failure,forcedClosed,kind,passed,requests,schemaVersion,steps,stopObserved,toolResults')
        Need ($receiver.kind -ceq 'claude-receiver' -and (Number $receiver.schemaVersion 1) -and $receiver.schemaVersion -eq 1)
        foreach ($name in @('passed', 'closed', 'stopObserved')) { Need (Boolean $receiver.$name $true) }
        Need ((Boolean $receiver.expired $false) -and $null -eq $receiver.failure -and (Number $receiver.requests 4) -and $receiver.requests -eq 4 -and
            (Number $receiver.completedResponses 4) -and $receiver.completedResponses -eq 4 -and (Number $receiver.forcedClosed 0) -and
            (Number $receiver.connectionCount 8) -and $receiver.connectionCount -gt 0 -and (Number $receiver.connectionClosed 8) -and
            (Number $receiver.clientEofCount 8) -and $receiver.connectionClosed -eq $receiver.connectionCount -and $receiver.clientEofCount -eq $receiver.connectionCount -and
            (Number $receiver.elapsedMilliseconds 44999))
        Need ($receiver.steps -is [array] -and ($receiver.steps -join ',') -ceq 'read,edit,test,finish' -and $receiver.toolResults -is [array] -and $receiver.toolResults.Count -eq 3)
        foreach ($value in $receiver.toolResults) { Need (Boolean $value $true) }
        $result.receiver = $receiver; $result.receiverStatus = 'independently-closed-fixed-api-corpus'
        $result.passed = (Boolean $task.passed $true) -and $task.stage -ceq 'complete' -and $null -eq $task.failure -and
            $task.cliSha256 -ceq 'eb95bb65955f8b1702e800815f9a2c0388a5de0f196c354c7ee1dd5cb9a2ba23' -and
            (Boolean $task.cliExitObserved $true) -and (Number $task.cliExitCode 0) -and (Boolean $task.deadlineExpired $false) -and
            (Boolean $task.outputLimit $false) -and (Number $task.stderrBytes 0) -and (Boolean $task.clientResultValid $true) -and
            (Boolean $task.taskObservedEditedBytesMatch $true) -and (Boolean $task.taskObservedReadEditTestPassed $true) -and
            (Number $task.taskObservedTestExitCode 0) -and (Number $task.elapsedMilliseconds 40999) -and (Number $task.clientMilliseconds 31000)
    } catch { }
    return $result
}

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$stage = 'scope'; $identity = $null
try {
    if ($env:AEGIS_CLOUD_GUEST_LAB -cne 'trusted-bootstrap-v1' -or $env:GITHUB_ACTIONS -cne 'true' -or
        $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:RUNNER_OS -cne 'Windows' -or
        $env:AEGIS_CLOUD_GUEST_VM_ID -cnotmatch '^[a-f0-9-]{36}$' -or $ExpectedSid -cnotmatch '^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$') { throw 'claude-guest-scope-refused' }
    if (!([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'claude-guest-scope-refused' }
    $trusted = 'C:\ProgramData\AegisCloudLab\trusted'; $project = 'C:\AegisLab\work\claude'
    $taskUser = Get-LocalUser -Name AegisTask
    if (!$taskUser.Enabled -or $taskUser.SID.Value -cne $ExpectedSid -or @(Get-LocalGroupMember -SID 'S-1-5-32-544' | Where-Object SID -eq $taskUser.SID).Count) { throw 'claude-account-refused' }
    $stage = 'fixed-inputs'
    # No first-phase process remains; still refuse any preexisting second-phase material.
    foreach ($selected in @($project, 'C:\AegisLab\work\claude-result.json', "$trusted\claude-endpoint.json", 'C:\ProgramData\AegisCloudLab\admin\claude-receiver-result.json')) {
        if (Test-Path -LiteralPath $selected) { throw 'claude-fresh-phase-required' }
    }
    foreach ($selected in @($trusted, 'C:\AegisLab\work', 'C:\ProgramData\AegisCloudLab\admin')) {
        $entry = Get-Item -LiteralPath $selected -Force
        while ($null -ne $entry) { if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'claude-input-reparse' }; $entry = $entry.Parent }
    }
    $manifestFile = Get-Item -LiteralPath "$trusted\manifest.json" -Force
    if ($manifestFile.Attributes -band [IO.FileAttributes]::ReparsePoint -or $manifestFile.Length -gt 64KB) { throw 'claude-manifest-refused' }
    $manifest = [IO.File]::ReadAllText($manifestFile.FullName) | ConvertFrom-Json
    foreach ($leaf in @('node.exe', 'guest-process.dll', 'claude.exe', 'claude-protocol.cjs', 'claude-receiver.cjs', 'claude-task.cjs', 'claude-runtime.cjs', 'claude-sum.test.cjs')) {
        $expected = @($manifest.files | Where-Object name -CEQ $leaf)
        if ($expected.Count -ne 1 -or $expected[0].sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'claude-manifest-refused' }
        $file = Get-Item -LiteralPath (Join-Path $trusted $leaf) -Force
        $cap = if ($leaf -ceq 'claude.exe') { 384MB } elseif ($leaf -ceq 'node.exe') { 256MB } elseif ($leaf -ceq 'guest-process.dll') { 1MB } else { 64KB }
        if ($file.PSIsContainer -or $file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt $cap -or
            (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expected[0].sha256) { throw 'claude-input-hash-refused' }
        if ($leaf -ceq 'claude.exe' -and ($file.Length -ne 254858400 -or $expected[0].sha256 -cne 'eb95bb65955f8b1702e800815f9a2c0388a5de0f196c354c7ee1dd5cb9a2ba23')) { throw 'claude-binary-pin-refused' }
        $acl = Get-Acl -LiteralPath $file.FullName
        if (!$acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne 'S-1-5-32-544') { throw 'claude-trusted-acl-refused' }
        $taskRules = 0
        foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
            $sid = $rule.IdentityReference.Value
            if ($rule.AccessControlType -ne 'Allow' -or $rule.IsInherited -or $sid -cnotin @('S-1-5-18', 'S-1-5-32-544', $ExpectedSid)) { throw 'claude-trusted-acl-refused' }
            if ($sid -ceq $ExpectedSid) { $taskRules++; if (!(Test-CloudGuestClaudeTaskReadRights $rule.FileSystemRights)) { throw 'claude-trusted-acl-refused' } }
            elseif ($rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) { throw 'claude-trusted-acl-refused' }
        }
        if ($taskRules -ne 1) { throw 'claude-trusted-acl-refused' }
    }
    $stage = 'fresh-project-and-acl'
    New-Item -ItemType Directory -Path $project -ErrorAction Stop | Out-Null
    $acl = [Security.AccessControl.DirectorySecurity]::new(); $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    }
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($taskUser.SID, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')); Set-Acl -LiteralPath $project -AclObject $acl
    # Transfer leaves already received the first bootstrap's explicit admin-owned RO ACL.
    $stage = 'native-load'; Add-Type -Path "$trusted\guest-process.dll"
    $stage = 'native-run'
    try { $identity = [CloudGuestProcess]::RunClaude($TaskPassword, $ExpectedSid) }
    catch { $identity = [CloudGuestProcess]::FailureReceipt($_.Exception); if ($null -eq $identity) { throw 'claude-native-refused' } }
    $stage = 'closed-result-observation'; $controls = Read-CloudGuestClaudeResult $identity
    return @{ schemaVersion = 1; identity = $identity; task = $controls.task; receiver = $controls.receiver; passed = $controls.passed;
        taskStatus = $controls.taskStatus; receiverStatus = $controls.receiverStatus; acceptancePassed = $false;
        trustedTestProcessObservation = 'unknown'; e6Qualified = $false; launchAllowed = $false; labOnlyPowerShellDirect = $true }
} catch {
    return @{ schemaVersion = 1; passed = $false; identity = $identity; task = $null; receiver = $null; taskStatus = 'unavailable';
        receiverStatus = 'unavailable'; failureStage = $stage; failureHResult = [int]$_.Exception.HResult; acceptancePassed = $false;
        trustedTestProcessObservation = 'unknown'; e6Qualified = $false; launchAllowed = $false; labOnlyPowerShellDirect = $true }
}
