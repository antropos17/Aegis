[CmdletBinding()]
param(
    [string]$OutputRoot = (Join-Path ([IO.Path]::GetTempPath()) ('aegis-etw-' + [guid]::NewGuid().ToString('N'))),
    [ValidateRange(5, 120)][int]$Seconds = 5,
    [string]$ProbePath = (Join-Path $PSScriptRoot 'bin/Release/net10.0-windows/EtwProbe.exe')
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false # Exit 5 is retained measurement data, not a terminating shell error.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Open an administrator PowerShell terminal. No ETW session was started.'
}
if (-not (Test-Path -LiteralPath $ProbePath -PathType Leaf)) {
    throw 'Build EtwProbe.csproj in a normal terminal first (see README).'
}
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
if (Test-Path -LiteralPath $OutputRoot) { throw 'OutputRoot must be a new directory.' }
$null = New-Item -ItemType Directory -Path $OutputRoot
$runs = @(
    @{ Name = 'idle'; Scenario = 'idle'; Mask = '0x1B0'; Events = 'all' },
    @{ Name = 'read-only'; Scenario = 'buffered'; Mask = '0x100'; Events = '15' },
    @{ Name = 'names-read'; Scenario = 'buffered'; Mask = '0x190'; Events = '10,12,15' },
    @{ Name = 'lifecycle'; Scenario = 'buffered'; Mask = '0x1B0'; Events = '10,12,13,14,15' },
    @{ Name = 'pid-filter'; Scenario = 'buffered'; Filter = 'target' },
    @{ Name = 'preopened'; Scenario = 'preopened' },
    @{ Name = 'async'; Scenario = 'async' },
    @{ Name = 'mapped'; Scenario = 'mapped' },
    @{ Name = 'churn-close'; Scenario = 'churn' },
    @{ Name = 'churn-cleanup'; Scenario = 'churn'; Evict = 'cleanup' },
    @{ Name = 'churn-no-eviction'; Scenario = 'churn'; Evict = 'none' }
)
$results = @()
foreach ($run in $runs) {
    $mask = if ($run.Mask) { $run.Mask } else { '0x1B0' }
    $events = if ($run.Events) { $run.Events } else { '10,12,13,14,15' }
    $filter = if ($run.Filter) { $run.Filter } else { 'none' }
    $evict = if ($run.Evict) { $run.Evict } else { 'close' }
    Write-Host ('Measuring ' + $run.Name)
    & $ProbePath capture (Join-Path $OutputRoot $run.Name) --seconds $Seconds --scenario $run.Scenario --keywords $mask --events $events --pid-filter $filter --evict $evict
    $probeExit = $LASTEXITCODE
    $results += [pscustomobject]@{ name = $run.Name; exitCode = $probeExit }
    if ($probeExit -notin @(0, 5)) { break }
}
$results | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $OutputRoot 'matrix.json') -Encoding utf8
Write-Host ('Results: ' + $OutputRoot)
if ($results.Count -ne $runs.Count -or @($results | Where-Object exitCode -ne 0).Count -gt 0) { exit 5 }
exit 0
