# Qualification-only host socket ownership. Never changes interface/firewall policy.
Set-StrictMode -Version Latest
function Get-CloudHostRouteSnapshot([string]$Id, [string]$Name, [string]$VmRoot, [ref]$Diagnostic) {
    Assert-CloudGuestRunner
    $observation = @{ phase = 'input'; reason = 'input-unconfirmed'; vmCount = 0; idMatched = $false; nameMatched = $false;
        configContained = $false; reparseFree = $false; observedId = $null; observedName = $null; observedConfig = $null;
        state = $null; nics = $null; nameType = 'unobserved'; configType = 'unobserved'; vmType = 'unobserved' }
    if ($null -ne $Diagnostic) { $Diagnostic.Value = $observation }
    $expectedName = '^aegis-cloud-' + [regex]::Escape($env:GITHUB_RUN_ID) + '-' + [regex]::Escape($env:GITHUB_RUN_ATTEMPT) + '-[a-f0-9]{32}$'
    $expectedRoot = 'D:\aegis-cloud-guest-' + $env:GITHUB_RUN_ID + '-' + $env:GITHUB_RUN_ATTEMPT + '\vm'
    if ($Id -notmatch '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' -or
        $Name -cnotmatch $expectedName -or
        ![IO.Path]::GetFullPath($VmRoot).TrimEnd('\').Equals($expectedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'host-route-owned-vm-refused' }
    $observation.phase = 'provider-query'; $observation.reason = 'provider-query-unconfirmed'
    $found = @(Get-VM -Id ([guid]$Id) -ErrorAction Stop); $observation.vmCount = [Math]::Min($found.Count, 2)
    if ($found.Count -ne 1) { $observation.reason = 'provider-count'; throw 'host-route-owned-vm-refused' }
    $vm = $found[0]
    $observation.vmType = if ($vm.PSObject.TypeNames -contains 'Microsoft.HyperV.PowerShell.VirtualMachine') { 'hyperv-vm' } else { 'other' }
    if ($null -eq $vm.Id) { $observation.reason = 'provider-id-missing'; throw 'host-route-owned-vm-refused' }
    $observedId = $vm.Id.ToString().ToLowerInvariant()
    if ($observedId -cmatch '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$') { $observation.observedId = $observedId }
    $observation.idMatched = $observedId -ceq $Id
    $observation.nameType = if ($vm.Name -is [string]) { 'string' } else { 'other' }
    if ($vm.Name -is [string] -and $vm.Name.Length -le 128 -and $vm.Name -cmatch $expectedName) { $observation.observedName = $vm.Name }
    $observation.nameMatched = $vm.Name -is [string] -and $vm.Name -ceq $Name
    if (!$observation.idMatched -or !$observation.nameMatched) { $observation.reason = 'provider-identity'; throw 'host-route-owned-vm-refused' }
    $observation.phase = 'provider-config'; $observation.reason = 'provider-config-unconfirmed'
    $observation.configType = if ($vm.ConfigurationLocation -is [string]) { 'string' } else { 'other' }
    if ($vm.ConfigurationLocation -isnot [string] -or $vm.ConfigurationLocation.Length -gt 512) { throw 'host-route-owned-vm-refused' }
    $actual = [IO.Path]::GetFullPath($vm.ConfigurationLocation).TrimEnd('\')
    $observation.configContained = $actual.Equals($expectedRoot, [StringComparison]::OrdinalIgnoreCase) -or
        $actual.StartsWith($expectedRoot + '\', [StringComparison]::OrdinalIgnoreCase)
    if (!$observation.configContained) { $observation.reason = 'provider-config-outside-owned-root'; throw 'host-route-owned-vm-refused' }
    $observation.observedConfig = $actual
    $observation.reason = 'provider-config-reparse-or-unavailable'
    $cursor = Get-Item -LiteralPath $actual -Force -ErrorAction Stop
    $ancestors = 0
    while ($null -ne $cursor) {
        if (!(($cursor.Attributes -band [IO.FileAttributes]::Directory)) -or
            ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -or ++$ancestors -gt 32) { throw 'host-route-owned-vm-refused' }
        $cursor = $cursor.Parent
    }
    $observation.reparseFree = $true
    $nics = @(Get-VMNetworkAdapter -VM $vm -ErrorAction Stop).Count
    $observation.nics = [Math]::Min($nics, 2); $observation.phase = 'provider-state'
    $state = $vm.State.ToString()
    $observation.state = if ($state -cin @('Running', 'Off', 'Starting', 'Stopping', 'Saved', 'Paused', 'Saving', 'Pausing', 'Reset')) { $state } else { 'other' }
    if ($nics -ne 0) { $observation.reason = 'provider-nic-count'; throw 'host-route-zero-nic-unconfirmed' }
    if ($state -cne 'Running') { $observation.reason = 'provider-not-running'; throw 'host-route-owned-vm-not-running' }
    $observation.reason = 'confirmed'; $observation.phase = 'complete'
    return @{ vmId = $Id; name = $Name; vmRoot = $expectedRoot; runId = $env:GITHUB_RUN_ID; runAttempt = $env:GITHUB_RUN_ATTEMPT; nics = $nics; state = 'Running' }
}
function Get-CloudHostRouteAddresses {
    Assert-CloudGuestRunner
    $ipv4 = @(); $ipv6 = @()
    foreach ($interface in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
        if ($interface.OperationalStatus -ne [Net.NetworkInformation.OperationalStatus]::Up -or
            $interface.NetworkInterfaceType -in @([Net.NetworkInformation.NetworkInterfaceType]::Loopback, [Net.NetworkInformation.NetworkInterfaceType]::Tunnel)) { continue }
        foreach ($entry in $interface.GetIPProperties().UnicastAddresses) {
            if ($entry.DuplicateAddressDetectionState -ne [Net.NetworkInformation.DuplicateAddressDetectionState]::Preferred) { continue }
            $address = $entry.Address.ToString()
            if ($entry.Address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and
                $address -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)') { $ipv4 += $address }
            elseif ($entry.Address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetworkV6 -and
                $address -match '^f[cd]' -and $address -notmatch '%') { $ipv6 += $address }
        }
    }
    $ipv4 = @($ipv4 | Sort-Object -Unique); $ipv6 = @($ipv6 | Sort-Object -Unique)
    if ($ipv4.Count -eq 0) { throw 'host-route-private-ipv4-unavailable' }
    return @{ ipv4 = $ipv4[0]; ipv6 = $(if ($ipv6.Count) { $ipv6[0] } else { $null }) }
}
function Read-CloudHostRouteLine($Task, $Watch, [int]$Deadline, [int]$Budget) {
    while (!$Task.IsCompleted -and $Watch.ElapsedMilliseconds -lt $Deadline) { Start-Sleep -Milliseconds 20 }
    if (!$Task.IsCompleted -or $Task.IsFaulted -or $Task.IsCanceled) { throw 'host-route-frame-deadline' }
    $line = $Task.GetAwaiter().GetResult()
    if ($null -eq $line -or $line.Length -eq 0 -or [Text.Encoding]::UTF8.GetByteCount($line) -gt $Budget) { throw 'host-route-frame-refused' }
    return $line
}
function New-CloudHostRouteProcess([string]$Node, [string]$Script, [bool]$InputRedirected) {
    Assert-CloudGuestRunner
    $nodeFile = Get-Item -LiteralPath $Node -Force; $source = Get-Item -LiteralPath $Script -Force
    if ($nodeFile.PSIsContainer -or $source.PSIsContainer -or ($nodeFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        ($source.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $nodeFile.Length -gt 256MB -or $source.Length -gt 64KB -or
        $Node.Contains('"') -or $Script.Contains('"')) { throw 'host-route-pinned-source-refused' }
    $info = [Diagnostics.ProcessStartInfo]::new(); $info.FileName = $Node; $info.Arguments = '"' + $Script + '"'
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true; $info.RedirectStandardInput = $InputRedirected
    $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $info.EnvironmentVariables.Clear()
    foreach ($name in @('SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT', 'RUNNER_OS')) {
        $value = [Environment]::GetEnvironmentVariable($name); if ($null -ne $value) { $info.EnvironmentVariables[$name] = $value }
    }
    $info.EnvironmentVariables['NODE_DISABLE_COMPILE_CACHE'] = '1'
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $info
    try {
        if (!$process.Start()) { throw 'host-route-process-create-failed' }
        $handle = $process.Handle
        if ($handle -eq [IntPtr]::Zero) { throw 'host-route-process-handle-unavailable' }
        return $process
    } catch {
        try { if (!$process.HasExited) { $process.Kill(); $process.WaitForExit(1500) | Out-Null } } catch {}
        $process.Dispose(); throw 'host-route-process-create-failed'
    }
}
function Start-CloudHostRoutes([string]$Id, [string]$Name, [string]$VmRoot, [string]$Node, [string]$SupportRoot, [string]$SourceSha, [ref]$Diagnostic) {
    Assert-CloudGuestRunner
    $before = Get-CloudHostRouteSnapshot $Id $Name $VmRoot $Diagnostic
    if ($SourceSha -notmatch '^[a-f0-9]{40}$') { throw 'host-route-source-required' }
    $addresses = Get-CloudHostRouteAddresses
    $random = New-Object byte[] 16; $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($random) } finally { $rng.Dispose() }
    $configuration = @{ addresses = $addresses; nonce = ([BitConverter]::ToString($random)).Replace('-', '').ToLowerInvariant(); vmId = $Id; sourceSha = $SourceSha }
    $watch = [Diagnostics.Stopwatch]::StartNew(); $process = $null
    try {
        $process = New-CloudHostRouteProcess $Node (Join-Path $SupportRoot 'route-receiver.cjs') $true
        $ownerPid = $process.Id; $birth = $process.StartTime.ToUniversalTime().Ticks.ToString()
        if ($process.HasExited -or $process.MainModule.FileName -ine [IO.Path]::GetFullPath($Node) -or $process.HasExited) { throw 'host-route-held-image-refused' }
        $stderr = $process.StandardError.ReadToEndAsync()
        $process.StandardInput.Write(($configuration | ConvertTo-Json -Compress -Depth 5) + "`n"); $process.StandardInput.Flush()
        $endpoint = (Read-CloudHostRouteLine ($process.StandardOutput.ReadLineAsync()) $watch 6000 2048) | ConvertFrom-Json
        if ($endpoint.vmId -cne $Id -or $endpoint.sourceSha -cne $SourceSha -or $endpoint.nonce -cne $configuration.nonce -or
            $endpoint.addresses.ipv4 -cne $addresses.ipv4 -or $endpoint.addresses.ipv6 -cne $addresses.ipv6) { throw 'host-route-readiness-refused' }
        return @{ process = $process; stderr = $stderr; finalLine = $process.StandardOutput.ReadLineAsync(); watch = $watch; endpoint = $endpoint;
            before = $before; id = $Id; name = $Name; vmRoot = $VmRoot; node = $Node; supportRoot = $SupportRoot;
            ownerPid = $ownerPid; birth = $birth; imageSha256 = (Get-FileHash -LiteralPath $Node -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
    catch {
        if ($null -ne $process) { try { $process.StandardInput.Close(); if (!$process.WaitForExit(1500)) { $process.Kill(); $process.WaitForExit(1500) | Out-Null } } catch {}; $process.Dispose() }
        $watch.Stop(); throw 'host-route-start-refused'
    }
}
function Stop-CloudHostRoutes($Owner, [bool]$JobClosed) {
    Assert-CloudGuestRunner
    $process = $Owner.process; $forced = $false; $stopMs = $Owner.watch.ElapsedMilliseconds; $final = $null
    $exitObserved = $false; $exitCode = $null; $exitMs = $null
    try {
        if (!$JobClosed -or $stopMs -ge 110000) { $process.StandardInput.Close() }
        else { $process.StandardInput.Write("stop`n"); $process.StandardInput.Flush(); $process.StandardInput.Close() }
        $final = (Read-CloudHostRouteLine $Owner.finalLine $Owner.watch 115000 16384) | ConvertFrom-Json
        if (!$process.WaitForExit(1500)) { throw 'host-route-exit-unconfirmed' }
        $exitObserved = $true; $exitCode = $process.ExitCode; $exitMs = $Owner.watch.ElapsedMilliseconds
        if (!$Owner.stderr.IsCompleted -or $Owner.stderr.GetAwaiter().GetResult().Length -ne 0 -or
            $null -ne $process.StandardOutput.ReadLine() -or $exitMs -ge 115000) { throw 'host-route-output-refused' }
    }
    finally {
        try { if (!$process.HasExited) { $forced = $true; $process.Kill(); $process.WaitForExit(1500) | Out-Null } } catch { $forced = $true }
        $process.Dispose(); $Owner.watch.Stop()
    }
    return @{ receiver = $final; owner = @{ heldProcess = $true; birthObserved = $true; imagePinned = $true; pid = $Owner.ownerPid;
        birthTicks = $Owner.birth; imageSha256 = $Owner.imageSha256; exitObserved = $exitObserved; exitCode = $exitCode;
        closed = $true; forced = $forced; stopAfterJobClosure = $JobClosed; stopMilliseconds = $stopMs; exitMilliseconds = $exitMs } }
}
function Test-CloudHostRoutes($Owner, $Closed, $Identity, $Client, [bool]$TaskPassed, $After) {
    Assert-CloudGuestRunner
    $native = @{}; foreach ($entry in $Identity.GetEnumerator()) { $native[$entry.Key] = $entry.Value }
    if ($native.ContainsKey('birthFileTime')) { $native.birthFileTime = [string]$native.birthFileTime }
    $evidence = @{ endpoint = $Owner.endpoint; receiver = $Closed.receiver; owner = $Closed.owner; identity = $native;
        client = $Client; taskPassed = $TaskPassed; before = $Owner.before; after = $After }
    $process = New-CloudHostRouteProcess $Owner.node (Join-Path $Owner.supportRoot 'route-oracle.cjs') $true
    try {
        $stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync()
        $text = $evidence | ConvertTo-Json -Compress -Depth 15
        if ([Text.Encoding]::UTF8.GetByteCount($text) -gt 65536) { throw 'host-route-oracle-budget' }
        $process.StandardInput.Write($text); $process.StandardInput.Close()
        if (!$process.WaitForExit(3000) -or !$stdout.IsCompleted -or !$stderr.IsCompleted) { throw 'host-route-oracle-deadline' }
        $output = $stdout.GetAwaiter().GetResult()
        if ($stderr.GetAwaiter().GetResult().Length -ne 0 -or [Text.Encoding]::UTF8.GetByteCount($output) -gt 4096) { throw 'host-route-oracle-output' }
        $result = $output | ConvertFrom-Json
        if ($process.ExitCode -ne 0 -or $result.passed -ne $true) { throw 'host-route-oracle-refused' }
        return @{ status = $result.status; passed = $true; e3Qualified = $false; launchAllowed = $false;
            endpoint = $Owner.endpoint; receiver = $Closed.receiver; owner = $Closed.owner; client = $Client; before = $Owner.before; after = $After;
            ipv6Coverage = $result.ipv6Coverage; fromHostPositives = $true; deliberateGuestExposureControl = $false }
    }
    finally { try { if (!$process.HasExited) { $process.Kill(); $process.WaitForExit(1500) | Out-Null } } catch {}; $process.Dispose() }
}
