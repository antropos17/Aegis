param([Parameter(Mandatory = $true)][string]$TaskPassword, [Parameter(Mandatory = $true)][string]$ExpectedSid)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$result = @{ schemaVersion = 1; kind = 'fixed-cloud-stdio'; passed = $false; cases = @(); failureStage = $null;
    newReceiversStarted = $false; inputsHeldThroughClosure = $false; e2Qualified = $false; launchAllowed = $false }
$held = [Collections.Generic.List[IO.FileStream]]::new(); $stage = 'scope'
try {
    if ($env:AEGIS_CLOUD_GUEST_LAB -cne 'trusted-bootstrap-v1' -or $env:GITHUB_ACTIONS -cne 'true' -or
        $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:RUNNER_OS -cne 'Windows' -or
        $ExpectedSid -cnotmatch '^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$' -or
        !([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'stdio-refused' }
    $account = Get-LocalUser -Name AegisTask
    if (!$account.Enabled -or $account.SID.Value -cne $ExpectedSid -or @(Get-LocalGroupMember -SID 'S-1-5-32-544' | Where-Object SID -eq $account.SID).Count) { throw 'stdio-refused' }
    $trusted = 'C:\ProgramData\AegisCloudLab\trusted'; $stage = 'fixed-inputs'
    foreach ($path in @($trusted, 'C:\AegisLab\work')) {
        $entry = Get-Item -LiteralPath $path -Force
        while ($null -ne $entry) { if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'stdio-refused' }; $entry = $entry.Parent }
    }
    $manifestFile = Get-Item -LiteralPath "$trusted\manifest.json" -Force
    if ($manifestFile.PSIsContainer -or $manifestFile.Attributes -band [IO.FileAttributes]::ReparsePoint -or $manifestFile.Length -gt 64KB) { throw 'stdio-refused' }
    $manifest = [IO.File]::ReadAllText($manifestFile.FullName) | ConvertFrom-Json
    foreach ($leaf in @('node.exe', 'guest-process.dll', 'guest-stdio-host.dll', 'guest-stdio.exe', 'cloud-stdio-runtime.cjs', 'cloud-stdio-task.cjs', 'stdio-fixed-task.cjs')) {
        $expected = @($manifest.files | Where-Object name -CEQ $leaf)
        $file = Get-Item -LiteralPath (Join-Path $trusted $leaf) -Force
        $cap = if ($leaf -ceq 'node.exe') { 256MB } elseif ($leaf -ceq 'guest-process.dll') { 80KB } else { 64KB }
        if ($expected.Count -ne 1 -or $expected[0].sha256 -cnotmatch '^[a-f0-9]{64}$' -or $file.PSIsContainer -or
            $file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -lt 1 -or $file.Length -gt $cap) { throw 'stdio-refused' }
        $stream = [IO.File]::Open($file.FullName, 'Open', 'Read', 'Read'); $held.Add($stream)
        if ($stream.Length -ne $file.Length) { throw 'stdio-refused' }
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $actual = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
        if ($actual -cne $expected[0].sha256) { throw 'stdio-refused' }
    }
    $stage = 'loader'; Add-Type -Path "$trusted\guest-process.dll"
    $loader = [CloudGuestLoaderProbe]::QualifyDocumentedForNewOwner($TaskPassword, $ExpectedSid)
    if ($loader.passed -isnot [bool] -or !$loader.passed) { throw 'stdio-refused' }
    foreach ($kind in 1..5) {
        $stage = 'native-stdio'
        $value = [CloudGuestProcess]::RunStdio($TaskPassword, $ExpectedSid, $kind)
        $result.cases += $value
        if ($value.passed -isnot [bool] -or !$value.passed -or $value.jobClosureConfirmed -isnot [bool] -or !$value.jobClosureConfirmed) { throw 'stdio-refused' }
    }
    $result.inputsHeldThroughClosure = $true; $result.passed = $result.cases.Count -eq 5
} catch { $result.failureStage = $stage; $result.passed = $false }
finally { foreach ($stream in $held) { $stream.Dispose() } }
return $result
