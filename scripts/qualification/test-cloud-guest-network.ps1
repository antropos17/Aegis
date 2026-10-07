Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
. (Join-Path $PSScriptRoot 'cloud-guest-media.ps1')
$temporary = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
$parent = Get-Item -LiteralPath $temporary -Force
while ($null -ne $parent) { if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'network-fixture-reparse-refused' }; $parent = $parent.Parent }
$fixture = Join-Path $temporary ('aegis-guest-network-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    $dll = Join-Path $fixture 'network-controls.dll'
    $arguments = @('/nologo', '/target:library', '/platform:x64', '/warnaserror+', ('/out:"' + $dll + '"'),
        ('"' + (Join-Path $PSScriptRoot 'CloudGuestNetwork.cs') + '"'), ('"' + (Join-Path $project 'sidecar/session/GuestJobNative.cs') + '"'))
    $exit = Invoke-CloudGuestNativeProcess $compiler $arguments (Join-Path $fixture 'compile.txt') (Join-Path $fixture 'compile.error') 10000
    if ($exit -ne 0 -or (Get-Item -LiteralPath $dll).Length -gt 1MB) { throw 'network-native-compile-refused' }
    $assembly = [Reflection.Assembly]::Load([IO.File]::ReadAllBytes($dll))
    $endpointParser = $assembly.GetType('CloudGuestNetwork').GetMethod('Endpoint', [Reflection.BindingFlags]'NonPublic,Static')
    $fileWriter = $assembly.GetType('CloudGuestNetwork').GetMethod('FreshJson', [Reflection.BindingFlags]'NonPublic,Static')
    $stopFence = $assembly.GetType('CloudGuestNetwork').GetMethod('StopWindow', [Reflection.BindingFlags]'NonPublic,Static')
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'cloud-guest-bootstrap.ps1'), [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw 'network-bootstrap-parse-refused' }
    foreach ($name in @('Read-CloudGuestNetworkControls', 'Merge-CloudGuestNetworkControls')) {
        $definition = $ast.FindAll({ param($item) $item -is [Management.Automation.Language.FunctionDefinitionAst] }, $false) | Where-Object Name -ceq $name
        if (@($definition).Count -ne 1) { throw 'network-function-missing' }; . ([scriptblock]::Create($definition.Extent.Text))
    }
    $script:checks = 0
    function Check([bool]$Value, [string]$Code) { if (!$Value) { throw $Code }; $script:checks++ }
    $freshPath = Join-Path $fixture 'native-fresh.json'
    [void]$fileWriter.Invoke($null, @([string]$freshPath, [string]'{}'))
    Check (([IO.File]::ReadAllBytes($freshPath).Length -eq 2)) 'native-file-bom-or-content-changed'
    $accepted = $false; try { [void]$fileWriter.Invoke($null, @([string]$freshPath, [string]'{}')); $accepted = $true } catch { }
    Check (!$accepted) 'native-existing-endpoint-overwritten'
    $oversizedPath = Join-Path $fixture 'native-oversized.json'
    $accepted = $false; try { [void]$fileWriter.Invoke($null, @([string]$oversizedPath, [string]('x' * 8193))); $accepted = $true } catch { }
    Check (!$accepted -and !(Test-Path -LiteralPath $oversizedPath)) 'native-oversized-file-created'
    [void]$stopFence.Invoke($null, @([long]17400, [long]17499))
    Check ($true) 'native-timely-stop-refused'
    $delay = [Diagnostics.Stopwatch]::StartNew(); Start-Sleep -Milliseconds 10
    $afterDelay = [long]17499 + $delay.ElapsedMilliseconds
    foreach ($times in @(@([long]17499, [long]$afterDelay), @([long]17000, [long]18000), @([long]100, [long]99))) {
        $accepted = $false; try { [void]$stopFence.Invoke($null, $times); $accepted = $true } catch { }
        Check (!$accepted) 'native-late-or-backwards-stop-accepted'
    }
    $observations = Join-Path $fixture 'loopback.json'
    $exit = Invoke-CloudGuestNativeProcess (Get-Command node.exe).Source @(('"' + (Join-Path $PSScriptRoot 'test-cloud-guest-network.cjs') + '"')) $observations (Join-Path $fixture 'loopback.error') 18000
    Check ($exit -eq 0 -and (Get-Item -LiteralPath $observations).Length -le 8192 -and (Get-Item -LiteralPath (Join-Path $fixture 'loopback.error')).Length -eq 0) 'actual-local-loopback-refused'
    $actual = [IO.File]::ReadAllText($observations) | ConvertFrom-Json
    $ready = '{"type":"ready","endpoint":{"schemaVersion":1,"nonce":"' + $actual.endpoint.nonce + '","ports":{"tcp4":' + $actual.endpoint.ports.tcp4 + ',"udp4":' + $actual.endpoint.ports.udp4 + ',"tcp6":' + $actual.endpoint.ports.tcp6 + ',"udp6":' + $actual.endpoint.ports.udp6 + '}}}'
    $endpointJson = $endpointParser.Invoke($null, @($ready))
    Check (($endpointJson | ConvertFrom-Json).nonce -ceq $actual.endpoint.nonce) 'native-endpoint-positive-refused'
    foreach ($frame in @(($ready + "`n"), ($ready.Replace('"schemaVersion":1', '"schemaVersion":2')), ($ready.Replace('"tcp4":' + $actual.endpoint.ports.tcp4, '"tcp4":0')), ($ready.Replace('"tcp4":' + $actual.endpoint.ports.tcp4, '"tcp4":65536')), ($ready.Replace('"tcp4":' + $actual.endpoint.ports.tcp4, '"tcp4":01')), ($ready.Replace('"nonce":', '"address":"192.0.2.1","nonce":')))) {
        $accepted = $false; try { [void]$endpointParser.Invoke($null, @($frame)); $accepted = $true } catch { }
        Check (!$accepted) 'native-endpoint-malformed-accepted'
    }
    $identity = [Collections.Generic.Dictionary[string,object]]::new()
    foreach ($name in @('runtimeResumed', 'runtimeCallerAuthenticated', 'runtimeInitializedBeforeProject', 'networkReceiverStartedAfterRuntimeReady', 'jobClosureConfirmed', 'networkReceiverOutsideTaskJob', 'networkReceiverStartedAfterHeldAdmission', 'networkReceiverAdministratorEnabled', 'networkReceiverSameOwnerSid', 'networkReceiverStoppedAfterJobClosure', 'networkReceiverExitObserved', 'networkReceiverResultWritten')) { $identity[$name] = $true }
    foreach ($name in @('networkReceiverForced', 'networkReceiverDisposalUnknown', 'networkReceiverExpiredBeforeStop')) { $identity[$name] = $false }
    $identity['networkReceiverPid'] = 123; $identity['networkReceiverBirthFileTime'] = [long]456; $identity['networkReceiverExitCode'] = 0
    $identity['networkReceiverReadyMilliseconds'] = [long]10; $identity['networkReceiverReleaseMilliseconds'] = [long]20; $identity['networkReceiverStopMilliseconds'] = [long]1000; $identity['networkReceiverStopSubmittedMilliseconds'] = [long]1001
    $identity['networkReceiverExitMilliseconds'] = [long]1010
    $endpointPath = Join-Path $fixture 'endpoint.json'; $clientPath = Join-Path $fixture 'client.json'; $receiverPath = Join-Path $fixture 'receiver.json'
    function Save($Client, $Receiver) {
        [IO.File]::WriteAllText($endpointPath, $endpointJson)
        [IO.File]::WriteAllText($clientPath, ($Client | ConvertTo-Json -Depth 8 -Compress))
        [IO.File]::WriteAllText($receiverPath, ($Receiver | ConvertTo-Json -Depth 8 -Compress))
    }
    Save $actual.client $actual.receiver
    $positive = Read-CloudGuestNetworkControls $identity $endpointPath $clientPath $receiverPath
    Check ($positive.passed -and !$positive.e3Qualified -and !$positive.launchAllowed -and !$positive.labCorpusComplete) 'actual-network-projection-refused'
    foreach ($mode in @('duplicate-client', 'missing-client', 'partial-client', 'submitted-only', 'missing-eof', 'extra-count', 'wrong-digest', 'receiver-error', 'receiver-open', 'wrong-scope', 'qualified-claim', 'extra-payload')) {
        $client = $actual.client | ConvertTo-Json -Depth 8 | ConvertFrom-Json
        $receiver = $actual.receiver | ConvertTo-Json -Depth 8 | ConvertFrom-Json
        switch ($mode) {
            'duplicate-client' { $client.cases[1].id = 'tcp4' }
            'missing-client' { $client.cases = @($client.cases | Select-Object -First 9) }
            'partial-client' { $client.cases[0].passed = $false }
            'submitted-only' { $client.cases[2].observed = 'submitted-delivery-unobserved' }
            'missing-eof' { $receiver.receipt.cases[0].eof = 0 }
            'extra-count' { $receiver.receipt.cases[8].received = 3 }
            'wrong-digest' { $receiver.receipt.nonceDigest = '0' * 64 }
            'receiver-error' { $receiver.receipt.receiverError = $true }
            'receiver-open' { $receiver.receipt.openConnections = 1 }
            'wrong-scope' { $client.scope = 'direct-egress' }
            'qualified-claim' { $client.e3Qualified = $true }
            'extra-payload' { $client | Add-Member payload 'SECRET_SENTINEL' }
        }
        Save $client $receiver
        $value = Read-CloudGuestNetworkControls $identity $endpointPath $clientPath $receiverPath
        $merged = Merge-CloudGuestNetworkControls @{passed=$true;task=@{passed=$true};failureCode=$null} $value
        Check (!$value.passed -and !$merged.task.passed -and !(($value | ConvertTo-Json -Depth 8).Contains('SECRET_SENTINEL'))) ('network-corruption-accepted-' + $mode)
    }
    Save $actual.client $actual.receiver
    foreach ($name in @('runtimeResumed', 'runtimeCallerAuthenticated', 'runtimeInitializedBeforeProject', 'networkReceiverStartedAfterRuntimeReady', 'jobClosureConfirmed', 'networkReceiverOutsideTaskJob', 'networkReceiverAdministratorEnabled', 'networkReceiverSameOwnerSid', 'networkReceiverStoppedAfterJobClosure', 'networkReceiverExitObserved', 'networkReceiverResultWritten', 'networkReceiverForced', 'networkReceiverDisposalUnknown', 'networkReceiverExpiredBeforeStop')) {
        $saved = $identity[$name]; $identity[$name] = !$saved
        $value = Read-CloudGuestNetworkControls $identity $endpointPath $clientPath $receiverPath
        Check (!$value.passed -and !(Merge-CloudGuestNetworkControls @{passed=$true;task=@{passed=$true};failureCode=$null} $value).task.passed) ('native-network-refusal-overridden-' + $name)
        $identity[$name] = $saved
    }
    $identity['networkReceiverStopMilliseconds'] = [long]17500
    Check (!(Read-CloudGuestNetworkControls $identity $endpointPath $clientPath $receiverPath).passed) 'receiver-expiry-accepted'
    $identity['networkReceiverStopMilliseconds'] = [long]1000
    $identity['networkReceiverStopSubmittedMilliseconds'] = [long]18000
    Check (!(Read-CloudGuestNetworkControls $identity $endpointPath $clientPath $receiverPath).passed) 'post-stop-expiry-accepted'
    $identity['networkReceiverStopSubmittedMilliseconds'] = [long]1001
    $identity['networkReceiverExitMilliseconds'] = [long]18000
    Check (!(Read-CloudGuestNetworkControls $identity $endpointPath $clientPath $receiverPath).passed) 'receiver-late-exit-accepted'
    $identity['networkReceiverExitMilliseconds'] = [long]1000
    Check (!(Read-CloudGuestNetworkControls $identity $endpointPath $clientPath $receiverPath).passed) 'receiver-pre-submission-exit-accepted'
    $identity['networkReceiverExitMilliseconds'] = [long]1010
    $identity['networkReceiverExitCode'] = 7
    Check (!(Read-CloudGuestNetworkControls $identity $endpointPath $clientPath $receiverPath).passed) 'receiver-nonzero-overridden'
    $identity['networkReceiverExitCode'] = 0
    $identity.Remove('networkReceiverResultWritten') | Out-Null
    Check (!(Read-CloudGuestNetworkControls $identity $endpointPath $clientPath $receiverPath).passed) 'missing-native-result-observation-accepted'
    $identity['networkReceiverResultWritten'] = $true
    Remove-Item -LiteralPath $clientPath
    Check (!(Read-CloudGuestNetworkControls $identity $endpointPath $clientPath $receiverPath).passed) 'missing-network-result-accepted'
    [IO.File]::WriteAllText($clientPath, '{')
    Check (!(Read-CloudGuestNetworkControls $identity $endpointPath $clientPath $receiverPath).passed) 'malformed-network-result-accepted'
    [IO.File]::WriteAllText($clientPath, (' ' * 8193))
    Check (!(Read-CloudGuestNetworkControls $identity $endpointPath $clientPath $receiverPath).passed) 'oversized-network-result-accepted'
    if ($checks -ne 51) { throw 'network-control-count-mismatch' }
    @{passed=$true;checks=$checks;actualLocalLoopback=$true;nativeCompiledWarningsAsErrors=$true;nativePrincipalJobModel='fixture-only';guest=$false;node22Qualified=$false;e3Qualified=$false;launchAllowed=$false} | ConvertTo-Json -Depth 4
} finally {
    foreach ($file in @(Get-ChildItem -LiteralPath $fixture -File -Force)) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 64KB -or !$file.FullName.StartsWith($fixture + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'network-fixture-cleanup-refused' }
        Remove-Item -LiteralPath $file.FullName -Force
    }
    Remove-Item -LiteralPath $fixture
}
