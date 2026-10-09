param([string]$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -cne 'Desktop') { throw 'stdio-retained-exit-windows-powershell-required' }
. (Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-media.ps1')
$owned = Join-Path ([IO.Path]::GetFullPath($env:TEMP)) ('aegis-stdio-retained-exit-output-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $owned | Out-Null
$out = Join-Path $owned 'result.json'; $err = Join-Path $owned 'result.error'
$node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
$fixture = Join-Path $ProjectRoot 'tests/fixtures/native-cloud-guest-stdio-retained-exit/run.cjs'
$code = Invoke-CloudGuestNativeProcess $node @(('"' + $fixture + '"')) $out $err 30000
if ($code -ne 0 -or (Get-Item -LiteralPath $out).Length -gt 64KB -or (Get-Item -LiteralPath $err).Length -ne 0) { throw 'stdio-retained-exit-native-refused' }
$result = [IO.File]::ReadAllText($out) | ConvertFrom-Json
if ($result.passed -isnot [bool] -or !$result.passed -or $result.controls -ne 4 -or
    $result.scope -cne 'actual-native-job-processes-with-synthetic-exit-visibility-schedule' -or
    $result.hostedFailingMemberIdentified -or $result.standardUserQualified -or $result.launchAllowed -or $result.e2Qualified) { throw 'stdio-retained-exit-native-refused' }
$result | ConvertTo-Json -Depth 5
