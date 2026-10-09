param([string]$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -cne 'Desktop') { throw 'stdio-readiness-windows-powershell-required' }
. (Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-media.ps1')
$owned = Join-Path ([IO.Path]::GetFullPath($env:TEMP)) ('aegis-stdio-readiness-output-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $owned | Out-Null
$out = Join-Path $owned 'result.json'; $err = Join-Path $owned 'result.error'
$node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
$fixture = Join-Path $ProjectRoot 'tests/fixtures/native-cloud-guest-stdio-readiness/run.cjs'
$code = Invoke-CloudGuestNativeProcess $node @(('"' + $fixture + '"')) $out $err 30000
if ($code -ne 0 -or (Get-Item -LiteralPath $out).Length -gt 64KB -or (Get-Item -LiteralPath $err).Length -ne 0) { throw 'stdio-readiness-native-refused' }
$result = [IO.File]::ReadAllText($out) | ConvertFrom-Json
if ($result.passed -isnot [bool] -or !$result.passed -or $result.controls -ne 11 -or $result.standardUserQualified -or $result.actualHostedCauseProved -or
    $result.productionEnabled -or $result.launchAllowed -or $result.e2Qualified) { throw 'stdio-readiness-native-refused' }
$result | ConvertTo-Json -Depth 5
